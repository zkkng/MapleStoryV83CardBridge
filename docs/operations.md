# Deployment, recovery and backups

Run the bridge as an unprivileged service with Node.js 24.14+, private state files, TLS at the public proxy, and an enabled Cosmic adapter on a private loopback connection. Example nginx and systemd files are in `deploy/`; adapt host names and paths before use.

The [managed Cosmic setup](cosmic-setup.md) automates these services, readiness checks, consistent backups, restoration and upgrades. The guidance below also applies to manually operated installations.

## State and secrets

`STATE_DIRECTORY` holds encrypted framework SQLite state and a separate purchase journal. The journal contains durable account/order/receipt metadata, not raw codes. Protect it as account data. The game database contains the independent debit receipts, HMAC code indices, inventory, sessions and notification outbox.

Keep these keys outside public assets and repositories:

- `STATE_KEY`: framework state encryption.
- `CODE_ENCRYPTION_KEY`: code vault encryption.
- `CODE_INDEX_KEY`: stable framework code fingerprint and retry identity.
- `GAME_SHARED_KEY` / `CARD_BRIDGE_SHARED_KEY`: private request signatures.
- `CARD_BRIDGE_CODE_KEY`: stable game-side code fingerprint.
- `CSRF_KEY`: browser-session request binding.

Back up both service databases, the game database, configuration and keys as one recoverable installation. Stop writers or use database-supported consistent backups. Copying a live SQLite main file without its WAL is not a valid backup procedure. Test restores privately. Losing an encryption key or changing either index key can make issued codes unusable.

## Purchase recovery

The purchase journal progresses through pending, paid and complete, or rejected. The game debit uses a durable order ID. A lost debit response is retried with the same ID, amount, account and cash type. Earlier implicit Credit orders are migrated to explicit cashType=1 before replay.

After a game receipt, the bridge settles the exact amount into the internal framework ledger and purchases under a durable framework request ID. Replaying either step cannot mint twice. A successful purchase creates the sealed cards and encrypted code together. Registration runs afterward over the private protocol.

A ten-second recovery pass resumes pending orders and registration. The opening animation does not allocate anything. Closing the browser does not undo or repeat the purchase.

If the game has accepted payment but framework allocation cannot finish, the order remains paid and blocks a replacement purchase for that account. Repair the reported capacity, catalog or key problem, then let the original order resume. Do not delete the journal row, issue a second payment, manually grant another pack, or refund cash while that paid order can still mint. This release provides retry recovery, not a refund/compensation API.

Catalog publication is refused while purchases are unresolved. Same-version content changes are also refused. Keep original versions available until all old orders complete.

## Reward recovery

READY means registered, PENDING means delivery/save is unresolved, and USED means inventory and the notification outbox committed. A failed save preserves the current-process in-memory delivery record; retrying saves that same reward without adding another item.

An enabled game process holds a MySQL advisory writer lease. It prevents another enabled process from simultaneously becoming the reward writer. After process death, an old PENDING claim can be recovered by the next exclusive writer because an uncommitted item was not saved. The character save's conditional claim update prevents a replaced claim from committing.

Keep the native character/inventory save transaction intact. Fork code that catches or commits inventory work independently must be inspected before using this adapter.

USED notification delivery retries until acknowledged. The library also polls registered, revealed codes, and the manual Refresh control forces an account-scoped reconciliation. Neither path marks a code used based on a browser claim.

## Availability and limits

`/api/library/health` is a readiness check. It requires a signed game response, a signed callback probe, matching authentication modes and accepted cash types. An unavailable game or callback, or mismatched configuration, returns failure. A game outage may leave the public catalog browsable while authenticated purchases report unavailable. Request errors omit internal exception details and plaintext code material. Run `node --env-file=.env tools/doctor.mjs` for a manual-service check, or the managed `doctor` command.

The framework defaults to 50,000 code records, 200,000 code retry/confirmation records and a bounded whole-state SQLite payload. Card copies and history also consume that payload. Those counts are limits, not a promise that every catalog can fill them. Monitor state size and pending orders before growing the installation. One Node writer and one enabled game process are the supported model.

Behind nginx, enable `TRUST_PROXY=1` only when the proxy replaces `X-Real-IP`. The service accepts that header only from loopback. Keep direct service ports private. Configure public TLS, connection/rate limits and request timeouts at the proxy; do not expose the game adapter to the Internet.

## Upgrade

Stop the bridge, reconcile any outstanding reward saves, and stop the game. Back up state and keys. Run the new installer's `--check`, inspect the game diff, install, rebuild, test and restart with the same persistent keys. Then start the bridge and verify an existing code history and an unopened pack. Preserve the game cash hooks whenever website debits are enabled.

## Rollout checklist

The included site is a small collecting website for the pinned vanilla Cosmic baseline. Qualify the actual deployment before inviting players:

1. Install into a clean copy of the supported Cosmic revision; run installer checks and the full game test suite.
2. Use a disposable real game account to sign in from the website. Verify each accepted balance independently and confirm that an insufficient selected balance never spends another balance.
3. Buy the default Shapes pack. Confirm eight collectible cards, no reward code, and no item delivery. Reload and restart both services; balances, unopened packs and the collection must persist.
4. Interrupt a purchase response after payment and recover the saved purchase. Confirm exactly one debit and one allocation. Complete pending orders before changing the catalog.
5. If rewards are enabled intentionally, redeem a configured code through a real v83 client's Cash Shop. Verify account restrictions, inventory capacity, USED status, and replay rejection after a restart.
6. Serve the site behind TLS with the configured exact public origin. Verify secure cookies, sign-out, throttling and proxy headers. Keep the bridge/game private endpoints on loopback or a protected internal network.
7. Back up both services' persistent data and encryption keys together. Verify ownership and pending-order recovery after a controlled restore. The managed restore command requires the original installation path and project; see [its restore procedure](cosmic-setup.md#private-state-and-backups).
8. Test the site on a phone and with keyboard navigation. Review imported catalogs and source receipts if using external scans. Keep the previous catalog and database backup available for a controlled rollback.

No fixture or CI result replaces a successful real-client and MySQL qualification. Roll out first to a small group after these checks pass, and monitor failed payments, stuck registrations and recovery errors.
