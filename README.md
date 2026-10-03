# MapleStory v83 Card Bridge

Bring an iTCG-style collecting and reward experience to your private MapleStory server. **The bridge includes a built-in workflow for distributing code cards in digital packs whose codes work in the game's existing Cash Shop code-entry field.** Players sign in with their game accounts, buy and open packs, collect cards, and reveal any included reward codes. They enter a code in the in-game Cash Shop on the same account to receive the configured reward; the website records when the game confirms it was used. This gives server owners a way to connect card collecting with in-game rewards without building the code issuance and redemption workflow themselves. Rewards are opt-in; the default installation is collectible-only.

This bridge connects [DigitalCardFramework](https://github.com/zkkng/DigitalCardFramework) to MapleStory. It includes a basic installation script and a simple card website, so you can start with a vanilla [Cosmic GMS v83](https://github.com/P0nk/Cosmic) deployment without building your own frontend. The framework can be connected to other MapleStory servers in principle; the supplied server hooks and installer specifically target Cosmic. Other server codebases need their own adapter and verification.

Players can pay with NX Credit, Maple Points, or NX Prepaid by default. You can adapt the server-side wallet to vote points or another currency, and customize pack contents and prices through the framework. Alternate currencies require adapter code; changing a website label does not change how the server charges a player.

When you configure rewards, packs can include a private-server code that players redeem in the in-game Cash Shop. **The default installation has no reward pool and issues no item codes.** It ships with an original Shapes pack so you can learn, collect, and test purchases without game artwork or reward items. The optional iTCG importer creates separate packs from external scan galleries; it does not add rewards.

The included website works independently. No Grendel website, custom account portal, or bundled game assets are required.

## What players can do

- Sign in with an existing Cosmic account. Accepted balances stay visible while browsing, with available and remaining funds in checkout and confirmation.
- Browse packs, inspect their contents and per-draw probabilities, select a balance, and confirm the total before paying.
- Open unopened packs. Opened packs become collection cards; there is no pack-history view.
- Browse the card catalog before signing in. Search and filter cards by set and rarity, sort them, inspect details, and see duplicate counts.
- Switch between owned cards, missing cards, duplicates and the full catalog, and track completion of each set.
- Reveal and copy any enabled reward codes, check their status, and load older codes.
- Recover an interrupted purchase using its original saved request without paying twice.

The layout works on desktop and mobile, uses system fonts and original CSS decoration, and includes keyboard navigation, labeled controls, live status messages, and reduced-motion support. Trading and public collections are outside this barebones website.

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

Open `http://127.0.0.1:8490/library/`. The optional disposable `CardTest` account is funded and purchases one Shapes pack during setup; its credentials are saved privately in the managed installation. The default pack contains eight collectibles and no reward codes. For the supplied Series One campaign, use the explicit profile:

```sh
python3 tools/cosmic.py --directory ../CosmicRewardsServer install --series-one --test-account
```

That profile adds exactly one code card per pack and enables its provider automatically. Reveal its code and redeem it on the same account in the v83 Cash Shop, with a free reward inventory slot. Automated setup checks registration and reveal; native-client redemption remains a separate gameplay qualification.

Setup preserves keys and purchase identities when resuming an interrupted run. Cosmic's demonstration administrator is disabled before login opens. Start, stop, readiness checks, account provisioning, funding, backup, restore and upgrades are scripted too. See [the complete setup guide](docs/cosmic-setup.md) for commands and recovery.

For an already operated Cosmic deployment, the [adapter guide](docs/install.md) describes source hooks and manual service configuration. The managed profile creates its own database; it does not replace an existing game's database or service.

## Add the real iTCG sets, optionally

The [optional importer](docs/itcg-import.md) builds one pack for each selected English set from the MapleStory Card Game Guide. By default the browser loads scans directly from that source website; the bridge does not host copies. Artwork is not included in this repository. The five source galleries are Set 1, OMG Bosses!, P3ts, NPC Heroes, and Behold Zakum.

```sh
python tools/import-itcg.py --inspect
python tools/import-itcg.py --output external/itcg --sets 1,2,3,4,5 --catalog-version 3
```

For a new managed Cosmic deployment with these five packs:

```sh
python3 tools/cosmic.py --directory ../CosmicITCGServer install --catalog external/itcg/catalog.json --test-account
```

For a manual bridge, set `CATALOG_PATH=./external/itcg/catalog.json` in its private configuration. Existing managed deployments use `private/catalog.json`; finish pending purchases, increase the catalog version, and keep definitions needed by issued cards when migrating. The importer never changes live configuration, replaces existing files or sets up rewards. It creates eight-card packs with equal per-card weights, not historical booster collation. `--download` optionally saves local scans; that mode needs an asset directory and mount.

## Customize packs and payment

Change `CATALOG_PATH` to a framework catalog you own. Cards, sets, rarities, pack contents and prices are catalog data. Increase the catalog version when content changes and the product revision when pack terms change. Finish pending purchases before switching versions.

Set `ACCEPTED_CASH_TYPES` and `CARD_BRIDGE_ACCEPTED_CASH_TYPES` to the same subset of `1,2,4`. The default enables all three at equal numeric prices. Debits never combine balances or fall back to another balance.

To use vote points or another currency, implement its authoritative wallet balance, debit, durable payment receipt, and retry behavior in the server adapter and bridge settlement mapping. See [the protocol](docs/protocol.md). Keep player funds and account ownership on the server. The generic framework supports catalog currencies; this premade Cosmic wallet implements the three native cash balances.

## Configure reward codes, explicitly

The default `ENABLE_SERIES_ONE_REWARDS=0` leaves the generated reward pool unconfigured. Keep it disabled for collectible-only packs. If you deliberately choose the supplied Series One reward campaign, read [code rules](docs/code-rules.md), build your own catalog with a `v83.series-one` code insert, and set `ENABLE_SERIES_ONE_REWARDS=1`. Do not enable it merely to import card scans.

Custom rewards require a matching game-side whitelist and provider; the supplied Series One adapter does not accept arbitrary items. Codes are account-bound and valid only on your private server. The game reports USED after the reward inventory and receipt commit together.

## Verify before rollout

Run `npm test`, `python -m unittest discover -s test -p '*_test.py'`, and `npm run test:browser` after installing Chromium with `npx playwright install chromium`. Browser checks cover default collectible packs and a separate reward-enabled fixture. The installed Cosmic checkout also runs the adapter's SQL and inventory contract tests with `bash ./mvnw test`.

Before inviting players, follow the [rollout checklist](docs/operations.md#rollout-checklist): test your actual v83 client, MySQL database, login, payment, restart recovery, backups and TLS. Fixture tests do not establish those deployment results. See [compatibility](docs/compatibility.md) for the verified baseline and limits.

Source is AGPL-3.0-only. Imported images retain their original rights and are not covered by this source license. Game databases, keys and operational files are not included.
