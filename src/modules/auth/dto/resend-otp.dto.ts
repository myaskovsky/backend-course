import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ResendOtpDto {
  @ApiProperty({
    description: 'Identifier of the challenge to resend the OTP for.',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    format: 'uuid',
  })
  @IsUUID()
  challengeId: string;
}
