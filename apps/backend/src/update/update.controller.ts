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
  status(@CurrentUser('role') role: UserRole) {
    return this.updates.getStatus(false, role === UserRole.ADMIN);
  }

  @Post('check')
  @ApiOperation({ summary: 'Force a fresh check for a newer version; when an Admin checks and one is available, the update starts right away' })
  check(@CurrentUser('role') role: UserRole, @CurrentUser('id') userId: string) {
    return this.updates.checkAndUpdate(role === UserRole.ADMIN, userId);
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
