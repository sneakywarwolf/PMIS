import { Module } from '@nestjs/common';
import { FindingsService } from './findings.service';
import { FindingsController } from './findings.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { ReportsModule } from '../reports/reports.module';
import { VulnerabilitiesModule } from '../vulnerabilities/vulnerabilities.module';
import { SettingsModule } from '../settings/settings.module';
import { ProjectFindingsService } from './project-findings.service';
import { FortifyImportService } from './fortify-import.service';

@Module({
  imports: [PrismaModule, AuditModule, ReportsModule, VulnerabilitiesModule, SettingsModule],
  controllers: [FindingsController],
  providers: [FindingsService, ProjectFindingsService, FortifyImportService],
  exports: [FindingsService],
})
export class FindingsModule {}
