import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';

export class EmailChangeDto {
  @ApiProperty({
    description: 'The new email address to associate with the account.',
    example: 'new-email@example.com',
    maxLength: 320,
  })
  @IsEmail()
  @MaxLength(320)
  newEmail: string;
}
