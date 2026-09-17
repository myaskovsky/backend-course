import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({
    description: 'Email address used to register the account.',
    example: 'user@example.com',
    maxLength: 320,
  })
  @IsEmail()
  @MaxLength(320)
  email: string;

  @ApiProperty({
    description: 'Account password (8-128 characters).',
    example: 'S3curePass!',
    minLength: 8,
    maxLength: 128,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @ApiPropertyOptional({
    description: 'Optional display name shown on the profile.',
    example: 'Jane Doe',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string;
}
