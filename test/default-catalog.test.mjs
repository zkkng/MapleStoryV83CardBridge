import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fixture } from "./fixture.mjs";
const catalog = JSON.parse(
  readFileSync(
    new URL("../data/catalog.example.json", import.meta.url),
    "utf8",
  ),
);
test("default Shapes purchase mints only collectibles and never registers a reward", async (t) => {
  const x = fixture({ catalog });
  t.after(() => x.close());
  const result = await x.library.buy(x.person, {
    key: "default-shapes-purchase",
    ...x.library.quote(x.person, {
      productId: "shapes",
      quantity: 1,
      cashType: 2,
    }),
  });
  const opened = x.library.open(x.person, {
    key: "default-shapes-opening",
    packId: result.packs[0].id,
  });
  assert.equal(opened.cards.length, 8);
  assert(opened.cards.every((c) => c.definition.type === "collectible"));
  assert.equal((await x.library.state(x.person)).codes.length, 0);
  assert.equal(x.registrations.size, 0);
  assert.equal(x.maplePoints.get(1), 9000);
  assert.equal(x.balances.get(1), 10000);
});
