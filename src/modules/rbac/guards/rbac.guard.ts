import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyRequest } from 'fastify';

import { RequestUser } from '@/modules/auth/auth.constants';

import {
  REQUIRE_PERMISSION_KEY,
  RequiredPermission,
} from '../decorators/require-permission.decorator';
import { RbacService } from '../rbac.service';

/**
 * Enforces @RequirePermission('resource@action'). Runs after the global
 * JwtAuthGuard, so req.user is already populated.
 */
@Injectable()
export class RbacGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbacService: RbacService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<RequiredPermission>(
      REQUIRE_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user?: RequestUser }>();
    const user = request.user;
    if (!user) {
      throw new UnauthorizedException();
    }

    const allowed = this.rbacService.check(
      user.roles,
      required.resource,
      required.action,
    );
    if (!allowed) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
