# Invent-IO API Reference

Every endpoint the Invent-IO backend exposes. Invent-IO turns a confirmed payment into a recorded sale and updates stock in under 60 seconds. This file is generated from the backend’s OpenAPI specification ([`openapi.json`](openapi.json)) and its request DTOs, so it lists exactly what the code serves.

| | |
|---|---|
| **Base URL** | `https://invent-io-backend-production.up.railway.app` |
| **Version prefix** | `/v1` |
| **Endpoints** | 43 |

## Conventions

- **Authentication:** send `Authorization: Bearer <accessToken>`. Tokens come from register, login or a login code; refresh them with `POST /v1/auth/refresh`.
- **Money:** amounts are whole minor units (kobo for NGN), sent and returned as strings, e.g. `"150000"` = ₦1,500.00.
- **Businesses are isolated:** every request is scoped to the signed-in user’s business. Roles decide what each member may do; owners can do everything.
- **Lists and errors:** lists take `limit` and `cursor` and return `nextCursor`. Errors return `{ statusCode, message }`.

## Contents

- [Accounts and sessions](#accounts-and-sessions) (12)
- [Business and branches](#business-and-branches) (2)
- [Products](#products) (6)
- [Stock](#stock) (4)
- [Payments](#payments) (2)
- [Sales and refunds](#sales-and-refunds) (2)
- [Paystack account setup](#paystack-account-setup) (2)
- [Payout bank account](#payout-bank-account) (3)
- [Dashboard and reports](#dashboard-and-reports) (3)
- [Notifications](#notifications) (1)
- [Browser push](#browser-push) (3)
- [Paystack webhooks](#paystack-webhooks) (2)
- [Health](#health) (1)

## Accounts and sessions

Register, sign in, refresh tokens, verify email, reset passwords, one-time login codes.

### `POST /v1/auth/register`

**Auth:** none

**Request body** (`application/json`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `businessName` | `string` | yes |  |
| `name` | `string` | yes |  |
| `email` | `string` | yes | email address |
| `password` | `string` | yes | min 8 chars |

**Responses:** `201`

### `POST /v1/auth/login`

**Auth:** none

**Request body** (`application/json`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `email` | `string` | yes | email address |
| `password` | `string` | yes |  |

**Responses:** `201`

### `POST /v1/auth/refresh`

**Auth:** none

**Request body** (`application/json`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `refreshToken` | `string` | yes |  |

**Responses:** `201`

### `POST /v1/auth/logout`

**Auth:** none

**Request body** (`application/json`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `refreshToken` | `string` | yes |  |

**Responses:** `201`

### `POST /v1/auth/verify-email`

Confirm an email address from the verification link token

**Auth:** none

**Request body** (`application/json`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `token` | `string` | yes | The raw token from the verification link. · min 1 chars |

**Responses:** `200`

### `POST /v1/auth/verify-email/resend`

Resend the verification email to the logged-in user (throttled)

**Auth:** Bearer token

**Responses:** `200`

### `POST /v1/auth/forgot-password`

Email a password-reset link (always succeeds; no account enumeration)

**Auth:** none

**Request body** (`application/json`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `email` | `string` | yes | The account email to send a reset link to. · email address |

**Responses:** `200`

### `POST /v1/auth/reset-password`

Set a new password from a reset-link token; revokes all sessions

**Auth:** none

**Request body** (`application/json`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `token` | `string` | yes | The raw token from the reset link. · min 1 chars |
| `password` | `string` | yes | The new password (min 8 characters). · min 8 chars |

**Responses:** `200`

### `POST /v1/auth/otp/request`

Email/text a 6-digit login code (always succeeds; no account enumeration)

**Auth:** none

**Request body** (`application/json`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `identifier` | `string` | yes | Email address or phone number to send the login code to. · min 1 chars |

**Responses:** `200`

### `POST /v1/auth/otp/verify`

Exchange a valid login code for a session

**Auth:** none

**Request body** (`application/json`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `identifier` | `string` | yes | The email or phone the code was sent to. · min 1 chars |
| `code` | `string` | yes | The 6-digit code. · e.g. `123456` · 6–6 chars |

**Responses:** `200`

### `POST /v1/auth/change-password`

Change password (requires current password); revokes all sessions

**Auth:** Bearer token

**Request body** (`application/json`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `currentPassword` | `string` | yes | The current password. · min 1 chars |
| `newPassword` | `string` | yes | The new password (min 8 characters). · min 8 chars |

**Responses:** `200`

### `POST /v1/auth/change-email`

Change email (requires current password); re-sends verification

**Auth:** Bearer token

**Request body** (`application/json`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `currentPassword` | `string` | yes | The current password (re-auth for a sensitive change). · min 1 chars |
| `newEmail` | `string` | yes | The new email address. · email address |

**Responses:** `200`

## Business and branches

Who the signed-in user is, which business they act for, and the branches they can use.

### `GET /v1/tenancy/me`

Current tenant context, with the branches this member can use

**Auth:** Bearer token

**Responses:** `200`

### `GET /v1/branches`

Active branches this member can use ([{ id, name }])

**Auth:** Bearer token

**Responses:** `200`

## Products

The product catalogue: create, list, edit, retire, and bulk-import from CSV.

### `POST /v1/products`

Create a product

**Auth:** Bearer token

**Request body** (`application/json`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | `string` | yes | e.g. `Bar Soap` · min 1 chars |
| `sku` | `string` | no | e.g. `SOAP-001` |
| `barcode` | `string` | no | e.g. `5901234123457` |
| `unit` | `string` | no | Unit of sale, e.g. "piece", "kg" · e.g. `piece` |
| `price` | `number` | yes | Price in integer minor units (e.g. kobo), in the org currency. Never a float. · e.g. `150000` · ≥ 0 |
| `cost` | `number` | yes | Cost in integer minor units. Never a float. · e.g. `90000` · ≥ 0 |

**Responses:** `201`

### `GET /v1/products`

List products (cursor-paginated)

**Auth:** Bearer token

**Parameters**

| Name | In | Required | Type |
|---|---|---|---|
| `limit` | query | yes | string |
| `cursor` | query | yes | string |

**Responses:** `200`

### `POST /v1/products/import`

Bulk-import products from CSV (partial success; bad rows reported)

**Auth:** Bearer token

**Request body** (`application/json`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `csv` | `string` | yes | Raw CSV text. Header row required; columns (case-insensitive): name, price, cost  · e.g. `` · min 1 chars |

**Responses:** `201`

### `GET /v1/products/{id}`

Get a product by id

**Auth:** Bearer token

**Parameters**

| Name | In | Required | Type |
|---|---|---|---|
| `id` | path | yes | string |

**Responses:** `200`

### `PATCH /v1/products/{id}`

Update a product (price/cost changes are audited)

**Auth:** Bearer token

**Parameters**

| Name | In | Required | Type |
|---|---|---|---|
| `id` | path | yes | string |

**Request body** (`application/json`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | `string` | no | e.g. `Bar Soap` · min 1 chars |
| `sku` | `string` | no | e.g. `SOAP-001` |
| `barcode` | `string` | no | e.g. `5901234123457` |
| `unit` | `string` | no | e.g. `piece` |
| `price` | `number` | no | Price in integer minor units. Never a float. · e.g. `150000` · ≥ 0 |
| `cost` | `number` | no | Cost in integer minor units. Never a float. · e.g. `90000` · ≥ 0 |
| `active` | `boolean` | no | e.g. `true` · true or false |

**Responses:** `200`

### `DELETE /v1/products/{id}`

Deactivate (soft-retire) a product

**Auth:** Bearer token

**Parameters**

| Name | In | Required | Type |
|---|---|---|---|
| `id` | path | yes | string |

**Responses:** `200`

## Stock

Stock levels per branch, restocks and adjustments, and low-stock thresholds.

### `POST /v1/stock/adjustments`

Restock or adjust stock with a reason

**Auth:** Bearer token

**Request body** (`application/json`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `branchId` | `string` | yes | min 1 chars |
| `productId` | `string` | yes | min 1 chars |
| `type` | `AdjustmentType` | yes | enum value |
| `qtyDelta` | `number` | yes | Signed change in units (negative to decrease). · e.g. `10` |
| `reason` | `string` | yes | Required reason for the adjustment. · e.g. `Received supplier delivery` · min 1 chars |

**Responses:** `201`

### `GET /v1/branches/{id}/stock`

Stock levels for a branch

**Auth:** Bearer token

**Parameters**

| Name | In | Required | Type |
|---|---|---|---|
| `id` | path | yes | string |

**Responses:** `200`

### `GET /v1/branches/{id}/low-stock`

Items at or below their low-stock threshold

**Auth:** Bearer token

**Parameters**

| Name | In | Required | Type |
|---|---|---|---|
| `id` | path | yes | string |

**Responses:** `200`

### `PATCH /v1/branches/{branchId}/stock/{productId}`

Set the low-stock threshold for a product at a branch

**Auth:** Bearer token

**Parameters**

| Name | In | Required | Type |
|---|---|---|---|
| `branchId` | path | yes | string |
| `productId` | path | yes | string |

**Request body** (`application/json`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `lowStockThreshold` | `number` | yes | Alert when stock is at or below this (0 disables). · e.g. `5` · ≥ 0 |

**Responses:** `200`

## Payments

Confirmed payments waiting to be itemized, and cash payments recorded by hand.

### `GET /v1/payments`

List succeeded payments that have not been itemized

**Auth:** Bearer token

**Parameters**

| Name | In | Required | Type |
|---|---|---|---|
| `status` | query | no | "SUCCEEDED" |
| `branchId` | query | no | string |
| `limit` | query | no | string |
| `cursor` | query | no | string |

**Responses:** `200`

### `POST /v1/payments/manual`

Record a cash payment for the itemization flow

**Auth:** Bearer token

**Request body** (`application/json`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `amountMinor` | `string` | yes | Amount received in minor currency units (kobo), as a positive integer string. · e.g. `125000` · pattern `^[1-9]\d*$` |
| `branchId` | `string` | no | Branch that received the cash; defaults to the tenant branch. · min 1 chars |

**Responses:** `201`

## Sales and refunds

Turn a payment into a sale by saying what was sold; refund all or part of a sale.

### `POST /v1/payments/{id}/match`

Allocate a confirmed payment to the items sold (creates a sale)

**Auth:** Bearer token

**Parameters**

| Name | In | Required | Type |
|---|---|---|---|
| `id` | path | yes | string |

**Request body** (`application/json`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `items` | `SaleItemInput[]` | yes | nested object |
| `idempotencyKey` | `string` | yes | Client-generated; replaying returns the original sale. · min 1 chars |

**Responses:** `201`

### `POST /v1/sales/{id}/refund`

Refund a sale (full or partial): restores stock and records the refund

**Auth:** Bearer token

**Parameters**

| Name | In | Required | Type |
|---|---|---|---|
| `id` | path | yes | string |

**Request body** (`application/json`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `items` | `RefundItemInput[]` | no | Lines to refund. Omit to refund the whole remaining sale. · nested object |
| `reason` | `string` | no | Why the refund was issued. |

**Responses:** `201`

## Paystack account setup

Create the business’s Paystack subaccount and dedicated virtual account (test mode).

### `GET /v1/payments/managed-account`

Get this organization’s managed Paystack account and DVA

**Auth:** Bearer token

**Responses:** `200`

### `POST /v1/payments/managed-account`

Provision a Paystack test subaccount and linked DVA

**Auth:** Bearer token

**Request body** (`application/json`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `businessName` | `string` | yes | e.g. `Example Business Ltd` · min 2 chars |
| `settlementBankCode` | `string` | yes | Paystack settlement-bank code · e.g. `058` · pattern `^\d{3,5}$` |
| `settlementAccountNumber` | `string` | yes | e.g. `0123456789` · pattern `^\d{8,20}$` |
| `ownerEmail` | `string` | yes | e.g. `owner@example.com` · email address |
| `ownerName` | `string` | yes | e.g. `Ada Owner` · min 2 chars |
| `customerFirstName` | `string` | yes | e.g. `Ada` · min 1 chars |
| `customerLastName` | `string` | yes | e.g. `Owner` · min 1 chars |
| `ownerPhone` | `string` | no | e.g. `+2348012345678` |
| `preferredBank` | `string` | no | e.g. `wema-bank` |
| `ownerConsent` | `boolean` | yes | Confirms the organization is authorized to submit these details to Paystack. · e.g. `true` · true or false |

**Responses:** `201`

## Payout bank account

The bank account the business is paid out to. Only the last 4 digits are ever returned.

### `GET /v1/payout-account`

Get the org payout account (last 4 digits only)

**Auth:** Bearer token

**Responses:** `200`

### `PUT /v1/payout-account`

Set or replace the org payout bank account

**Auth:** Bearer token

**Request body** (`application/json`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `bankCode` | `string` | yes | Bank code (provider/CBN bank code). · min 1 chars |
| `bankName` | `string` | yes | e.g. `Guaranty Trust Bank` · min 1 chars |
| `accountName` | `string` | yes | Account holder name. · e.g. `Marcel Ndanwe` · min 1 chars |
| `accountNumber` | `string` | yes | Account number (digits only). · e.g. `0123456789` · pattern `^\d{6,20}$` |
| `currency` | `string` | no | Currency code (default NGN). · e.g. `NGN` · 3–3 chars |

**Responses:** `200`

### `DELETE /v1/payout-account`

Remove the org payout account

**Auth:** Bearer token

**Responses:** `200`

## Dashboard and reports

Today’s figures, low-stock items, and the filtered sales history.

### `GET /v1/dashboard/summary`

Today's sales count, revenue, margin and low-stock count

**Auth:** Bearer token

**Parameters**

| Name | In | Required | Type |
|---|---|---|---|
| `date` | query | yes | string |

**Responses:** `200`

### `GET /v1/dashboard/low-stock`

Items at or below their low-stock threshold

**Auth:** Bearer token

**Responses:** `200`

### `GET /v1/reports/sales`

Filtered, cursor-paginated sales list

**Auth:** Bearer token

**Parameters**

| Name | In | Required | Type |
|---|---|---|---|
| `from` | query | yes | string |
| `to` | query | yes | string |
| `branchId` | query | yes | string |
| `limit` | query | yes | string |
| `cursor` | query | yes | string |

**Responses:** `200`

## Notifications

Send a templated message over email or WhatsApp to verify delivery.

### `POST /v1/notifications/test`

Send a templated notification over a channel (demo/verify)

**Auth:** Bearer token

**Request body** (`application/json`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `channel` | `'whatsapp' \| 'email' \| 'simulated'` | yes | one of 'whatsapp', 'email', 'simulated' |
| `to` | `string` | yes | Phone number (whatsapp) or email address (email). · min 1 chars |
| `template` | `string` | yes | e.g. `payment.received` · min 1 chars |
| `data` | `Record` | no | Template variables, e.g. { amountMinor, currency }. |

**Responses:** `201`

## Browser push

Subscribe a browser to push notifications for payment and stock alerts.

### `GET /v1/push/vapid-public-key`

The VAPID public key the browser needs to subscribe

**Auth:** Bearer token

**Responses:** `200`

### `POST /v1/push/subscriptions`

Register this browser to receive push notifications

**Auth:** Bearer token

**Request body** (`application/json`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `endpoint` | `string` | yes | Push service endpoint URL for this browser. · min 1 chars |
| `keys` | `PushKeysDto` | yes | nested object |

**Responses:** `201`

### `DELETE /v1/push/subscriptions`

Stop receiving push notifications on this browser

**Auth:** Bearer token

**Request body** (`application/json`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `endpoint` | `string` | yes | The endpoint URL to remove. · min 1 chars |

**Responses:** `200`

## Paystack webhooks

Called by Paystack, not by the app. Signed and verified before anything is processed.

### `POST /v1/webhooks/paystack/platform`

**Auth:** none

**Responses:** `200`

### `POST /v1/webhooks/paystack/{integrationToken}`

**Auth:** none

**Parameters**

| Name | In | Required | Type |
|---|---|---|---|
| `integrationToken` | path | yes | string |

**Responses:** `200`

## Health

A simple check that the API is up.

### `GET /v1`

**Auth:** none

**Responses:** `200`

---

Generated 2026-11-24 from `docs/openapi.json` and the request DTOs in `src/`.
