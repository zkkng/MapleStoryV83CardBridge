import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const setup = fileURLToPath(new URL("../tools/setup.mjs", import.meta.url));
test("setup creates independent persistent keys and refuses either pre-existing configuration without a partial pair", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "card-bridge-setup-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, "game.env"), "existing-private-settings");
  let result = spawnSync(
    process.execPath,
    [setup, "--output-directory", directory],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(join(directory, ".env")), false);
  assert.equal(
    readFileSync(join(directory, "game.env"), "utf8"),
    "existing-private-settings",
  );
  rmSync(join(directory, "game.env"));
  result = spawnSync(
    process.execPath,
    [setup, "--output-directory", directory],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const node = Object.fromEntries(
    readFileSync(join(directory, ".env"), "utf8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i), l.slice(i + 1)];
      }),
  );
  assert.equal(node.ENABLE_SERIES_ONE_REWARDS, "0");
  assert.equal(node.CATALOG_PATH, resolve("./data/catalog.example.json"));
  assert.equal(node.STATE_DIRECTORY, resolve("./state"));
  const game = readFileSync(join(directory, "game.env"), "utf8");
  assert(game.includes("CARD_BRIDGE_SHARED_KEY=" + node.GAME_SHARED_KEY));
  const keys = [
    "GAME_SHARED_KEY",
    "STATE_KEY",
    "CODE_ENCRYPTION_KEY",
    "CODE_INDEX_KEY",
    "CSRF_KEY",
  ].map((k) => node[k]);
  assert.equal(new Set(keys).size, 5);
  keys.forEach((k) => assert.equal(Buffer.from(k, "base64").length, 32));
  assert(!result.stdout.includes(node.GAME_SHARED_KEY));
  const before = readFileSync(join(directory, ".env"), "utf8");
  result = spawnSync(
    process.execPath,
    [setup, "--output-directory", directory],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(join(directory, ".env"), "utf8"), before);
});
