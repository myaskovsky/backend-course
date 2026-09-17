export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

export type TokenType = 'access' | 'refresh';

export interface JwtPayload {
  /** user id */
  sub: string;
  email: string;
  type: TokenType;
  /** roles are populated from RBAC (Phase 3); empty until then */
  roles?: string[];
}

/**
 * Authenticated principal attached to the request by JwtStrategy.
 */
export interface RequestUser {
  userId: string;
  email: string;
  roles: string[];
}
