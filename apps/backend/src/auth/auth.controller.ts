import { Controller, Post, Get, Body, Res, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { Response, Request } from 'express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto, ChangePasswordDto } from './dto/auth.dto';
import { Public } from './decorators/roles.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with username and password' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
    @Req() request: Request,
  ) {
    const ipAddress = request.ip || 'unknown';
    const userAgent = request.headers['user-agent'] || 'unknown';
    
    const result = await this.authService.validateUser(
      dto.username,
      dto.password,
      ipAddress,
      userAgent,
    );

    const accessMaxAge = result.access_expiry_seconds * 1000;
    const refreshMaxAge = result.refresh_expiry_seconds * 1000;

    response.cookie('access_token', result.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: accessMaxAge,
    });

    response.cookie('refresh_token', result.refresh_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: refreshMaxAge,
    });

    return { user: result.user };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = request.cookies?.refresh_token;
    if (!refreshToken) {
      return { error: 'No refresh token' };
    }

    const ipAddress = request.ip || 'unknown';
    const userAgent = request.headers['user-agent'] || 'unknown';
    
    const result = await this.authService.refreshTokens(refreshToken, ipAddress, userAgent);

    response.cookie('access_token', result.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: result.access_expiry_seconds * 1000,
    });

    response.cookie('refresh_token', result.refresh_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: result.refresh_expiry_seconds * 1000,
    });

    return { user: result.user };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout user' })
  async logout(
    @CurrentUser('id') userId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = request.cookies?.refresh_token;
    const ipAddress = request.ip || 'unknown';
    const userAgent = request.headers['user-agent'] || 'unknown';

    await this.authService.logout(userId, refreshToken, ipAddress, userAgent);

    response.clearCookie('access_token');
    response.clearCookie('refresh_token');

    return { message: 'Logged out successfully' };
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change password' })
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
    @Req() request: Request,
  ) {
    const ipAddress = request.ip || 'unknown';
    const userAgent = request.headers['user-agent'] || 'unknown';

    await this.authService.changePassword(userId, dto, ipAddress, userAgent);

    return { message: 'Password changed successfully' };
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  async me(@CurrentUser() user: any) {
    return { user };
  }
}
