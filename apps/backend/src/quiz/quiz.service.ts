import { Injectable, ConflictException, BadRequestException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class QuizService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sweepQuizStatuses(): Promise<void> {
    const now = new Date();

    await this.prisma.quizQuestion.updateMany({
      where: { status: 'SCHEDULED', scheduledFor: { lte: now } },
      data: { status: 'ACTIVE' },
    });

    await this.prisma.quizQuestion.updateMany({
      where: { status: 'ACTIVE', scheduledFor: { lte: new Date(now.getTime() - TWENTY_FOUR_HOURS_MS) } },
      data: { status: 'REVEALED', revealedAt: now },
    });
  }
}
