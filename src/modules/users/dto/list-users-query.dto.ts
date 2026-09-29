import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { UserStatus } from '../entities/user.entity';

export enum UserSortField {
  CREATED_AT = 'created_at',
  LAST_LOGIN = 'last_login',
  EMAIL = 'email',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export class ListUsersQueryDto {
  @ApiPropertyOptional({
    description:
      'Opaque cursor from the previous page (`nextCursor`). Only valid with the same `sort` and `order`; a malformed or mismatched cursor returns 400.',
    example: 'eyJ2IjoiMjAyNi0wMS0wMSIsImlkIjoiLi4uIn0',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Maximum number of users to return per page.',
    example: 20,
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({
    description:
      'Search string: case-insensitive substring of email or display name (wildcards are matched literally), or an exact user id.',
    example: 'jane',
    maxLength: 320,
  })
  @IsOptional()
  @IsString()
  @MaxLength(320)
  q?: string;

  @ApiPropertyOptional({
    description: 'Filter by account status.',
    enum: UserStatus,
  })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({
    description: 'Field to sort results by.',
    enum: UserSortField,
    default: UserSortField.CREATED_AT,
  })
  @IsOptional()
  @IsEnum(UserSortField)
  sort: UserSortField = UserSortField.CREATED_AT;

  @ApiPropertyOptional({
    description: 'Sort direction.',
    enum: SortOrder,
    default: SortOrder.DESC,
  })
  @IsOptional()
  @IsEnum(SortOrder)
  order: SortOrder = SortOrder.DESC;
}
