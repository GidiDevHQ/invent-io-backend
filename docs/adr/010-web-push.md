# ADR 010: Web Push for closed-tab notifications

Status: Accepted

## Context
ADR 009 wakes the **open** dashboard over a WebSocket. But the core promise —
"a payment landed, what did you sell?" within 60s — fails if the owner has no
tab open. The follow-up ADR 009 named was Web Push: a browser notification the
operating system shows as a banner even when the site is closed, delivered by
the browser's push service (not us) via a Service Worker on the client.

The triggering events already flow through the transactional outbox and the
notification dispatcher (which runs in the worker and already fans out
email/WhatsApp). Web Push is therefore just another delivery channel, plus the
storage of per-browser subscriptions.

## Options
1. **FCM / APNs directly** — vendor-specific, and FCM is mobile-first. Rejected:
   the client is a web app, and the Web Push standard (RFC 8030 + VAPID) already
   reaches Chrome, Firefox, Edge and (iOS 16.4+) Safari through one API.
2. **WebSocket only** — cannot reach a closed tab. Already shipped (ADR 009) and
   kept; Web Push complements it.
3. **Web Push channel fed by the same dispatcher.** Chosen.

## Decision
- A `PushSubscription` table stores one row per browser/device
  (`endpoint` unique, `p256dh` + `auth` keys, scoped to user + organization).
  Re-subscribing upserts on `endpoint`.
- The client gets the **VAPID public key** from `GET /v1/push/vapid-public-key`,
  calls `PushManager.subscribe`, and registers via
  `POST /v1/push/subscriptions` (`DELETE` to remove). These routes need only
  authentication — **every** role must be able to enrol its own device, so no
  `@RequirePermission` is attached.
- A `WebPushChannel` (implementing the existing `MessageChannel`) signs with
  VAPID and sends a small JSON `{ title, body }` payload the Service Worker
  renders. VAPID keys are **optional** config: a send without them throws, the
  same way the email channel behaves without its API key.
- The **dispatcher** fans a templated event out to every subscription in the
  org, alongside email/WhatsApp. A push the service reports **gone** (404/410)
  is pruned, so dead subscriptions self-heal.

### Dependencies
Adds `web-push` (+ `@types/web-push`). New env: `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (generate with `npx web-push generate-vapid-keys`).

## Consequences
- Easier: the owner is reached even with no tab open; one standard covers all
  major browsers; delivery reuses the outbox → dispatcher path and its dedup.
- Harder / new surface: a public/private VAPID keypair to manage as secrets; the
  client must ship a Service Worker; payload size is limited (~4 KB) so pushes
  stay to a title + short body and the app fetches detail on tap.
- Consent: still org-wide (no per-user consent field yet) — the same follow-up
  the dispatcher already carries for email/WhatsApp.
