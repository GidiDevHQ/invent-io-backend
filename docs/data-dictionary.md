# Data dictionary

One entry per table. Money columns are integer minor units unless noted.

## Product
Catalog item owned by an organization and shared across its branches.

| Column | Type | Notes |
|---|---|---|
| id | uuid (v4) | PK. Spec calls for UUIDv7; v4 used to match existing tables (see ADR). |
| organizationId | uuid | FK → Organization. Tenant scope. |
| name | text | Required. |
| sku | text? | Optional. Unique per org (`@@unique(organizationId, sku)`). |
| barcode | text? | Optional. Unique per org (`@@unique(organizationId, barcode)`). |
| unit | text? | Unit of sale, e.g. "piece", "kg". |
| price | int | Integer minor units, org currency. Never a float. |
| cost | int | Integer minor units. Never a float. |
| active | bool | Soft retirement; `false` = retired. Default `true`. |
| version | int | Incremented on every edit; used by sync conflict handling. Default `0`. |
| createdAt | timestamp | |
| updatedAt | timestamp | |

Indexes: `(organizationId, active)`. Currency is the organization's; products are single-currency.

## BranchStock
Cached per-branch quantity for a product. Updated in the same transaction as the
ledger; rebuildable from `StockMovement`. Composite PK `(branchId, productId)`.

| Column | Type | Notes |
|---|---|---|
| branchId | uuid | FK → Branch. Part of PK. |
| productId | uuid | FK → Product. Part of PK. |
| qty | int | Cached quantity. Atomic `qty = qty + delta`. May be negative. |
| lowStockThreshold | int | Alert fires when qty crosses to ≤ this (and > 0). Default 0. |
| flags | text[] | e.g. `["NEGATIVE_STOCK"]`. Default `[]`. |
| updatedAt | timestamp | |

## StockMovement
Immutable ledger. Current qty is the sum of a product's deltas at a branch.

| Column | Type | Notes |
|---|---|---|
| id | uuid (v4) | PK |
| branchId | uuid | FK → Branch. |
| productId | uuid | FK → Product. |
| type | enum | `SALE`, `RESTOCK`, `ADJUSTMENT`, `RETURN`, `TRANSFER_OUT`, `TRANSFER_IN`. |
| qtyDelta | int | Signed: negative for `SALE`, positive for `RESTOCK`. |
| refType / refId | text? | Originating entity, e.g. `sale` / sale id. |
| reason | text? | Required for manual adjustments. |
| createdBy | uuid? | Actor. |
| createdAt | timestamp | |

Indexes: `(branchId, productId, createdAt)`.

## AuditLog
Append-only record of audited actions. Written in the same transaction as the
action. No foreign keys, so actor/entity rows can be pruned without losing history.

| Column | Type | Notes |
|---|---|---|
| id | uuid (v4) | PK |
| organizationId | uuid | Tenant scope. |
| actorId | uuid? | User who performed the action, if any. |
| action | text | e.g. `product.price_changed`. |
| entity | text | e.g. `Product`. |
| entityId | text | Affected row id. |
| before | json? | Snapshot before the change. |
| after | json? | Snapshot after the change. |
| createdAt | timestamp | |

Indexes: `(organizationId, createdAt)`.
