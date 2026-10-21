# Payments contract

The agreed interface for the `payments` module. Owned by Engineer A; `sales`
(Engineer B) builds against the `Payment` shape and the allocation rule below.
Architecture decisions: `docs/adr/001-payments-architecture.md`.

> **Reconciled to the implementation (2026-10-21).** Where the original ADR said
> `PENDING → MATCHED` with a `payment.received` event, the shipped code uses a
> provider-settlement status (`SUCCEEDED`) and a `payment.confirmed` event, and
> **allocation is tracked separately from payment status** (see "What `sales`
> relies on"). This doc now reflects what is built; ADR 001 carries an amendment
> noting the change.

## Models (Prisma)

### PaymentAccount
How a business receives money.
| Field | Type | Notes |
|---|---|---|
| id | String | PK (uuid v4) |
| organizationId | String | tenant scope |
| branchId | String? | optional; copied onto `Payment` at write time |
| provider | enum `PaymentProvider` | `PAYSTACK` |
| providerAccountId | String? | may be unknown until first real event |
| status | enum `PaymentAccountStatus` | `ACTIVE` \| `DISABLED` |
| integrationTokenHash | String (unique) | sha256 of the per-account webhook token (DIRECT) |
| secretCiphertext | String | AES-256-GCM-encrypted webhook signing secret |
| keyVersion | Int | encryption key version |

Unique: `integrationTokenHash`; `(provider, providerAccountId)`.
**Planned for MANAGED (not yet built):** `integrationType (DIRECT|MANAGED)`,
`paystackCustomerCode`, `dvaBank`, `dvaAccountNumber`.

### WebhookEvent (raw ingest log + first idempotency layer)
Raw bytes + verification result; the worker processes these asynchronously.
| Field | Type | Notes |
|---|---|---|
| id | String | PK |
| paymentAccountId | String? | null = quarantined (unknown account) |
| eventType | String | e.g. `charge.success` |
| payload | Json? | only when signed + valid JSON |
| rawBody | String | exact bytes (truncated if oversized + unauthenticated) |
| signatureValid | Boolean | |
| dedupeKey | String | sha256(`eventType:reference:body`) |
| status | enum `WebhookEventStatus` | `RECEIVED` `PROCESSING` `PROCESSED` `FAILED` `QUARANTINED` `REJECTED` |
| attempts / lastError / correlationId / receivedAt / processedAt / availableAt | | retry + audit metadata |

Unique: `(paymentAccountId, dedupeKey)` — idempotency layer 1.

### Payment
| Field | Type | Notes |
|---|---|---|
| id | String | PK (uuid v4) |
| paymentAccountId | String | FK |
| organizationId / branchId | String / String? | tenant scope (copied from the account) |
| providerReference | String | Paystack reference |
| providerPaymentId | String? | informational only |
| amountMinor | **BigInt** | integer minor units (kobo); serialize to string at the API edge |
| currency | String | ISO 4217 |
| method | String | card / transfer / … (Paystack `channel`) |
| status | enum `PaymentStatus` | `PENDING` \| `SUCCEEDED` \| `FAILED` (refunds = separate records later) |
| occurredAt / receivedAt | DateTime | |

Unique: `(paymentAccountId, providerReference)` — idempotency layer 2.

### LedgerEntry — MANAGED wallet, **planned + simulated** (ADR 001 §5)
Not yet built. Append-only; `amountMinor` BigInt (credit `+`, settlement `-`),
`type` (`DVA_COLLECTION` | `SETTLEMENT`), `status`, `paymentId?`. Simulated in
Paystack test mode; **no real fund custody**.

## Lifecycle (as built)
```
WebhookEvent: RECEIVED → PROCESSING → PROCESSED        (or FAILED / QUARANTINED / REJECTED)
Payment:      SUCCEEDED   (created on a verified charge.success)
              PENDING / FAILED reserved for other sources (e.g. manual/cash, failures)
```
Only the payments worker/service writes `Payment` and `WebhookEvent`.
Refunds/chargebacks will be **separate records**, not a status flag.

## What `sales` relies on — allocation (reconciled)
A confirmed payment is `SUCCEEDED` **and unallocated**. Allocation does not flip
the payment status; instead a payment can back **exactly one sale**, enforced by
a unique constraint — "use the idempotency pattern already in use" rather than a
status claim:

- `sales` lists `SUCCEEDED` payments with **no `SaleAllocation`** → the
  "what did you sell?" queue.
- Allocation creates `Sale` + `SaleAllocation` in one transaction;
  **`SaleAllocation.paymentId` is unique**, so two concurrent confirms → one
  wins, the other hits `P2002` → **409 conflict** (the double-tap guard).
- The request carries a client `idempotencyKey`; a replay returns the original
  sale instead of erroring.
- Split payments later: relax to many allocations summing to the payment amount.

This replaces the old `PENDING → MATCHED` claim and needs a 👍 from Engineer A
(it lives on the sales side, referencing his `Payment.id`).

## Outbox event (as built)
`type: 'payment.confirmed'`, payload
`{ paymentId, organizationId, branchId, reference, amountMinor: string, currency }`
(BigInt serialized as a decimal string). Emitted in the same transaction as the
`Payment` create. Consumed by the worker → (web) WebSocket gateway — not yet built.

## Endpoints (`/v1`)
| Method | Path | Status |
|---|---|---|
| POST | `/webhooks/paystack/:integrationToken` | **built** — DIRECT receiver (per-account secret) |
| POST | `/webhooks/paystack/platform` | planned — MANAGED (platform secret, route by `customer_code`) |
| POST | `/payments/manual` | planned — cash/manual |
| GET | `/payments?status=&branchId=` | planned — list |

Allocation (`POST /payments/:id/match` or a sales route) lives in **sales**.

## Known gaps to close (tracked)
- 🔴 Unknown token currently returns **401**; must be **200 + log** (CLAUDE.md:
  unknown webhook tokens reveal nothing and are not retried by the provider).
- 🟡 MANAGED/DVA flow, platform webhook routing, and the simulated wallet/ledger
  are not built yet (ADR 001 decision: dual flow + simulated escrow).
- Rate limiting on the webhook route (abuse/DoS on quarantine storage).

## Configure a Paystack test webhook (DIRECT)
The Paystack dashboard needs a public HTTPS URL; `localhost` isn't reachable, so
tunnel the API port (default `3000`) with ngrok/Cloudflare Tunnel and use that
origin as `PUBLIC_BASE_URL`.
1. `npm run start:dev` (DB + Redis up first).
2. `ngrok http 3000` → copy the HTTPS origin.
3. In `.env` set `PUBLIC_BASE_URL`, `SEED_ORG_ID`, `SEED_PAYSTACK_SECRET_KEY`
   (test key), and `CREDENTIALS_ENCRYPTION_KEY`
   (`node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`).
4. `npx ts-node -T scripts/seed-payment-account.ts` → prints the full webhook URL
   `…/v1/webhooks/paystack/<integration-token>` (token stored only as a hash —
   save the printed URL).
5. Paste it into Paystack **test-mode** webhooks and trigger an event. Set
   `WEBHOOK_WORKER_ENABLED=true` to process events in the API process; then check
   the `WebhookEvent`, `Payment`, `AuditLog`, and `OutboxEvent` rows.

## Open items to confirm with Engineer A
- Ratify the allocation rule above (unique `SaleAllocation.paymentId` + idempotencyKey).
- Is there a `PaymentService` helper sales should call, or does sales own the
  allocation transaction directly? (Prefer a thin `payments` read for
  "unallocated SUCCEEDED payments".)
