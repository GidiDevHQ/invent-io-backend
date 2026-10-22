# Payments contract

The agreed interface for the `payments` module. Owned by Engineer A; `sales`
(Engineer B) builds against the `Payment` shape and state machine below.
Decisions behind this are in `docs/adr/001-payments-architecture.md`.

## Models (Prisma)

### PaymentAccount

How a business receives money. One per branch (or per org).

| Field                      | Type     | Notes                                                |
| -------------------------- | -------- | ---------------------------------------------------- |
| id                         | String   | PK (uuid v4)                                         |
| organizationId             | String   | tenant scope                                         |
| branchId                   | String?  | optional                                             |
| provider                   | String   | e.g. `paystack`                                      |
| integrationType            | enum     | `DIRECT` \| `MANAGED`                                |
| webhookToken               | String?  | DIRECT: unique; identifies this account from the URL |
| encryptedSecret            | String   | AES-256-GCM; the webhook signing secret (DIRECT)     |
| paystackCustomerCode       | String?  | MANAGED: maps DVA events to this account             |
| dvaBank / dvaAccountNumber | String?  | MANAGED: displayed to the merchant                   |
| createdAt                  | DateTime |                                                      |

Unique: DIRECT `webhookToken`; MANAGED `paystackCustomerCode`.

### Payment

| Field                     | Type     | Notes                                                         |
| ------------------------- | -------- | ------------------------------------------------------------- |
| id                        | String   | PK (uuid v4)                                                  |
| organizationId / branchId | String   | tenant scope                                                  |
| provider                  | String   | `paystack` / `cash`                                           |
| providerRef               | String   | Paystack reference; cash → generated                          |
| amount                    | BigInt   | integer minor units (kobo)                                    |
| currency                  | String   | ISO 4217                                                      |
| method                    | String   | card / transfer / cash                                        |
| status                    | enum     | `PENDING` \| `MATCHED` \| `IGNORED` \| `REFUNDED` \| `FAILED` |
| rawPayload                | Json     | stored before processing                                      |
| receivedAt                | DateTime |                                                               |

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

| Method | Path                                   | Purpose                                                    |
| ------ | -------------------------------------- | ---------------------------------------------------------- |
| POST   | `/webhooks/paystack/:integrationToken` | DIRECT receiver (per-account secret)                       |
| POST   | `/webhooks/paystack/platform`          | MANAGED receiver (platform secret, route by customer_code) |
| GET    | `/payments/managed-account`            | Get this organization’s managed account and DVA            |
| POST   | `/payments/managed-account`            | Provision a test subaccount and linked DVA                 |
| POST   | `/payments/manual`                     | Record received cash as SUCCEEDED with generated reference |
| GET    | `/payments?status=SUCCEEDED&branchId=&limit=&cursor=` | Cursor-paginated, unallocated payments for itemization |
| POST   | `/payments/:id/ignore`                 | → IGNORED                                                  |

Allocation (`POST /payments/:id/match`) lives in **sales**, not payments.

The payments list is restricted to `SUCCEEDED` records with no sale allocation.
Omit `status` or pass `status=SUCCEEDED`; other statuses are rejected. `branchId`
is optional for organization-wide members and is always constrained to the
active tenant. A branch-scoped member can only see their own branch. Pagination
uses the shared `limit`/opaque `cursor` convention and returns
`{ items, nextCursor }`.

`POST /payments/manual` accepts `{ "amountMinor": "125000", "branchId": "..." }`.
The amount is a positive integer string in minor units; `branchId` may be
omitted for a branch-scoped member. Organization-wide members must specify an
active branch. The backend generates a unique `cash_...` reference, records the
receipt as `SUCCEEDED`, and emits `payment.confirmed`, putting cash receipts in
the same itemization queue and allocation flow as webhook payments.

## Configure a Paystack test webhook (DIRECT)

The Paystack dashboard needs a publicly reachable HTTPS URL. `localhost` is
only reachable on your machine, so for local development run the API and
expose its port (default `3000`) through a tunnel such as ngrok or Cloudflare
Tunnel. Use the tunnel's HTTPS origin as `PUBLIC_BASE_URL`.

1. Start the database and Redis, then start the API from `invent-io-backend`:

   ```sh
   npm run start:dev
   ```

2. Start an HTTPS tunnel to the API port. For example:

   ```sh
   ngrok http 3000
   ```

   Copy the HTTPS forwarding origin shown by the tunnel, for example
   `https://example.ngrok-free.app`.

3. In the backend `.env`, set the following values. Obtain the organization ID
   from your database; use a Paystack **test** secret key from the Paystack
   dashboard. Generate a 32-byte encryption key with Node.js:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
   ```

   Put that output in `CREDENTIALS_ENCRYPTION_KEY`:

   ```dotenv
   PUBLIC_BASE_URL=https://example.ngrok-free.app
   SEED_ORG_ID=<organization-id>
   SEED_PAYSTACK_SECRET_KEY=sk_test_...
   CREDENTIALS_ENCRYPTION_KEY=<base64-encoded-32-byte-key>
   ```

   Keep the Paystack secret and encryption key private. Do not commit `.env`.

4. From `invent-io-backend`, create a test `PaymentAccount` and print its
   webhook URL:

   ```sh
   npx ts-node -T scripts/seed-payment-account.ts
   ```

   The output is the complete URL:

   ```text
   https://example.ngrok-free.app/v1/webhooks/paystack/<integration-token>
   ```

   The token is stored only as a hash, so save the printed URL; it cannot be
   retrieved from the database later. Each run creates another account/token.

5. In Paystack's **test-mode** webhook settings, paste that complete URL and
   trigger a test event. The API must be running and the tunnel must remain
   active. If the tunnel URL changes, update `PUBLIC_BASE_URL`, create a new
   account/token, and update the Paystack webhook URL.

## Current Flow A processing behavior

The implemented path is DIRECT/Flow A only. It verifies HMAC-SHA512 over the
raw request bytes, persists valid webhook events, and processes
`charge.success` asynchronously. The worker creates a `SUCCEEDED` `Payment`,
an audit entry, an outbox `payment.confirmed` event, and marks the webhook
`PROCESSED` in one database transaction. Payment idempotency is enforced by
`(paymentAccountId, providerReference)`; a duplicate matching payment
reference is marked processed without another audit or outbox event. Invalid
event shapes and unsupported event types are quarantined.

To exercise processing locally, set `WEBHOOK_WORKER_ENABLED=true` for the API
process after configuring the database, Redis, encryption key, and seeded
test account. The API acknowledges after durable webhook receipt; payment
creation is asynchronous. Confirm the `WebhookEvent`, `Payment`, `AuditLog`,
and `OutboxEvent` rows after delivery.

The application now has a tenant-scoped managed-account provisioning endpoint
and a platform webhook route. Configure `PAYSTACK_PLATFORM_TEST_SECRET_KEY`
with a test secret before accepting platform deliveries. The webhook processor
supports a verified, platform-ingested `charge.success` event: it maps
`data.customer.customer_code` and, when present,
`data.authorization.receiver_bank_account_number` to the same pending or active DVA, then creates a tenant-scoped
payment linked to that DVA and managed payment account. Unmapped or inactive
A missing mapping, mismatched identifiers, and disabled/failed accounts are quarantined.
A verified `dedicatedaccount.assign.success` event activates the matching
pending DVA when its customer code and optional account number match the stored
provisioning record; it does not mark the managed profile settled or infer that
Paystack has settled funds. A platform webhook ingress route that verifies the
platform signature and durably stores events without a DIRECT account is still
required before this processing path can be used with production credentials.

An initial test-key-only provisioning
proof is available with `npm run paystack:flow-b:proof`. It creates a Paystack
subaccount with 0% platform commission, creates the owner customer, then asks
Paystack to create a DVA linked to that subaccount. This script is a sandbox
proof only: it does not persist the provider records in Invent-IO, and it is
not safe to treat a successful DVA response as proof of completed settlement.
Verify the transaction, webhook, and settlement destination in Paystack before
adding production onboarding or a settlement model. No internal wallet or
Invent-IO payout initiation is part of Flow B. The script creates provider
resources and is not idempotent; if a step fails after creating a subaccount or
customer, retain the printed provider code and inspect the Paystack dashboard
before retrying.

The provider documentation describes [subaccounts and split payments](https://paystack.com/docs/payments/split-payments/)
and [subaccount linking for dedicated virtual accounts](https://paystack.com/docs/payments/dedicated-virtual-accounts/#split-payment-on-dedicated-virtual-account).

The initial persistence shape is `ManagedPaymentAccount` (one per organization)
and `DedicatedVirtualAccount` (one or more per managed profile). The managed
profile stores the Paystack subaccount code and verified settlement bank/name,
and an AES-GCM encrypted settlement account number for safe provisioning retries;
API responses expose only its last four digits. A DVA stores
the provider customer code and account details needed to show the virtual
account to the organization. Managed payments use nullable `paymentAccountId`
plus `managedPaymentAccountId` and `dedicatedVirtualAccountId`; a database
constraint ensures each payment belongs to exactly one integration flow.
Settlement confirmation is not inferred from `charge.success`.

The ADR's
`payment.received` name and this implementation's `payment.confirmed` name
must be reconciled before building consumers against either event.

## What `sales` relies on (so it can be built in parallel)

- A `Payment` row in `PENDING` with `id`, `amount: BigInt`, `currency`,
  `branchId`, `organizationId`.
- **Atomic claim:** allocation does
  `updateMany({ where: { id, status: 'PENDING' }, data: { status: 'MATCHED' }})`;
  `count === 0` → 409 conflict. This is the double-tap guard.
- `payments` exposes a `PaymentService` claim method (or sales performs the
  conditional update within its transaction) — **to be confirmed with Engineer A.**

## Outbox event

Current Flow A emits `type: 'payment.confirmed'` with
`{ paymentId, organizationId, branchId, reference, amountMinor: string,
currency }`. BigInt amounts are serialized as decimal strings. WebSocket
delivery and payment-list APIs are not implemented yet.

## Open items to confirm with Engineer A

- Does `sales` call a `PaymentService.claim(tx, id)` or run the conditional
  update itself? (Prefer a `PaymentService` method to keep the state machine in
  payments.)
- `OutboxEvent` column additions (`organizationId`, `attempts`, `lastError`,
  `availableAt`) — coordinate the migration; the `OutboxPublisher` update to use
  them is owned by whoever owns `outbox`.
