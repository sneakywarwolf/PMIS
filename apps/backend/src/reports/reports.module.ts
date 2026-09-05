import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { StorageService } from './storage.service';
import { DocxManipulatorService } from './docx-manipulator.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [ReportsController],
  providers: [ReportsService, StorageService, DocxManipulatorService],
  exports: [ReportsService, StorageService, DocxManipulatorService],
})
export class ReportsModule {}
