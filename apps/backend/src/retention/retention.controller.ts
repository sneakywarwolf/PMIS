import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ProjectStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

const DAY_MS = 24 * 60 * 60 * 1000;

@ApiTags('Retention')
@Controller('retention')
export class RetentionController {
  constructor(
    private prisma: PrismaService,
    private settingsService: SettingsService,
  ) {}

  @Get('tracker')
  @ApiOperation({ summary: 'Completed projects with their retention countdown (visible to all roles)' })
  async getTracker() {
    const { settings } = await this.settingsService.get();
    const retentionDays = settings.system.projectRetentionDays;

    const projects = await this.prisma.project.findMany({
      where: { status: ProjectStatus.COMPLETED, generatedAt: { not: null } },
      select: { id: true, name: true, generatedAt: true },
      orderBy: { generatedAt: 'asc' },
    });

    const now = Date.now();
    return projects.map((p) => {
      const completedAt = p.generatedAt as Date;
      const scheduledDeletionDate = new Date(completedAt.getTime() + retentionDays * DAY_MS);
      const daysRemaining = Math.max(0, Math.ceil((scheduledDeletionDate.getTime() - now) / DAY_MS));
      return {
        projectId: p.id,
        projectName: p.name,
        completionDate: completedAt,
        retentionPeriodDays: retentionDays,
        daysRemaining,
        scheduledDeletionDate,
      };
    });
  }
}
