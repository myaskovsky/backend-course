export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

export type TokenType = 'access' | 'refresh';

export interface JwtPayload {
  /** user id */
  sub: string;
  email: string;
  type: TokenType;
  /** unique token id — the key of the revocation denylist */
  jti: string;
  /** issued-at, seconds since epoch (fractional — see TokensService) */
  iat: number;
  /** expiry, seconds since epoch */
  exp: number;
}

/**
 * Authenticated principal attached to the request by JwtStrategy.
 */
export interface RequestUser {
  userId: string;
  email: string;
  roles: string[];
}
