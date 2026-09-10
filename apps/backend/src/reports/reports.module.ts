import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { StorageService } from './storage.service';
import { DocxManipulatorService } from './docx-manipulator.service';
import { ReportGenerationProcessor } from './report-generation.processor';
import { REPORT_GENERATION_QUEUE } from './report-generation.types';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    BullModule.registerQueue({ name: REPORT_GENERATION_QUEUE }),
  ],
  controllers: [ReportsController],
  providers: [ReportsService, StorageService, DocxManipulatorService, ReportGenerationProcessor],
  exports: [ReportsService, StorageService, DocxManipulatorService],
})
export class ReportsModule {}
