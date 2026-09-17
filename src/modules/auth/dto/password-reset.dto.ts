import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';

export class PasswordResetRequestDto {
  @ApiProperty({
    description: 'Email address to send the password reset code to.',
    example: 'user@example.com',
    maxLength: 320,
  })
  @IsEmail()
  @MaxLength(320)
  email: string;
}

export class PasswordResetConfirmDto {
  @ApiProperty({
    description: 'Email address the reset code was sent to.',
    example: 'user@example.com',
    maxLength: 320,
  })
  @IsEmail()
  @MaxLength(320)
  email: string;

  @ApiProperty({
    description: 'Six-digit one-time confirmation code.',
    example: '123456',
    minLength: 6,
    maxLength: 6,
  })
  @IsString()
  @Length(6, 6)
  code: string;

  @ApiProperty({
    description: 'New password to set (8-128 characters).',
    example: 'N3wS3curePass!',
    minLength: 8,
    maxLength: 128,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword: string;
}
