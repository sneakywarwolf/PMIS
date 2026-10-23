import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { APP_GUARD } from '@nestjs/core';
import IORedis from 'ioredis';

import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ProjectsModule } from './projects/projects.module';
import { ReportsModule } from './reports/reports.module';
import { VulnerabilitiesModule } from './vulnerabilities/vulnerabilities.module';
import { AuditModule } from './audit/audit.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { PresenceModule } from './presence/presence.module';
import { FindingsModule } from './findings/findings.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SettingsModule } from './settings/settings.module';
import { QuizModule } from './quiz/quiz.module';
import { RetentionModule } from './retention/retention.module';
import { EasterEggModule } from './easter-egg/easter-egg.module';
import { UpdateModule } from './update/update.module';

import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { RateLimitGuard } from './common/rate-limit.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env',
    }),
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: new IORedis(config.get<string>('REDIS_URL') || 'redis://localhost:6379', {
          maxRetriesPerRequest: null,
        }),
      }),
    }),
    PrismaModule,
    RedisModule,
    AuthModule,
    UsersModule,
    ProjectsModule,
    FindingsModule,
    ReportsModule,
    VulnerabilitiesModule,
    AuditModule,
    DashboardModule,
    PresenceModule,
    NotificationsModule,
    SettingsModule,
    QuizModule,
    RetentionModule,
    EasterEggModule,
    UpdateModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
