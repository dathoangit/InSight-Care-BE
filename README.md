# BE-nestJS

Base backend project using NestJS, TypeORM, JWT authentication, and common platform infrastructure.

## Purpose

This project provides backend foundations for new web applications. Business-specific feature modules were removed.

## Core Structure

```text
BE-nestJS/
  src/
    main.ts                    # Bootstrap and HTTP server startup
    app.module.ts              # Root module and infrastructure wiring
    modules/
      auth/                    # Login/register/me/reset-password flow
      user/                    # User entity and service used by auth
      health-checker/          # Health endpoints and indicators
      cache/                   # Redis cache service and module
    filters/                   # Global exception filters
    interceptors/              # Global response interceptor
    guards/                    # Auth and role guards
    decorators/                # Route/auth metadata decorators
    database/                  # DB helpers and migrations
    i18n/                      # Translation resources
```

## Runtime Flow

1. App starts from `src/main.ts` and creates Nest application with CORS enabled.
2. `AppModule` initializes config, i18n, throttling, TypeORM, and core modules.
3. Global `ValidationPipe`, filters, and interceptors normalize request/response behavior.
4. Auth endpoints in `modules/auth` validate credentials and issue JWT access tokens.
5. Protected APIs use guards and decorators to enforce authentication/authorization.

## Environment

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

Important variables:

- `PORT` (default `8081`)
- `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`
- `DB_TYPE`, `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`
- Optional Redis: `REDIS_CACHE_ENABLED`, `REDIS_URL`

## Commands

```bash
yarn
yarn dev
yarn build:prod
yarn start:prod
```

## Base Endpoints

- `GET /`
- `GET /health`
- `GET /documentation`
- `POST /auth/login` and other `/auth/*`
