# ADR 001: Payments architecture — flows, tenant mapping, transport, money, managed wallet

Status: Proposed (needs ratification by both engineers before PAY-01 continues)

## Context
Payments ingests Paystack events and triggers the 60-second "what did you sell?"
loop. A proposed blueprint introduced choices that conflict with the technical
spec (float money, inline WebSocket, unified-URL routing, a fund-custody wallet).
This ADR locks the interlocking decisions so the payments and sales modules are
built once, not reworked. The primary client is now a **web app** (not the
React Native mobile app the spec assumed); the backend remains client-agnostic.

## Decisions

### 1. Two ingestion flows
- **DIRECT (enterprise):** merchant connects their **own** Paystack account.
  Real funds settle to the merchant's bank; the platform never touches them. We
  log a **tracking** payment (amount recorded for the sale, no platform credit).
- **MANAGED (SME):** merchant uses the **platform** Paystack account with a
  Dedicated Virtual Account (DVA). Transfers land in the platform balance and we
  credit the merchant's internal wallet. See decision 5.

`PaymentAccount.integrationType` is `DIRECT | MANAGED`.

### 2. Tenant mapping (hybrid — the two flows differ by construction)
- **DIRECT:** unique webhook URL `/v1/webhooks/paystack/:token`. The token
  identifies the `PaymentAccount` (hence org + branch). Verified with **that
  account's** encrypted secret. The merchant pastes this URL into their own
  Paystack dashboard.
- **MANAGED:** a single platform URL `/v1/webhooks/paystack/platform`. Verified
  with the **platform** secret. Routed to the business by the payload's
  `customer.customer_code` → `PaymentAccount.paystackCustomerCode`.
- Unknown token / unmatched customer_code → **HTTP 200 + log**, no action
  (reveal nothing). Bad signature → reject.

### 3. Money: integer minor units, BigInt
- All payment/sale/ledger amounts are **BigInt** (Postgres `int8`) in integer
  minor units (kobo). Never `DECIMAL`, never floats. Product `price`/`cost`
  stay `Int` (a single item won't hit the ~₦21.4M int4 cap).
- `common/Money.amount` changes from `number` to `bigint` so the DB type and the
  domain type match (Prisma returns `bigint` for `int8`). One representation.

### 4. After-commit + real-time transport
- Webhook: verify signature against the **raw body** (timing-safe) → persist the
  raw payload → insert `PENDING` payment (idempotent on `(provider, providerRef)`)
  → write `outbox 'payment.received'` → **return 200 fast**. No inline work.
- A worker consumes `payment.received` and delivers it to the connected web
  dashboard over a **WebSocket gateway**. WebSocket (not FCM) because the client
  is a web app; the backend stays client-agnostic (it only emits the outbox
  event — the gateway is a delivery adapter). Web Push for closed tabs is future
  work.

### 5. Managed wallet + settlement — SIMULATED for the capstone
- The internal wallet and settlement are implemented as an **append-only ledger**
  against **Paystack test mode** only. **No real third-party funds are ever
  custodied.** Balance = `SUM(ledger.amount)`; "withdraw" appends a negative
  `PENDING` `SETTLEMENT` row (prevents double-spend); an admin marks it
  `SUCCESSFUL` after a (sandboxed) payout. Labeled **"simulated"** in the demo,
  exactly as WhatsApp is.
- **Real fund custody is explicitly out of scope** (pooled FBO account, payout
  rails, KYC, reconciliation, licensing). Documented as future work.

## Options considered (rejected)
- Float/`DECIMAL` money — violates the money invariant.
- Single webhook URL routing purely by payload — fails for DIRECT (merchant's
  own account posts to their own configured URL) and couples to payload shape.
- Inline WebSocket emit in the request — loses events on a crash; bypasses the
  outbox we built.
- Real fund custody — not legally/operationally feasible for a capstone.

## Consequences
- Easier: one money type end to end; crash-safe delivery via the outbox; sales
  can rely on a fixed `Payment` contract; the escrow is demoable without real risk.
- Harder / new surface: a WebSocket gateway; a `PaymentAccount.integrationType`
  branch in ingestion; a wallet ledger + settlement workflow (simulated); the
  `Money` type change ripples through `common` and its callers.
- Revisit later: the sync module's offline-first emphasis (mobile-shaped), and
  real custody + Web Push as future work.

## Amendment (2026-10-21) — reconciled to the shipped DIRECT implementation
The PAY-01 build (DIRECT/Flow A) settled two points differently from §3–§4
above; we adopt the implementation as the source of truth and updated
`docs/payments-contract.md` to match:
- **Payment status** is a provider-settlement status — `PENDING | SUCCEEDED |
  FAILED` — not `PENDING → MATCHED`. A verified `charge.success` creates a
  `SUCCEEDED` payment. **Allocation is tracked separately from payment status.**
- **The outbox event is `payment.confirmed`** (not `payment.received`), emitted
  in the same transaction as the `Payment` create.
- **Allocation double-tap guard** (for `sales`) is a **unique
  `SaleAllocation.paymentId`** plus the client `idempotencyKey`, not a status
  flip — reusing the unique-constraint idempotency pattern already used in
  payments/webhook ingestion.

Unchanged and still required: BigInt integer-minor-unit money, raw-body
timing-safe HMAC, persist-raw → 200-fast → async, dual flow + simulated managed
wallet (DIRECT built; MANAGED pending), WebSocket transport for the web client.
Outstanding: unknown token must return **200 + log**, not 401.
