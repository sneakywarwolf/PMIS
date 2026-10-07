import { Module } from '@nestjs/common';
import { QuizController } from './quiz.controller';
import { QuizService } from './quiz.service';
import { ArcadeController } from './arcade/arcade.controller';
import { ArcadeService } from './arcade/arcade.service';
import { TeamsController } from './teams/teams.controller';
import { TeamsService } from './teams/teams.service';
import { EngagementController } from './engagement/engagement.controller';
import { EngagementService } from './engagement/engagement.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, AuditModule, NotificationsModule],
  controllers: [QuizController, ArcadeController, TeamsController, EngagementController],
  providers: [QuizService, ArcadeService, TeamsService, EngagementService],
})
export class QuizModule {}
