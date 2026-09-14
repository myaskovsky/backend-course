# File Converter API

Monolithic NestJS backend that **converts files from one format to others**. Clients upload a file, choose a target format, and receive the converted result. Files are stored **on local disk**. Email (job status, download links) goes through **turboSMTP or a compatible SMTP** provider.

This README is the product brief for humans and AI agents. Do not turn the app into microservices or swap the locked stack below.

## Locked stack

The course brief allows alternatives; this repo has already chosen. **Do not switch unless asked.**

| Concern | Chosen (use this) | Allowed by brief, not used |
|---|---|---|
| Architecture | Monolith | — |
| Framework | NestJS 11 + **Fastify** (`@nestjs/platform-fastify`) | Express |
| Database | PostgreSQL | — |
| ORM | **TypeORM** | Prisma |
| HTTP / DTO validation | **class-validator** + class-transformer | Zod |
| Env validation | **Joi** (`config.validation.ts`) | Zod |
| Email | turboSMTP or compatible SMTP (planned) | — |
| File storage | **Local disk** | S3 / object storage |

HTTP kernel is Fastify, not Express. Use Fastify plugins and types (`NestFastifyApplication`, `app.register(...)`) in `src/main.ts`. Compression (`@fastify/compress`) and cookies (`@fastify/cookie`) are already registered.

## Scripts

```bash
npm run start:dev    # Development with hot reload
npm run start:prod   # Production
npm run build        # Build
npm run lint         # Lint & fix
npm run test         # Unit tests
npm run test:e2e     # E2E tests
```

## Project structure

```
src/
├── core/
│   ├── config/      # App configuration (env variables)
│   ├── database/    # TypeORM + PostgreSQL connection
│   ├── health/      # Health check endpoints
│   └── app/         # Root module
├── database/        # TypeORM CLI data-source and migrations
├── modules/         # Feature modules (users/auth stubs today)
└── main.ts          # Entry point
```

## Domain (to build)

Not implemented yet. Keep new work in `src/modules/` as a single app:

- **Files** — upload and store on local disk; persist metadata in PostgreSQL (path, mime, size, owner). Do not store file blobs in the database.
- **Conversions** — transform a stored file from one format to another; track job status.
- **Mail** — SMTP (turboSMTP or compatible) for notifications.
- **Users / auth** — empty modules exist (`UsersModule` is wired; `AuthModule` is not).

## Database

PostgreSQL and TypeORM are already wired in. Use them for new modules — no extra setup.

- **Local Postgres:** `docker compose up -d` (image and credentials from `.env` / `.env.example`)
- **Connection:** `DatabaseModule` (`src/core/database`) is imported in `AppModule`
- **Entities:** any `*.entity.ts` under `src/` is auto-loaded
- **Repositories:** `TypeOrmModule.forFeature([YourEntity])` in a feature module, then `@InjectRepository(YourEntity)`
- **Transactions:** `@Transactional()` from `typeorm-transactional` (context is initialized in `src/main.ts`)
- **Schema:** migrations in `src/database/migrations/`. `POSTGRES_SYNCHRONIZE` is `false` by default — do not rely on auto-sync

```bash
npm run migration:generate   # Generate from entity changes
npm run migration:run        # Apply pending migrations
npm run migration:revert     # Roll back the last migration
npm run migration:show       # List applied / pending
```

CLI uses `src/database/data-source.ts`. At runtime, Nest uses the DataSource from `DatabaseModule`. If `POSTGRES_MIGRATIONS_RUN=true`, pending migrations also run on app start.

## Libraries

| Purpose       | Library                  |
|---------------|--------------------------|
| HTTP          | Fastify (`@nestjs/platform-fastify`) |
| Env validation | Joi                      |
| DTO validation | class-validator          |
| ORM           | TypeORM (`@nestjs/typeorm`) |
| Database      | PostgreSQL (`pg`)        |

## Core modules

| Purpose       | Module           |
|---------------|-----------------|
| Configuration | `ConfigModule`  |
| Database      | `DatabaseModule` |
| Health Check  | `HealthModule`  |

## Adding a module

```bash
nest generate module <name>
nest generate controller <name>
nest generate service <name>
```

Place feature code under `src/modules/<name>/` and import the module in `src/core/app/app.module.ts`.

## Code style

- Use `@/` aliases for imports (e.g. `@/core/config/config.service`)
- Run `npm run format` before committing
- Follow the NestJS module pattern

## Cursor / AI

Project guidance lives in `AGENTS.md`, `.cursor/rules/`, `.cursor/skills/`, and `.cursor/agents/`.

1. Enable **Context7** under Cursor Settings → Tools & MCP and complete OAuth (config is `.cursor/mcp.json`).
2. Use Context7 when you need current NestJS, Fastify, or TypeORM docs.
3. Skills: `/add-feature-module`, `/add-typeorm-entity`, `/add-env-config`.
4. Agents: `/nestjs-reviewer` (read-only review), `/verifier` (run tests and confirm wiring).
