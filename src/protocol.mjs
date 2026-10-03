import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const mac = (key, value) =>
  createHmac("sha256", key).update(value).digest("hex");
export function equal(a, b) {
  return (
    typeof a === "string" &&
    typeof b === "string" &&
    Buffer.byteLength(a) === Buffer.byteLength(b) &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
export function fail(code, message, status = 400) {
  throw Object.assign(new Error(message), { code, status });
}
export function key(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(value))
    fail("INVALID_KEY", "Use a new request identifier.");
  return value;
}
export function createGameClient({
  url,
  secret,
  timeoutMs = 8000,
  fetchImpl = fetch,
}) {
  const base = new URL(url);
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.pathname !== "/"
  )
    throw Error("Invalid game service URL");
  if (
    base.protocol === "http:" &&
    !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)
  )
    throw Error("Remote game connections require HTTPS");
  if (secret.length < 32)
    throw Error("Game service key must contain at least 32 characters");
  return async (path, input = {}) => {
    const body = JSON.stringify(input),
      timestamp = String(Date.now()),
      nonce = randomBytes(16).toString("hex");
    const signature = mac(
      secret,
      ["POST", path, timestamp, nonce, hash(body)].join("\n"),
    );
    let res;
    try {
      res = await fetchImpl(new URL(path, base), {
        method: "POST",
        body,
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "Content-Type": "application/json",
          "X-Bridge-Time": timestamp,
          "X-Bridge-Nonce": nonce,
          "X-Bridge-Signature": signature,
        },
      });
    } catch {
      fail(
        "GAME_UNAVAILABLE",
        "The game service is temporarily unavailable. Your request can be retried safely.",
        503,
      );
    }
    if (Number(res.headers.get("content-length") ?? 0) > 65536)
      fail("GAME_UNAVAILABLE", "Invalid game response.", 503);
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of res.body) {
        size += chunk.length;
        if (size > 65536)
          fail("GAME_UNAVAILABLE", "Invalid game response.", 503);
        chunks.push(chunk);
      }
    } catch {
      fail("GAME_UNAVAILABLE", "Invalid game response.", 503);
    }
    const encoded = Buffer.concat(chunks).toString("utf8");
    let value;
    try {
      value = JSON.parse(encoded);
    } catch {
      fail("GAME_UNAVAILABLE", "Invalid game response.", 503);
    }
    if (!res.ok)
      fail(
        value.code ?? "GAME_UNAVAILABLE",
        value.message ?? "The game service could not complete this request.",
        res.status,
      );
    return value;
  };
}
export function verifyRequest({
  secret,
  method,
  path,
  headers,
  body,
  nonces,
  now = Date.now(),
}) {
  const time = headers["x-bridge-time"],
    nonce = headers["x-bridge-nonce"],
    sig = headers["x-bridge-signature"];
  if (
    !/^\d{13}$/.test(time ?? "") ||
    Math.abs(now - Number(time)) > 60000 ||
    !/^[a-f0-9]{32}$/.test(nonce ?? "")
  )
    return false;
  const wanted = mac(
    secret,
    [method, path, time, nonce, hash(body)].join("\n"),
  );
  if (!equal(sig, wanted)) return false;
  for (const [n, t] of nonces) if (t < now - 60000) nonces.delete(n);
  if (nonces.has(nonce) || nonces.size >= 10000) return false;
  nonces.set(nonce, now);
  return true;
}
