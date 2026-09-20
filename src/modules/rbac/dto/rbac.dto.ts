import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({
    description: 'Unique role name.',
    example: 'editor',
    maxLength: 64,
  })
  @IsString()
  @MaxLength(64)
  name: string;

  @ApiPropertyOptional({
    description: 'Human-readable description of the role.',
    example: 'Can manage content but not users.',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}

export class UpdateRoleDto {
  @ApiPropertyOptional({
    description: 'New role name.',
    example: 'editor',
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;

  @ApiPropertyOptional({
    description: 'Human-readable description of the role.',
    example: 'Can manage content but not users.',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}

export class CreatePermissionDto {
  @ApiProperty({
    description: 'Unique permission name (resource identifier).',
    example: 'users',
    maxLength: 64,
  })
  @IsString()
  @MaxLength(64)
  name: string;

  @ApiProperty({
    description: 'Actions allowed by this permission.',
    example: ['read', 'update'],
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  actions: string[];
}

export class UpdatePermissionDto {
  @ApiPropertyOptional({
    description: 'New permission name.',
    example: 'users',
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;

  @ApiPropertyOptional({
    description: 'Actions allowed by this permission.',
    example: ['read', 'update'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  actions?: string[];
}

export class CreateGrantDto {
  @ApiProperty({
    description: 'Identifier of the role receiving the grant.',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    format: 'uuid',
  })
  @IsUUID()
  roleId: string;

  @ApiProperty({
    description: 'Identifier of the permission being granted.',
    example: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    format: 'uuid',
  })
  @IsUUID()
  permissionId: string;

  @ApiPropertyOptional({
    description:
      'Subset of the permission actions to grant. Defaults to all actions.',
    example: ['read'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  actions?: string[];
}

export class UpdateGrantDto {
  @ApiPropertyOptional({
    description: 'Subset of the permission actions to grant.',
    example: ['read', 'update'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  actions?: string[];
}
