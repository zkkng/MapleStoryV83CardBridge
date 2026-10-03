import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Journal } from "../src/journal.mjs";
import { verifyRequest } from "../src/protocol.mjs";
const execute = promisify(execFile),
  cli = fileURLToPath(new URL("../tools/admin.mjs", import.meta.url));
test("local administrator CLI resolves native identity, handles name boundaries and cleans unavailable grants", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "bridge-admin-cli-")),
    journal = new Journal(join(directory, "bridge.sqlite")),
    secret = "fixture-signing-key-".repeat(4),
    nonces = new Map();
  const people = [
    { accountId: 1, name: "Tom", banned: false },
    { accountId: 2, name: "CollectorLong", banned: false },
    { accountId: 3, name: "Banned", banned: true },
  ];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    assert.equal(req.url, "/resolve-account");
    assert.ok(
      verifyRequest({
        secret,
        method: "POST",
        path: req.url,
        headers: req.headers,
        body: raw,
        nonces,
      }),
    );
    const input = JSON.parse(raw),
      person = people.find((p) =>
        input.accountId
          ? p.accountId === input.accountId
          : p.name === input.name,
      );
    res.writeHead(person && !person.banned ? 200 : 404, {
      "Content-Type": "application/json",
    });
    res.end(
      JSON.stringify(
        person && !person.banned
          ? { accountId: person.accountId, name: person.name }
          : { code: "ACCOUNT_UNAVAILABLE", message: "Account unavailable." },
      ),
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    journal.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const env = {
    ...process.env,
    STATE_DIRECTORY: directory,
    GAME_URL: `http://127.0.0.1:${server.address().port}`,
    GAME_SHARED_KEY: secret,
  };
  const call = async (args) =>
    JSON.parse(
      (await execute(process.execPath, [cli, ...args], { env })).stdout,
    );
  assert.equal((await call(["grant", "Tom"])).changed, true);
  assert.equal((await call(["grant", "Tom"])).changed, false);
  assert.equal((await call(["grant", "CollectorLong"])).accountId, 2);
  await assert.rejects(call(["grant", "Banned"]), (e) => e.code === 1);
  await assert.rejects(call(["grant", "Unknown"]), (e) => e.code === 1);
  await assert.rejects(call(["grant", "To"]), (e) => e.code === 2);
  await assert.rejects(
    call(["grant", "CollectorExtraLong"]),
    (e) => e.code === 2,
  );
  people[0].banned = true;
  const listed = await call(["list"]);
  assert.equal(listed.items.find((p) => p.accountId === 1).available, false);
  await assert.rejects(call(["revoke", "Tom"]), (e) => e.code === 1);
  const offline = { ...env };
  delete offline.GAME_SHARED_KEY;
  delete offline.GAME_URL;
  const revoke = async () =>
    JSON.parse(
      (
        await execute(process.execPath, [cli, "revoke", "--account-id", "1"], {
          env: offline,
        })
      ).stdout,
    );
  assert.equal((await revoke()).changed, true);
  assert.equal((await revoke()).changed, false);
  assert.equal(journal.administrator(1), false);
  assert.equal(journal.administrator(2), true);
  const wrong = join(directory, "wrong");
  await assert.rejects(
    execute(process.execPath, [cli, "list"], {
      env: { ...env, STATE_DIRECTORY: wrong },
    }),
    (e) => e.code === 1,
  );
  assert.equal(existsSync(join(wrong, "bridge.sqlite")), false);
});
