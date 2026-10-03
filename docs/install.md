# Install the Cosmic adapter

Applies to bridge 0.1 and the Cosmic revision in [compatibility](compatibility.md). First make a normal Cosmic installation work with your v83 client. This adapter extends that installation; it does not supply the client or replace game setup.

## Hooks

| File | Change |
| --- | --- |
| CouponCodeHandler | Check bridge codes inside the existing client lock; unknown codes continue through the existing coupon handler. |
| Character.saveCharToDB | Run `beforeSave` immediately before the inventory transaction commits, and `afterSave` only after commit. |
| CashShop | Read and mutate all three cash balances from the authoritative account row while enabled; avoid saving stale cached balances. Cash inventory still saves normally. |
| Server startup | Start the signed loopback adapter after game initialization and before the login listener. |
| Maven | Add Gson 2.13.2 and test-only H2 2.3.232. Run the adapter tests in their own JVM, preserving the game's one-time WZ initialization. |

`tools/install-cosmic.py SERVER --check` validates without writing. The regular invocation validates all anchors first, writes the hooks, and copies `java/src` into the game checkout. It rejects conflicting dependency versions and unknown source layouts. Repeating it does not duplicate hooks or dependencies.

For a different revision, apply the same bounded hooks manually, retaining the inventory transaction boundary. Compilation alone does not establish compatibility. Add your target to your own tested compatibility record before deploying it.

## Configuration

Generate `.env` and `game.env` using `node tools/setup.mjs`. On Linux, load the game values into the actual service process environment; a shell launch can use `set -a; . /private/path/game.env; set +a`. On Windows, assign each KEY=VALUE line to that process's environment before running your jar. An existing service needs its own environment configuration.

The default game adapter listens on `127.0.0.1:8486` or the platform loopback address. The bridge uses `GAME_URL=http://127.0.0.1:8486`. If your platform chooses IPv6 loopback, use `http://[::1]:8486`. A remote connection must use HTTPS with certificate validation through a private proxy.

Game keys:

- `CARD_BRIDGE_ENABLED=1` enables the adapter and authoritative cash hooks.
- `CARD_BRIDGE_SHARED_KEY` authenticates both services; it matches `GAME_SHARED_KEY`.
- `CARD_BRIDGE_CODE_KEY` is a separate, persistent code-index key. Keep it stable.
- `CARD_BRIDGE_CALLBACK_URL` points to the bridge's private `/api/library/provider/used` endpoint.
- `CARD_BRIDGE_ACCEPTED_CASH_TYPES=1,2,4` enables Credit, Points and Prepaid.
- `CARD_BRIDGE_SESSION_SOURCE=bridge` uses native starter sessions; `grove` uses the existing portal's `web_sessions`.

The adapter adds `card_bridge_codes`, `card_bridge_payments`, `card_bridge_outbox` and `card_bridge_sessions`. It preserves existing account, character and coupon tables. Its schema is embedded in the jar. Earlier payment rows without a cash type migrate explicitly to NX Credit, their original source.

## Account verification

The standalone starter validates the existing Cosmic password formats without changing the game's login state. Website sessions contain only a SHA-256 token hash, account ID and expiry; the browser receives an HttpOnly cookie. Sessions expire after one day, and account bans and temporary bans are checked on every lookup.

Grove mode delegates sign-in to the existing account website and validates its session table. Another host must provide equivalent verified account mapping, expiry, revocation and ban checks. A browser-submitted account ID or character name cannot establish ownership.

## Check the installation

Run the complete game tests, then start the rebuilt game with the adapter enabled. Confirm startup can hold the MySQL writer lease; a second enabled game process must fail rather than become another reward writer. Start the bridge and complete the [starter workflow](../README.md). Check each accepted cash type separately, test an insufficient selected balance, then retry the same code after redemption: it must grant no second item.

Disable the adapter only after reconciling purchases and reward claims. Stop the bridge first, and restart the game when changing `CARD_BRIDGE_ENABLED`. Do not switch back to cached cash writes while an enabled bridge can still debit accounts.
