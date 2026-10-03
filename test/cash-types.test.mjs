import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixture.mjs";
import { Journal } from "../src/journal.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("each cash type funds the same pack price from only its selected balance", async () => {
  const x = fixture();
  try {
    for (const type of [1, 2, 4])
      await x.buy("payment-" + type, 1, x.person, type);
    assert.equal(x.balances.get(1), 9000);
    assert.equal(x.maplePoints.get(1), 9000);
    assert.equal(x.nxPrepaid.get(1), 9000);
    assert.equal(x.core.packs(x.library.actor(x.person)).length, 3);
    assert.deepEqual(
      [...x.payments.values()].map((p) => p.cashType),
      [1, 2, 4],
    );
  } finally {
    x.close();
  }
});
test("an insufficient selected balance never spends another type and retries cannot change the source", async () => {
  const x = fixture();
  try {
    x.maplePoints.set(1, 0);
    await assert.rejects(
      x.buy("empty-points", 1, x.person, 2),
      (e) => e.code === "INSUFFICIENT_FUNDS",
    );
    assert.equal(x.balances.get(1), 10000);
    assert.equal(x.nxPrepaid.get(1), 10000);
    await x.buy("credit-purchase", 1, x.person, 1);
    await assert.rejects(
      x.buy("credit-purchase", 1, x.person, 4),
      (e) => e.code === "IDEMPOTENCY_CONFLICT",
    );
    assert.equal(x.nxPrepaid.get(1), 10000);
  } finally {
    x.close();
  }
});
test("operator policy rejects unsupported types and exposes accepted balances", async () => {
  const x = fixture({ acceptedCashTypes: [2] });
  try {
    assert.throws(
      () =>
        x.library.quote(x.person, { productId: "first-light", cashType: 1 }),
      (e) => e.code === "UNSUPPORTED_CASH_TYPE",
    );
    assert.deepEqual(
      (await x.library.state(x.person)).wallet.acceptedCashTypes,
      [2],
    );
    await x.buy("points-only", 1, x.person, 2);
    assert.equal(x.balances.get(1), 10000);
  } finally {
    x.close();
  }
});
test("response loss preserves the source and blocks a replacement debit until recovery", async () => {
  const x = fixture();
  try {
    x.faults.lostDebit = true;
    await assert.rejects(
      x.buy("lost-prepaid", 1, x.person, 4),
      (e) => e.code === "GAME_UNAVAILABLE",
    );
    await assert.rejects(
      x.buy("replacement-credit", 1, x.person, 1),
      (e) => e.code === "PURCHASE_PENDING",
    );
    await x.library.recover();
    assert.equal(x.debitCount, 1);
    assert.equal(x.nxPrepaid.get(1), 9000);
    assert.equal(x.balances.get(1), 10000);
    assert.equal(x.journal.find(1, "lost-prepaid").payment.cashType, 4);
  } finally {
    x.close();
  }
});
test("earlier implicit NX Credit orders migrate their original source before replay", () => {
  const dir = mkdtempSync(join(tmpdir(), "bridge-migration-"));
  try {
    const file = join(dir, "journal.sqlite");
    let journal = new Journal(file);
    const input = {
        productId: "first-light",
        quantity: 1,
        catalogVersion: 1,
        productRevision: 1,
      },
      quote = { price: { amount: 1000, currencyId: "nx" } };
    const order = journal.create(1, "legacy-purchase", input, "example", quote);
    journal.save({ ...order, payment: { amount: 1000 } }, "paid");
    journal.close();
    journal = new Journal(file);
    const restored = journal.find(1, "legacy-purchase");
    assert.equal(restored.input.cashType, 1);
    assert.equal(restored.quote.cashType, 1);
    assert.equal(restored.payment.cashType, 1);
    assert.equal(
      journal.create(
        1,
        "legacy-purchase",
        { ...input, cashType: 1 },
        "example",
        quote,
      ).id,
      order.id,
    );
    assert.throws(
      () =>
        journal.create(
          1,
          "legacy-purchase",
          { ...input, cashType: 4 },
          "example",
          quote,
        ),
      (e) => e.code === "IDEMPOTENCY_CONFLICT",
    );
    journal.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
