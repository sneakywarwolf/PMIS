import { Body, Controller, Get, Post } from '@nestjs/common';
import { ArcadeService } from './arcade.service';
import { SubmitPatternMapDto } from './arcade.dto';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller('quiz/arcade')
export class ArcadeController {
  constructor(private readonly arcade: ArcadeService) {}

  @Post('pattern-map/scores')
  submit(@CurrentUser('id') userId: string, @Body() dto: SubmitPatternMapDto) {
    return this.arcade.submit(userId, dto);
  }

  @Get('pattern-map/leaderboard')
  leaderboard() {
    return this.arcade.leaderboard();
  }
}
