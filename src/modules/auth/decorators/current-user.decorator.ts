import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

import { RequestUser } from '../auth.constants';

/**
 * Extracts the authenticated principal (set by JwtStrategy) from the request.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    const request = ctx
      .switchToHttp()
      .getRequest<FastifyRequest & { user: RequestUser }>();
    return request.user;
  },
);
