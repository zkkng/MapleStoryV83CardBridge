import { DatabaseSync } from "node:sqlite";
import { hash, fail } from "./protocol.mjs";
export class Journal {
  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, account_id INTEGER NOT NULL, request_key TEXT NOT NULL, input_hash TEXT NOT NULL, body TEXT NOT NULL, state TEXT NOT NULL, UNIQUE(account_id,request_key)) STRICT; CREATE TABLE IF NOT EXISTS registrations(code_id TEXT PRIMARY KEY, state TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;",
    );
    // Earlier installations stored NX Credit implicitly. Persist that choice before replay.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of this.db.prepare("SELECT id,body FROM orders").all()) {
        const value = JSON.parse(row.body);
        if (Object.hasOwn(value.input, "cashType")) continue;
        value.input.cashType = 1;
        value.quote.cashType = 1;
        if (value.payment) value.payment.cashType = 1;
        this.db
          .prepare("UPDATE orders SET input_hash=?,body=? WHERE id=?")
          .run(
            hash(JSON.stringify(value.input)),
            JSON.stringify(value),
            row.id,
          );
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  create(accountId, requestKey, input, userId, quote) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      let row = this.db
        .prepare("SELECT * FROM orders WHERE account_id=? AND request_key=?")
        .get(accountId, requestKey);
      const digest = hash(JSON.stringify(input));
      if (row && row.input_hash !== digest)
        fail(
          "IDEMPOTENCY_CONFLICT",
          "This request identifier has different purchase details.",
          409,
        );
      if (!row) {
        const id = hash(accountId + ":" + requestKey),
          body = {
            id,
            accountId,
            userId,
            input,
            quote,
            createdAt: new Date().toISOString(),
            result: null,
          };
        this.db
          .prepare("INSERT INTO orders VALUES(?,?,?,?,?,?)")
          .run(
            id,
            accountId,
            requestKey,
            digest,
            JSON.stringify(body),
            "pending",
          );
        row = { body: JSON.stringify(body), state: "pending" };
      }
      this.db.exec("COMMIT");
      return { ...JSON.parse(row.body), state: row.state };
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  save(order, state) {
    this.db
      .prepare("UPDATE orders SET body=?,state=? WHERE id=?")
      .run(JSON.stringify({ ...order, state }), state, order.id);
  }
  pending() {
    return this.db
      .prepare(
        "SELECT body,state FROM orders WHERE state!='complete' AND state!='rejected'",
      )
      .all()
      .map((r) => ({ ...JSON.parse(r.body), state: r.state }));
  }
  find(accountId, requestKey) {
    const row = this.db
      .prepare(
        "SELECT body,state FROM orders WHERE account_id=? AND request_key=?",
      )
      .get(accountId, requestKey);
    return row ? { ...JSON.parse(row.body), state: row.state } : null;
  }
  due(codeId, force = false) {
    const row = this.db
      .prepare("SELECT updated_at FROM registrations WHERE code_id=?")
      .get(codeId);
    return force || !row || Date.now() - Date.parse(row.updated_at) >= 60000;
  }
  checked(codeId) {
    this.db
      .prepare("UPDATE registrations SET updated_at=? WHERE code_id=?")
      .run(new Date().toISOString(), codeId);
  }
  orders(accountId) {
    return this.db
      .prepare(
        "SELECT body,state FROM orders WHERE account_id=? ORDER BY rowid DESC LIMIT 100",
      )
      .all(accountId)
      .map((r) => ({ ...JSON.parse(r.body), state: r.state }));
  }
  registration(codeId) {
    return (
      this.db
        .prepare("SELECT state FROM registrations WHERE code_id=?")
        .get(codeId)?.state ?? "pending"
    );
  }
  register(codeId, state) {
    this.db
      .prepare(
        "INSERT INTO registrations VALUES(?,?,?) ON CONFLICT(code_id) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at",
      )
      .run(codeId, state, new Date().toISOString());
  }
  close() {
    this.db.close();
  }
}
