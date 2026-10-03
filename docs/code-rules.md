# Series One code rules

Rewards are disabled by default. The Shapes catalog has no code insert and no reward pool is configured. An operator can enable the supplied Series One campaign for selected published packs using the stopped-writer procedure below.

## Enable rewards on an existing managed installation

Update the bridge source and [upgrade the managed installation](cosmic-setup.md#upgrade) to a release containing `tools/rewards.mjs` first. In Administration, find the stable IDs of the published, enabled packs that should receive a code. Sign out all game accounts and finish pending purchases, then run:

```sh
python3 tools/cosmic.py --directory ../CosmicCardServer rewards enable-series-one --products shapes
```

Replace `shapes` with your actual pack ID, or use comma-separated IDs without spaces. The command takes a consistent backup after stopping the game, website and card writers, enables the provider, and appends one guaranteed dedicated code insert to each selected pack. It checks readiness with ingress closed before reopening the deployment. It refuses incomplete setup/recovery, unresolved purchases and conflicting code assignments. Other packs keep their definitions. Repeating the same selection adds no duplicate inserts or catalog versions.

Existing sealed packs, cards and issued codes retain their original allocations. Only future purchases of the selected packs receive the new insert. The active catalog is stored in persistent state; editing `private/catalog.json` does not apply this change.

If configuration or private validation fails, the command restores the previous provider configuration, catalog and data. If reopening ingress fails, it stops services and preserves current data because players may already have transacted. Keep the named safety backup, correct the fault and run `start`; do not restore over possible new transactions. See [backup and recovery](operations.md#consistent-backups-and-in-place-restore).

For a new installation, `install --series-one` explicitly adds the insert to every initial pack. The default installation remains reward-free.

## Enable rewards on a manual installation

Use the current bridge source with dependencies installed, the existing absolute `STATE_DIRECTORY` and the original persistent keys. Finish pending purchases, stop the website and game writers, and take a consistent backup of the game database, both SQLite databases and any WAL files, private environment files and static media. Prevent the service manager from restarting those writers during this operation.

For the service layout in [manual installation](install.md), set `ENABLE_SERIES_ONE_REWARDS=1` in `/etc/card-library/.env`, preserving every other setting and its file ownership/mode. From `/opt/card-library/bridge`, run:

```sh
sudo -u card-library /usr/bin/node --env-file=/etc/card-library/.env tools/rewards.mjs enable-series-one --products shapes --confirm-stopped
```

Select actual published pack IDs as above. The flag is your assertion that both writers are stopped; the CLI does not stop services for you. The CLI refuses missing databases, unresolved purchases, disabled/unknown packs and conflicting inserts. If it fails, restore the complete consistent backup and the previous environment before restarting; provider and catalog writes span separate transactions. Keep ingress closed while restarting and running `tools/doctor.mjs`, then reopen it after readiness passes. Verify one new purchase issues exactly one READY code before inviting collectors. Do not change the native game's reward flag: the enabled adapter already validates the supported whitelist.

## Code allocation and redemption

An opted-in reward pack issues one code when the pack is purchased, in the same framework transaction as the sealed cards. Opening, animation, reload and reveal do not reroll it.

| Family   | Layout                            | Rewards                               |
| -------- | --------------------------------- | ------------------------------------- |
| Standard | 15 characters, displayed as 5-5-5 | Fourteen material/consumable outcomes |
| Pet      | C01 + 15 characters               | Black Bunny, 30 days                  |
| Pet      | C02 + 15 characters               | Blue Husky, 30 days                   |
| Pet      | C03 + 15 characters               | Porcupine, 30 days                    |

The bridge accepts spaces and hyphens for display grouping and normalizes case. Generation uses cryptographically secure random draws and an alphabet excluding ambiguous I, O, 0 and 1. This alphabet is an implementation choice, not a recovered official code-generation algorithm. Codes are valid only on the configured private server.

Each of the seventeen outcomes in [series-one.json](../data/series-one.json) has a uniform 1/17 chance, independently of collectible rarity. Pets expire thirty days after delivery. Consumables retain the table's quantities. Starter Red Relaxer, promotional Maple Champion and later-series rewards are excluded.

Historical Series One reward codes were printed on play cards. The dedicated insert in every digital pack is this edition's adaptation; it is not a claim that original Series One boosters contained a separate code card. Historical layouts and quantities were checked against [the iTCG code reference](https://maplestoryitcg.weebly.com/codes.html).

The game enforces the account, Series One whitelist, quantity and pet-prefix pairing. It stores an HMAC fingerprint rather than plaintext code text. Redeeming a code retains the collectible/code-card record in the library; it changes the verified redemption status.
