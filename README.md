# MapleStory v83 Card Bridge

Add an iTCG-style card system to your MapleStory private server. Players sign in with their game accounts, buy digital packs, and collect cards. **Enable rewards to distribute code cards redeemable in the game's existing Cash Shop code-entry field.** The bridge handles code issuance, account ownership, and redemption status, so you can connect collecting to in-game rewards without building that workflow yourself.

Built on [DigitalCardFramework](https://github.com/zkkng/DigitalCardFramework), it includes a card website and installer for vanilla [Cosmic GMS v83](https://github.com/P0nk/Cosmic). NX Credit, Maple Points, and NX Prepaid work by default. Other MapleStory servers and currencies, including vote points, require adapter changes.

Start with a sample Shapes pack and no reward pool configured. Add your own cards, enable a reward campaign, or optionally import scans from five original iTCG sets.

## Get started

You need Linux or WSL2, Python 3.11+, Git, and Docker with Compose. From this repository, run:

```sh
python3 tools/cosmic.py --directory ../CosmicCardServer install --test-account
```

This installs the supported Cosmic version, database, bridge, and website. Open `http://127.0.0.1:8490/library/`; the test-account credentials are saved in the installation's private directory.

Follow the [setup guide](docs/cosmic-setup.md) for configuration and operation, or the [adapter guide](docs/install.md) to connect an existing Cosmic deployment. Game client files are supplied separately.

## Make it your own

- **Cards and packs:** choose the cards, sets, prices, and draw weights in your [catalog](docs/cosmic-setup.md#customize-the-catalog). The website includes pack previews, collection search, filters, duplicate counts, and set completion.
- **Reward codes:** the optional [Series One profile](docs/cosmic-setup.md#install-and-verify) includes a ready-made reward campaign. [Code rules](docs/code-rules.md) explain redemption and the supported rewards; custom rewards need a matching game-side provider.
- **Original iTCG sets:** the [optional importer](docs/itcg-import.md) creates five set-based packs using externally sourced scans. No artwork is bundled and no rewards are enabled by the import.
- **Other servers or currencies:** adapt the [server protocol](docs/protocol.md) to your account, payment, and reward systems.

Before inviting players, check [compatibility](docs/compatibility.md) and complete the [rollout checks](docs/operations.md#rollout-checklist) with your game client and database.

Source: AGPL-3.0-only. Third-party artwork retains its original rights.
