import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { RequestUser } from '@/modules/auth/auth.constants';
import { CurrentUser } from '@/modules/auth/decorators/current-user.decorator';
import { RequirePermission } from '@/modules/rbac/decorators/require-permission.decorator';
import { RbacGuard } from '@/modules/rbac/guards/rbac.guard';

import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { PaginatedUsersDto } from './dto/paginated-users.dto';
import { PaginatedUsers, UsersService } from './users.service';

@ApiTags('admin-users')
@ApiCookieAuth('access_token')
@Controller('admin/users')
@UseGuards(RbacGuard)
export class AdminUsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermission('users@list')
  @ApiOperation({ summary: 'List users with cursor pagination and filters' })
  @ApiOkResponse({ type: PaginatedUsersDto })
  @ApiBadRequestResponse({ description: 'Invalid query or cursor.' })
  @ApiForbiddenResponse({ description: 'Missing users@list permission.' })
  list(
    @Query() query: ListUsersQueryDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<PaginatedUsers> {
    return this.usersService.list(query, actor.userId);
  }
}
