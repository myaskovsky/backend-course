import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Length } from 'class-validator';

export class ConfirmDto {
  @ApiProperty({
    description: 'Identifier of the challenge issued during the flow.',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    format: 'uuid',
  })
  @IsUUID()
  challengeId: string;

  @ApiProperty({
    description: 'Six-digit one-time confirmation code.',
    example: '123456',
    minLength: 6,
    maxLength: 6,
  })
  @IsString()
  @Length(6, 6)
  code: string;
}
