# Agent notes

This is a **monolithic NestJS backend** that converts files from one format to others. Store uploads on **local disk**. Send email through **turboSMTP or a compatible SMTP** provider. Do not split into microservices.

**Locked stack** (already in the repo — do not replace unless asked): NestJS 11 + Fastify, PostgreSQL + TypeORM, Joi for env, class-validator for HTTP DTOs. Prisma, Zod, Express, and S3 are out of scope.

Read [README.md](README.md) as the product brief. Follow `.cursor/rules/` for conventions. Use Context7 MCP for current NestJS / Fastify / TypeORM docs.
