import { Controller, Get } from '@nestjs/common';
import { TeamsService } from './teams.service';

@Controller('quiz/teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get('leaderboard')
  leaderboard() {
    return this.teams.leaderboard();
  }
}
