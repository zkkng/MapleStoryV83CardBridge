# Service and browser contracts

Applies to bridge 0.1. The browser talks to the library service. Only the library service talks to the game adapter. Account IDs and balances supplied by browser JSON are never authority.

## Private game requests

All requests are POST JSON with these headers:

- `X-Bridge-Time`: thirteen-digit Unix time in milliseconds.
- `X-Bridge-Nonce`: a new 32-character lowercase hexadecimal value.
- `X-Bridge-Signature`: lowercase HMAC-SHA256, using the shared key.

Sign the UTF-8 string `method + "\n" + path + "\n" + time + "\n" + nonce + "\n" + sha256(exactBody)`. Both implementations authenticate the exact bytes and path, allow a sixty-second clock window, and reject reused nonces. Synchronize host clocks. Use loopback or certificate-validated HTTPS; redirects are rejected.

| Endpoint | Input | Result |
| --- | --- | --- |
| /login | username, password, tokenHash | accountId, canonical name; native starter mode only |
| /logout | tokenHash | ok; revoke the native session |
| /session | tokenHash | verified accountId and name |
| /wallet | accountId | separate balances and acceptedCashTypes |
| /debit | orderId, accountId, amount, cashType | the same identity, amount, cashType and balance after debit |
| /codes/register | issuanceId, accountId, code, itemId, quantity, petDays, series | issuanceId and registration status |
| /codes/status | issuanceId | READY, PENDING, or USED; USED includes receiptId and usedAt |

The debit order ID is a persistent 64-character hash. Cash types are 1=NX Credit, 2=Maple Points, 4=NX Prepaid. A replay must match account, amount and source. The game receipt and debit commit in one SQL transaction.

Code registration is idempotent by issuanceId and immutable after acceptance. The game validates the Series One item/quantity/pet family, binds the account, and stores only an HMAC code index. Do not log registration bodies or raw credentials.

The game posts `{issuanceId,receiptId,occurredAt}` to `/api/library/provider/used` using the same signature protocol. It writes the outbox in the item-save transaction and marks delivery only after a 2xx acknowledgement. The framework deduplicates receipt IDs persistently. Polling uses the same game receipt and cannot create a conflicting result.

## Browser API

GET `/api/library/catalog` and `/rewards` are public. GET `/session` returns `{signedIn,authMode,username?,csrf?}`; it does not disclose the session token. GET `/state` requires a verified account and returns its balances, packs, inventory, code summaries, albums and order summaries. Raw code text is absent.

All authenticated POST requests require the exact configured Origin, JSON content type, and `X-CSRF-Token` from the verified session. The cookie is HttpOnly, SameSite=Strict, and Secure under HTTPS.

| Action under /api/library/ | Input |
| --- | --- |
| quote | productId, quantity, cashType |
| buy | quote fields and a stable key |
| open | packId, stable key |
| reveal | codeId, stable key |
| album | name, placements, key; updates also need albumId and expectedVersion |
| codes | after, limit; paginated secret-free history |
| refresh | empty object; reconcile this account and return current state |
| login | username, password; native mode, with guest CSRF from /session |
| logout | empty object; native mode |

Quote responses include catalogVersion, productRevision, quantity, price and cashType. Buy uses the original values; prices are rechecked server-side. Preserve the same key after a lost response. A different key cannot start another purchase while that account has a pending order.

Reveal requires an opened owned pack and successful game registration. It returns plaintext only in the private no-store response. The caller should keep it in memory, clear it on account switch or view disposal, and copy it only through an explicit user action.

## Another account website

Replace `BridgeSessions.session` with a trusted session lookup that binds the server-issued token hash to one existing game account. Require expiry, revocation, bans and temporary bans. Keep the result `{accountId,name}`. The bridge consumes that verified identity; it does not accept an asserted owner from the browser.

A different frontend can use these same HTTP contracts. It does not need GrendelLibrary or access to framework storage internals.
