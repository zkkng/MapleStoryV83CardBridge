# MapleStory v83 Card Bridge

Connect [DigitalCardFramework](https://github.com/zkkng/DigitalCardFramework) to a Cosmic GMS v83 server. Players choose NX Credit, Maple Points, or NX Prepaid, buy and open packs, collect cards, and redeem newly generated Series One code cards in the native Cash Shop. The game reports USED only after the reward inventory and receipt commit together.

The bridge includes a standalone account-and-pack website. You can also build a custom frontend through the public bridge protocol. Neither the Grove website nor game artwork is required for the starter.

## Requirements

- Linux, or WSL2 with Docker integration; Python 3.11+, Git, and a running Docker Engine with Compose.
- Internet access for the pinned Cosmic checkout, Maven dependencies and container images.
- A v83 game client for gameplay. Client files and game artwork are supplied separately.

## Complete Cosmic setup

From this repository, run:

```sh
python3 tools/cosmic.py --directory ../CosmicCardServer install --test-account
```

The script clones the supported Cosmic revision, installs and tests the adapter, builds the game and card service, initializes MySQL, creates persistent encrypted storage and private keys, starts the game and default website, and verifies authenticated communication in both directions. Java, Node.js and MySQL run in containers; you do not install them separately.

Open `http://127.0.0.1:8490/library/`. The optional disposable `CardTest` account is funded and purchases one real pack during setup; its credentials are saved privately in the managed installation. Setup preserves its keys and purchase identities when resuming an interrupted run. Cosmic's upstream demonstration administrator is disabled before login opens.

Start, stop, readiness checks, account provisioning, funding, backup, restore, and upgrades are scripted too. See [the complete setup guide](docs/cosmic-setup.md) for commands, remote access, an existing source checkout, and recovery.

For an already operated Cosmic deployment, the [adapter installation guide](docs/install.md) describes the bounded source hooks and manual service configuration. The managed profile creates its own database; it does not replace an existing game's database or service.

Players sign in with their game account, choose one cash balance, buy a pack and open it. Reveal the code, enter it in the v83 Cash Shop on the same account, and leave a free reward inventory slot. Refresh the code ledger after redemption. Automated setup checks registration and reveal; native-client redemption remains a separate gameplay qualification.

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
