---
name: add-feature-module
description: Scaffold a NestJS feature module under src/modules with controller, service, class-validator DTOs, colocated specs, and AppModule wiring. Use when adding a new domain feature (conversions, files, auth, users, mail) or the user asks to generate a module.
---

# Add a feature module

## Steps

1. Create `src/modules/<name>/` with kebab-case files:
   - `<name>.module.ts`
   - `<name>.controller.ts`
   - `<name>.service.ts`
   - `dto/` with class-validator DTOs when the feature has HTTP input
   - `<name>.controller.spec.ts` and `<name>.service.spec.ts`
2. Register controller and providers **in that module**, not in `AppModule`.
3. Import the module in `src/core/app/app.module.ts` under the "Application modules" block.
4. Use `@/` imports (`@/modules/<name>/...`, `@/core/config/config.service`).
5. If the feature needs DB: `TypeOrmModule.forFeature([...])` in the feature module, then follow `add-typeorm-entity`.
6. If it needs new env vars: follow `add-env-config`.
7. Fetch current NestJS 11 controller/DTO APIs via Context7 when unsure.

## Constraints

- Fastify app — do not import Express types.
- Keep controllers thin; put conversion/storage/mail logic in services.
- Do not create a new Nest app or a microservice.

## Example wiring

```typescript
import { ConvertModule } from '@/modules/convert/convert.module';

@Module({
  imports: [
    // core modules...
    ConvertModule,
  ],
})
export class AppModule {}
```
