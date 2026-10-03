import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  CardFramework,
  createCodeVault,
  validateCatalog,
} from "@digital-card/framework";
import { SQLiteStore } from "@digital-card/framework/sqlite";
import { isDeepStrictEqual } from "node:util";
import { acceptedTypes } from "./cash-types.mjs";
import { Journal } from "./journal.mjs";
import { Library, operator } from "./library.mjs";
import { createGameClient } from "./protocol.mjs";
import { createLibraryHttp } from "./http.mjs";
import { generateSeriesOneCode } from "./series-one.mjs";
const env = (name) => {
  if (!process.env[name]) throw Error("Missing " + name);
  return process.env[name];
};
const key32 = (name) => {
  const key = Buffer.from(env(name), "base64");
  if (key.length !== 32) throw Error(name + " must encode 32 bytes");
  return key;
};
const state = resolve(env("STATE_DIRECTORY"));
mkdirSync(state, { recursive: true, mode: 0o700 });
const store = new SQLiteStore(join(state, "framework.sqlite"), {
  encryptionKey: key32("STATE_KEY"),
});
const vault = createCodeVault({
  activeKeyId: "v1",
  keys: { v1: key32("CODE_ENCRYPTION_KEY") },
  indexKey: key32("CODE_INDEX_KEY"),
});
const core = new CardFramework({
  store,
  codeVault: vault,
  codeGenerators: { "series-one": generateSeriesOneCode },
});
const journal = new Journal(join(state, "bridge.sqlite")),
  catalog = JSON.parse(readFileSync(env("CATALOG_PATH"), "utf8"));
const current = store.read((s) => s.catalog?.version ?? 0);
if (
  current === catalog.version &&
  !isDeepStrictEqual(core.operatorCatalog(operator), validateCatalog(catalog))
)
  throw Error("Catalog content changed without a new version");
if (current !== catalog.version) {
  if (journal.pending().length)
    throw Error("Finish pending purchases before changing catalog versions");
  core.publishCatalog(operator, catalog);
}
core.configureCodePool(operator, {
  key: "series-one-pool-v1",
  pool: {
    id: "v83.series-one",
    providerId: "maplestory.v83",
    name: "Series One code",
    normalization: "upper-trim",
    generator: "series-one",
    instructions:
      "Enter this code in the v83 Cash Shop using the same game account. Each code grants one randomly assigned Series One reward.",
  },
});
const secret = env("GAME_SHARED_KEY"),
  game = createGameClient({ url: env("GAME_URL"), secret });
const library = new Library({
  framework: core,
  store,
  journal,
  game,
  acceptedCashTypes: acceptedTypes(process.env.ACCEPTED_CASH_TYPES),
});
const server = createLibraryHttp({
  library,
  game,
  origin: env("PUBLIC_ORIGIN"),
  secret,
  csrfSecret: env("CSRF_KEY"),
  authMode: process.env.AUTH_MODE ?? "bridge",
  webRoot:
    process.env.WEB_ROOT ??
    fileURLToPath(new URL("../starter/", import.meta.url)),
  assetRoot: process.env.ASSET_ROOT,
  trustProxy: process.env.TRUST_PROXY === "1",
  cookieName: process.env.SESSION_COOKIE,
});
let stopping = false,
  recovery = null;
function recover() {
  if (stopping) return Promise.resolve();
  if (recovery) return recovery;
  const shouldStop = () => stopping;
  recovery = (async () => {
    await library.recover({ shouldStop });
    if (!stopping) await library.reconcile({ shouldStop });
  })().finally(() => {
    recovery = null;
  });
  return recovery;
}
const timer = setInterval(() => recover().catch(() => {}), 10000);
timer.unref();
server.requestTimeout = 15000;
server.headersTimeout = 20000;
server.keepAliveTimeout = 5000;
server.listen(Number(process.env.PORT ?? 8487), "127.0.0.1", () => {
  console.log("Card library service listening on loopback");
  recover().catch(() => {});
});
function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  server.close(async () => {
    await recovery?.catch(() => {});
    journal.close();
    core.close();
  });
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
