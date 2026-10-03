import { isDeepStrictEqual } from "node:util";
import { fail, hash } from "./protocol.mjs";
import { validateWebsiteCatalog } from "./administration.mjs";

export const seriesOnePool = {
  id: "v83.series-one",
  providerId: "maplestory.v83",
  name: "Series One code",
  normalization: "upper-trim",
  generator: "series-one",
  instructions:
    "Enter this code in the v83 Cash Shop using the same game account. Each code grants one randomly assigned Series One reward.",
};
const code = {
  id: "game",
  poolId: "v83.series-one",
  reveal: "peel",
  transfer: "block",
  title: "Series One reward",
};
const insert = {
  id: "series-one-insert",
  role: "insert",
  count: 1,
  pool: [{ variantId: "series-one-code.standard", weight: 1 }],
};
export function seriesOneIdentity(lineId, primaryLineId) {
  const cardId =
    lineId === primaryLineId
      ? "series-one-code"
      : "series-one-code-" + hash(lineId).slice(0, 16);
  return { cardId, variantId: cardId + ".standard" };
}

// An offline operation: stop both writers and take a consistent backup first.
export function enableSeriesOne(core, journal, productIds) {
  if (
    !Array.isArray(productIds) ||
    !productIds.length ||
    productIds.length > 1000 ||
    productIds.some(
      (id) =>
        typeof id !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(id),
    ) ||
    new Set(productIds).size !== productIds.length
  )
    fail("INVALID_PRODUCTS", "Select unique published pack IDs.");
  if (journal.pending().length)
    fail(
      "PENDING_PURCHASES",
      "Finish outstanding purchases before enabling rewards.",
      409,
    );
  const actor = { role: "admin" },
    base = core.operatorCatalog(actor),
    candidate = structuredClone(base),
    selected = new Set(productIds);
  for (const id of selected) {
    const product = candidate.products.find((p) => p.id === id);
    if (!product || product.enabled === false)
      fail(
        "INVALID_PRODUCTS",
        "Every selected pack must exist and be enabled.",
      );
    const { cardId, variantId } = seriesOneIdentity(
      product.lineId,
      candidate.lines[0].id,
    );
    const current = product.slots.find((s) => s.id === insert.id);
    if (
      current &&
      (current.count !== 1 ||
        current.role !== "insert" ||
        current.pool.length !== 1 ||
        current.pool[0].variantId !== variantId ||
        current.pool[0].weight !== 1 ||
        (current.probability &&
          current.probability.numerator !== current.probability.denominator))
    )
      fail(
        "REWARD_CONFLICT",
        "A selected pack has a conflicting reward insert.",
        409,
      );
    for (const slot of product.slots.filter((s) => s.id !== insert.id))
      if (
        slot.pool.some(
          (entry) =>
            candidate.variants.find((v) => v.id === entry.variantId)?.codes
              ?.length,
        )
      )
        fail(
          "REWARD_CONFLICT",
          "A selected pack already draws code cards in another slot.",
          409,
        );
    const card = candidate.cards.find((c) => c.id === cardId),
      variant = candidate.variants.find((v) => v.id === variantId);
    if (
      (card || variant) &&
      (!card ||
        !variant ||
        card.type !== "code" ||
        card.lineId !== product.lineId ||
        variant.cardId !== card.id ||
        variant.enabled === false ||
        !isDeepStrictEqual(variant.codes, [code]))
    )
      fail(
        "REWARD_CONFLICT",
        "Reserved reward identities are disabled or have different definitions.",
        409,
      );
    if (!card) {
      candidate.cards.push({
        id: cardId,
        lineId: product.lineId,
        name: "Series One code card",
        type: "code",
        behavior: { tradable: false, albumEligible: true },
      });
      candidate.variants.push({
        id: variantId,
        cardId,
        rarityId: candidate.rarities[0].id,
        codes: [structuredClone(code)],
      });
    }
  }
  let changed = false;
  for (const product of candidate.products) {
    if (
      !selected.has(product.id) ||
      product.slots.some((s) => s.id === insert.id)
    )
      continue;
    const slot = structuredClone(insert);
    slot.pool[0].variantId = seriesOneIdentity(
      product.lineId,
      candidate.lines[0].id,
    ).variantId;
    product.slots.push(slot);
    product.revision++;
    changed = true;
  }
  candidate.version = base.version + (changed ? 1 : 0);
  validateWebsiteCatalog(candidate, candidate, { rewardsEnabled: true });
  // Validate the complete prospective catalog before writing any provider configuration.
  if (changed)
    core.previewImport(actor, {
      source: candidate,
      mode: "replace",
      expectedVersion: base.version,
    });
  const existingPool = core
    .codePools(actor)
    .find((p) => p.id === seriesOnePool.id);
  if (
    existingPool &&
    (existingPool.providerId !== seriesOnePool.providerId ||
      existingPool.generator !== seriesOnePool.generator ||
      existingPool.normalization !== seriesOnePool.normalization ||
      existingPool.enabled === false)
  )
    fail(
      "REWARD_CONFLICT",
      "The existing reward pool has an incompatible or disabled configuration.",
      409,
    );
  core.configureCodePool(actor, {
    key: "series-one-pool-v1",
    pool: seriesOnePool,
  });
  if (changed) core.publishCatalog(actor, candidate);
  return { changed, version: candidate.version, products: productIds };
}
