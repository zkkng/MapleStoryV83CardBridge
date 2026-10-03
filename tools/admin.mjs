import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { Journal } from "../src/journal.mjs";
import { createGameClient } from "../src/protocol.mjs";
const [command, name, ...extra] = process.argv.slice(2);
const revokeId =
  command === "revoke" &&
  name === "--account-id" &&
  extra.length === 1 &&
  /^[1-9]\d{0,9}$/.test(extra[0])
    ? Number(extra[0])
    : null;
if (
  !["grant", "revoke", "list"].includes(command) ||
  (!revokeId &&
    (extra.length ||
      (command === "list"
        ? name !== undefined
        : !/^[A-Za-z0-9]{3,13}$/.test(name ?? ""))))
) {
  console.error(
    "Usage: node tools/admin.mjs grant|revoke ACCOUNT_NAME, list, or revoke --account-id ID. Load the installation environment first.",
  );
  process.exit(2);
}
let journal;
try {
  for (const key of revokeId
    ? ["STATE_DIRECTORY"]
    : ["STATE_DIRECTORY", "GAME_URL", "GAME_SHARED_KEY"])
    if (!process.env[key]) throw Error(`Missing ${key}`);
  const path = join(resolve(process.env.STATE_DIRECTORY), "bridge.sqlite");
  if (!existsSync(path)) throw Error("Bridge state does not exist");
  journal = new Journal(path);
  if (revokeId) {
    const old = journal.grants().find((g) => g.accountId === revokeId);
    console.log(
      JSON.stringify(
        journal.grant(
          { accountId: revokeId, name: old?.name ?? "Unavailable account" },
          false,
        ),
      ),
    );
  } else {
    const game = createGameClient({
      url: process.env.GAME_URL,
      secret: process.env.GAME_SHARED_KEY,
    });
    if (command === "list") {
      const items = [];
      for (const grant of journal.grants()) {
        try {
          const person = await game("/resolve-account", {
            accountId: grant.accountId,
          });
          items.push({
            ...grant,
            name: person.name,
            role: "administrator",
            available: true,
          });
        } catch (error) {
          if (error.code !== "ACCOUNT_UNAVAILABLE") throw error;
          items.push({ ...grant, role: "administrator", available: false });
        }
      }
      console.log(JSON.stringify({ items }));
    } else {
      const person = await game("/resolve-account", { name });
      if (
        !Number.isSafeInteger(person.accountId) ||
        person.accountId < 1 ||
        typeof person.name !== "string"
      )
        throw Error("Invalid account response");
      console.log(JSON.stringify(journal.grant(person, command === "grant")));
    }
  }
} catch (error) {
  console.error(
    error.status
      ? error.message
      : "Administrator operation failed. Check the installation environment and game readiness.",
  );
  process.exitCode = 1;
} finally {
  journal?.close();
}
