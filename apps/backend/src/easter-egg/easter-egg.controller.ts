import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Easter Egg')
@Controller('easter-egg')
export class EasterEggController {
  @Get('uptime')
  @ApiOperation({ summary: 'Backend uptime only (any authenticated user)' })
  uptime() {
    return { uptimeSeconds: Math.round(process.uptime()) };
  }
}
