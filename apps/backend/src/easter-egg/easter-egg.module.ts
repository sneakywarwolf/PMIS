import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EasterEggController } from './easter-egg.controller';
import { EasterEggGateway } from './easter-egg.gateway';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [PrismaModule, RedisModule, JwtModule.register({})],
  controllers: [EasterEggController],
  providers: [EasterEggGateway],
})
export class EasterEggModule {}
