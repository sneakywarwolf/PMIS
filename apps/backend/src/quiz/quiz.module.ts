import { Module } from '@nestjs/common';
import { QuizController } from './quiz.controller';
import { QuizService } from './quiz.service';
import { ArcadeController } from './arcade/arcade.controller';
import { ArcadeService } from './arcade/arcade.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, AuditModule, NotificationsModule],
  controllers: [QuizController, ArcadeController],
  providers: [QuizService, ArcadeService],
})
export class QuizModule {}
