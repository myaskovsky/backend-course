import { ApiProperty } from '@nestjs/swagger';

import { UserStatus } from '../entities/user.entity';

export class UserListItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'jane@example.com' })
  email: string;

  @ApiProperty({ type: String, nullable: true })
  photo: string | null;

  @ApiProperty({ type: String, nullable: true })
  displayName: string | null;

  @ApiProperty({ enum: UserStatus })
  status: UserStatus;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: Date, nullable: true })
  lastLoginAt: Date | null;
}

export class PaginatedUsersDto {
  @ApiProperty({ type: UserListItemDto, isArray: true })
  items: UserListItemDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Pass as `cursor` to get the next page; null on the last page.',
  })
  nextCursor: string | null;
}
