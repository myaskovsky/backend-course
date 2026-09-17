import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    description: 'Email address of the account.',
    example: 'user@example.com',
    maxLength: 320,
  })
  @IsEmail()
  @MaxLength(320)
  email: string;

  @ApiProperty({
    description: 'Account password.',
    example: 'S3curePass!',
    maxLength: 128,
  })
  @IsString()
  @MaxLength(128)
  password: string;
}
