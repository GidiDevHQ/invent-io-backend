# ADR 006: UUIDv4 for primary keys (for now)

Status: Accepted

## Context
The technical specification (§5, §20.11) calls for **UUIDv7** primary keys:
time-sortable and safe for client-side generation, which the offline sync
module relies on (clients generate IDs for queued operations, and time-ordered
keys keep index locality and `change_log` ordering sane).

The existing `auth`/`tenancy` tables (authored first) use Prisma's default
`@default(uuid())`, which generates **UUIDv4** (random, not time-sortable).
The `catalog` work needed to pick one and stay consistent with the tables
already in the database.

## Options
1. **UUIDv4 everywhere (current).** Keep Prisma's default; match existing tables.
2. **UUIDv7 everywhere.** Switch all models to a v7 generator and migrate the
   existing `auth`/`tenancy` tables.
3. **Mixed.** v4 for existing tables, v7 for new ones. Rejected: inconsistent
   keys across the schema are a maintenance trap.

## Decision
Use **UUIDv4** for all tables for now, to stay consistent with the tables
Gideon already shipped. Defer the switch to UUIDv7 to a dedicated change made
**before the `sync` module is built**, since that is the module whose
correctness depends on time-sortable, client-generatable IDs.

## Consequences
- Easier: no migration of existing tables right now; one consistent key type.
- Harder / deferred: before `sync`, we must either (a) adopt UUIDv7 and migrate
  existing tables, or (b) prove v4 is acceptable for client-generated IDs and
  accept worse index locality. This ADR is the reminder to resolve that then.
- Risk: if sync is built on v4 and we later switch, in-flight client IDs and the
  `change_log` ordering assumptions must be revisited.

> Note: numbered 006 to avoid colliding with the spec's suggested ADRs 001–005
> (tenant mapping, stock ledger, outbox, modular monolith, RLS). Renumber if the
> team prefers a different scheme.
