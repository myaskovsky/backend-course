import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { RequirePermission } from './decorators/require-permission.decorator';
import {
  CreateGrantDto,
  CreatePermissionDto,
  CreateRoleDto,
  UpdateGrantDto,
  UpdatePermissionDto,
  UpdateRoleDto,
} from './dto/rbac.dto';
import { RbacGuard } from './guards/rbac.guard';
import { RbacAdminService } from './rbac-admin.service';

@ApiTags('admin-rbac')
@ApiCookieAuth('access_token')
@Controller('admin/rbac')
@UseGuards(RbacGuard)
export class RbacController {
  constructor(private readonly rbacAdminService: RbacAdminService) {}

  // ---- Roles ----
  @Get('roles')
  @RequirePermission('rbac@read')
  @ApiOperation({ summary: 'List all roles' })
  @ApiOkResponse({ description: 'The list of roles.' })
  @ApiForbiddenResponse({ description: 'Missing rbac@read permission.' })
  listRoles() {
    return this.rbacAdminService.listRoles();
  }

  @Post('roles')
  @RequirePermission('rbac@create')
  @ApiOperation({ summary: 'Create a role' })
  @ApiCreatedResponse({ description: 'The created role.' })
  @ApiForbiddenResponse({ description: 'Missing rbac@create permission.' })
  createRole(@Body() dto: CreateRoleDto) {
    return this.rbacAdminService.createRole(dto);
  }

  @Put('roles/:id')
  @RequirePermission('rbac@update')
  @ApiOperation({ summary: 'Update a role' })
  @ApiOkResponse({ description: 'The updated role.' })
  @ApiForbiddenResponse({ description: 'Missing rbac@update permission.' })
  updateRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.rbacAdminService.updateRole(id, dto);
  }

  @Delete('roles/:id')
  @RequirePermission('rbac@delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a role' })
  @ApiNoContentResponse({ description: 'Role deleted.' })
  @ApiForbiddenResponse({ description: 'Missing rbac@delete permission.' })
  deleteRole(@Param('id', ParseUUIDPipe) id: string) {
    return this.rbacAdminService.deleteRole(id);
  }

  // ---- Permissions ----
  @Get('permissions')
  @RequirePermission('rbac@read')
  @ApiOperation({ summary: 'List all permissions' })
  @ApiOkResponse({ description: 'The list of permissions.' })
  @ApiForbiddenResponse({ description: 'Missing rbac@read permission.' })
  listPermissions() {
    return this.rbacAdminService.listPermissions();
  }

  @Post('permissions')
  @RequirePermission('rbac@create')
  @ApiOperation({ summary: 'Create a permission' })
  @ApiCreatedResponse({ description: 'The created permission.' })
  @ApiForbiddenResponse({ description: 'Missing rbac@create permission.' })
  createPermission(@Body() dto: CreatePermissionDto) {
    return this.rbacAdminService.createPermission(dto);
  }

  @Put('permissions/:id')
  @RequirePermission('rbac@update')
  @ApiOperation({ summary: 'Update a permission' })
  @ApiOkResponse({ description: 'The updated permission.' })
  @ApiForbiddenResponse({ description: 'Missing rbac@update permission.' })
  updatePermission(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePermissionDto,
  ) {
    return this.rbacAdminService.updatePermission(id, dto);
  }

  @Delete('permissions/:id')
  @RequirePermission('rbac@delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a permission' })
  @ApiNoContentResponse({ description: 'Permission deleted.' })
  @ApiForbiddenResponse({ description: 'Missing rbac@delete permission.' })
  deletePermission(@Param('id', ParseUUIDPipe) id: string) {
    return this.rbacAdminService.deletePermission(id);
  }

  // ---- Grants ----
  @Get('grants')
  @RequirePermission('rbac@read')
  @ApiOperation({ summary: 'List all grants' })
  @ApiOkResponse({ description: 'The list of grants.' })
  @ApiForbiddenResponse({ description: 'Missing rbac@read permission.' })
  listGrants() {
    return this.rbacAdminService.listGrants();
  }

  @Post('grants')
  @RequirePermission('rbac@create')
  @ApiOperation({ summary: 'Create a grant (assign a permission to a role)' })
  @ApiCreatedResponse({ description: 'The created grant.' })
  @ApiForbiddenResponse({ description: 'Missing rbac@create permission.' })
  createGrant(@Body() dto: CreateGrantDto) {
    return this.rbacAdminService.createGrant(dto);
  }

  @Put('grants/:id')
  @RequirePermission('rbac@update')
  @ApiOperation({ summary: 'Update a grant' })
  @ApiOkResponse({ description: 'The updated grant.' })
  @ApiForbiddenResponse({ description: 'Missing rbac@update permission.' })
  updateGrant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGrantDto,
  ) {
    return this.rbacAdminService.updateGrant(id, dto);
  }

  @Delete('grants/:id')
  @RequirePermission('rbac@delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a grant' })
  @ApiNoContentResponse({ description: 'Grant deleted.' })
  @ApiForbiddenResponse({ description: 'Missing rbac@delete permission.' })
  deleteGrant(@Param('id', ParseUUIDPipe) id: string) {
    return this.rbacAdminService.deleteGrant(id);
  }
}
