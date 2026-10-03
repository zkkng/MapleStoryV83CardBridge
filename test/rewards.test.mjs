import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fixture } from "./fixture.mjs";
import { enableSeriesOne } from "../src/reward-configuration.mjs";
import { CardFramework, createCodeVault } from "@digital-card/framework";
import { SQLiteStore } from "@digital-card/framework/sqlite";
import { Journal } from "../src/journal.mjs";

const shapes = JSON.parse(
  readFileSync(new URL("../data/catalog.example.json", import.meta.url)),
);
test("offline reward activation preserves existing cards and applies one insert only to selected packs", async () => {
  const catalog = structuredClone(shapes);
  catalog.products.push({
    ...structuredClone(catalog.products[0]),
    id: "other-pack",
    name: "Other pack",
  });
  const x = fixture({ catalog });
  try {
    const id = catalog.products[0].id,
      quote = x.library.quote(x.person, { productId: id }),
      result = await x.library.buy(x.person, {
        ...quote,
        key: "before-rewards",
      });
    const actor = x.library.actor(x.person);
    const prior = x.core.inventory(actor).map((c) => c.id),
      oldPack = x.core.packs(actor).find((p) => p.id === result.packs[0].id);
    const enabled = enableSeriesOne(x.core, x.journal, [id]);
    assert.equal(enabled.changed, true);
    assert.equal(enabled.version, catalog.version + 1);
    assert.deepEqual(
      x.core.inventory(actor).map((c) => c.id),
      prior,
    );
    assert.deepEqual(
      x.core.packs(actor).find((p) => p.id === oldPack.id),
      oldPack,
    );
    assert.equal(x.core.codeInventory({ role: "admin" }).total, 0);
    const live = x.core.catalog();
    assert.equal(
      live.products.find((p) => p.id === id).revision,
      catalog.products[0].revision + 1,
    );
    assert.equal(
      live.products.find((p) => p.id === "other-pack").slots.length,
      catalog.products[1].slots.length,
    );
    assert.equal(enableSeriesOne(x.core, x.journal, [id]).changed, false);
    const next = x.library.quote(x.person, { productId: id });
    await x.library.buy(x.person, { ...next, key: "after-rewards" });
    assert.equal(x.core.codeInventory({ role: "admin" }).total, 1);
    assert.equal(
      enableSeriesOne(x.core, x.journal, ["other-pack"]).version,
      live.version + 1,
    );
    assert.equal(x.core.codeInventory({ role: "admin" }).total, 1);
  } finally {
    x.close();
  }
});
test("reward activation rejects pending purchases, conflicting identities and invalid selection without publication", () => {
  const x = fixture({ catalog: shapes });
  try {
    for (const ids of [
      [],
      ["missing"],
      [shapes.products[0].id, shapes.products[0].id],
    ])
      assert.throws(() => enableSeriesOne(x.core, x.journal, ids), {
        code: "INVALID_PRODUCTS",
      });
    const quote = x.library.quote(x.person, {
      productId: shapes.products[0].id,
    });
    x.journal.create(
      x.person.accountId,
      "pending-activation",
      { productId: quote.productId },
      x.library.actor(x.person).userId,
      quote,
    );
    assert.throws(() => enableSeriesOne(x.core, x.journal, [quote.productId]), {
      code: "PENDING_PURCHASES",
    });
    assert.equal(x.core.catalog().version, shapes.version);
    assert.equal(x.core.codePools({ role: "admin" }).length, 0);
  } finally {
    x.close();
  }
  const collision = structuredClone(shapes);
  collision.cards.push({
    id: "series-one-code",
    lineId: collision.lines[0].id,
    name: "Unrelated collectible",
  });
  const y = fixture({ catalog: collision });
  try {
    assert.throws(
      () => enableSeriesOne(y.core, y.journal, [collision.products[0].id]),
      { code: "REWARD_CONFLICT" },
    );
    assert.equal(y.core.catalog().version, collision.version);
    assert.equal(y.core.codePools({ role: "admin" }).length, 0);
  } finally {
    y.close();
  }
});
test("multiple sets receive matching code variants and disabled reward identities fail closed", async () => {
  const catalog = structuredClone(shapes);
  catalog.lines.push({ id: "second-set", name: "Second set" });
  for (const card of shapes.cards)
    catalog.cards.push({
      ...structuredClone(card),
      id: "second-" + card.id,
      lineId: "second-set",
    });
  for (const variant of shapes.variants)
    catalog.variants.push({
      ...structuredClone(variant),
      id: "second-" + variant.id,
      cardId: "second-" + variant.cardId,
    });
  const second = structuredClone(shapes.products[0]);
  second.id = "second-pack";
  second.lineId = "second-set";
  for (const slot of second.slots)
    for (const entry of slot.pool)
      entry.variantId = "second-" + entry.variantId;
  catalog.products.push(second);
  for (const together of [false, true]) {
    const x = fixture({ catalog });
    try {
      enableSeriesOne(
        x.core,
        x.journal,
        together ? [shapes.products[0].id, second.id] : [shapes.products[0].id],
      );
      if (!together) enableSeriesOne(x.core, x.journal, [second.id]);
      const live = x.core.catalog();
      assert.equal(live.cards.filter((c) => c.type === "code").length, 2);
      for (const productId of [shapes.products[0].id, second.id]) {
        const product = live.products.find((p) => p.id === productId),
          slot = product.slots.find((s) => s.role === "insert"),
          variant = live.variants.find((v) => v.id === slot.pool[0].variantId);
        assert.equal(
          live.cards.find((c) => c.id === variant.cardId).lineId,
          product.lineId,
        );
        const quote = x.library.quote(x.person, { productId });
        await x.library.buy(x.person, {
          ...quote,
          key: "multi-set-" + productId,
        });
      }
      assert.equal(x.core.codeInventory({ role: "admin" }).total, 2);
      const disabled = x.core.operatorCatalog({ role: "admin" });
      disabled.version++;
      disabled.variants.find(
        (v) => v.id === "series-one-code.standard",
      ).enabled = false;
      x.core.publishCatalog({ role: "admin" }, disabled);
      assert.throws(
        () => enableSeriesOne(x.core, x.journal, [shapes.products[0].id]),
        { code: "REWARD_CONFLICT" },
      );
      assert.equal(x.core.catalog().version, disabled.version);
      assert.equal(x.core.codeInventory({ role: "admin" }).total, 2);
    } finally {
      x.close();
    }
  }
});
test("offline CLI requires explicit stopped-writer confirmation and persists idempotent activation", () => {
  const state = mkdtempSync(join(tmpdir(), "bridge-rewards-")),
    env = {
      ...process.env,
      STATE_DIRECTORY: state,
      ENABLE_SERIES_ONE_REWARDS: "1",
      STATE_KEY: Buffer.alloc(32, 1).toString("base64"),
      CODE_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
      CODE_INDEX_KEY: Buffer.alloc(32, 3).toString("base64"),
    };
  try {
    const core = new CardFramework({
      store: new SQLiteStore(join(state, "framework.sqlite"), {
        encryptionKey: Buffer.alloc(32, 1),
      }),
      codeVault: createCodeVault({
        activeKeyId: "v1",
        keys: { v1: Buffer.alloc(32, 2) },
        indexKey: Buffer.alloc(32, 3),
      }),
    });
    core.publishCatalog({ role: "admin" }, shapes);
    core.close();
    new Journal(join(state, "bridge.sqlite")).close();
    const args = [
      "tools/rewards.mjs",
      "enable-series-one",
      "--products",
      shapes.products[0].id,
    ];
    assert.equal(
      spawnSync(process.execPath, args, { env, encoding: "utf8" }).status,
      2,
    );
    const first = spawnSync(process.execPath, [...args, "--confirm-stopped"], {
      env,
      encoding: "utf8",
    });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(first.stdout).changed, true);
    const replay = spawnSync(process.execPath, [...args, "--confirm-stopped"], {
      env,
      encoding: "utf8",
    });
    assert.equal(replay.status, 0, replay.stderr);
    assert.equal(JSON.parse(replay.stdout).changed, false);
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});
