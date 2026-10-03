# Optional iTCG scan import

The barebones bridge uses a Shapes collection by default. This optional tool imports the five English card-scan galleries from [the MapleStory Card Game Guide](https://maplestoryitcg.weebly.com/), preserving each gallery as a separate set and pack. It does not configure item rewards, generate game codes, or bundle scans in the source repository.

The source gallery order supplies stable scan numbers. Source pages do not provide machine-readable card names or rarity labels, so imported cards are named by set and number and use the rarity label Scanned card. You can replace these labels and adjust weights in the generated catalog. Every card initially has equal draw weight; eight draws per pack allow duplicates. These are digital collection packs, not historical booster-odds claims. Galleries may include alternate printings or extra cards.

## Inspect and import

Use Python 3 from the bridge directory:

```sh
python tools/import-itcg.py --inspect
python tools/import-itcg.py --output external/itcg --sets 1,2,3,4,5 --price 1000 --catalog-version 3
```

`--inspect` fetches only the gallery HTML and lists scan counts. `--sets` accepts any subset of 1–5. Import downloads scans sequentially with a short delay, limits each file to 8 MiB, checks JPEG/PNG signatures, and writes a SHA-256 source receipt. An existing output directory is never overwritten. A failed import leaves an INCOMPLETE marker and does not activate anything; retry into a new directory after correcting the source or network issue.

The output contains:

- `catalog.json`: the framework catalog with one pack per set.
- `assets/`: downloaded scans, served from your installation.
- `sources.json`: source URLs, byte counts and file hashes.

The importer accepts only scan links from the named source domain. If its page layout changes or files disappear, it fails rather than silently substituting art. Keep the imported directory in your installation backups and outside public source control. Do not depend on remote hotlinks during a player's purchase or pack opening.

## Activate the catalog

Review the generated catalog before changing your private `.env`:

These paths apply to a manual bridge deployment. The managed Cosmic profile mounts `private/catalog.json` and does not mount an external scan directory. Serving scans with that profile requires an operator-supplied read-only asset mount and a matching container `ASSET_ROOT`; a host path alone is insufficient.

```dotenv
CATALOG_PATH=./external/itcg/catalog.json
ASSET_ROOT=./external/itcg/assets
ENABLE_SERIES_ONE_REWARDS=0
```

Use a catalog version greater than your current version. Finish pending purchases before changing versions, then restart the bridge. Check each selected set in the pack shop, inspect contents, purchase with a test account, open a pack, and confirm images and duplicates appear in the collection. Preserve existing catalogs and assets needed by issued cards; switching catalogs is an operator migration, not an importer action.

The scan artwork is third-party material. Downloading it separately does not change its copyright or grant redistribution rights. Use it only where you have the necessary permission; the Shapes pack works without external artwork.
