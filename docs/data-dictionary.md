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
