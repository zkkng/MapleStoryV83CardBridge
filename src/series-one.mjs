import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
export const seriesOne = JSON.parse(
  readFileSync(new URL("../data/series-one.json", import.meta.url), "utf8"),
);
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function generateSeriesOneCode({ copy }, draw = randomInt) {
  const reward = seriesOne.rewards[draw(seriesOne.rewards.length)];
  const tail = Array.from(
    { length: 15 },
    () => alphabet[draw(alphabet.length)],
  ).join("");
  return {
    code: (reward.prefix ?? "") + tail,
    externalId: randomUUID(),
    metadata: {
      series: 1,
      rewardId: reward.id,
      itemId: reward.itemId,
      quantity: reward.quantity,
      petDays: reward.petDays ?? 0,
      purchaseId: copy.source.purchaseId,
      codePattern: reward.prefix ?? "standard",
    },
  };
}
export function normalizeCode(code) {
  if (typeof code !== "string" || code.length > 40)
    throw new Error("Invalid code");
  const value = code.replace(/[ -]/g, "").toUpperCase();
  if (!/^(?:[A-Z2-9]{15}|C0[123][A-Z2-9]{15})$/.test(value))
    throw new Error("Invalid code");
  return value;
}
