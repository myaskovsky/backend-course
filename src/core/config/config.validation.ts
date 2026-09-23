import Joi from 'joi';

import { Config } from './config.types';

export const configValidationSchema = Joi.object<Config>({
  PORT: Joi.number().port().required(),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').required(),

  /**
   * Cookie secret
   */
  COOKIE_SECRET: Joi.string().required(),

  /**
   * Cookie options for auth tokens
   */
  COOKIE_SECURE: Joi.boolean().optional().default(false),
  COOKIE_SAMESITE: Joi.string()
    .valid('lax', 'strict', 'none')
    .optional()
    .default('lax'),
  COOKIE_DOMAIN: Joi.string().optional(),

  CORS_ORIGINS: Joi.string()
    .optional()
    .default(
      'http://localhost:5174,http://localhost:4200,http://localhost:8080',
    ),

  /**
   * JWT options (secrets and TTL in seconds)
   */
  JWT_ACCESS_SECRET: Joi.string().required(),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_ACCESS_TTL: Joi.number().optional().default(900),
  JWT_REFRESH_TTL: Joi.number().optional().default(2592000),

  /**
   * Email confirmation feature flags (admin-toggleable per scenario)
   */
  CONFIRM_REGISTRATION_ENABLED: Joi.boolean().optional().default(false),
  CONFIRM_LOGIN_ENABLED: Joi.boolean().optional().default(false),
  CONFIRM_EMAIL_CHANGE_ENABLED: Joi.boolean().optional().default(true),
  CONFIRM_SELF_DELETE_ENABLED: Joi.boolean().optional().default(true),
  CONFIRM_PASSWORD_RECOVERY: Joi.boolean().optional().default(true),

  /**
   * Initial admin seeded by the RBAC migration
   */
  ADMIN_EMAIL: Joi.string().email().optional(),
  ADMIN_PASSWORD: Joi.string().optional(),

  /**
   * SMTP options (optional — logs OTP when unset)
   */
  SMTP_HOST: Joi.string().optional(),
  SMTP_PORT: Joi.number().port().optional(),
  SMTP_SECURE: Joi.boolean().optional().default(false),
  SMTP_USER: Joi.string().optional(),
  SMTP_PASSWORD: Joi.string().optional(),
  SMTP_FROM: Joi.string().optional().default('no-reply@example.com'),

  /**
   * Health check options
   */
  HEALTH_CHECK_ENABLED: Joi.boolean().optional().default(false),

  /**
   * Throttler options
   */
  THROTTLE_GLOBAL_TTL: Joi.number().optional().default(10000),
  THROTTLE_GLOBAL_LIMIT: Joi.number().optional().default(10),

  /**
   * Text-format conversion options (per-format upload limits in bytes,
   * conversion timeout, and max IR nesting depth)
   */
  CONVERT_MAX_SIZE_CSV: Joi.number().optional().default(5242880),
  CONVERT_MAX_SIZE_JSON: Joi.number().optional().default(5242880),
  CONVERT_MAX_SIZE_XML: Joi.number().optional().default(5242880),
  CONVERT_MAX_SIZE_YAML: Joi.number().optional().default(5242880),
  CONVERT_TIMEOUT_MS: Joi.number().optional().default(30000),
  CONVERT_MAX_DEPTH: Joi.number().optional().default(100),

  /**
   * PostgreSQL database options
   */
  POSTGRES_HOST: Joi.string().hostname().required(),
  POSTGRES_PORT: Joi.number().port().required(),
  POSTGRES_USER: Joi.string().required(),
  POSTGRES_PASSWORD: Joi.string().required(),
  POSTGRES_DB: Joi.string().required(),
  POSTGRES_SYNCHRONIZE: Joi.boolean().optional().default(false),
  POSTGRES_LOGGING: Joi.boolean().optional().default(false),
  POSTGRES_MIGRATIONS_RUN: Joi.boolean().optional().default(false),
});
