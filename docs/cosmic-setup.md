# Complete Cosmic setup and operation

Applies to bridge 0.1 and Cosmic revision `fec53bc7714dc0f1ae3f50b2986cdf2727e0912a`. The managed Linux profile creates a complete isolated game, MySQL database, card service and default website. It requires Python 3.11+, Git and a running Docker Engine with Compose. Use WSL2 with Docker integration on Windows. A v83 client, DNS, router configuration and public TLS are supplied separately.

On WSL2, keep the managed deployment inside the WSL home directory so private file permissions and Docker bind mounts behave as expected.

- [Install and verify](#install-and-verify)
- [Start, stop and diagnose](#start-stop-and-diagnose)
- [Accounts and funding](#accounts-and-funding)
- [Customize the catalog](#customize-the-catalog)
- [Private state and backups](#private-state-and-backups)
- [Upgrade](#upgrade)
- [Remote players](#remote-players)

## Install and verify

Clone [the bridge repository](https://github.com/zkkng/MapleStoryV83CardBridge) and run:

```sh
git clone https://github.com/zkkng/MapleStoryV83CardBridge.git
cd MapleStoryV83CardBridge
python3 tools/cosmic.py --directory ../CosmicCardServer install --test-account
```

The installation directory must be separate from the source repository and empty. Setup validates Cosmic's hooks before changing its deployment copy, builds with Java 21, runs the Cosmic and adapter tests, installs the pinned framework dependency with Node.js 24, initializes the game database through Cosmic's migrations, and starts the game, database, card service, proxy and private network container. Runtime container images are resolved to digests and retained in `images.lock.json`. Subsequent starts and upgrades use those locked runtimes.

Open `http://127.0.0.1:8490/library/`. Setup's final readiness check proves the signed game request, the signed provider callback, matching authentication mode and accepted cash types, and the website proxy. It fails when these disagree. The public catalog remains readable during a game outage, but the readiness endpoint returns failure.

`--test-account` creates a disposable `CardTest` native game account with 5,000 NX Prepaid. Setup purchases one 1,000-unit example pack, retries the same purchase, opens eight collectibles and one code insert, checks registration, reveals the code and signs out. Credentials stay in `CosmicCardServer/private/test-account.json`; they are never printed. Keep this account for local testing only. The normal install omits it and grants no cash. The upstream demonstration administrator is disabled during the seed migration.

An interrupted install leaves `setup.pending.json`. Repeat the **same command and options** to resume without replacing persistent keys, duplicating funding or buying another verification pack. A completed installation refuses a second install; use `start` or `upgrade` instead. Do not delete the marker, keys or volumes to recover an interrupted purchase.

To use a clean Cosmic-derived source checkout:

```sh
python3 tools/cosmic.py --directory ../CosmicCardServer install --cosmic-directory ../MyCosmic
```

This copies the checkout into the managed deployment and rejects unknown hooks or conflicting dependencies. It creates a new isolated database; it does not import or overwrite an existing game's database. For an existing operated installation, follow [the adapter guide](install.md). Fork compatibility still requires the [gameplay checks](compatibility.md).

## Start, stop and diagnose

Keep `--directory` before the command in every invocation:

```sh
python3 tools/cosmic.py --directory ../CosmicCardServer doctor
python3 tools/cosmic.py --directory ../CosmicCardServer stop
python3 tools/cosmic.py --directory ../CosmicCardServer start
python3 tools/cosmic.py --directory ../CosmicCardServer smoke
```

`smoke` requires the optional setup account and reuses its existing pack. Stop refuses while a game account is logged in. Containers restart automatically after host or process failure; volumes retain the game database and encrypted card state. Start waits for database, adapter, callback and proxy readiness.

For startup diagnostics:

```sh
docker compose -f ../CosmicCardServer/compose.json ps
docker compose -f ../CosmicCardServer/compose.json logs --tail 100 cosmic cards web
```

Do not publish environment dumps, SQL backups or code-reveal responses. An installation that moved to another directory is rejected because its Compose project and volumes belong to the recorded original path.

## Accounts and funding

Create a native account with a privately prompted password:

```sh
python3 tools/cosmic.py --directory ../CosmicCardServer account create Collector
python3 tools/cosmic.py --directory ../CosmicCardServer account fund Collector --cash-type 4 --amount 5000 --request-id opening-credit-001
```

Use 3–13 letters or digits for the account name and 8–72 UTF-8 bytes for the password. `--password-file` accepts a private UTF-8 file for unattended provisioning. Passwords enter Java over stdin and are hashed with BCrypt. Recreating an account with the same password succeeds; a different password is rejected without changing it.

Cash types are 1=NX Credit, 2=Maple Points and 4=NX Prepaid. Funding requires a request ID. Retry an uncertain credit with the same ID, cash type and amount; its SQL receipt prevents duplicate credit. Reusing an ID with different terms is rejected. Use a new ID for an intentional additional credit. These commands are operator tools, not public website routes. Funding receipts live in `card_bridge_operator_funding`.

## Customize the catalog

The managed catalog is `CosmicCardServer/private/catalog.json`, mounted read-only into the card service. Change this file rather than giving the container a host-only `CATALOG_PATH`. Keep the generated insert's pool ID `v83.series-one` for the supplied reward provider. Increase the catalog version after content changes and the product revision after changing pack terms. Prices and collectible rarity weights belong to the catalog; Series One game rewards remain constrained by the adapter whitelist.

Finish pending purchases, stop the services, back up the original catalog file privately, edit it, and start again. The card service rejects changed content under the same version and refuses catalog publication while a purchase is unresolved. Restore the original file if validation fails. The upgrade command preserves this customized file. The [framework runtime](framework-runtime.md) supplies catalog and card contracts; game assets and your card artwork are separate inputs.

## Private state and backups

`private/` contains generated service keys, database credentials, the runtime game configuration and catalog. Its parent directory is owner-only. Keys are not baked into container images. The game and card containers run as separate unprivileged users. MySQL and adapter HTTP ports are never published. Card and proxy roots are read-only; writable state has its own named volume.

Take a consistent backup while no game accounts are connected:

```sh
python3 tools/cosmic.py --directory ../CosmicCardServer backup
```

The command stops game, card and website writers, dumps MySQL, archives the stopped SQLite state, and saves private keys, catalog, configuration, checksums and the exact game/card Docker images. It restarts and checks the installation afterward. Backups contain account data and credentials; store copies privately off the host. They can be large because runtime images are included. Keep free space for an additional safety backup before a restore or upgrade.

Restore one of this installation's backups:

```sh
python3 tools/cosmic.py --directory ../CosmicCardServer restore --backup ../CosmicCardServer/backups/REPLACE_WITH_BACKUP_NAME
```

Restore verifies checksums and allowed state paths, requires the original installation identity and database credentials, and takes a safety backup before replacing data. It loads and verifies the saved runtime images, restores both databases and keys, then checks readiness. A failed restore attempts recovery from its safety backup. Restore accepts trusted operator backups only. It does not merge databases, move installations or restore a different server's backup.

## Upgrade

Update this bridge source checkout to the desired reviewed release, then run:

```sh
python3 tools/cosmic.py --directory ../CosmicCardServer upgrade
```

Upgrade refuses connected game accounts and unresolved purchases, validates and installs the adapter into the managed game copy, builds and tests the new images, makes a consistent safety backup, then starts and checks the candidate. A failed candidate restores the previous images, keys and data. Issued codes, the customized catalog and persistent encryption/index keys are retained. Locked base images and the Cosmic source revision are not silently changed. Major Cosmic/runtime migrations require separate qualification.

## Remote players

For a remotely reachable game, supply the IPv4 address advertised to the v83 client, the host interface, and the website's real HTTPS origin:

```sh
python3 tools/cosmic.py --directory ../CosmicCardServer install --game-host 192.0.2.10 --bind 0.0.0.0 --origin https://cards.example.org
```

The addresses above are examples. Configure your host TLS reverse proxy to forward that origin to `127.0.0.1:8490`. The HTTP listener remains bound to loopback even when game ports use `--bind 0.0.0.0`. Setup rejects non-loopback HTTP origins. Public DNS, certificate issuance and router/firewall rules are host-specific; the installer does not change them. See [Docker's firewall guidance](https://docs.docker.com/engine/network/packet-filtering-firewalls/) when publishing container ports.

Have the TLS proxy replace `X-Forwarded-For` with the verified client address. The managed proxy trusts only loopback and its generated Docker host gateway when resolving that header, then replaces `X-Real-IP` for the card service. This keeps request limits separate for remote players. Do not forward an unchecked client-supplied forwarding header.

Defaults publish website port 8490, game login 8484 and channels 7575–7577, bound to loopback. `--web-port` and `--login-port` select different host ports; the client must use the chosen login port. Channel ports are fixed in this profile. The game, card backend and proxy join a stable private network container, so callbacks use loopback without LAN relays and the game can restart independently. All three cash types use the same example pack price; debits never combine balances.

Before accepting player purchases, use a real v83 client to qualify ordinary and pet redemption, inventory-full rejection, repeat redemption and saved-item/USED agreement after restarts. Automated setup tests the backend account-to-code flow; it does not automate a licensed game client.
