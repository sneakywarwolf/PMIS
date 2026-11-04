import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CyberdigestController } from './cyberdigest.controller';
import { CyberdigestAccessGuard } from './access.guard';
import { DigestConfigService } from './digest-config.service';
import { JobRunner } from './job-runner';
import { IngestionService } from './ingestion.service';
import { KevService } from './kev.service';
import { CveVerificationService } from './cve-verification.service';
import { ZeroDayService } from './zero-day.service';
import { StoryReviewService } from './story-review.service';
import { DigestService } from './digest.service';
import { HealthWatchService } from './health-watch.service';

@Module({
  imports: [PrismaModule, AuditModule, NotificationsModule],
  controllers: [CyberdigestController],
  providers: [
    CyberdigestAccessGuard, DigestConfigService, JobRunner, IngestionService, KevService, CveVerificationService, ZeroDayService, StoryReviewService, DigestService, HealthWatchService,
  ],
  exports: [DigestService, DigestConfigService],
})
export class CyberdigestModule {}
