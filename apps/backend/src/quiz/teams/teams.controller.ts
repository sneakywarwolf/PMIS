import { Body, Controller, Get, Put } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { TeamsService } from './teams.service';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller('quiz/teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get('leaderboard')
  leaderboard(@CurrentUser('id') userId: string) {
    return this.teams.leaderboard(userId);
  }

  @Get('names')
  names() {
    return this.teams.names();
  }

  @Get('me')
  mine(@CurrentUser('id') userId: string, @CurrentUser('role') role: UserRole) {
    return this.teams.mine(userId, role);
  }

  // Team leads only; the name is used on Quiz/Arcade boards and nowhere else.
  @Roles(UserRole.TEAM_LEAD)
  @Put('name')
  rename(@CurrentUser('id') leadId: string, @Body('name') name?: string) {
    return this.teams.rename(leadId, name);
  }
}
