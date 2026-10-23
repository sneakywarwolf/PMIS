import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { User, UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { PresenceService } from './presence.service';

@ApiTags('Presence')
@Controller('presence')
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  /**
   * Called by every signed-in client about every 30s. `active: true` means the person has used the page
   * recently and records them as live; `active: false` only reads the count. Any signed-in role may call it,
   * and it only ever returns a number.
   */
  @Post('ping')
  @ApiOperation({ summary: 'Heartbeat + live user count (all signed-in users)' })
  async ping(@CurrentUser('id') userId: string, @Body() body: { active?: boolean }) {
    if (body?.active === true) await this.presence.heartbeat(userId);
    return { count: await this.presence.count(), thresholdSeconds: this.presence.thresholdMs / 1000 };
  }

  @Get('active-users')
  @Roles(UserRole.ADMIN, UserRole.TEAM_LEAD, UserRole.AVP)
  @ApiOperation({ summary: 'Currently active users within the caller’s scope (Admin, Team Lead, AVP only)' })
  async activeUsers(@CurrentUser() user: User) {
    const users = await this.presence.listFor(user);
    return {
      thresholdSeconds: this.presence.thresholdMs / 1000,
      users: users.map((u) => ({
        id: u.id,
        fullName: u.fullName,
        username: u.username,
        role: u.role,
        teamLead: u.teamLeadName,
        lastActiveAt: u.lastActiveAt,
      })),
    };
  }
}
