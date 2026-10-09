import { Module } from '@nestjs/common';
import { FindingsService } from './findings.service';
import { FindingsController } from './findings.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { ReportsModule } from '../reports/reports.module';
import { VulnerabilitiesModule } from '../vulnerabilities/vulnerabilities.module';

@Module({
  imports: [PrismaModule, AuditModule, ReportsModule, VulnerabilitiesModule],
  controllers: [FindingsController],
  providers: [FindingsService],
  exports: [FindingsService],
})
export class FindingsModule {}
