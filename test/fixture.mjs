import { readFileSync } from "node:fs";
import {
  CardFramework,
  MemoryStore,
  createCodeVault,
} from "@digital-card/framework";
import { Journal } from "../src/journal.mjs";
import { Library, operator } from "../src/library.mjs";
import { generateSeriesOneCode } from "../src/series-one.mjs";
import { fail } from "../src/protocol.mjs";
export const catalog = JSON.parse(
  readFileSync(new URL("./reward-catalog.json", import.meta.url)),
);
export function fixture({
  store = new MemoryStore(),
  journal = new Journal(),
  catalog: inputCatalog = catalog,
  generator = generateSeriesOneCode,
  acceptedCashTypes = [1, 2, 4],
} = {}) {
  const core = new CardFramework({
    store,
    codeVault: createCodeVault({
      activeKeyId: "test",
      keys: { test: Buffer.alloc(32, 1) },
      indexKey: Buffer.alloc(32, 2),
    }),
    codeGenerators: { "series-one": generator },
  });
  if (!store.read((s) => s.catalog))
    core.publishCatalog(operator, inputCatalog);
  if (inputCatalog.variants.some((v) => v.codes?.length))
    core.configureCodePool(operator, {
      key: "pool-test",
      pool: {
        id: "v83.series-one",
        providerId: "maplestory.v83",
        name: "Series One",
        generator: "series-one",
        normalization: "upper-trim",
      },
    });
  const payments = new Map(),
    registrations = new Map(),
    balances = new Map([
      [1, 10000],
      [2, 10000],
    ]);
  const maplePoints = new Map([
      [1, 10000],
      [2, 10000],
    ]),
    nxPrepaid = new Map([
      [1, 10000],
      [2, 10000],
    ]),
    wallets = new Map([
      [1, balances],
      [2, maplePoints],
      [4, nxPrepaid],
    ]);
  const faults = { lostDebit: false, registration: false };
  let debitCount = 0;
  const game = async (path, value) => {
    if (path === "/session") {
      if (value.tokenHash !== "valid")
        fail("UNAUTHENTICATED", "Invalid session", 401);
      return { accountId: 1, name: "Collector" };
    }
    if (path === "/wallet")
      return {
        nx: balances.get(value.accountId),
        acceptedCashTypes,
        balances: [
          {
            cashType: 1,
            name: "NX Credit",
            amount: balances.get(value.accountId),
          },
          {
            cashType: 2,
            name: "Maple Points",
            amount: maplePoints.get(value.accountId),
          },
          {
            cashType: 4,
            name: "NX Prepaid",
            amount: nxPrepaid.get(value.accountId),
          },
        ],
      };
    if (path === "/debit") {
      if (payments.has(value.orderId)) {
        const old = payments.get(value.orderId);
        if (
          old.cashType !== value.cashType ||
          old.amount !== value.amount ||
          old.accountId !== value.accountId
        )
          fail("CONFLICT", "Changed debit");
        return old;
      }
      if (!acceptedCashTypes.includes(value.cashType))
        fail("UNSUPPORTED_CASH_TYPE", "Unsupported cash type");
      const balance = wallets.get(value.cashType);
      if (balance.get(value.accountId) < value.amount)
        fail("INSUFFICIENT_FUNDS", "Insufficient NX", 409);
      balance.set(value.accountId, balance.get(value.accountId) - value.amount);
      debitCount++;
      const receipt = { ...value, balance: balance.get(value.accountId) };
      payments.set(value.orderId, receipt);
      if (faults.lostDebit) {
        faults.lostDebit = false;
        fail("GAME_UNAVAILABLE", "Payment response lost", 503);
      }
      return receipt;
    }
    if (path === "/codes/register") {
      if (faults.registration)
        fail("GAME_UNAVAILABLE", "Registration unavailable", 503);
      const old = registrations.get(value.issuanceId);
      if (old && JSON.stringify(old.material) !== JSON.stringify(value))
        fail("CONFLICT", "Registration conflict", 409);
      if (!old)
        registrations.set(value.issuanceId, {
          material: value,
          status: "READY",
        });
      return { issuanceId: value.issuanceId, status: "READY" };
    }
    if (path === "/codes/status")
      return {
        issuanceId: value.issuanceId,
        ...registrations.get(value.issuanceId),
      };
    throw Error("Unknown method");
  };
  const library = new Library({
      framework: core,
      store,
      journal,
      game,
      acceptedCashTypes,
    }),
    person = { accountId: 1, name: "Collector" },
    other = { accountId: 2, name: "OtherCollector" };
  const buy = (key = "purchase-test", quantity = 1, p = person, cashType = 1) =>
    library.buy(p, {
      key,
      ...library.quote(p, { productId: "first-light", quantity, cashType }),
    });
  return {
    store,
    core,
    journal,
    library,
    person,
    other,
    buy,
    game,
    payments,
    registrations,
    balances,
    maplePoints,
    nxPrepaid,
    faults,
    get debitCount() {
      return debitCount;
    },
    close() {
      journal.close();
      core.close();
    },
  };
}
