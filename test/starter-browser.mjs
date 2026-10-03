import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { readFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { fixture } from "./fixture.mjs";
import { createLibraryHttp } from "../src/http.mjs";
import { fail } from "../src/protocol.mjs";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_CHANNEL
    ? { channel: process.env.BROWSER_CHANNEL }
    : {}),
});
const defaultCatalog = JSON.parse(
  readFileSync(
    new URL("../data/catalog.example.json", import.meta.url),
    "utf8",
  ),
);
async function scenario(rewards) {
  const x = fixture(rewards ? {} : { catalog: defaultCatalog }),
    sessions = new Map();
  let origin;
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
  // Allocate a local test port before constructing the same-origin HTTP handler.
  const server = createLibraryHttp({
    library: x.library,
    game,
    origin: "http://127.0.0.1:8487",
    secret: "browser-test-shared-".repeat(3),
    csrfSecret: "browser-test-csrf-".repeat(3),
    authMode: "bridge",
    webRoot: fileURLToPath(new URL("../starter", import.meta.url)),
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  origin = "http://127.0.0.1:" + port;
  const app = createLibraryHttp({
    library: x.library,
    game,
    origin,
    secret: "browser-test-shared-".repeat(3),
    csrfSecret: "browser-test-csrf-".repeat(3),
    authMode: "bridge",
    webRoot: fileURLToPath(new URL("../starter", import.meta.url)),
  });
  await new Promise((r) => app.listen(port, "127.0.0.1", r));
  const page = await browser.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(origin + "/library/");
    await page.waitForFunction(
      () =>
        document.querySelector("#status").textContent ===
        "Choose a pack to begin.",
    );
    assert.equal(await page.locator("#purchase").isDisabled(), true);
    await page
      .getByRole("button", { name: "View contents", exact: true })
      .click();
    await page.locator("#detail[open]").waitFor();
    assert.ok((await page.locator("#detail li").count()) > 0);
    await page.getByRole("button", { name: "Close card details" }).click();
    await page.locator("[name=username]").fill("Collector");
    await page.locator("[name=password]").fill("wrong");
    await page.locator("#login button").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#status").textContent ===
        "Invalid test account",
    );
    await page.locator("[name=password]").fill("fixture");
    await page.locator("#login button").click();
    await page.waitForFunction(() =>
      document.querySelector("#welcome").textContent.includes("Collector"),
    );
    await page.locator("#cash-type").selectOption("4");
    await page.locator("#quantity").fill("2");
    await page.getByRole("button", { name: "Buy pack", exact: true }).click();
    await page.locator("#confirm[open]").waitFor();
    assert.ok(
      (await page.locator("#confirm-text").textContent()).includes(
        "2,000 NX Prepaid",
      ),
    );
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(x.debitCount, 0);
    await page.getByRole("button", { name: "Buy pack", exact: true }).click();
    await page
      .getByRole("button", { name: "Confirm purchase", exact: true })
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll("[data-pack]").length === 2,
    );
    assert.equal(x.nxPrepaid.get(1), 8000);
    assert.equal(x.balances.get(1), 10000);
    assert.equal(x.maplePoints.get(1), 10000);
    await page.locator("[data-pack]").first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll("#opened .card").length === n,
      rewards ? 9 : 8,
    );
    await page.waitForFunction(
      () => document.querySelectorAll("[data-pack]").length === 1,
    );
    await page.locator("#collection .card").first().waitFor();
    assert.equal(
      await page.evaluate(() =>
        [...document.querySelectorAll("#collection .copies")].reduce(
          (n, e) => n + Number(e.textContent.slice(1)),
          0,
        ),
      ),
      8,
    );
    await page.locator("#search").fill("no-matching-card");
    await page.getByText("No matching cards", { exact: true }).waitFor();
    await page.locator("#search").fill("");
    await page.locator("#collection .card").first().click();
    await page.locator("#detail[open]").waitFor();
    assert.ok(
      (await page.locator("#detail-content").textContent()).includes(
        "Copies owned",
      ),
    );
    await page.getByRole("button", { name: "Close card details" }).click();
    if (rewards) {
      await page
        .getByRole("button", { name: "Reveal code", exact: true })
        .click();
      await page.locator(".code-text").waitFor();
      const raw = await page.locator(".code-text").textContent();
      assert.match(raw, /^[A-Z0-9]{15,18}$/);
      assert.equal(
        await page.evaluate(
          (code) => JSON.stringify(sessionStorage).includes(code),
          raw,
        ),
        false,
      );
      const code = (await x.library.state(x.person)).codes[0],
        row = x.registrations.get(code.id);
      row.status = "USED";
      row.receiptId = randomUUID();
      row.usedAt = new Date().toISOString();
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await page.locator(".used").waitFor();
      assert.equal(await page.locator(".used").textContent(), "USED");
      assert.equal(await page.locator("[data-code]").count(), 0);
    } else {
      assert.equal(x.registrations.size, 0);
      assert.equal(await page.locator("[data-code]").count(), 0);
    }
    if (!rewards) {
      // A changed quote cannot silently replace the price the player reviewed.
      await page.locator("#quantity").fill("1");
      await page.route(
        "**/api/library/quote",
        async (route) => {
          const response = await route.fetch(),
            quote = await response.json();
          quote.price.amount++;
          await route.fulfill({ response, json: quote });
        },
        { times: 1 },
      );
      await page.getByRole("button", { name: "Buy pack", exact: true }).click();
      await page.waitForFunction(() =>
        document
          .querySelector("#status")
          .textContent.includes("This pack changed"),
      );
      assert.equal(
        await page.locator("#confirm").evaluate((e) => e.open),
        false,
      );
      assert.equal(x.debitCount, 1);
      // Lose a response after the debit; recovery must use the identical request.
      await page.route(
        "**/api/library/buy",
        async (route) => {
          await route.fetch();
          await route.abort("failed");
        },
        { times: 1 },
      );
      await page.getByRole("button", { name: "Buy pack", exact: true }).click();
      await page
        .getByRole("button", { name: "Confirm purchase", exact: true })
        .click();
      await page.waitForFunction(() =>
        document
          .querySelector("#status")
          .textContent.includes("purchase is saved"),
      );
      assert.equal(x.debitCount, 2);
      await page.reload();
      await page
        .getByRole("button", { name: "Check purchase", exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelector("#pending").hidden,
      );
      assert.equal(x.debitCount, 2);
      assert.equal(x.nxPrepaid.get(1), 7000);
      assert.equal(await page.locator("[data-pack]").count(), 2);
      await page.locator("#cash-type").selectOption("4");
      x.nxPrepaid.set(1, 0);
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await page.waitForFunction(() =>
        document
          .querySelector("#purchase-note")
          .textContent.includes("Not enough funds"),
      );
      assert.equal(await page.locator("#purchase").isDisabled(), true);
      x.nxPrepaid.set(1, 7000);
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await page.waitForFunction(
        () =>
          !document.querySelector("#refresh").disabled &&
          document.querySelector("#purchase-note").textContent === "",
      );
    } else {
      for (let i = 0; i < 11; i++) {
        x.balances.set(1, 100000);
        const bought = await x.buy("pagination-fixture-" + i, 5);
        for (const pack of bought.packs)
          x.library.open(x.person, { key: "open-" + pack.id, packId: pack.id });
      }
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await page.locator("#more-codes").waitFor({ state: "visible" });
      assert.equal(await page.locator("#codes .code").count(), 50);
      await page
        .getByRole("button", { name: "Load more codes", exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelectorAll("#codes .code").length === 56,
      );
      await page.locator("#code-filter").selectOption("redeemed");
      assert.equal(await page.locator("#codes .code").count(), 1);
      await page.locator("#code-filter").selectOption("all");
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    if (process.env.QA_DIRECTORY && !rewards) {
      mkdirSync(process.env.QA_DIRECTORY, { recursive: true });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path:
          process.env.QA_DIRECTORY +
          `/starter-${rewards ? "rewards" : "shapes"}-mobile.png`,
        fullPage: true,
      });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.screenshot({
        path:
          process.env.QA_DIRECTORY +
          `/starter-${rewards ? "rewards" : "shapes"}-desktop.png`,
        fullPage: true,
      });
    }
    let release, returned;
    const held = new Promise((r) => (release = r)),
      pending = new Promise((r) => (returned = r));
    await page.route("**/api/library/open", async (route) => {
      const response = await route.fetch();
      returned();
      await held;
      await route.fulfill({ response });
    });
    await page.locator("[data-pack]").first().click();
    await pending;
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector("#status").textContent === "Signed out.",
    );
    const delivered = page.waitForResponse((r) =>
      r.url().endsWith("/api/library/open"),
    );
    release();
    await delivered;
    await page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
    );
    assert.equal(sessions.size, 0);
    assert.equal(await page.locator(".code-text").count(), 0);
    assert.equal(await page.locator("#opened .card").count(), 0);
    assert.equal(await page.locator("#collection .card").count(), 0);
    assert.equal(x.debitCount, rewards ? 12 : 2);
    assert.deepEqual(errors, []);
    console.log(
      `${rewards ? "Optional rewards" : "Default shapes"}: sign-in, selected balance, confirmation/cancel, collection, unopened-only packs, mobile layout, and logout isolation passed.`,
    );
  } finally {
    await page.close();
    await new Promise((r) => app.close(r));
    x.close();
  }
}
try {
  await scenario(false);
  await scenario(true);
} finally {
  await browser.close();
}
