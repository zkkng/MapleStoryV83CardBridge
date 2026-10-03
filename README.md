# MapleStory v83 Card Bridge

Connect [DigitalCardFramework](https://github.com/zkkng/DigitalCardFramework) to a Cosmic GMS v83 server. Players choose NX Credit, Maple Points, or NX Prepaid, buy and open packs, collect cards, and redeem newly generated Series One code cards in the native Cash Shop. The game reports USED only after the reward inventory and receipt commit together.

The bridge includes a standalone account-and-pack website. You can also build a custom frontend through the public bridge protocol. Neither the Grove website nor game artwork is required for the starter.

## Requirements

- Node.js 24.14 or newer, Java 21, Python 3, and a working Cosmic MySQL installation.
- Cosmic revision `fec53bc7714dc0f1ae3f50b2986cdf2727e0912a`. See [compatibility](docs/compatibility.md).
- One bridge service and one enabled game process writing the same installation.
- Existing game accounts and operator-controlled cash balances.

## Start from Cosmic

1. Install Cosmic using its [upstream instructions](https://github.com/P0nk/Cosmic#readme), check out the supported revision, and confirm that your v83 client can log in.
2. Clone this repository beside the game checkout. Install its pinned framework dependency with `npm ci`.
3. Validate and install the game hooks:

   ```sh
   python tools/install-cosmic.py ../Cosmic --check
   python tools/install-cosmic.py ../Cosmic
   cd ../Cosmic
   ./mvnw test package
   ```

   On Windows use `mvnw.cmd`. The installer validates every source anchor before writing and is safe to repeat. Keep your game changes in version control. The hook locations are described in [installation](docs/install.md).

4. From this bridge directory, generate private configuration:

   ```sh
   node tools/setup.mjs --origin http://127.0.0.1:8487
   ```

   This creates `.env` and `game.env` with independent random keys. It refuses to overwrite existing files. Load `game.env` into the Cosmic process environment, then restart your rebuilt game. Keep these files private.

5. Start the bridge:

   ```sh
   node --env-file=.env src/server.mjs
   ```

6. Open `http://127.0.0.1:8487/library/`. Sign in with your existing game account, choose one cash balance, buy a pack, and open it. Reveal its code, then enter it in the v83 Cash Shop on the same account. Leave a free reward inventory slot. Refresh the code ledger after redemption.

A fresh account starts with the game's configured balances. Fund a disposable local test account through your normal operator process when checking purchases; the bridge does not grant free cash. The service binds to loopback. Use a TLS reverse proxy for remote players; see [deployment and recovery](docs/operations.md).

## Pack One

The example catalog draws eight collectible cards and one guaranteed code insert per pack. Each collectible draws independently, with duplicates allowed. Rarity weights are Common 62%, Uncommon 25%, Rare 10%, Epic 2.5%, and Legendary 0.5%. The code reward independently chooses one of 17 Series One outcomes uniformly.

Standard codes contain fifteen characters. Pet codes add C01, C02, or C03, for eighteen total; the three pets have 30 days of life. Material and consumable quantities are in [the reward table](data/series-one.json). These are newly issued private-server codes, using an unambiguous random alphabet. They do not redeem at official MapleStory services. The separate digital insert and uniform reward distribution are choices of this edition. See [code rules](docs/code-rules.md).

## Customize your installation

Change `CATALOG_PATH` to a framework catalog you own. Packs, collectible rarities, contents and prices are catalog data. Keep the generated insert's pool ID `v83.series-one` for this Series One provider. Increase the catalog version when content changes, and the product revision when pack terms change. Finish pending purchases before publishing new versions.

Set `ACCEPTED_CASH_TYPES` and `CARD_BRIDGE_ACCEPTED_CASH_TYPES` to the same subset of `1,2,4`. The starter enables all three at equal numeric prices. Debits never combine or fall back to another balance. Series One reward validation is enforced by the game adapter; adding other reward campaigns requires a separately reviewed provider/whitelist.

For an existing Grove account website, use `AUTH_MODE=grove`, `CARD_BRIDGE_SESSION_SOURCE=grove`, and `SESSION_COOKIE=qg_account`. Default `bridge` authentication uses its own hashed session table and requires no portal tables. Other websites implement the trusted session resolver contract in [the protocol](docs/protocol.md).

## Verification

`npm test` checks generation, encrypted persistence, purchase recovery, ownership, cash selection, callbacks and browser-request boundaries. Install the browser with `npx playwright install chromium`, then run `npm run test:browser` for the standalone account, purchase, reveal, USED, replay and sign-out flow. After installation, `./mvnw test` also runs the game adapter's SQL and inventory contract tests in an isolated JVM.

See [compatibility](docs/compatibility.md) for the exact baseline and verification limits. Tests use isolated fixtures; they do not replace an operator's real client redemption and restart check.

Source is AGPL-3.0-only. Game assets, databases, keys and operational files are not included.
