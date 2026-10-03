# Framework runtime dependency

Bridge 0.1 installs the MIT licensed DigitalCardFramework 0.2.0 generated-code edition from a pinned [runtime release](https://github.com/zkkng/MapleStoryV83CardBridge/releases/tag/framework-runtime-0.2.0-grendel.1).

The package includes the reusable source exports, runtime dependencies, generated OpenAPI reference and card/code guide. It is a versioned distribution of the framework; the bridge consumes its public APIs. Game-specific code remains in this repository.

`package-lock.json` pins the archive URL and SHA-512 integrity. [The runtime descriptor](../data/framework-runtime.json) also records its SHA-256, byte size and exact source revision. Public installation requires no GitHub account or SSH key.

The runtime package exposes `CardFramework`, `createCodeVault`, and the separate SQLite export. Generated pools are synchronous, allocate within the pack transaction, and preserve successful retry results. `codeRegistrationMaterial` is a trusted server method with no public HTTP route.

To inspect the dependency, open its `src/`, `docs/openapi.json` and `docs/card-types-and-codes.md` files after installation. Its MIT software license does not cover separately supplied artwork. Keep any local runtime modifications under version control and qualify them before changing an installed bridge.
