import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ProjectStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../reports/storage.service';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private settingsService: SettingsService,
    private auditService: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async runRetentionSweep(): Promise<void> {
    const systemActor = await this.prisma.user.findFirst({ where: { role: UserRole.ADMIN }, select: { id: true } });
    await this.deleteExpiredPocAttachments(systemActor?.id ?? null);
    await this.deleteExpiredCompletedProjects(systemActor?.id ?? null);
  }

  private async deleteExpiredPocAttachments(systemActorId: string | null): Promise<void> {
    const { settings } = await this.settingsService.get();
    const retentionDays = settings.system.attachmentRetentionDays;
    const cutoff = new Date(Date.now() - retentionDays * DAY_MS);

    const expiredSteps = await this.prisma.pocStep.findMany({
      where: { imagePath: { not: null }, createdAt: { lt: cutoff } },
      select: { id: true, imagePath: true },
    });

    for (const step of expiredSteps) {
      if (!step.imagePath) continue;
      try {
        await this.storage.deleteFile(step.imagePath);
      } catch (error) {
        this.logger.error(`Failed to delete PoC attachment ${step.imagePath}`, error as Error);
      }
      await this.prisma.pocStep.update({ where: { id: step.id }, data: { imagePath: null } });
    }

    if (expiredSteps.length > 0) {
      this.logger.log(`Attachment retention: deleted ${expiredSteps.length} expired PoC attachment(s)`);
      if (systemActorId) {
        await this.auditService.log({
          actorId: systemActorId,
          action: 'ATTACHMENT_RETENTION_DELETED',
          targetType: 'POC_STEP',
          ipAddress: 'system',
          userAgent: 'retention-cron',
          details: { count: expiredSteps.length },
        });
      }
    }
  }

  private async deleteExpiredCompletedProjects(systemActorId: string | null): Promise<void> {
    const { settings } = await this.settingsService.get();
    const retentionDays = settings.system.projectRetentionDays;
    const cutoff = new Date(Date.now() - retentionDays * DAY_MS);

    const expiredProjects = await this.prisma.project.findMany({
      where: { status: ProjectStatus.COMPLETED, generatedAt: { lt: cutoff } },
      include: {
        reportGenerations: true,
        findings: { include: { pocSteps: true } },
      },
    });

    for (const project of expiredProjects) {
      await this.deleteProjectAndArtifacts(project, systemActorId);
    }

    if (expiredProjects.length > 0) {
      this.logger.log(`Project retention: deleted ${expiredProjects.length} expired completed project(s)`);
    }
  }

  private async deleteProjectAndArtifacts(
    project: {
      id: string;
      name: string;
      reportDocxPath: string | null;
      reportPdfPath: string | null;
      reportGenerations: { docxPath: string | null; pdfPath: string | null }[];
      findings: { evidencePaths: string[]; pocSteps: { imagePath: string | null }[] }[];
    },
    systemActorId: string | null,
  ): Promise<void> {
    const filesToDelete: string[] = [];
    if (project.reportDocxPath) filesToDelete.push(project.reportDocxPath);
    if (project.reportPdfPath) filesToDelete.push(project.reportPdfPath);
    for (const rg of project.reportGenerations) {
      if (rg.docxPath) filesToDelete.push(rg.docxPath);
      if (rg.pdfPath) filesToDelete.push(rg.pdfPath);
    }
    for (const finding of project.findings) {
      filesToDelete.push(...finding.evidencePaths);
      for (const step of finding.pocSteps) {
        if (step.imagePath) filesToDelete.push(step.imagePath);
      }
    }

    for (const path of filesToDelete) {
      try {
        await this.storage.deleteFile(path);
      } catch (error) {
        this.logger.error(`Failed to delete stored file ${path} for project ${project.id}`, error as Error);
      }
    }

    // Cascades to Findings, PocSteps, and ReportGenerations at the database level.
    await this.prisma.project.delete({ where: { id: project.id } });

    if (systemActorId) {
      await this.auditService.log({
        actorId: systemActorId,
        action: 'PROJECT_RETENTION_DELETED',
        targetType: 'PROJECT',
        targetId: project.id,
        ipAddress: 'system',
        userAgent: 'retention-cron',
        details: { name: project.name, filesDeleted: filesToDelete.length },
      });
    }
  }
}
