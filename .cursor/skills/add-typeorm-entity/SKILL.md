---
name: add-typeorm-entity
description: Add a TypeORM entity, register it with forFeature, and generate a migration. Use when adding or changing database tables, entities, repositories, or schema for the file conversion backend.
---

# Add a TypeORM entity

## Steps

1. Add `src/modules/<feature>/<name>.entity.ts` (or next to the owning module). Class + `@Entity()`; file must end in `.entity.ts`.
2. In the feature module:

```typescript
imports: [TypeOrmModule.forFeature([FileEntity])],
```

3. Inject with `@InjectRepository(FileEntity)`.
4. Multi-step writes: `@Transactional()` from `typeorm-transactional`.
5. Generate and apply a migration — do **not** enable `POSTGRES_SYNCHRONIZE`:

```bash
npm run migration:generate
npm run migration:run
```

6. Migration files live in `src/database/migrations/` and must match `*.migration.ts`.
7. Use Context7 for current TypeORM 0.3 column/relation APIs.

## Constraints

- PostgreSQL via existing `DatabaseModule`. No Prisma.
- CLI uses `src/database/data-source.ts`; Nest runtime uses `DatabaseModule`.
- Local file **contents** stay on disk; persist metadata (path, mime, status) in TypeORM — do not store blobs in Postgres unless asked.
