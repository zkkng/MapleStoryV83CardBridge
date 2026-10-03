# Optional iTCG scan import

The bridge uses an original Shapes collection by default. This optional tool reads the five English card-scan galleries from [the MapleStory Card Game Guide](https://maplestoryitcg.weebly.com/), preserving each gallery as a separate set and pack. Images load directly from the source website by default. It does not configure item rewards, generate game codes, or bundle scans in the source repository.

The source gallery order supplies stable scan numbers. Source pages do not provide machine-readable card names or rarity labels, so imported cards are named by set and number and use the rarity label Scanned card. You can replace these labels and adjust weights in the generated catalog. Every card initially has equal draw weight; eight draws per pack allow duplicates. These are digital collection packs, not historical booster-odds claims. Galleries may include alternate printings or extra cards.

## Inspect and import

Use Python 3 from the bridge directory:

```sh
python tools/import-itcg.py --inspect
python tools/import-itcg.py --output external/itcg --sets 1,2,3,4,5 --price 1000 --catalog-version 3
```

`--inspect` fetches only gallery HTML and lists scan counts. `--sets` accepts any subset of 1–5. The default import writes a catalog of source image URLs and a receipt containing gallery hashes and scan references, without downloading artwork. The website permits only the named HTTPS source, sends no referrer with image requests and shows an unavailable-image placeholder if a scan cannot load. The source controls availability of these images; cards and purchase receipts remain stored on your server.

To download local copies instead, add `--download`. Downloads run sequentially with a short delay, limit each file to 8 MiB, check JPEG/PNG signatures and record file hashes. An existing output directory is never overwritten. A failed download leaves an INCOMPLETE marker and no activatable catalog; retry into a new directory after correcting the source or network issue.

The output contains:

- `catalog.json`: the framework catalog with one pack per set.
- `assets/`: downloaded scans, only when `--download` is selected.
- `sources.json`: source URLs, byte counts and file hashes.

The importer accepts only scan links from the named source domain and refuses redirects outside it. If its page layout changes, it fails rather than substituting art. Keep generated catalogs and receipts outside public source control and in installation backups. Direct-source images are display assets; they never determine payment or pack allocation.

## Activate the catalog

For a fresh managed Cosmic installation, review the catalog and run:

```sh
python3 tools/cosmic.py --directory ../CosmicITCGServer install --catalog external/itcg/catalog.json --test-account
```

This copies the catalog into the managed private configuration; direct-source mode needs no artwork mount and keeps rewards disabled. Interrupted setup verifies the original catalog hash before resuming. For an existing managed installation, migrate `private/catalog.json` using the [catalog procedure](cosmic-setup.md#customize-the-catalog).

For a manual bridge, review the catalog before changing your private `.env`:

The managed profile does not mount an external scan directory. Local-download mode requires an operator-supplied read-only asset mount and a matching container `ASSET_ROOT`; a host path alone is insufficient.

```dotenv
CATALOG_PATH=./external/itcg/catalog.json
ENABLE_SERIES_ONE_REWARDS=0
```

Use a catalog version greater than your current version. Finish pending purchases before changing versions, then restart the bridge. Check each selected set in the pack shop, inspect contents, purchase with a test account, open a pack, and confirm images and duplicates appear in the collection. Preserve existing catalogs and assets needed by issued cards; switching catalogs is an operator migration, not an importer action.

For local-download mode, also set `ASSET_ROOT=./external/itcg/assets` in a manual deployment, or the equivalent container path after mounting assets.

The scan artwork is third-party material. Downloading it separately does not change its copyright or grant redistribution rights. Use it only where you have the necessary permission; the Shapes pack works without external artwork.
