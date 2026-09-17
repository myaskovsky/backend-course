import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({
    description: 'The user current password.',
    example: 'S3curePass!',
    maxLength: 128,
  })
  @IsString()
  @MaxLength(128)
  currentPassword: string;

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
