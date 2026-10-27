import { pocStepImagePaths } from '../common/poc-images.util';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ProjectStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../reports/storage.service';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { ProjectPurgeService, PurgeableProject } from '../common/project-purge.service';

const DAY_MS = 24 * 60 * 60 * 1000;
// Purged rows are deleted, so a capped batch just means the rest are picked up by the next hourly sweep.
const PURGE_BATCH = 25;

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private settingsService: SettingsService,
    private auditService: AuditService,
    private projectPurge: ProjectPurgeService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async runRetentionSweep(): Promise<void> {
    const systemActor = await this.prisma.user.findFirst({ where: { role: UserRole.ADMIN, isActive: true }, select: { id: true } });
    await this.deleteExpiredPocAttachments(systemActor?.id ?? null);
    await this.deleteExpiredCompletedProjects(systemActor?.id ?? null);
    await this.deleteExpiredUsers(systemActor?.id ?? null);
  }

  // Users deleted by an admin get a 24h grace period (isActive: false,
  // deletedAt set) during which reactivating restores them with data intact.
  // Once the window lapses without reactivation, purge their owned projects.
  private async deleteExpiredUsers(systemActorId: string | null): Promise<void> {
    const cutoff = new Date(Date.now() - DAY_MS);

    const expiredUsers = await this.prisma.user.findMany({
      where: { isActive: false, deletedAt: { lt: cutoff } },
      take: PURGE_BATCH,
      include: {
        projectsOwned: {
          include: { reportGenerations: true, findings: { include: { pocSteps: true } } },
        },
      },
    });

    for (const user of expiredUsers) {
      let filesDeleted = 0;
      for (const project of user.projectsOwned) {
        const result = await this.projectPurge.purgeProject(project);
        filesDeleted += result.filesDeleted;
      }

      // Delete the user row last so the sweep can't pick them up (and re-audit
      // them) again next hour. Needs an admin to inherit rows that must survive.
      if (systemActorId) await this.deleteUserRow(user.id, systemActorId);

      if (systemActorId) {
        await this.auditService.log({
          actorId: systemActorId,
          action: 'USER_RETENTION_PURGED',
          targetType: 'USER',
          targetId: user.id,
          ipAddress: 'system',
          userAgent: 'retention-cron',
          details: { username: user.username, projectsDeleted: user.projectsOwned.length, filesDeleted },
        });
      }
    }

    if (expiredUsers.length > 0) {
      this.logger.log(`User retention: purged data for ${expiredUsers.length} deleted user(s)`);
    }
  }

  // Same handling as the DB reset's user removal: shared rows go to the admin,
  // per-user rows (one-per-user quiz/arcade data) are
  // deleted, optional references (incl. the audit-log actor) null themselves via ON DELETE SET NULL, and
  // notifications cascade.
  private async deleteUserRow(userId: string, adminId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.project.updateMany({ where: { tlId: userId }, data: { tlId: adminId } }),
      this.prisma.finding.updateMany({ where: { createdById: userId }, data: { createdById: adminId } }),
      this.prisma.reportGeneration.updateMany({ where: { generatedById: userId }, data: { generatedById: adminId } }),
      this.prisma.reportTemplate.updateMany({ where: { uploadedById: userId }, data: { uploadedById: adminId } }),
      this.prisma.quizQuestion.updateMany({ where: { createdById: userId }, data: { createdById: adminId } }),
      this.prisma.vulnerabilityChangeRequest.updateMany({ where: { requestedById: userId }, data: { requestedById: adminId } }),
      this.prisma.quizAttempt.deleteMany({ where: { userId } }),
      this.prisma.quizUserStats.deleteMany({ where: { userId } }),
      this.prisma.patternMapScore.deleteMany({ where: { userId } }),
      this.prisma.user.delete({ where: { id: userId } }),
    ]);
  }

  private async deleteExpiredPocAttachments(systemActorId: string | null): Promise<void> {
    const { settings } = await this.settingsService.get();
    const retentionDays = settings.system.attachmentRetentionDays;
    const cutoff = new Date(Date.now() - retentionDays * DAY_MS);

    const expiredSteps = await this.prisma.pocStep.findMany({
      where: { OR: [{ imagePath: { not: null } }, { extraImagePaths: { isEmpty: false } }], createdAt: { lt: cutoff } },
      select: { id: true, imagePath: true, extraImagePaths: true },
    });

    for (const step of expiredSteps) {
      for (const path of pocStepImagePaths(step)) {
        try {
          await this.storage.deleteFile(path);
        } catch (error) {
          this.logger.error(`Failed to delete PoC attachment ${path}`, error as Error);
        }
      }
      await this.prisma.pocStep.update({ where: { id: step.id }, data: { imagePath: null, extraImagePaths: [] } });
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

    const expiredProjects: (PurgeableProject & { name: string })[] = await this.prisma.project.findMany({
      where: { status: ProjectStatus.COMPLETED, generatedAt: { lt: cutoff } },
      take: PURGE_BATCH,
      include: {
        reportGenerations: true,
        findings: { include: { pocSteps: true } },
      },
    });

    for (const project of expiredProjects) {
      const { filesDeleted } = await this.projectPurge.purgeProject(project);
      if (systemActorId) {
        await this.auditService.log({
          actorId: systemActorId,
          action: 'PROJECT_RETENTION_DELETED',
          targetType: 'PROJECT',
          targetId: project.id,
          ipAddress: 'system',
          userAgent: 'retention-cron',
          details: { name: project.name, filesDeleted },
        });
      }
    }

    if (expiredProjects.length > 0) {
      this.logger.log(`Project retention: deleted ${expiredProjects.length} expired completed project(s)`);
    }
  }
}
