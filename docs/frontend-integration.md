# Frontend & Design integration brief (web app)

The backend is **client-agnostic** and **contract-first**: auth, catalog and
inventory are live now; payments and real-time are a locked contract you can
build against a mock until they land. Live API reference (Scalar): **`/v1/reference`**.
Payment data shapes: `docs/payments-contract.md`. Architecture: `docs/adr/001-payments-architecture.md`.

## The one-liner
A payment arrives → the merchant's screen instantly shows **"₦X received — what
did you sell?"** → they tap the products → stock, margin and low-stock update.
Target: **payment to confirmed sale in under 60 seconds.** That prompt is the
product; everything else supports it.

## Ground rules (apply everywhere)
- **Base path:** everything under **`/v1`**. Source of truth: `/v1/reference` (Scalar).
- **Auth:** `register`/`login` return an **access token (~15 min)** + a **refresh
  token**. Send `Authorization: Bearer <access>`. On 401, call
  `/v1/auth/refresh` — tokens **rotate**, always keep the newest; reuse is
  rejected. `logout` revokes.
- **Money:** integers in **minor units (kobo)**, sent as **strings** (BigInt).
  Never do float math. Display: `Number(amount)/100` then format `₦`.
- **Errors:** `{ error: { code, message, details?, requestId } }`. Branch on the
  stable `code`; show `message`; keep `requestId` for support.
- **Lists:** cursor pagination — `?limit=&cursor=`; response `{ items, nextCursor }`
  (`null` = end).
- **Roles:** owner / manager / cashier / auditor. Hide actions the user can't
  perform (adjust stock, refund, withdraw…).

## Onboarding — two account types (a toggle)
- **DIRECT (enterprise):** merchant has their **own Paystack account**. UI asks
  for their **Paystack webhook secret** and shows **our webhook URL to paste into
  their Paystack dashboard**. Their cash goes to their own bank → **wallet
  balance ₦0 / hidden** (we're not their bank).
- **MANAGED (SME):** no Paystack account. We generate a **Dedicated Virtual
  Account** (bank + number) they display/share to get paid. Show
  **"Your payment account: Wema Bank • 992384711"** and a **wallet balance** that
  rises as transfers arrive.

## The core loop (the money screen)
1. **Live trigger:** on a payment, the backend pushes a **WebSocket** event to the
   open dashboard: `{ paymentId, amount, currency, reference }`. Design the
   attention overlay: "₦35,000 received — inventory this sale?"
2. **Product grid:** `GET /v1/products` → tappable grid; taps build line items.
3. **Confirm → allocate:** `POST /v1/payments/:id/match` with items + a
   generated `idempotencyKey` (resend-safe). Backend creates the sale, snapshots
   price/cost, decrements stock atomically.
4. **Variance allowed:** item total needn't equal the payment exactly
   (discounts/tips) — allow confirm with the difference shown, don't block.
5. **Reliable itemization queue:** `GET /v1/payments?status=SUCCEEDED&branchId=&limit=&cursor=`
   — cursor-paginated confirmed payments that have not been allocated to a sale.
   This is the recovery path if the dashboard missed the WebSocket prompt.
6. **Cash receipts:** `POST /v1/payments/manual` with `amountMinor` as a
   positive integer string and an optional `branchId` for branch-scoped users.
   The backend creates a `SUCCEEDED` cash payment with a generated reference,
   then sends it through the same itemization queue and allocation flow.

## Inventory (live now)
- Products: `GET/POST /v1/products`, `PATCH /v1/products/:id`.
- Stock: `GET /v1/branches/:id/stock`, low-stock `GET /v1/branches/:id/low-stock`.
- Adjust: `POST /v1/stock/adjustments` (needs a **reason**). Reorder point:
  `PATCH /v1/branches/:branchId/stock/:productId`.
- **Negative stock is allowed and flagged** (`NEGATIVE_STOCK`) — show a
  flagged/oversold badge, never a hard block.

## Wallet & withdrawals — MANAGED only, **SIMULATED**
Merchant sees balance + **Withdraw** → pending payout (balance drops immediately
to prevent double-spend) → an **admin** approves on an admin screen → merchant
notified. ⚠️ **Label "simulated"** — runs in Paystack test mode, no real money.

## Weekly summary
Evening WhatsApp summary (revenue, margin, top sellers, low stock) —
**sandbox/simulated**; present honestly.

## Real today vs. mock
- **Live:** auth, products, stock/inventory, `/v1/reference`.
- **Contract only (mock until backend lands):** pending-payments list, the
  match/allocate call, the WebSocket payment event, wallet/withdraw. Build
  against the contract; shapes won't change under you.

## OpenAPI / mock server
`docs/openapi.json` is a generated export of the live routes — load it into any
mock server (Prism, Mockoon, etc.) to start building. Regenerate anytime with
`npm run openapi:export`.
- **Currently included:** auth, tenancy, products (catalog).
- **Not yet included:** inventory (`/v1/stock/*`, `/v1/branches/:id/stock`) — those
  routes return 404 on `master` until the `fix/register-inventory-module` PR
  merges; regenerate the export after it lands. Payments/real-time are
  contract-only (see `docs/payments-contract.md`) until that module ships.

## Open items for design
- The 60-second prompt interaction (how modal on a web dashboard?).
- DIRECT onboarding copy — pasting a webhook secret needs clear, trustworthy steps.
- Role-gated views.
- "Simulated" labeling for wallet + WhatsApp — honest, not alarming.
