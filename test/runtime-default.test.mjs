import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { SQLiteStore } from "@digital-card/framework/sqlite";
test("a fresh service starts with Shapes and no configured reward pool", async () => {
  const directory = mkdtempSync(join(tmpdir(), "card-default-runtime-"));
  const key = Buffer.alloc(32, 7),
    environment = {
      ...process.env,
      STATE_DIRECTORY: directory,
      CATALOG_PATH: fileURLToPath(
        new URL("../data/catalog.example.json", import.meta.url),
      ),
      PORT: "0",
      PUBLIC_ORIGIN: "http://127.0.0.1:8487",
      GAME_URL: "http://127.0.0.1:1",
      GAME_SHARED_KEY: "fixture-shared-key-".repeat(3),
      STATE_KEY: key.toString("base64"),
      CODE_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64"),
      CODE_INDEX_KEY: Buffer.alloc(32, 9).toString("base64"),
      CSRF_KEY: "fixture-csrf-key-".repeat(3),
      ENABLE_SERIES_ONE_REWARDS: "0",
      AUTH_MODE: "bridge",
      ACCEPTED_CASH_TYPES: "1,2,4",
      WEB_ROOT: fileURLToPath(new URL("../starter", import.meta.url)),
    };
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("../src/server.mjs", import.meta.url))],
    { env: environment, stdio: ["ignore", "pipe", "pipe"] },
  );
  let error = "";
  child.stderr.on("data", (data) => (error += data));
  try {
    await Promise.race([
      new Promise((resolve) =>
        child.stdout.on("data", (data) => {
          if (String(data).includes("listening")) resolve();
        }),
      ),
      once(child, "exit").then(() => {
        throw Error("Startup failed: " + error);
      }),
      new Promise((_, reject) => {
        const timer = setTimeout(
          () => reject(Error("Startup timed out")),
          10000,
        );
        timer.unref();
      }),
    ]);
    const store = new SQLiteStore(join(directory, "framework.sqlite"), {
      encryptionKey: key,
    });
    try {
      assert.equal(
        store.read((s) => s.catalog.products[0].id),
        "shapes",
      );
      assert.deepEqual(
        store.read((s) => s.codePools ?? {}),
        {},
      );
    } finally {
      store.close();
    }
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
