import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { CardFramework, createCodeVault } from "@digital-card/framework";
import { SQLiteStore } from "@digital-card/framework/sqlite";
import { Journal } from "../src/journal.mjs";
import { generateSeriesOneCode } from "../src/series-one.mjs";
import { enableSeriesOne } from "../src/reward-configuration.mjs";

const args = process.argv.slice(2);
if (
  args.length !== 4 ||
  args[0] !== "enable-series-one" ||
  args[1] !== "--products" ||
  args[3] !== "--confirm-stopped"
) {
  console.error(
    "Usage: node tools/rewards.mjs enable-series-one --products PACK_ID,OTHER_ID --confirm-stopped. Stop both writers and back up the installation first.",
  );
  process.exit(2);
}
let core, journal;
try {
  if (
    process.env.ENABLE_SERIES_ONE_REWARDS !== "1" ||
    !process.env.STATE_DIRECTORY
  )
    throw Error("Missing reward environment");
  const state = resolve(process.env.STATE_DIRECTORY);
  for (const name of ["framework.sqlite", "bridge.sqlite"])
    if (!existsSync(join(state, name))) throw Error("Existing state required");
  const key = (name) => {
    const value = Buffer.from(process.env[name] ?? "", "base64");
    if (value.length !== 32) throw Error("Invalid key");
    return value;
  };
  const store = new SQLiteStore(join(state, "framework.sqlite"), {
    encryptionKey: key("STATE_KEY"),
  });
  core = new CardFramework({
    store,
    codeVault: createCodeVault({
      activeKeyId: "v1",
      keys: { v1: key("CODE_ENCRYPTION_KEY") },
      indexKey: key("CODE_INDEX_KEY"),
    }),
    codeGenerators: { "series-one": generateSeriesOneCode },
  });
  journal = new Journal(join(state, "bridge.sqlite"));
  console.log(
    JSON.stringify(enableSeriesOne(core, journal, args[2].split(","))),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      code: /^[A-Z][A-Z0-9_]{0,80}$/.test(error.code ?? "")
        ? error.code
        : "REWARD_SETUP_FAILED",
      message:
        "Reward setup failed. Check selected pack IDs, outstanding purchases, compatible state and the loaded installation keys. Restore the consistent backup before restarting if configuration changed.",
    }),
  );
  process.exitCode = 1;
} finally {
  journal?.close();
  core?.close();
}
