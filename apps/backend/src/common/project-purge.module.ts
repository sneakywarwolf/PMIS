import { Module } from '@nestjs/common';
import { ProjectPurgeService } from './project-purge.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ReportsModule } from '../reports/reports.module';

@Module({
  imports: [PrismaModule, ReportsModule],
  providers: [ProjectPurgeService],
  exports: [ProjectPurgeService],
})
export class ProjectPurgeModule {}
