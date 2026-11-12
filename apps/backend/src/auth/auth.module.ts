import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AccountLockService } from './account-lock.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { AuditModule } from '../audit/audit.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    AuditModule,
    SettingsModule,
    PassportModule,
    JwtModule.register({
      // No fallback value: a missing secret must make signing and verification fail, never use a published default.
      secret: process.env.JWT_ACCESS_SECRET,
      signOptions: { expiresIn: '15m' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AccountLockService],
  exports: [AuthService, AccountLockService, JwtModule],
})
export class AuthModule {}
