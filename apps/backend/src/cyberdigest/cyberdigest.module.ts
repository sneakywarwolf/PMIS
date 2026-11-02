import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CyberdigestController } from './cyberdigest.controller';
import { IngestionService } from './ingestion.service';

@Module({
  imports: [PrismaModule],
  controllers: [CyberdigestController],
  providers: [IngestionService],
  exports: [IngestionService],
})
export class CyberdigestModule {}
