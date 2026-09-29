# File Converter API

This is a monolithic **NestJS 11 + Fastify** backend. Authenticated users upload a CSV, JSON, XML or YAML file, choose a target format, and get the converted file back as a streamed download. They can also save the result and download it again later. The app also provides:

- registration and login with email OTP confirmation;
- JWT auth in HttpOnly cookies, with instant token revocation;
- RBAC;
- user management;
- a per-user transformation history.

File contents live on **local disk**, and metadata lives in **PostgreSQL**. Emails (OTP codes) go through **turboSMTP** or any compatible SMTP server.

The product requirements are in [docs/requirements/](docs/requirements/).

## Stack

| Concern | Library |
|---|---|
| Framework / HTTP | NestJS 11, Fastify (`@nestjs/platform-fastify`) |
| Database / ORM | PostgreSQL, TypeORM 0.3, `typeorm-transactional` |
| Validation | class-validator + class-transformer (DTOs), Joi (environment) |
| Auth | `@nestjs/jwt`, `passport-jwt`, `argon2`, `@fastify/cookie` |
| Security | `@fastify/helmet`, CORS, `@nestjs/throttler` |
| Conversion | `stream-json`, `saxes`, `csv-parse` / `csv-stringify`, `js-yaml`, `piscina` (worker threads) |
| Uploads | `@fastify/multipart` |
| Mail | `nodemailer` (SMTP) |
| Health / docs | `@nestjs/terminus`, `@nestjs/swagger` |

## Quick start

```bash
cp .env.example .env          # then change the secrets
docker compose up -d          # PostgreSQL
npm install
npm run migration:run         # schema + RBAC seed (admin user from ADMIN_EMAIL / ADMIN_PASSWORD)
npm run start:dev
```

- API: `http://localhost:$PORT`
- Swagger UI: `http://localhost:$PORT/docs`
- Health: `GET /health`

## Scripts

| Script | Purpose |
|---|---|
| `start`, `start:dev`, `start:debug`, `start:prod` | Run the app (dev with watch, debug, or built `dist/`) |
| `build` | Compile to `dist/` |
| `lint`, `format` | ESLint with `--fix`, Prettier |
| `test`, `test:watch`, `test:cov`, `test:debug` | Unit tests (Jest) |
| `test:e2e` | End-to-end tests (need PostgreSQL with migrations applied) |
| `migration:generate`, `migration:create`, `migration:run`, `migration:revert`, `migration:show` | TypeORM migrations (`src/database/data-source.ts`) |

## Project structure

```
src/
├── main.ts                 # bootstrap: Fastify adapter, Swagger, shutdown hooks
├── core/
│   ├── app/                # AppModule + configureApp() (plugins/pipes shared with e2e tests)
│   ├── config/             # typed ConfigService, Joi schema, Config interface
│   ├── database/           # runtime TypeORM DataSource
│   ├── health/             # GET /health (Terminus DB ping)
│   └── throttler/          # global rate limiting
├── database/
│   ├── data-source.ts      # DataSource for the TypeORM CLI
│   └── migrations/         # *.migration.ts
└── modules/
    ├── auth/               # register/login/OTP, JWT cookies, refresh rotation, token revocation
    ├── users/              # profile CRUD, email change, soft delete, admin list
    ├── rbac/               # roles, permissions, grants; RbacGuard + @RequirePermission
    ├── conversions/        # POST /api/convert: codecs, worker pool, transformation history entity
    ├── transformations/    # history listing, downloads of saved results, retention cleanup
    ├── storage/            # FileStorage abstraction → LocalDiskStorage
    └── mail/               # SMTP sender for OTP codes
test/                       # e2e suites + fixtures
docs/requirements/          # functional / non-functional requirements
```

## API

Every route needs a valid `access_token` cookie unless it is marked public. See `/docs` for the request and response schemas.

| Method & path | Access | Notes |
|---|---|---|
| `GET /health` | public | Pings the database when `HEALTH_CHECK_ENABLED=true` |
| `POST /auth/register`, `/auth/register/confirm` | public, 5/min | Confirmation is sent by OTP when `CONFIRM_REGISTRATION_ENABLED=true` |
| `POST /auth/login`, `/auth/login/confirm` | public, 5/min | Sets the auth cookies. OTP step when `CONFIRM_LOGIN_ENABLED=true` |
| `POST /auth/refresh` | public, 10/min | Rotates the token pair and revokes the refresh token that was presented |
| `POST /auth/logout` | public, 10/min | Revokes the presented access and refresh tokens, and clears the cookies |
| `POST /auth/password-reset/request`, `/confirm` | public, 5/min | OTP by email. Revokes all sessions |
| `POST /auth/change-password` | user | Revokes all sessions and re-issues cookies for the current one |
| `POST /auth/otp/resend` | public, 3/min | |
| `GET, PATCH, DELETE /users/:id` | self, or a `users@read/update/delete` permission | Field access depends on the role. Deleting your own account needs OTP confirmation when `CONFIRM_SELF_DELETE_ENABLED=true` |
| `POST /users/:id/email-change`, `/email-change/confirm` | self | OTP sent to the new address |
| `POST /users/:id/deletion/confirm` | self | |
| `GET /admin/users` | `users@list` | Cursor pagination, see [below](#pagination) |
| `GET, POST /admin/rbac/{roles,permissions,grants}`, `PUT, DELETE …/:id` | `rbac@read/create/update/delete` | |
| `POST /api/convert` | user, 20/min | multipart: `file`, `targetFormat`, optional `save=true` |
| `GET /api/convert/formats` | user | The 12 supported directions |
| `GET /api/transformations/history`, `/history/:id/download` | user (own items), 60/min | Download returns 404 if nothing was saved and 410 if the file expired |
| `GET /admin/users/:userId/transformations/history`, `/history/:itemId/download` | `transformations@read` / `@download` | |

The RBAC migration seeds an `admin` role. It has every permission listed above and is assigned to the user from `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

## File conversion

The four formats convert into each other in all **12 directions**:

| Format | Extension | Standard |
|---|---|---|
| CSV | `.csv` | RFC 4180 |
| JSON | `.json` | RFC 8259 |
| XML | `.xml` | XML 1.0 |
| YAML | `.yaml`, `.yml` | YAML 1.2 |

The source format is detected from the file extension. A request can fail with:
- 400: invalid parameters, syntax or encoding;
- 408: timeout;
- 413: file over the size limit;
- 415: missing or unsupported file.

### Pipeline

A file is never held in memory as a whole:

1. **Upload.** The multipart file stream is written to `STORAGE_DIR/.tmp` while its bytes are counted. The per-format limit (`CONVERT_MAX_SIZE_<FMT>`) is enforced as data arrives, so an oversized upload is rejected without being buffered.
2. **Worker thread.** The conversion runs in a `piscina` pool of `CONVERT_WORKER_POOL_SIZE` threads, off the main event loop:

   ```
   disk → strict UTF-8 decoder → streaming parser → IR → streaming serializer → disk
   ```

   - The UTF-8 decoder is incremental and strips the BOM.
   - `CONVERT_TIMEOUT_MS` is a real timeout: the task is aborted and its thread is terminated.
3. **Response.** The finished output file is streamed to the client, so a partial file is never sent. With `save=true`, the file is moved (an atomic rename) into storage and recorded in the history. Otherwise it is deleted once the response has been sent. Temp files left behind by a crash are removed at startup.

Parsers by format:
- **JSON:** tokenized by `stream-json`.
- **XML:** parsed with SAX (`saxes`).
- **CSV:** read record by record with `csv-parse`.
- **YAML:** has no incremental parser for a single document. It is read chunk by chunk and then parsed once.

On the output side, JSON, XML and YAML are generated piece by piece, and CSV uses `csv-stringify`.

### Security limits

- XML `<!DOCTYPE>` is rejected, which blocks XXE and entity expansion.
- Nesting deeper than `CONVERT_MAX_DEPTH` is rejected while parsing.
- A `__proto__` key becomes an ordinary own property.
- Invalid UTF-8 is rejected with `invalid_encoding`.
- File contents are never logged.

### Mapping rules for ambiguous pairs

- **CSV → \*:** an array of objects keyed by the header row. All values are strings.
- **\* → CSV:** requires an array of flat objects.
  - Single-key wrappers are unwrapped first, so `{people: {person: [...]}}` from XML yields the `person` rows.
  - A single flat object becomes one row.
  - Nested values are rejected with `not_tabular`.
  - The header is the union of keys in first-seen order. Booleans are written as `true`/`false`, dates in ISO 8601.
- **XML → \*:**
  - The root element becomes the single top-level key.
  - Attributes become `@_name` keys.
  - Element text goes under `#text` when the element also has attributes or children.
  - Repeated elements become arrays, and an empty element becomes `""`.
  - Text that is exactly a JSON number or `true`/`false` is converted, so `007` stays a string.
- **\* → XML:**
  - A single-key object is used as the root element. Anything else is wrapped in `<root>`, with array items as `<item>`.
  - Characters that are not allowed in XML names are replaced with `_`.

## Authentication and token revocation

- The access token (default 15 min) and the refresh token (default 30 days) are HttpOnly cookies. `Secure` and `SameSite` come from the config. The refresh cookie is scoped to `/auth`, so it is sent only to `/auth/refresh` and `/auth/logout`.
- Every JWT has a unique `jti` and a millisecond-precision `iat`. Revocation takes effect immediately and uses two mechanisms:
  - **The `revoked_tokens` denylist**, keyed by `jti`, holds each row only until the token would expire anyway. Expired rows are purged every `REVOKED_TOKENS_CLEANUP_INTERVAL_MS`.
    - Logout revokes both presented tokens.
    - Refresh revokes the refresh token it used.
    - A refresh token that was already rotated and is presented again is treated as theft, and all of the user's sessions are revoked.
  - **`users.tokensValidAfter`:** any token issued before this moment is rejected. It is set on password change or reset, deletion, and blocking, which covers every device of the user.
- `JwtStrategy` loads the user and their roles on every request, so blocking a user or changing their roles applies right away.

> **Deviation from `docs/requirements/…/авторизация.txt`.** The spec forbids storing refresh state on the server. The code review required immediate revocation, which cannot be done without server state. The state is kept minimal: denylisted token ids (only until they expire) and one timestamp per user. No active-token allowlist or session list is stored.

## Pagination

`GET /admin/users?limit=&cursor=&q=&status=&sort=&order=` uses keyset pagination and returns `{ items, nextCursor }`.

| Parameter | Values |
|---|---|
| `limit` | 1–100, default 20 |
| `sort` | `created_at` (default), `last_login`, `email` |
| `order` | `desc` (default), `asc` |
| `status` | `pending`, `active`, `blocked`, `deleted` |
| `q` | Case-insensitive substring of the email or display name. `%` and `_` are matched literally. A UUID also matches the user id |

- The order is stable: the sort column, then `id`. NULL values of `last_login` always come last.
- `nextCursor` is opaque. It holds the full-precision sort value (timestamps keep their microseconds) and is bound to the `sort`/`order` it was created for.
- A malformed cursor, or one used with a different sort, returns **400**. It is not silently treated as the first page.

## Security

- `@fastify/helmet` security headers:
  - CSP is `'self'`, with inline scripts and styles allowed only because Swagger UI needs them. `frame-ancestors 'none'`.
  - `nosniff`, `X-Frame-Options`, `Cross-Origin-Resource-Policy: same-site`.
  - HSTS is sent when `COOKIE_SECURE=true`.
- CORS allows only origins from `CORS_ORIGINS`, with credentials.
- Rate limits are global (`THROTTLE_GLOBAL_*`), with stricter limits per auth route.
- Passwords are hashed with argon2. OTP codes are stored hashed and have limits on attempts and resends.
- The global `ValidationPipe` is `whitelist: true`. Sensitive fields are never returned.

## Configuration

Every variable is declared in `src/core/config/config.types.ts`, validated in `config.validation.ts`, and documented in [.env.example](.env.example).

| Group | Variables |
|---|---|
| Server | `PORT`, `NODE_ENV`, `CORS_ORIGINS` |
| Cookies | `COOKIE_SECRET`, `COOKIE_SECURE`, `COOKIE_SAMESITE`, `COOKIE_DOMAIN` |
| JWT | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `REVOKED_TOKENS_CLEANUP_INTERVAL_MS` |
| OTP flags | `CONFIRM_REGISTRATION_ENABLED`, `CONFIRM_LOGIN_ENABLED`, `CONFIRM_EMAIL_CHANGE_ENABLED`, `CONFIRM_SELF_DELETE_ENABLED`, `CONFIRM_PASSWORD_RECOVERY` |
| Admin seed | `ADMIN_EMAIL`, `ADMIN_PASSWORD` (read by the RBAC migration) |
| SMTP | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` (with no host set, OTP codes are logged instead) |
| Health / throttling | `HEALTH_CHECK_ENABLED`, `THROTTLE_GLOBAL_TTL`, `THROTTLE_GLOBAL_LIMIT` |
| Conversion | `CONVERT_MAX_SIZE_CSV/JSON/XML/YAML`, `CONVERT_TIMEOUT_MS`, `CONVERT_MAX_DEPTH`, `CONVERT_WORKER_POOL_SIZE` |
| Storage / history | `STORAGE_DIR`, `CONVERT_MAX_SAVE_SIZE`, `HISTORY_RETENTION_DAYS`, `HISTORY_CLEANUP_INTERVAL_MS` |
| PostgreSQL | `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_SYNCHRONIZE` (keep `false`), `POSTGRES_LOGGING`, `POSTGRES_MIGRATIONS_RUN` |

## Database

- Entities (`*.entity.ts`) are auto-loaded and registered per feature with `TypeOrmModule.forFeature`. Multi-step writes use `@Transactional()`.
- The schema changes only through migrations in `src/database/migrations/`:
  - users;
  - RBAC, including the admin seed;
  - user list indexes;
  - email challenges;
  - password reset;
  - transformation history;
  - result storage;
  - the transformations permission;
  - token revocation.
- `POSTGRES_MIGRATIONS_RUN=true` applies pending migrations on startup. It defaults to `false`; `.env.example` turns it on for local development.

## Tests

```bash
npm test               # unit tests (colocated *.spec.ts)
npm run test:cov       # with coverage
npm run test:e2e       # test/*.e2e-spec.ts — needs `docker compose up -d` + `npm run migration:run`
```

The e2e suites boot the real application through `configureApp()`, with the same plugins as `main.ts`, and send requests with `app.inject`. They cover:
- auth and revocation, and the security headers;
- pagination against the real database;
- conversions, including a multi-megabyte CSV that goes through the worker threads;
- the history and downloads.
