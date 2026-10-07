import { Controller, Get, Put, Body, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { Public, Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  // Unauthenticated on purpose (login page theme). Declared before any ':param' route; exposes only the theme id.
  @Public()
  @Get('public-theme')
  @ApiOperation({ summary: 'Admin default theme id, for rendering the login page' })
  async publicTheme() {
    return this.settingsService.getPublicTheme();
  }

  @Get()
  @ApiOperation({ summary: 'Get effective application settings (any authenticated user)' })
  async get() {
    return this.settingsService.get();
  }

  @Put()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update application settings (Admin only)' })
  async update(@Body() body: any, @CurrentUser('id') userId: string, @Req() req: any) {
    const ipAddress = req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    return this.settingsService.update(body, userId, ipAddress, userAgent);
  }

  @Get('history')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get settings change history (Admin only)' })
  async history() {
    return this.settingsService.getHistory();
  }

  @Get('system-health')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get infrastructure health and configuration info (Admin only)' })
  async systemHealth() {
    return this.settingsService.getSystemHealth();
  }
}
