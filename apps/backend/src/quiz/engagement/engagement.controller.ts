import { Controller, Get } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../auth/decorators/roles.decorator';
import { EngagementService } from './engagement.service';

@Controller('quiz/engagement')
export class EngagementController {
  constructor(private readonly engagement: EngagementService) {}

  @Roles(UserRole.ADMIN)
  @Get()
  summary() {
    return this.engagement.summary();
  }
}
