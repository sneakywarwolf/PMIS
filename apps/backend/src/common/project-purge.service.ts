import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../reports/storage.service';

export type PurgeableProject = {
  id: string;
  reportDocxPath: string | null;
  reportPdfPath: string | null;
  reportGenerations: { docxPath: string | null; pdfPath: string | null }[];
  findings: { evidencePaths: string[]; pocSteps: { imagePath: string | null }[] }[];
};

/**
 * Permanently deletes a project's stored files (report docx/pdf, finding
 * evidence, PoC images) and then the Project row itself. Prisma cascade
 * removes the Finding/PocStep/ReportGeneration DB rows. Shared by the
 * retention sweep and the user-deletion cascade — callers own their own
 * audit logging, since the actor/action differ per caller.
 */
@Injectable()
export class ProjectPurgeService {
  private readonly logger = new Logger(ProjectPurgeService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  async purgeProject(project: PurgeableProject): Promise<{ filesDeleted: number }> {
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

    await this.prisma.project.delete({ where: { id: project.id } });

    return { filesDeleted: filesToDelete.length };
  }

  /** Fetches a project with everything purgeProject() needs, or null if it doesn't exist. */
  async loadPurgeableProject(projectId: string): Promise<PurgeableProject | null> {
    return this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        reportGenerations: true,
        findings: { include: { pocSteps: true } },
      },
    });
  }
}
