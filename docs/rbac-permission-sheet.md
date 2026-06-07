# RBAC Permission Sheet

Auth architecture and session/cache details: [auth.md](./auth.md), [cache.md](./cache.md).

## Permission Catalog

- `user:read` - Read users
- `user:write` - Create or update users
- `role:read` - Read roles
- `role:write` - Create or update roles
- `permission:read` - Read permissions
- `permission:write` - Create or update permissions
- `auth:manage` - Manage auth settings and account linking policies

## Role Mapping

- `admin` -> all permissions
- `doctor` -> `user:read`
- `nurse` -> `user:read`

## Endpoint Mapping

### Auth

- `POST /auth/register` - Public
- `POST /auth/login` - Public (identifier = username or verified email)
- `POST /auth/forgot-password` - Public
- `POST /auth/reset-password` - Public
- `GET /auth/me` - Authenticated
- `GET /auth/google` - Public (Google OAuth start)
- `GET /auth/google/callback` - Public (Google OAuth callback)
- `POST /auth/update-email` - Authenticated
- `POST /auth/request-email-verification` - Authenticated
- `POST /auth/verify-email` - Authenticated

### Admin RBAC

- `GET /admin/users` -> `user:read`
- `GET /admin/roles` -> `role:read`
- `GET /admin/permissions` -> `permission:read`
- `PATCH /admin/users/:id/roles` -> `user:write`
- `PATCH /admin/roles/:id/permissions` -> `role:write`

## Account Linking Rules

- One user can authenticate with local credentials, Google SSO, or both.
- Username/password registration does not require email.
- If email is added or changed later, verification is required before the email becomes active.
- Local login supports:
  - Username + password
  - Verified email + password
- Google callback links identity by provider subject first; if not found, it links by email; if no match, it creates a new user.

## Email Verification Architecture

- System stores verification record with:
  - `method = otp | link`
  - secret hash (`otp_hash` or `token_hash`)
  - `expires_at`
  - `consumed_at`
- Current backend generates both flow types and logs issuance; email transport can be plugged in later.

## Security Operation Notes

- Default bootstrap account: `admin/admin`.
- Force password rotation for `admin` account in production after initial bootstrap.
- Keep migration idempotent when replaying on staging/production.
