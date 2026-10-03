import { chromium } from "playwright";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { fixture } from "./fixture.mjs";
import { createLibraryHttp } from "../src/http.mjs";
import { fail } from "../src/protocol.mjs";
const socket = createServer();
await new Promise((r) => socket.listen(0, "127.0.0.1", r));
const port = socket.address().port;
await new Promise((r) => socket.close(r));
const x = fixture(),
  sessions = new Map(),
  origin = "http://127.0.0.1:" + port;
const game = async (path, value) => {
  if (path === "/login") {
    if (value.username !== "Collector" || value.password !== "fixture")
      fail("UNAUTHENTICATED", "Invalid test account", 401);
    sessions.set(value.tokenHash, x.person);
    return x.person;
  }
  if (path === "/session") {
    if (!sessions.has(value.tokenHash))
      fail("UNAUTHENTICATED", "Session expired", 401);
    return sessions.get(value.tokenHash);
  }
  if (path === "/logout") {
    sessions.delete(value.tokenHash);
    return { ok: true };
  }
  return x.game(path, value);
};
const server = createLibraryHttp({
  library: x.library,
  game,
  origin,
  secret: "browser-test-shared-".repeat(3),
  csrfSecret: "browser-test-csrf-".repeat(3),
  authMode: "bridge",
  webRoot: fileURLToPath(new URL("../starter", import.meta.url)),
});
await new Promise((r) => server.listen(port, "127.0.0.1", r));
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_CHANNEL
    ? { channel: process.env.BROWSER_CHANNEL }
    : {}),
});
const page = await browser.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(origin + "/library/");
  await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
  assert.equal(await page.locator("#purchase").isDisabled(), true);
  await page.locator("[name=username]").fill("Collector");
  await page.locator("[name=password]").fill("fixture");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector("#welcome").textContent.includes("Collector"),
  );
  await page.locator("#cash-type").selectOption("4");
  await page.getByRole("button", { name: "Buy pack", exact: true }).click();
  await page.locator("[data-pack]").waitFor();
  assert.equal(x.nxPrepaid.get(1), 9000);
  assert.equal(x.balances.get(1), 10000);
  assert.equal(x.maplePoints.get(1), 10000);
  await page.locator("[data-pack]").first().click();
  await page.waitForFunction(
    () => document.querySelectorAll("#opened .card").length === 9,
  );
  await page.locator("#collection .card").first().waitFor();
  assert.equal(await page.locator("#collection .card").count(), 8);
  await page.getByRole("button", { name: "Reveal code", exact: true }).click();
  await page.locator(".code-text").waitFor();
  const raw = await page.locator(".code-text").textContent();
  assert.match(raw, /^[A-Z0-9]{15,18}$/);
  assert.equal(
    await page.evaluate(() =>
      JSON.stringify(sessionStorage).includes(
        document.querySelector(".code-text").textContent,
      ),
    ),
    false,
  );
  const code = (await x.library.state(x.person)).codes[0],
    row = x.registrations.get(code.id);
  row.status = "USED";
  row.receiptId = randomUUID();
  row.usedAt = new Date().toISOString();
  await page
    .getByRole("button", { name: "Refresh collection and code status" })
    .click();
  await page.locator(".used").waitFor();
  assert.equal(await page.locator(".used").textContent(), "USED");
  let releaseOpening, openingReturned;
  const heldOpening = new Promise((resolve) => (releaseOpening = resolve));
  const pendingOpening = new Promise((resolve) => (openingReturned = resolve));
  await page.route("**/api/library/open", async (route) => {
    const response = await route.fetch();
    openingReturned();
    await heldOpening;
    await route.fulfill({ response });
  });
  await page.locator("[data-pack]").first().click();
  await pendingOpening;
  assert.equal(x.core.inventory(x.library.actor(x.person)).length, 9);
  assert.equal(x.debitCount, 1);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("#status").textContent === "Signed out.",
  );
  const releasedResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/library/open"),
  );
  releaseOpening();
  await releasedResponse;
  await page.evaluate(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  ));
  await page.locator("#login").waitFor({ state: "visible" });
  assert.equal(sessions.size, 0);
  assert.equal(await page.locator(".code-text").count(), 0);
  assert.equal(await page.locator("#opened .card").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "Standalone account, selected cash, durable pack, private reveal, USED refresh, replay and logout checks passed.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  x.close();
}
