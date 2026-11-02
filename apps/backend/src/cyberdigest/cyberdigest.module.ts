import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { CyberdigestController } from './cyberdigest.controller';
import { IngestionService } from './ingestion.service';
import { KevService } from './kev.service';
import { CveVerificationService } from './cve-verification.service';
import { ZeroDayService } from './zero-day.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [CyberdigestController],
  providers: [IngestionService, KevService, CveVerificationService, ZeroDayService],
  exports: [IngestionService, CveVerificationService, ZeroDayService],
})
export class CyberdigestModule {}
