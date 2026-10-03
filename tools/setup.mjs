import { randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
const args = process.argv.slice(2),
  option = (name, fallback) => {
    const i = args.indexOf(name);
    return i < 0 ? fallback : args[i + 1];
  };
const origin = option("--origin", "http://127.0.0.1:8487"),
  game = option("--game-url", "http://127.0.0.1:8486");
if (new URL(origin).origin !== origin)
  throw Error("Use an origin without a path or trailing slash.");
const mode = option("--auth-mode", "bridge");
if (!["bridge", "grove"].includes(mode))
  throw Error("Choose bridge or grove authentication.");
const directory = resolve(option("--output-directory", "."));
mkdirSync(directory, { recursive: true, mode: 0o700 });
const nodePath = resolve(directory, ".env"),
  gamePath = resolve(directory, "game.env");
if (existsSync(nodePath) || existsSync(gamePath))
  throw Error(
    "Private configuration already exists; neither file was changed.",
  );
const random = () => randomBytes(32).toString("base64"),
  shared = random();
const nodeEnv =
  [
    "PUBLIC_ORIGIN=" + origin,
    "GAME_URL=" + game,
    "GAME_SHARED_KEY=" + shared,
    "STATE_KEY=" + random(),
    "CODE_ENCRYPTION_KEY=" + random(),
    "CODE_INDEX_KEY=" + random(),
    "CSRF_KEY=" + random(),
    "STATE_DIRECTORY=./state",
    "CATALOG_PATH=./data/catalog.example.json",
    "AUTH_MODE=" + mode,
    "PORT=8487",
    "ACCEPTED_CASH_TYPES=1,2,4",
    "ENABLE_SERIES_ONE_REWARDS=0",
    "# Optional imported card scans are served from ASSET_ROOT.",
    "# Set TRUST_PROXY=1 only behind a proxy that replaces X-Real-IP.",
  ].join("\n") + "\n";
const gameEnv =
  [
    "CARD_BRIDGE_ENABLED=1",
    "CARD_BRIDGE_PORT=8486",
    "CARD_BRIDGE_SHARED_KEY=" + shared,
    "CARD_BRIDGE_CODE_KEY=" + random(),
    "CARD_BRIDGE_CALLBACK_URL=http://127.0.0.1:8487/api/library/provider/used",
    "CARD_BRIDGE_SESSION_SOURCE=" + mode,
    "CARD_BRIDGE_ACCEPTED_CASH_TYPES=1,2,4",
  ].join("\n") + "\n";
writeFileSync(nodePath, nodeEnv, { flag: "wx", mode: 0o600 });
try {
  writeFileSync(gamePath, gameEnv, { flag: "wx", mode: 0o600 });
} catch (error) {
  unlinkSync(nodePath);
  throw error;
}
console.log(
  "Created private .env and game.env files. Existing files are never overwritten. Load game.env into the Cosmic process environment before starting the adapter.",
);
