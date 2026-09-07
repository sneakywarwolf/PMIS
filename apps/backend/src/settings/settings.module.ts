import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { RedisModule } from '../redis/redis.module';
import { ReportsModule } from '../reports/reports.module';

@Module({
  imports: [PrismaModule, AuditModule, RedisModule, ReportsModule],
  providers: [SettingsService],
  controllers: [SettingsController],
  exports: [SettingsService],
})
export class SettingsModule {}
