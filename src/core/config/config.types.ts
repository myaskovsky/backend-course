export interface Config {
  PORT: number;
  NODE_ENV: 'development' | 'production' | 'test';

  /**
   * Cookie secret
   */
  COOKIE_SECRET: string;

  /**
   * Cookie options for auth tokens
   */
  COOKIE_SECURE?: boolean;
  COOKIE_SAMESITE?: 'lax' | 'strict' | 'none';
  COOKIE_DOMAIN?: string;

  /**
   * Comma-separated list of trusted CORS origins.
   */
  CORS_ORIGINS?: string;

  /**
   * JWT options (secrets and TTL in seconds)
   */
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  JWT_ACCESS_TTL?: number;
  JWT_REFRESH_TTL?: number;

  /**
   * Email confirmation feature flags (admin-toggleable per scenario).
   * Actual OTP delivery is wired in Phase 6; until then, enabled flows are stubbed.
   */
  CONFIRM_REGISTRATION_ENABLED?: boolean;
  CONFIRM_LOGIN_ENABLED?: boolean;
  CONFIRM_EMAIL_CHANGE_ENABLED?: boolean;
  CONFIRM_SELF_DELETE_ENABLED?: boolean;
  CONFIRM_PASSWORD_RECOVERY?: boolean;

  /**
   * SMTP (turboSMTP or compatible) for OTP emails. Optional — when unset,
   * MailService logs the OTP instead of sending (dev convenience).
   */
  SMTP_HOST?: string;
  SMTP_PORT?: number;
  SMTP_SECURE?: boolean;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  SMTP_FROM?: string;

  /**
   * Health check options
   */
  HEALTH_CHECK_ENABLED?: boolean;

  /**
   * Throttler options
   */
  THROTTLE_GLOBAL_TTL?: number;
  THROTTLE_GLOBAL_LIMIT?: number;

  /**
   * PostgreSQL database options
   */
  POSTGRES_HOST: string;
  POSTGRES_PORT: number;
  POSTGRES_USER: string;
  POSTGRES_PASSWORD: string;
  POSTGRES_DB: string;
  POSTGRES_SYNCHRONIZE?: boolean;
  POSTGRES_LOGGING?: boolean;
  POSTGRES_MIGRATIONS_RUN?: boolean;
}
