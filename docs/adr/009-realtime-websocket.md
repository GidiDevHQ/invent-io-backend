# ADR 009: Real-time "wake the screen" over WebSocket

Status: Accepted

## Context
The product's core promise: a payment lands → the owner's open dashboard
instantly shows "₦X received — what did you sell?" (< 60s). The client is a
**web app**, so the right transport is a WebSocket to the open dashboard, not
mobile push (FCM). The triggering events already flow through the transactional
outbox (`payment.confirmed`, `stock.low`, `sale.created`), and the worker is a
separate process from the API that holds the socket connections.

## Options
1. **FCM push** — mobile-oriented; wrong fit for a web dashboard. Rejected
   (ADR 001 already chose WebSocket for the web client).
2. **Inline WebSocket emit in the webhook request** — loses events on a crash;
   bypasses the outbox. Rejected.
3. **WebSocket gateway fed by the outbox, fanned out via Redis.** Chosen.

## Decision
- The **API** hosts a Socket.IO server attached to the HTTP server. Clients
  connect with their JWT (`handshake.auth.token`); the server verifies it,
  reads the `org` claim, and joins the socket to room `org:<organizationId>`.
  The server uses the **Redis adapter** (`@socket.io/redis-adapter`) so any
  process — including the worker and multiple API instances — can emit to a room.
- The **worker**, when it consumes a relevant outbox event, uses a
  **Redis emitter** (`@socket.io/redis-emitter`) to `emit` to `org:<orgId>`.
  This runs alongside the notifications dispatcher: the dispatcher sends
  email/WhatsApp, the realtime emitter wakes the open dashboard. The backend
  stays client-agnostic — it only emits events; the gateway is a delivery adapter.
- Event delivered to clients: `event` with `{ type, payload }`.

### Dependencies
Adds `socket.io`, `@socket.io/redis-adapter`, `@socket.io/redis-emitter`. All use
`ioredis` (already a dependency). `REDIS_URL` is already required.

## Consequences
- Easier: the open dashboard wakes within the poll latency of a confirmed
  payment, with no per-client polling; horizontal scaling works via the Redis
  adapter.
- Harder / new surface: a Socket.IO server + two Redis clients on the API; the
  worker gains a Redis emitter; sockets must be authenticated and org-scoped.
- Follow-ups: reconnection/backfill (a client that was offline misses events —
  pair with a "pending payments" fetch on connect), per-event delivery metrics,
  and Web Push for closed tabs.
