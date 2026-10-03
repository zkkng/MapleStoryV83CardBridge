# Compatibility

Bridge 0.1 targets Cosmic GMS v83 revision `fec53bc7714dc0f1ae3f50b2986cdf2727e0912a` from [P0nk/Cosmic](https://github.com/P0nk/Cosmic/tree/fec53bc7714dc0f1ae3f50b2986cdf2727e0912a).

The framework runtime archive and integrity are pinned in package.json and the lockfile; the exact source revision is in data/framework-runtime.json. See [the runtime dependency](framework-runtime.md). The dependency includes synchronous generated-code pools and the server-only registration-material API; an older framework checkout lacks those methods.

## Qualified source and contract checks

- Installer anchors, repeat installation and Java 21 compilation against the pinned unmodified upstream source.
- Stock Cosmic's 1,886 tests and nine added adapter tests: 1,895 passing tests with the adapter tests isolated in a separate JVM.
- SQL-backed reward/item/USED/outbox commit, failed-save retry, account ownership and immutable registration.
- Independent spending from all three cash balances, changed-type replay rejection and insufficient selected funds.
- Native account-session creation, lookup, revocation and password compatibility.
- Node bridge purchase, encrypted restart, generated code and signed HTTP contract tests.
- The standalone and Grendel frontends are separate from the game source; fixture browser tests exercise their API wiring.

The adapter was also installed and compiled against a Cosmic-derived downstream checkout. This does not establish compatibility with every HeavenMS/OdinMS fork.

## Managed deployment qualification

The scripted Linux amd64 profile was exercised with Docker 29.7.2, Compose 5.5.0, MySQL 8.4.11, Java 21 and Node.js 24.19.0. A fresh database completed Cosmic migrations, native account login, a selected Prepaid debit and retry, eight collectibles plus one registered code, reveal and logout. Independent game restart, maintenance refusal for a connected account, funding idempotence, consistent backup, restoration of an intentionally changed balance, and upgrade retention of keys, cards and codes also passed. The CI workflow repeats installation and the persistent lifecycle on a disposable fresh stack.

These backend checks do not establish real-client coupon rendering or redemption. The managed installer runs on Linux; WSL2 is an available Linux execution route, rather than a separately qualified Windows-native profile.

## Runtime checks for your server

SQL tests use H2 in MySQL compatibility mode and mocked packet/character boundaries. They verify adapter transitions but do not prove real client rendering, MySQL lock behavior under your deployment, or every character-save extension in a fork.

Before enabling player purchases, complete the starter workflow with a disposable real account and v83 client: all accepted balances, ordinary and pet rewards, full inventory rejection, repeat redemption, game restart, bridge restart and a temporarily unavailable callback. Confirm that your saved item and USED receipt agree. Keep your installed code revision and configuration together when diagnosing an issue.

The process model is one bridge writer and one enabled Cosmic process per installation. Distributed game writers are outside this profile. The framework uses an encrypted whole-state SQLite store with bounded capacity; it is not a distributed transaction service. Do not run two bridge services against the same state files.
