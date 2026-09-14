---
name: add-env-config
description: Add a typed environment variable across Config interface, Joi schema, and .env.example. Use when introducing SMTP, file storage paths, ports, or any new process env setting.
---

# Add env config

A new variable is incomplete until all three files match.

## Checklist

- [ ] `src/core/config/config.types.ts` — add the key on `Config`
- [ ] `src/core/config/config.validation.ts` — Joi rule (required vs optional + default)
- [ ] `.env.example` — documented dummy value, grouped with comments
- [ ] Feature code reads it via `this.configService.get('KEY')` from `@/core/config/config.service`

## Patterns

```typescript
// config.types.ts
SMTP_HOST: string;
UPLOAD_DIR: string;

// config.validation.ts
SMTP_HOST: Joi.string().hostname().required(),
UPLOAD_DIR: Joi.string().required(),
```

Optional flags follow existing style (`Joi.boolean().optional().default(false)`).

## Constraints

- Do not read `process.env` in Nest providers (exception: `src/database/data-source.ts`).
- Do not add Zod. Do not commit real secrets — only placeholders in `.env.example`.
