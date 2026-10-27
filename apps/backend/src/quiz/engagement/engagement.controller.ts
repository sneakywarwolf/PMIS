import { Controller, Get } from '@nestjs/common';

import { EngagementService } from './engagement.service';
import { Permission } from '../../common/permissions';

@Controller('quiz/engagement')
export class EngagementController {
  constructor(private readonly engagement: EngagementService) {}

  @Get()
  @Permission('quiz.engagement')
  summary() {
    return this.engagement.summary();
  }
}
