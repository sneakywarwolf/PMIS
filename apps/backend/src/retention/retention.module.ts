import { Module } from '@nestjs/common';
import { RetentionService } from './retention.service';
import { RetentionController } from './retention.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ReportsModule } from '../reports/reports.module';
import { SettingsModule } from '../settings/settings.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [PrismaModule, ReportsModule, SettingsModule, AuditModule],
  controllers: [RetentionController],
  providers: [RetentionService],
})
export class RetentionModule {}
