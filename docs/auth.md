# Auth (Backend)

Stateless **JWT (RS256)** authentication. Clients send `Authorization: Bearer <accessToken>` on protected routes. There is **no refresh-token flow**; clients re-login when the access token expires.

## Architecture

```mermaid
sequenceDiagram
  participant Client
  participant API as AuthController
  participant Auth as AuthService
  participant DB

  Client->>API: POST /auth/login
  API->>Auth: validate credentials
  Auth->>DB: find user + password hash
  Auth->>Client: { user, token: { accessToken, expiresIn } }

  Client->>API: GET /auth/me (Bearer JWT)
  API->>Auth: JwtStrategy.validate(payload)
  Auth->>DB: load user
  API->>Client: UserDto
```

### JWT access token

- Algorithm: **RS256** (`JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY`)
- Default TTL: **86400s** (`JWT_EXPIRATION_TIME`)
- Payload (`IJwtAccessPayload`):

| Claim | Description |
|-------|-------------|
| `sub` | User UUID |
| `type` | `ACCESS_TOKEN` |
| `role` | Staff role (`admin` \| `doctor` \| `nurse`) |
| `email` | Optional, when user has email |

## Environment variables

```env
JWT_EXPIRATION_TIME=86400
JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
```

Generate RS256 keys (example):

```bash
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem
```

## API endpoints

Rate limits use `@nestjs/throttler` on public routes.

### Public

| Method | Path | Body | Response | Notes |
|--------|------|------|----------|-------|
| `POST` | `/auth/login` | `{ username, password }` | `AuthTokenDto` | `username` field accepts username or verified email |

### Authenticated (`Authorization: Bearer <accessToken>`)

| Method | Path | Response |
|--------|------|----------|
| `GET` | `/auth/me` | `UserDto` |

### Login response shape

```json
{
  "user": { "id": "...", "username": "...", "role": "admin", "isActive": true },
  "token": {
    "accessToken": "<jwt>",
    "expiresIn": 86400
  }
}
```

## Login rules

- **Login identifier:** username, or verified email if `email_verified_at` is set
- Inactive users cannot log in

## Guards and decorators

Protected routes use `@Auth()` from `src/decorators/http.decorators.ts`:

```typescript
@Auth()                    // JWT required
@Auth([StaffRole.ADMIN])   // JWT + staff role
@PublicRoute(true)         // skip JWT (used on auth controller)
```

Guard chain: `AuthGuard` → `RolesGuard`.

Inject current user: `@AuthUser() user: JwtAuthenticatedUser`.

## Bootstrap account

`SeedService` creates the default admin on first app start (idempotent):

- Username: `admin`
- Password: `0123456789`
- Role: `admin`

**Rotate the admin password in production** after first deploy.

## Production checklist

- [ ] Set strong RS256 keys; never commit real keys
- [ ] Change default `admin` password
- [ ] Run migrations: `yarn migration:run`

## Module layout

| Path | Responsibility |
|------|----------------|
| `src/modules/auth/auth.module.ts` | JWT + Passport |
| `src/modules/auth/auth.controller.ts` | HTTP routes |
| `src/modules/auth/auth.service.ts` | Login + me |
| `src/modules/auth/strategies/jwt.strategy.ts` | Token validation |
| `src/guards/auth.guard.ts` | Bearer JWT guard |
| `src/guards/roles.guard.ts` | Staff role check |
