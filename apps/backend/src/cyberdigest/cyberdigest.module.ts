import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CyberdigestController } from './cyberdigest.controller';
import { IngestionService } from './ingestion.service';
import { KevService } from './kev.service';
import { CveVerificationService } from './cve-verification.service';

@Module({
  imports: [PrismaModule],
  controllers: [CyberdigestController],
  providers: [IngestionService, KevService, CveVerificationService],
  exports: [IngestionService, CveVerificationService],
})
export class CyberdigestModule {}
