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

  // Team leads rename their own team; admins rename any team (teamLeadId). The name is used on Quiz/Arcade boards and nowhere else.
  @Roles(UserRole.TEAM_LEAD, UserRole.ADMIN)
  @Put('name')
  rename(
    @CurrentUser('id') id: string,
    @CurrentUser('role') role: UserRole,
    @Body('name') name?: string,
    @Body('teamLeadId') teamLeadId?: string,
  ) {
    return this.teams.rename({ id, role }, name, teamLeadId);
  }
}
