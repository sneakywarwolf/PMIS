import { Body, Controller, Get, Put } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { TeamsService } from './teams.service';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Permission } from '../../common/permissions';

@Controller('quiz/teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get('leaderboard')
  @Permission('quiz.play')
  leaderboard(@CurrentUser('id') userId: string) {
    return this.teams.leaderboard(userId);
  }

  @Get('names')
  @Permission('quiz.play')
  names() {
    return this.teams.names();
  }

  @Get('me')
  @Permission('quiz.play')
  mine(@CurrentUser('id') userId: string, @CurrentUser('role') role: UserRole) {
    return this.teams.mine(userId, role);
  }

  // Team leads rename their own team; admins rename any team (teamLeadId). The name is used on Quiz/Arcade boards and nowhere else.
  @Put('name')
  @Permission('quiz.rename_team')
  rename(
    @CurrentUser('id') id: string,
    @CurrentUser('role') role: UserRole,
    @Body('name') name?: string,
    @Body('teamLeadId') teamLeadId?: string,
  ) {
    return this.teams.rename({ id, role }, name, teamLeadId);
  }
}
