import { IsString, MinLength, MaxLength, IsEmail, IsOptional, IsEnum } from 'class-validator';
import { UserRole } from '@prisma/client';

export class LoginDto {
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  username: string;

  @IsString()
  @MinLength(8)
  password: string;
}

export class CreateUserDto {
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  username: string;

  @IsEmail()
  email: string;

  @IsEnum(UserRole)
  role: UserRole;

  @IsOptional()
  @IsString()
  assignedTlId?: string;

  @IsOptional()
  fullName?: string;

  @IsOptional()
  phone?: string;

  @IsOptional()
  designation?: string;

  @IsOptional()
  managerId?: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  username?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsString()
  assignedTlId?: string;

  @IsOptional()
  fullName?: string;

  @IsOptional()
  phone?: string;

  @IsOptional()
  designation?: string;

  @IsOptional()
  managerId?: string;

  @IsOptional()
  isActive?: boolean;
}

export class ChangePasswordDto {
  // Only required for a voluntary change (profile page) — a forced change
  // (isForcePasswordChange) skips this since the user already proved
  // possession of the current/temp password by logging in with it.
  @IsOptional()
  @IsString()
  currentPassword?: string;

  @IsString()
  @MinLength(14)
  newPassword: string;
}

export class ForcePasswordResetDto {
  @IsString()
  userId: string;
}
