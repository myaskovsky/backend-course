import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { RequirePermission } from '@/modules/rbac/decorators/require-permission.decorator';
import { RbacGuard } from '@/modules/rbac/guards/rbac.guard';

import { ListUsersQueryDto } from './dto/list-users-query.dto';
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
  @ApiOkResponse({ description: 'A paginated list of users.' })
  @ApiForbiddenResponse({ description: 'Missing users@list permission.' })
  list(@Query() query: ListUsersQueryDto): Promise<PaginatedUsers> {
    return this.usersService.list(query);
  }
}
