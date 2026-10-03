# Framework runtime dependency

The bridge depends directly on the public [DigitalCardFramework repository](https://github.com/zkkng/DigitalCardFramework). Bridge 0.1 pins its MIT licensed 0.2.0 generated-code edition to [commit `7423262fedeb3116dff2dd178761e54704ba3169`](https://github.com/zkkng/DigitalCardFramework/tree/7423262fedeb3116dff2dd178761e54704ba3169).

`npm ci` downloads that exact source archive from GitHub. No GitHub account, SSH key, local framework checkout or bridge-hosted framework copy is required. The pinned commit includes synchronous generated-code pools and the trusted server-only `codeRegistrationMaterial` API. An older framework revision lacks those methods.

`package-lock.json` pins the archive URL and SHA-512 integrity. [The runtime descriptor](../data/framework-runtime.json) records the source repository, commit, SHA-256, archive size and integrity. These identifiers must change together when qualifying a framework upgrade.

The framework supplies generic card behavior and public APIs. This bridge supplies Cosmic identity, cash balances and game rewards. Custom frontends use the same public bridge APIs. Use the framework repository for its source, license, contracts and development history.

After installation, inspect the dependency's `src/`, `docs/openapi.json` and `docs/card-types-and-codes.md` files. Its MIT software license does not cover separately supplied artwork. Qualify local runtime modifications before changing an installed bridge.
