# Payments contract

The agreed interface for the `payments` module. Owned by Engineer A; `sales`
(Engineer B) builds against the `Payment` shape and state machine below.
Decisions behind this are in `docs/adr/001-payments-architecture.md`.

## Models (Prisma)

### PaymentAccount
How a business receives money. One per branch (or per org).
| Field | Type | Notes |
|---|---|---|
| id | String | PK (uuid v4) |
| organizationId | String | tenant scope |
| branchId | String? | optional |
| provider | String | e.g. `paystack` |
| integrationType | enum | `DIRECT` \| `MANAGED` |
| webhookToken | String? | DIRECT: unique; identifies this account from the URL |
| encryptedSecret | String | AES-256-GCM; the webhook signing secret (DIRECT) |
| paystackCustomerCode | String? | MANAGED: maps DVA events to this account |
| dvaBank / dvaAccountNumber | String? | MANAGED: displayed to the merchant |
| createdAt | DateTime | |

Unique: DIRECT `webhookToken`; MANAGED `paystackCustomerCode`.

### Payment
| Field | Type | Notes |
|---|---|---|
| id | String | PK (uuid v4) |
| organizationId / branchId | String | tenant scope |
| provider | String | `paystack` / `cash` |
| providerRef | String | Paystack reference; cash → generated |
| amount | BigInt | integer minor units (kobo) |
| currency | String | ISO 4217 |
| method | String | card / transfer / cash |
| status | enum | `PENDING` \| `MATCHED` \| `IGNORED` \| `REFUNDED` \| `FAILED` |
| rawPayload | Json | stored before processing |
| receivedAt | DateTime | |

Unique: `(provider, providerRef)` — the idempotency key.

### WebhookEvent (raw ingest log) and the MANAGED wallet ledger
- `WebhookEvent`: raw payload + headers + verification result, for audit/replay.
- `LedgerEntry` (MANAGED, **simulated** per ADR 001): append-only; `amount`
  BigInt (credit `+`, settlement `-`), `type` (`DVA_COLLECTION` | `SETTLEMENT`),
  `status` (`PENDING` | `SUCCESSFUL` | `FAILED`), `paymentId?`. Balance =
  `SUM(amount WHERE status='SUCCESSFUL')`.

## State machine (only `PaymentService` mutates `status`)
```
PENDING --match--> MATCHED        (allocation claims it; see below)
PENDING --ignore--> IGNORED
MATCHED --refund--> REFUNDED
(provider failure) --> FAILED
```

## Endpoints (all under `/v1`)
| Method | Path | Purpose |
|---|---|---|
| POST | `/webhooks/paystack/:token` | DIRECT receiver (per-account secret) |
| POST | `/webhooks/paystack/platform` | MANAGED receiver (platform secret, route by customer_code) |
| POST | `/payments/manual` | cash/manual → PENDING with generated ref |
| GET | `/payments?status=pending&branchId=` | pending list |
| POST | `/payments/:id/ignore` | → IGNORED |

Allocation (`POST /payments/:id/match`) lives in **sales**, not payments.

## Ingestion rules (ADR 001 §2, §4)
1. Verify HMAC SHA512 over the **raw body**, timing-safe, before storing.
2. Persist raw payload; insert `PENDING` payment (idempotent on
   `(provider, providerRef)`).
3. For MANAGED, append a `DVA_COLLECTION` ledger credit in the same transaction.
4. Write `outbox 'payment.received'` **in the same transaction**; return 200 fast.
5. Unknown token / unmatched customer_code → 200 + log, no action.

## What `sales` relies on (so it can be built in parallel)
- A `Payment` row in `PENDING` with `id`, `amount: BigInt`, `currency`,
  `branchId`, `organizationId`.
- **Atomic claim:** allocation does
  `updateMany({ where: { id, status: 'PENDING' }, data: { status: 'MATCHED' }})`;
  `count === 0` → 409 conflict. This is the double-tap guard.
- `payments` exposes a `PaymentService` claim method (or sales performs the
  conditional update within its transaction) — **to be confirmed with Engineer A.**

## Outbox event
`type: 'payment.received'`, `payload: { paymentId, organizationId, branchId,
amount: string /* BigInt serialized */, currency }`. Consumed by the worker →
WebSocket gateway → web dashboard.

## Open items to confirm with Engineer A
- Does `sales` call a `PaymentService.claim(tx, id)` or run the conditional
  update itself? (Prefer a `PaymentService` method to keep the state machine in
  payments.)
- `OutboxEvent` column additions (`organizationId`, `attempts`, `lastError`,
  `availableAt`) — coordinate the migration; the `OutboxPublisher` update to use
  them is owned by whoever owns `outbox`.
