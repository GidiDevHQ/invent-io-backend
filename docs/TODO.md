# TODO / Backlog

Shared backlog of work not yet built. Grouped by module. Keep it current as
items ship or get added. Deeper context lives in `docs/adr/` and
`docs/audit/auth-tenancy-2026-10-09.md`.

## Shipped (for context)
auth · tenancy · catalog · inventory (stock ledger) · audit · outbox + worker ·
payments (DIRECT webhook ingestion) · sales (atomic allocation) · notifications
(email/WhatsApp channels + auto-dispatch) · realtime WebSocket "wake the screen".

## Payments
- [ ] `GET /v1/payments?status=&branchId=` — list **unallocated SUCCEEDED**
      payments (the "to-do / tap a payment" pull screen). Cursor-paginated.
- [ ] `POST /v1/payments/manual` — cash/manual path (generated ref → same flow).
- [ ] MANAGED / DVA flow: platform-account webhook route, `integrationType`,
      `paystackCustomerCode`, DVA fields (ADR 001).
- [ ] Managed wallet + settlement — **simulated** ledger, withdraw request,
      admin payout, `settlement.completed` notification (ADR 001 §5; test mode,
      no real custody).
- [ ] `POST /v1/payments/:id/ignore` (mark not-a-sale → IGNORED).
- [ ] Reconciliation job — backfill payments missed by webhooks.
- [ ] Refunds: `POST /v1/sales/:id/refund` (restore stock via RETURN movements,
      reverse margin, mark REFUNDED).

## Sales
- [ ] Ratify the allocation rule with Engineer A: unique `SaleAllocation.paymentId`
      + idempotencyKey (currently implemented that way).
- [ ] Split payments (many allocations summing to a payment).
- [ ] `daily_sales_summary` update inside the allocation tx (needs `reports`).

## Notifications
- [ ] Opt-in / consent enforcement — needs a consent field on `User`
      (auth/tenancy owns); currently **all org members** are notified.
- [ ] **Web Push** (device-level banners, opt-in): `PushSubscription` table +
      `POST/DELETE /v1/notifications/subscriptions`, a `webpush` channel
      (`web-push` lib + self-generated VAPID), dispatcher wiring. Frontend adds a
      service worker + permission + `subscribe()`. iOS needs "Add to Home Screen".
      (Needs an ADR for the dep.)
- [ ] WhatsApp **approved templates** for out-of-window business-initiated sends.
- [ ] Weekly summary **scheduler** (BullMQ repeatable, per business, org
      timezone; pulls from `reports`).

## Auth / account lifecycle (emails ride notifications channels)
- [ ] Onboarding / welcome email on registration.
- [ ] Email verification (token email + `verified` flag + resend).
- [ ] OTP login: `/auth/otp/request` + `/auth/otp/verify` (6-digit, 5-min,
      attempt-limited, rate-limited). `otp` template exists.
- [ ] Forgot / reset password (single-use short-lived token; invalidate sessions).
- [ ] Change email / change password (while logged in).
- [ ] Membership invite email: `POST /memberships/invite`. `membership.invite`
      template exists.
- [ ] Account lockout on repeated failed logins.
- [ ] MFA for enterprise web (later).
- [ ] Device registration `POST /v1/devices` (ties into Web Push).

## Reports (not started)
- [ ] `GET /v1/dashboard/summary`, `/dashboard/low-stock`.
- [ ] `daily_sales_summary` table maintained incrementally.
- [ ] `GET /v1/reports/sales` (filters + CSV export), weekly summary payload.

## Sync (not started — Engineer A)
- [ ] `POST /v1/sync/push`, `GET /v1/sync/pull` (offline ops, `change_log`).
- [ ] UUIDv7 migration before building sync (ADR 006 — currently v4).

## Catalog / inventory
- [ ] CSV bulk import (`POST /v1/products/import`, all-or-nothing, per-line errors).
- [ ] Product search; per-branch price overrides (later).

## Cross-cutting / platform
- [ ] Global exception filter → standard error shape `{ error: {...} }` (audit #6).
- [ ] Register tenant/permission guards globally (audit #7).
- [ ] Rate limiting on auth/OTP/webhook routes (audit #8; Redis available).
- [ ] Org-scoped roles — currently a shared global `OWNER` role (audit #5).
- [ ] Outbox: dead-letter queue + metrics (ADR 003). WebSocket: reconnection/
      backfill on connect, delivery metrics (ADR 009).
- [ ] `Money.amount` in `common` → `bigint` to match DB (deferred decision).

## Open decisions / in-flight
- [ ] Merge `docs/reconcile-payments-contract` (contract aligned to shipped model).
- [ ] Rate limiting is a prerequisite for OTP / password reset / login hardening.
