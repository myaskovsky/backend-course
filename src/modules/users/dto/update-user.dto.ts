import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

import { UserStatus } from '../entities/user.entity';

/**
 * All fields optional. Which fields a caller may actually change is enforced
 * in the service by role (Self vs Admin) — default-deny.
 */
export class UpdateUserDto {
  @ApiPropertyOptional({
    description: 'New email address (admin-only via this endpoint).',
    example: 'user@example.com',
    maxLength: 320,
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @ApiPropertyOptional({
    description: 'Display name shown on the profile.',
    example: 'Jane Doe',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string;

  @ApiPropertyOptional({
    description: 'URL of the profile photo.',
    example: 'https://cdn.example.com/avatars/jane.png',
    maxLength: 2048,
  })
  @IsOptional()
  @IsUrl()
  @MaxLength(2048)
  photo?: string;

  @ApiPropertyOptional({
    description: 'Account status (admin-only).',
    enum: UserStatus,
  })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}
