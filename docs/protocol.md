# Service and browser contracts

Applies to bridge 0.1. The browser talks to the library service. Only the library service talks to the game adapter. Account IDs and balances supplied by browser JSON are never authority.

## Private game requests

All requests are POST JSON with these headers:

- `X-Bridge-Time`: thirteen-digit Unix time in milliseconds.
- `X-Bridge-Nonce`: a new 32-character lowercase hexadecimal value.
- `X-Bridge-Signature`: lowercase HMAC-SHA256, using the shared key.

Sign the UTF-8 string `method + "\n" + path + "\n" + time + "\n" + nonce + "\n" + sha256(exactBody)`. Both implementations authenticate the exact bytes and path, allow a sixty-second clock window, and reject reused nonces. Synchronize host clocks. Use loopback or certificate-validated HTTPS; redirects are rejected.

| Endpoint         | Input                                                          | Result                                                                                                                           |
| ---------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| /health          | empty object                                                   | ok, protocol, sessionSource, acceptedCashTypes, callbackReady, leaseReady; requires the writer lease and a signed callback probe |
| /resolve-account | name or accountId, exactly one                                 | eligible accountId and canonical name; local administration bootstrap                                                            |
| /login           | username, password, tokenHash                                  | accountId, canonical name; native starter mode only                                                                              |
| /logout          | tokenHash                                                      | ok; revoke the native session                                                                                                    |
| /session         | tokenHash                                                      | verified accountId and name                                                                                                      |
| /wallet          | accountId                                                      | separate balances and acceptedCashTypes                                                                                          |
| /debit           | orderId, accountId, amount, cashType                           | the same identity, amount, cashType and balance after debit                                                                      |
| /codes/register  | issuanceId, accountId, code, itemId, quantity, petDays, series | issuanceId and registration status                                                                                               |
| /codes/status    | issuanceId                                                     | READY, PENDING, or USED; USED includes receiptId and usedAt                                                                      |

The debit order ID is a persistent 64-character hash. Cash types are 1=NX Credit, 2=Maple Points, 4=NX Prepaid. A replay must match account, amount and source. The game receipt and debit commit in one SQL transaction.

Code registration is idempotent by issuanceId and immutable after acceptance. The game validates the Series One item/quantity/pet family, binds the account, and stores only an HMAC code index. Do not log registration bodies or raw credentials.

The game posts `{issuanceId,receiptId,occurredAt}` to `/api/library/provider/used` using the same signature protocol. It writes the outbox in the item-save transaction and marks delivery only after a 2xx acknowledgement. The framework deduplicates receipt IDs persistently. Polling uses the same game receipt and cannot create a conflicting result.

The game probes POST `/api/library/provider/health` with a signed empty JSON object. It returns `{ok:true,protocol:"v83-card-bridge/1"}` without changing issued codes or outbox records. This is distinct from anonymous GET `/api/library/health`, which checks the complete game/callback connection and configuration agreement.

## Browser API

GET `/api/library/catalog` and `/rewards` are public. GET `/live` reports process liveness; `/health` requires game/callback/lease/configuration agreement and a durable local write probe. GET `/session` returns `{signedIn,authMode,username?,csrf?,role?,capabilities?}`; it does not disclose the session token. Roles are `collector` and `administrator`, computed from durable numeric grants after native session validation. GET `/state` requires a verified account and returns its balances, collection counts/representative cards, a first page of unopened packs/copies, code summaries, albums and order summaries. Raw code text is absent.

All authenticated POST requests require the exact configured Origin, JSON content type, and `X-CSRF-Token` from the verified session. The cookie is HttpOnly, SameSite=Strict, and Secure under HTTPS.

| Action under /api/library/ | Input                                                                |
| -------------------------- | -------------------------------------------------------------------- |
| quote                      | productId, quantity, cashType                                        |
| buy                        | quote fields and a stable key                                        |
| open                       | packId, stable key                                                   |
| reveal                     | codeId, stable key                                                   |
| album                      | name, placements, key; updates also need albumId and expectedVersion |
| codes                      | after, limit; paginated secret-free history                          |
| inventory                  | after, limit 1–100; paginated owned copies                           |
| packs                      | after, limit 1–100; paginated unopened packs                         |
| refresh                    | empty object; reconcile this account and return current state        |
| login                      | username, password; native mode, with guest CSRF from /session       |
| logout                     | empty object; native mode                                            |

Quote responses include catalogVersion, productRevision, quantity, price and cashType. Buy uses the original values; prices are rechecked server-side. Preserve the same key after a lost response. A different key cannot start another purchase while that account has a pending order.

The state response includes `collection:{items:[{variantId,count,card}],totalCards,uniqueCards}` for collectible variants. Use these counts rather than treating the compatibility `inventory` first page as the complete collection. `inventoryNext`/`inventoryTotal` and `packNext`/`packTotal` describe pagination; both initial pages contain at most 50 entries. Code-only cards remain in code history. Collection summaries preserve issued representative snapshots; individual snapshots are available through inventory pages. The current whole-state framework store still materializes records for these queries; response bounds do not certify indexed storage or unlimited scale.

Reveal requires an opened owned pack and successful game registration. It returns plaintext only in the private no-store response. The caller should keep it in memory, clear it on account switch or view disposal, and copy it only through an explicit user action.

## Another account website

Replace `BridgeSessions.session` with a trusted session lookup that binds the server-issued token hash to one existing game account. Require expiry, revocation, bans and temporary bans. Keep the result `{accountId,name}`. The bridge consumes that verified identity; it does not accept an asserted owner from the browser.

A custom frontend can use these HTTP contracts for account access, purchases, collections, and reward codes.

## Administration API

Every admin route validates the native session and current numeric grant. Anonymous requests return 401; collectors and revoked grants return 403. A native ban or expired session denies access. POSTs retain exact Origin, CSRF and JSON validation. Publication and queued retries recheck authority inside the admission critical section before effects.

| Route under /api/library/    | Method | Contract                                                                                                              |
| ---------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------- |
| admin/catalog, admin/export  | GET    | active portable catalog and adminRevision                                                                             |
| admin/overview               | GET    | sanitized connection, storage, catalog and unresolved-work diagnostics                                                |
| admin/orders                 | GET    | limit 1–100, supplied after cursor, optional exact native account name, numeric account ID or durable order ID search |
| admin/activity               | GET    | limit 1–100 and supplied after cursor                                                                                 |
| admin/registrations          | GET    | limit 1–100 and supplied after cursor; no code plaintext                                                              |
| admin/preview                | POST   | `{catalog}`; returns previewId, digest, expectedVersion, policyRevision, adminRevision, counts, changes and warnings  |
| admin/publish                | POST   | the preview fields and stable idempotencyKey; applies only the server-stored reviewed manifest                        |
| admin/orders/ID/retry        | POST   | empty object; resumes the original order without replacement debit                                                    |
| admin/registrations/ID/retry | POST   | empty object; retries that registration through the same recovery engine                                              |

Ordinary request bodies are limited to 16 KiB. Only catalog preview accepts 2 MiB. Admin lists default to 25 entries. Code history defaults to 50, with framework-supported limits. Previews belong to one numeric administrator, expire after 24 hours and retain at most ten per account. Published catalog identity/history persists; disabled offers retire through explicit publication. Basic website publication validates its supported symbols/static-image presentation subset and independently weighted duplicate-allowing packs.

No HTTP endpoint grants roles, reveals another player's codes, directly edits game cash, marks a code USED, or deletes purchase evidence. Local `tools/admin.mjs` provides grant/revoke/list, including offline stale-grant cleanup with `revoke --account-id ID`. The versioned bridge journal stores grants, attributed activity, previews, orders and safe retry diagnostics and is included in stopped-writer backups.
