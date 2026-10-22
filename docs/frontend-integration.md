# Frontend & Design integration brief (web app)

Current as of the sales + notifications + realtime work. The backend is
**client-agnostic**; live API reference (Scalar): **`/v1/reference`**. Spec file
for mocking: **`docs/openapi.json`** (`npm run openapi:export` to refresh).
Deeper refs: `docs/payments-contract.md`, `docs/adr/001-payments-architecture.md`,
`docs/adr/009-realtime-websocket.md`.

## The one-liner
A payment arrives → the merchant's open dashboard **instantly** shows
**"₦X received — what did you sell?"** → they tap the products → stock, margin
and low-stock update. Target: **payment to confirmed sale in under 60 seconds.**

## Ground rules (apply everywhere)
- **Base path:** everything under **`/v1`**. Source of truth: `/v1/reference` (Scalar).
- **Auth:** `register`/`login` → an **access token (~15 min)** + a **refresh token**.
  Send `Authorization: Bearer <access>`. On 401, call `/v1/auth/refresh` — tokens
  **rotate**, always keep the newest; reusing an old one revokes the session.
  `logout` revokes.
- **Money:** integers in **minor units (kobo)**, serialized as **strings**
  (they're BigInt server-side): `payment.amountMinor`, `sale.total`, `sale.margin`,
  `sale.variance`. **Never do float math.** Display: `Number(x)/100` then format `₦`.
- **Errors:** `{ error: { code, message, details?, requestId } }` — branch on the
  stable `code`, show `message`, keep `requestId` for support.
- **Lists:** cursor pagination — `?limit=&cursor=`; response `{ items, nextCursor }`
  (`null` = end). (Products uses this.)
- **Roles:** owner / manager / cashier / auditor. Hide actions the user lacks
  permission for (`stock.adjust`, `sales.allocate`, `catalog.write`, …).

## The core loop (the money screen) — LIVE
1. **Live trigger (WebSocket, see below):** on a confirmed payment, the dashboard
   receives an `event` of type `payment.confirmed` with
   `{ paymentId, organizationId, branchId, reference, amountMinor, currency }`.
   Show the overlay: "₦3,500 received — inventory this sale?"
2. **Product grid:** `GET /v1/products` → tappable grid; taps build line items.
3. **Confirm → allocate:** `POST /v1/payments/:id/match`
   `{ items: [{ productId, qty }], idempotencyKey }`. Creates the **sale**,
   snapshots unit price/cost, decrements stock atomically, returns the sale:
   `{ id, total, margin, variance, flagged, items[], allocations[] }`
   (money fields are strings). **Idempotent** — replaying the same
   `idempotencyKey` returns the same sale; a second device matching the same
   payment gets **409** (one sale per payment).
4. **Variance allowed:** item total needn't equal the payment (discounts/tips).
   The sale carries `variance` (signed string) and `flagged` (bool); show it,
   **don't block**.
5. **The "to-do" queue:** a confirmed payment has `status: SUCCEEDED`; one that
   hasn't been turned into a sale yet is the "what did you sell?" item. (A
   filtered payments-list endpoint is planned; for now the WebSocket event is the
   trigger.)

## Real-time — WebSocket (how to connect)
A **Socket.IO** server runs on the API origin. 
- **Connect** with the access token on the handshake:
  ```js
  import { io } from 'socket.io-client';
  const socket = io(API_ORIGIN, { auth: { token: accessToken } });
  ```
- On connect you're **auto-joined to your organization's room** (server-side,
  from the token). No manual subscribe.
- **Listen:** `socket.on('event', ({ type, payload }) => { ... })`. Types:
  - `payment.confirmed` → the wake (payload above)
  - `stock.low` → `{ branchId, productId, qty, lowStockThreshold }`
  - `sale.created` → `{ saleId, paymentId, branchId, total, flagged }`
- **Reconnection:** a client that was offline misses events — on (re)connect,
  refetch current state (e.g. recent payments/products) to backfill.
- The same events also go out as **email / WhatsApp** server-side (notifications),
  so the owner is reached even with no dashboard open.

## Inventory — LIVE
- Products: `GET/POST /v1/products`, `PATCH /v1/products/:id`.
- Stock: `GET /v1/branches/:id/stock`, low-stock `GET /v1/branches/:id/low-stock`.
- Adjust: `POST /v1/stock/adjustments` (needs a **reason**). Reorder point:
  `PATCH /v1/branches/:branchId/stock/:productId`.
- **Negative stock is allowed and flagged** (`NEGATIVE_STOCK`) — show an
  oversold badge, never a hard block.

## Onboarding — two account types
- **DIRECT (enterprise) — built:** merchant has their **own Paystack account**.
  UI collects their **Paystack webhook secret** and shows **the webhook URL to
  paste into their Paystack dashboard**. Cash goes to their own bank →
  **wallet ₦0 / hidden**.
- **MANAGED (SME) — planned:** we generate a **Dedicated Virtual Account** (bank
  + number) they share to get paid, with a **wallet balance**. Not built yet —
  design it, but it's not wired server-side.

## Wallet & withdrawals — MANAGED only, SIMULATED, planned
Balance + **Withdraw** → pending payout (balance drops immediately) → **admin**
approves → merchant notified. ⚠️ Label **"simulated"** (Paystack test mode, no
real money). Not built yet.

## Notifications
Owner is notified on `payment.confirmed`, `stock.low`, flagged sales, refunds —
over **email (Brevo)** and **WhatsApp (Meta)**, both live-tested (sandbox). Also
a verify endpoint `POST /v1/notifications/test`. Opt-in/consent is a planned
follow-up (currently all org members are notified). Weekly WhatsApp summary is
planned/simulated.

## Live now vs. planned (for your build plan)
- **Live:** auth, products/catalog, inventory, **payment webhook ingestion
  (DIRECT)**, **sale allocation (`/payments/:id/match`)**, **real-time WebSocket
  wake**, notifications (email/WhatsApp).
- **Planned (design, not wired):** MANAGED/DVA onboarding, wallet + withdrawals,
  weekly summary, a filtered payments-list endpoint, refunds UI, **device-level
  push notifications** (opt-in Web Push — OS banners when the app is closed;
  frontend adds a service worker + permission + `subscribe()`, backend sends via
  VAPID. iOS needs "Add to Home Screen").

## OpenAPI / mock server
`docs/openapi.json` is a generated export of the live REST routes — load into
Prism/Mockoon. The **WebSocket** contract is documented above (not in OpenAPI).
Regenerate the REST spec with `npm run openapi:export`.

## Open items for design
- The wake overlay interaction (how modal on a web dashboard; auto-dismiss?).
- DIRECT onboarding copy — pasting a Paystack webhook secret needs clear steps.
- Role-gated views (owner vs cashier vs auditor).
- "Simulated" labeling for wallet + WhatsApp — honest, not alarming.
- Reconnection/backfill UX for the WebSocket (what to refetch on reconnect).
