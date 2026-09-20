import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSION_KEY = 'requirePermission';

export interface RequiredPermission {
  resource: string;
  action: string;
}

/**
 * Declares the permission required to access a route, in the form
 * `resource@action`, e.g. @RequirePermission('users@read').
 */
export const RequirePermission = (permission: `${string}@${string}`) => {
  const [resource, action] = permission.split('@');
  return SetMetadata<string, RequiredPermission>(REQUIRE_PERMISSION_KEY, {
    resource,
    action,
  });
};
