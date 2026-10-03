# Install into an existing Cosmic server

Applies to bridge 0.1 and the pinned Cosmic revision in [compatibility](compatibility.md). This path retains the existing game database, accounts, passwords and cash. For a new isolated deployment, use [scripted Cosmic setup](cosmic-setup.md). A separately supplied v83 client must already log into the game.

Requirements: Linux with systemd, Node.js 24.14 or newer at `/usr/bin/node`, Java 21, Maven, Python 3.11+, Git, and the operated Cosmic checkout and MySQL database. The commands use `/opt/cosmic` for that checkout and `cosmic.service` for its existing service; replace both consistently if yours differs. Unknown forks require their own compatibility tests.

## Back up and patch the game

Stop purchases and disconnect game accounts before maintenance. Stop the existing game service and take its normal tested MySQL/configuration backup. Keep the current jar and Git revision available for rollback. Do not rerun seed migrations or replace the operating database.

```sh
sudo systemctl stop cosmic.service
sudo install -d -o "$(id -un)" -g "$(id -gn)" -m 755 /opt/card-library
git clone https://github.com/zkkng/MapleStoryV83CardBridge.git /opt/card-library/bridge
cd /opt/card-library/bridge
python3 tools/install-cosmic.py /opt/cosmic --check
python3 tools/install-cosmic.py /opt/cosmic
cd /opt/cosmic
mvn -B test package
```

The installer validates all anchors before writing. It adds the coupon, character-save, authoritative cash, Cash Shop economic-ordering, and startup hooks plus their tests. Repeating the patch is safe; conflicting dependencies or unknown layouts are rejected. Inspect the game diff and run the complete tests before replacing the service's jar with the resulting `target/Cosmic.jar`, using the existing service's deployment procedure. Keep its working directory, WZ files, scripts and game configuration.

The enabled adapter adds its own tables and preserves native accounts, characters and coupons. Website sessions verify the existing password formats and account bans. It never grants website administration from a native GM level.

## Install the card service

Install a compatible Node runtime through your operating system's approved package source. Confirm `node --version` and `/usr/bin/node` before installing the unit below.

```sh
cd /opt/card-library/bridge
npm ci --omit=dev --ignore-scripts
chmod 755 /opt/card-library/bridge
chmod -R a+rX,go-w src starter data tools node_modules
chmod a+r,go-w package.json package-lock.json
sudo useradd --system --no-create-home --home-dir /var/lib/card-library --shell /usr/sbin/nologin card-library
sudo install -d -o card-library -g card-library -m 700 /var/lib/card-library
sudo install -d -o root -g card-library -m 750 /etc/card-library
sudo node tools/setup.mjs --output-directory /etc/card-library --state-directory /var/lib/card-library --catalog-path /opt/card-library/bridge/data/catalog.example.json --origin http://127.0.0.1:8487
sudo chown root:card-library /etc/card-library/.env
sudo chmod 640 /etc/card-library/.env
sudo chmod 600 /etc/card-library/game.env
```

Skip `useradd` if the dedicated service account already exists. The permission commands make only public runtime source and dependencies readable under a restrictive operator umask; they leave private state/configuration and Git metadata alone. Configuration generation refuses to overwrite either environment file; keep the existing keys on retries. The absolute state path agrees with the unit's writable directory. The source and `node_modules` may remain read-only to the service. Keep keys and state outside the source checkout.

Add the generated game environment file to the existing service rather than replacing that service:

```sh
sudo install -d -m 755 /etc/systemd/system/cosmic.service.d
printf '[Service]\nEnvironmentFile=/etc/card-library/game.env\nRestart=on-failure\nRestartSec=5\n' | sudo tee /etc/systemd/system/cosmic.service.d/card-library.conf >/dev/null
sudo install -m 644 /opt/card-library/bridge/deploy/card-library.service /etc/systemd/system/card-library.service
sudo systemctl daemon-reload
sudo systemctl start cosmic.service
sudo systemctl enable --now card-library.service
sudo -u card-library /usr/bin/node --env-file=/etc/card-library/.env tools/doctor.mjs
```

Expected result: signed game and callback checks pass and the website opens at `http://127.0.0.1:8487/library/`. The game adapter uses private loopback port 8486. The default Shapes pack has eight collectibles and no rewards. Keep both backend ports private. For Internet access, configure an exact HTTPS `PUBLIC_ORIGIN` and a TLS reverse proxy following [operations](operations.md#internet-access); restart the bridge after configuration changes.

For different private listener ports, edit both environment files before starting: bridge `GAME_URL` must match native `CARD_BRIDGE_BIND`/`CARD_BRIDGE_PORT`; the bridge's loopback listener `PORT` must match native `CARD_BRIDGE_CALLBACK_URL`, whose path remains `/api/library/provider/used`. For example, use `GAME_URL=http://127.0.0.1:19486` with native bind `127.0.0.1` and port `19486`, and bridge `PORT=19487` with callback `http://127.0.0.1:19487/api/library/provider/used`. The setup tool's `--game-url` changes the bridge target only, so pair it with the native listener settings. `PUBLIC_ORIGIN` and `--origin` specify the browser-facing origin; they do not change either private listener or callback port. Adjust the reverse proxy upstream for a changed bridge port, preserve the original keys and rerun `doctor` after restart.

The game service must use `Restart=on-failure` with a bounded `RestartSec`, for example five seconds. Adapter lease loss terminates the enabled game process with status 75 so the service can safely restart and acquire a new exclusive writer lease. Keep the card service stopped until the rebuilt game is enabled.

## Grant the first website administrator

Choose an existing ordinary native account, or create one through your server's established registration procedure. Do not promote the upstream demonstration account. From the bridge directory:

```sh
sudo -u card-library /usr/bin/node --env-file=/etc/card-library/.env tools/admin.mjs grant Owner
sudo -u card-library /usr/bin/node --env-file=/etc/card-library/.env tools/admin.mjs list
```

Replace `Owner` with its exact native account name. The CLI resolves the name through the signed game endpoint and refuses unknown or banned identities. Sign in on the website with that game's password, then open Administration to edit, preview and publish a pack. Grants are durable numeric account mappings, independent of GM level. To revoke access or recover from zero administrators, use the same local CLI:

```sh
sudo -u card-library /usr/bin/node --env-file=/etc/card-library/.env tools/admin.mjs revoke Owner
```

Use a separate collector account to verify the purchase workflow and all three cash types. Revocation applies to an already open session. The CLI needs live game identity resolution and the same writable state directory; do not run it against an unrelated state path.

If an account is banned or deleted, remove its remembered grant by the numeric ID shown by `list`, even while native identity resolution is unavailable:

```sh
sudo -u card-library /usr/bin/node --env-file=/etc/card-library/.env tools/admin.mjs revoke --account-id 123
```

Replace 123 with the actual grant ID. This local recovery operation changes only website access.

## Configuration and qualification

For your own static images, create `/var/lib/card-library/media`, grant the service read access, and set `ASSET_ROOT=/var/lib/card-library/media` in the private `.env`. Copy your permitted PNG/JPEG/WebP there with mode 644, then enter `/assets/library/filename.png` in the card form and preview/publish. Restart the bridge after changing `ASSET_ROOT`. Back up this directory with state. This is a static-file route, not a browser upload feature.

`CATALOG_PATH` seeds an empty installation only. Edit live cards and packs through Administration and explicitly preview/publish imports; restarting with an old seed does not overwrite live content. Back up the framework state, purchase journal, admin grants, active catalog, game DB and persistent keys together. See [operations](operations.md).

Both services accept the same subset of `1,2,4`: NX Credit, Maple Points and NX Prepaid. Selected balances never combine or fall back. Other currencies require an authoritative wallet adapter. `AUTH_MODE=bridge` and `CARD_BRIDGE_SESSION_SOURCE=bridge` use native website login. Existing portal mode requires its own verified `web_sessions` authority.

Keep `STATE_KEY`, `CODE_ENCRYPTION_KEY`, both code-index keys, the shared signing key and `CSRF_KEY` stable. Enabling the supported Series One reward provider is a separate opt-in operation; see [code rules](code-rules.md). Do not disable the game adapter while bridge debits or pending reward saves exist.

Qualify MySQL restart, lease-loss recovery, duplicate purchases and stopped-writer restore before taking player funds. If rewards are enabled, verify actual Cash Shop redemption, inventory-full rejection, wrong account, duplicate redemption and saved-item/USED agreement with a real v83 client. Compilation and HTTP tests do not replace that gameplay check.
