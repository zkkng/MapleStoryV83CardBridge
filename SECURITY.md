# Security

Bridge 0.1 supports one Node state writer and one enabled Cosmic game process. Its loopback protocol uses separate persistent keys, exact request signatures, timestamp checks and nonce replay rejection. Expose only the website through a TLS reverse proxy.

Codes are encrypted in the framework and indexed by keyed hashes in the game database. Browser history and inventory responses contain no plaintext code. The private registration API returns secret material only to the trusted backend; never expose it through a general client endpoint or request log.

Treat game accounts, the purchase journal, backups and encryption keys as private data. Keep raw client assets separate from private configuration. Preserve the native character inventory transaction and the adapter's conditional reward claim and outbox hooks when adapting a fork.

Report vulnerabilities privately through GitHub's security advisory tools when available. Provide the affected revisions and an isolated reproduction. Avoid posting real codes, passwords, session cookies, database copies or keys publicly.

See [operations](docs/operations.md) for recovery, writer limits and backups, and [compatibility](docs/compatibility.md) for the required real-client checks before accepting player purchases.
