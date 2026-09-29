import { configValidationSchema } from './config.validation';

describe('configValidationSchema', () => {
  const minimalEnv = (): Record<string, string> => ({
    PORT: '3000',
    NODE_ENV: 'test',
    COOKIE_SECRET: 'cookie-secret',
    JWT_ACCESS_SECRET: 'access-secret',
    JWT_REFRESH_SECRET: 'refresh-secret',
    POSTGRES_HOST: 'localhost',
    POSTGRES_PORT: '5432',
    POSTGRES_USER: 'postgres',
    POSTGRES_PASSWORD: 'postgres',
    POSTGRES_DB: 'app',
  });

  const validate = (env: Record<string, unknown>) =>
    configValidationSchema.validate(env, { abortEarly: false });

  it('accepts a minimal env and coerces numbers', () => {
    const { error, value } = validate(minimalEnv());
    expect(error).toBeUndefined();
    expect(value.PORT).toBe(3000);
    expect(value.POSTGRES_PORT).toBe(5432);
  });

  it('applies defaults for optional keys', () => {
    const { value } = validate(minimalEnv());
    expect(value).toMatchObject({
      JWT_ACCESS_TTL: 900,
      JWT_REFRESH_TTL: 2592000,
      REVOKED_TOKENS_CLEANUP_INTERVAL_MS: 3600000,
      CONVERT_WORKER_POOL_SIZE: 0,
      POSTGRES_SYNCHRONIZE: false,
      POSTGRES_LOGGING: false,
      POSTGRES_MIGRATIONS_RUN: false,
      HEALTH_CHECK_ENABLED: false,
      COOKIE_SECURE: false,
      COOKIE_SAMESITE: 'lax',
      CONFIRM_EMAIL_CHANGE_ENABLED: true,
      CONFIRM_SELF_DELETE_ENABLED: true,
      CONFIRM_REGISTRATION_ENABLED: false,
      SMTP_FROM: 'no-reply@example.com',
      CONVERT_MAX_SIZE_CSV: 5242880,
      CONVERT_MAX_SAVE_SIZE: 10485760,
      HISTORY_RETENTION_DAYS: 90,
      STORAGE_DIR: './storage/transformations',
    });
  });

  it('coerces boolean strings', () => {
    const { error, value } = validate({
      ...minimalEnv(),
      HEALTH_CHECK_ENABLED: 'true',
      COOKIE_SECURE: 'true',
    });
    expect(error).toBeUndefined();
    expect(value.HEALTH_CHECK_ENABLED).toBe(true);
    expect(value.COOKIE_SECURE).toBe(true);
  });

  it.each([
    'PORT',
    'NODE_ENV',
    'COOKIE_SECRET',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'POSTGRES_HOST',
    'POSTGRES_PORT',
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'POSTGRES_DB',
  ])('rejects the env when required key %s is missing', (key) => {
    const env = minimalEnv();
    delete env[key];
    const { error } = validate(env);
    expect(error).toBeDefined();
    expect(error!.details.map((d) => d.context?.key)).toContain(key);
  });

  it('rejects an invalid NODE_ENV', () => {
    const { error } = validate({ ...minimalEnv(), NODE_ENV: 'staging' });
    expect(error?.message).toMatch(/NODE_ENV/);
  });

  it('rejects an invalid COOKIE_SAMESITE', () => {
    const { error } = validate({ ...minimalEnv(), COOKIE_SAMESITE: 'always' });
    expect(error?.message).toMatch(/COOKIE_SAMESITE/);
  });

  it.each(['lax', 'strict', 'none'])('accepts COOKIE_SAMESITE=%s', (v) => {
    const { error } = validate({ ...minimalEnv(), COOKIE_SAMESITE: v });
    expect(error).toBeUndefined();
  });

  it('rejects a negative CONVERT_WORKER_POOL_SIZE', () => {
    const { error } = validate({
      ...minimalEnv(),
      CONVERT_WORKER_POOL_SIZE: '-1',
    });
    expect(error?.message).toMatch(/CONVERT_WORKER_POOL_SIZE/);
  });

  it('rejects a non-integer CONVERT_WORKER_POOL_SIZE', () => {
    const { error } = validate({
      ...minimalEnv(),
      CONVERT_WORKER_POOL_SIZE: '1.5',
    });
    expect(error?.message).toMatch(/CONVERT_WORKER_POOL_SIZE/);
  });

  it('rejects a REVOKED_TOKENS_CLEANUP_INTERVAL_MS below 1000', () => {
    const { error } = validate({
      ...minimalEnv(),
      REVOKED_TOKENS_CLEANUP_INTERVAL_MS: '10',
    });
    expect(error?.message).toMatch(/REVOKED_TOKENS_CLEANUP_INTERVAL_MS/);
  });

  it('rejects an out-of-range PORT', () => {
    const { error } = validate({ ...minimalEnv(), PORT: '70000' });
    expect(error?.message).toMatch(/PORT/);
  });

  it('rejects a malformed ADMIN_EMAIL', () => {
    const { error } = validate({
      ...minimalEnv(),
      ADMIN_EMAIL: 'not-an-email',
    });
    expect(error?.message).toMatch(/ADMIN_EMAIL/);
  });
});
