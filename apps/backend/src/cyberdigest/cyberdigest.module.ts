import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { CyberdigestController } from './cyberdigest.controller';
import { IngestionService } from './ingestion.service';
import { KevService } from './kev.service';
import { CveVerificationService } from './cve-verification.service';
import { ZeroDayService } from './zero-day.service';
import { StoryReviewService } from './story-review.service';
import { DigestService } from './digest.service';
import { HealthWatchService } from './health-watch.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, AuditModule, NotificationsModule],
  controllers: [CyberdigestController],
  providers: [IngestionService, KevService, CveVerificationService, ZeroDayService, StoryReviewService, DigestService, HealthWatchService],
  exports: [IngestionService, CveVerificationService, ZeroDayService, StoryReviewService, DigestService],
})
export class CyberdigestModule {}
