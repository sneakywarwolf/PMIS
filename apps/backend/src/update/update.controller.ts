import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { UpdateService } from './update.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Update')
@Controller('update')
export class UpdateController {
  constructor(private readonly updates: UpdateService) {}

  @Get('status')
  @ApiOperation({ summary: 'Version, release notes and update state (any authenticated user)' })
  status() {
    return this.updates.getStatus();
  }

  @Post('check')
  @ApiOperation({ summary: 'Force a fresh check for a newer version (any authenticated user)' })
  check() {
    return this.updates.getStatus(true);
  }

  @Post('schedule')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Schedule the update for a date/time (Admin only)' })
  schedule(@Body('scheduledAt') scheduledAt: string, @CurrentUser('id') userId: string) {
    return this.updates.schedule(scheduledAt, userId);
  }

  @Delete('schedule')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Cancel a scheduled update (Admin only)' })
  cancel() {
    return this.updates.cancel();
  }
}
