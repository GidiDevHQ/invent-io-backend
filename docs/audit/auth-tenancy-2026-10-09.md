# Audit: auth & tenancy — 2026-10-09

Review of the `auth` and `tenancy` modules against the technical spec (§11,
§20.1, §20.2) and for correctness/security. Items marked **Fixed** are addressed
in PR `fix/auth-hardening`; **Deferred** items are tracked here as follow-ups.

## Fixed in `fix/auth-hardening`

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | 🔴 Critical | `login` issued tokens without verifying the password — any password worked for a known email | `argon2.verify`, reject on mismatch |
| 2 | 🟠 High | Refresh-rotation reuse detection raced (read-then-write), so concurrent requests could both rotate | Atomic conditional claim on `usedAt`; zero rows → reuse → revoke family |
| 3 | 🟠 High | Access tokens lived 1 day; logout/role changes didn't take effect promptly | TTL reduced to 15m |
| 4 | 🟠 High | Tenant org resolved via `findFirst` with no ordering → arbitrary for multi-membership users | `org` claim in token; guard resolves by `(userId, org)` + deterministic earliest fallback |
| — | 🔵 Nit | Unused `isString` import in login DTO | Removed |
| — | Infra | Redis absent entirely (needed for queues/cache/rate-limits) | Added `redis` service to compose (port-overridable) |

## Deferred (not yet actioned)

### #5 — Roles are global, not org-scoped (🟡 Medium)
`Role.name` is globally unique; `register` upserts one shared `OWNER` role.
Spec §20.2 wants roles scoped to an organization. Today every org shares the
same role rows — editing one would affect all tenants.
**Needs:** schema change (`organizationId` on role, or a role-per-org seed) +
migration + a design call with the module owner.

### #6 — No global exception filter → non-standard error shape (🟡 Medium)
Auth throws raw Nest exceptions, so responses aren't the spec's
`{ error: { code, message, details, requestId } }` (§21.1). `common/errors.ts`
defines the shape but nothing maps to it.
**Needs:** a global exception filter + request-id interceptor.

### #7 — Guards are opt-in per controller (🟡 Medium)
`JwtAuthGuard + TenantContextGuard + PermissionGuard` must be remembered on
every controller; one omission = an unscoped endpoint.
**Needs:** register tenant/permission guards globally (with an `@Public()` /
skip decorator for auth and webhook routes).

### #8 — No rate limiting / account lockout (🟡 Medium)
Spec §11 requires rate limiting on auth/OTP/webhook routes and §20.1 wants
lockout on repeated failures. Neither exists. Redis is now available to back a
throttler.
**Needs:** `@nestjs/throttler` (Redis store) on auth routes; lockout policy.

### Not-yet-built (per scope tiers, expected)
OTP/PIN login, device registration (§20.1); BullMQ wiring on top of Redis;
permission caching in Redis (§20.2 — currently read live from Postgres, which is
correct, just uncached).

## Notes
- These are the other engineer's modules; fixes land via reviewed PRs.
- Env still uses a single `JWT_SECRET` vs the spec's
  `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`. Refresh tokens are random UUIDs (not
  JWTs), so a separate refresh secret isn't strictly required — naming only.
