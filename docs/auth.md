# Auth (Backend)

NestJS base auth stack: **JWT (RS256) + Redis session** + optional **Google SSO**, **email verification**, and **password reset**. There is **no refresh-token flow**; clients re-login when the access token expires or the server-side session is invalidated.

RBAC permission matrix and admin endpoint mapping: [rbac-permission-sheet.md](./rbac-permission-sheet.md).

Session and user caching details: [cache.md](./cache.md).

## Architecture

```mermaid
sequenceDiagram
  participant Client
  participant API as AuthController
  participant Auth as AuthService
  participant Redis
  participant DB

  Client->>API: POST /auth/login
  API->>Auth: validate credentials
  Auth->>DB: find user + password hash
  Auth->>Redis: SET auth:user-session:{userId} = sessionId
  Auth->>Client: { user, token: { accessToken, expiresIn } }

  Client->>API: GET /auth/me (Bearer JWT)
  API->>Auth: JwtStrategy.validate(payload)
  Auth->>Redis: GET sessionId, GET/SET auth:user:{userId}
  Auth->>DB: load user on cache miss
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
| `role` | Legacy single role (`admin` \| `doctor` \| `nurse`) |
| `roles` | RBAC role slugs |
| `permissions` | Effective permission names |
| `sessionId` | Server session id (must match Redis) |
| `email` | Optional, when user has email |

### Server-side session (Redis)

Each successful login (local or Google) writes:

```
auth:user-session:{userId} = {sessionId}
TTL = JWT_EXPIRATION_TIME
```

`JwtStrategy` rejects tokens when `sessionId` in JWT does not match Redis. A new login **replaces** the previous session (single active session per user).

**Important:** `REDIS_CACHE_ENABLED=true` is required for login and protected routes. When Redis is disabled, login returns `503` and JWT validation fails with `401 Session expired`. See [cache.md](./cache.md).

## Environment variables

```env
# Required
JWT_EXPIRATION_TIME=86400
JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"

# Redis (required for auth session)
REDIS_CACHE_ENABLED=true
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_DB=0
REDIS_PASSWORD=

# Password reset
RESET_TOKEN_TTL_MINUTES=30

# Email verification
EMAIL_VERIFY_TTL_MINUTES=15

# Google SSO (optional)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:8081/auth/google/callback
```

Generate RS256 keys (example):

```bash
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem
```

## API endpoints

All routes are under global prefix (default `/`). Rate limits use `@nestjs/throttler` on sensitive public routes.

### Public

| Method | Path | Body | Response | Notes |
|--------|------|------|----------|-------|
| `POST` | `/auth/register` | `{ username, password, email? }` | `UserDto` | Email optional; if provided, issues link verification |
| `POST` | `/auth/login` | `{ identifier, password }` | `AuthTokenDto` | `identifier` = username **or** verified email |
| `POST` | `/auth/forgot-password` | `{ email }` | `{ message }` | Generic message (no user enumeration) |
| `POST` | `/auth/reset-password` | `{ token, newPassword }` | `204` | Invalidates auth session |
| `GET` | `/auth/google` | — | redirect | Starts Google OAuth |
| `GET` | `/auth/google/callback` | — | `AuthTokenDto` | Links or creates user, issues JWT |

### Authenticated (`Authorization: Bearer <accessToken>`)

| Method | Path | Body | Response |
|--------|------|------|----------|
| `GET` | `/auth/me` | — | `UserDto` |
| `POST` | `/auth/update-email` | `{ email }` | `204` |
| `POST` | `/auth/request-email-verification` | `{ email, method: "otp" \| "link" }` | `204` |
| `POST` | `/auth/verify-email` | `{ email, method, otp? \| token? }` | `UserDto` |

### Login response shape

```json
{
  "user": { "id": "...", "username": "...", "role": "admin", "roles": [], "permissionNames": [], "isActive": true },
  "token": {
    "accessToken": "<jwt>",
    "expiresIn": 86400
  }
}
```

## Registration and login rules

- **Username:** lowercase, 3–64 chars, `[a-z0-9_]`
- **Password:** min 8 chars
- **Register:** email is optional; default role is `nurse`
- **Login identifier:**
  - Username (any registered username)
  - Verified email only (`email_verified_at` must be set)
- Inactive users cannot log in

## Account linking (Google SSO)

1. Lookup `user_oauth_identities` by `provider=google` + `provider_user_id`
2. If not found and Google returns email → link existing user by email
3. If still not found → create user (generated username, random password hash)
4. Google email is marked verified when present
5. OAuth identity row is created on first link

Local + Google can coexist on one user.

## Email verification

Verification records (`email_verifications`):

| Field | Description |
|-------|-------------|
| `method` | `otp` or `link` |
| `otp_hash` / `token_hash` | SHA-256 of secret (never store plain secret) |
| `expires_at` | Default 15 minutes |
| `consumed_at` | Set on successful verify |

Email transport is **not** implemented in base — secrets are created and **logged** for development. Plug in mailer in `AuthService.createEmailVerification()`.

Changing email always requires verification before `email_verified_at` is updated.

## Password reset

1. `POST /auth/forgot-password` — creates hashed token in `password_reset_tokens` (TTL default 30 min)
2. Token delivery is not implemented — check server logs in development
3. `POST /auth/reset-password` — updates password, marks token used, **deletes** `auth:user-session:{userId}`

## Guards and decorators

Protected routes use `@Auth()` from `src/decorators/http.decorators.ts`:

```typescript
@Auth()                                    // JWT required
@Auth([UserRole.ADMIN])                    // JWT + legacy role
@Auth([], { permissions: ['user:read'] })  // JWT + permission
@PublicRoute(true)                         // skip JWT (used on auth controller)
```

Guard chain: `AuthGuard` → `RolesGuard` → `PermissionsGuard`.

Inject current user: `@AuthUser() user: UserEntity`.

## Bootstrap account

Migration seeds (idempotent):

- Username: `admin`
- Password: `0123456789`
- Role: `admin`

**Rotate the admin password in production** after first deploy.

## Production checklist

- [ ] Set strong RS256 keys; never commit real keys
- [ ] `REDIS_CACHE_ENABLED=true` with persistent Redis
- [ ] Change default `admin` password
- [ ] Configure Google OAuth env vars if using SSO
- [ ] Implement email delivery for verification and password reset
- [ ] Run migrations: `yarn migration:run`

## Module layout

| Path | Responsibility |
|------|----------------|
| `src/modules/auth/auth.module.ts` | JWT, Passport, Google strategy |
| `src/modules/auth/auth.controller.ts` | HTTP routes |
| `src/modules/auth/auth.service.ts` | Register, login, SSO, email, reset |
| `src/modules/auth/strategies/jwt.strategy.ts` | Token + session validation |
| `src/modules/auth/strategies/google.strategy.ts` | Google profile extraction |
| `src/modules/auth/auth-redis.constants.ts` | Redis key prefixes + TTLs |
| `src/guards/auth.guard.ts` | Bearer JWT guard |
| `src/guards/roles.guard.ts` | Legacy role + RBAC slug check |
| `src/guards/permissions.guard.ts` | Permission name check |
