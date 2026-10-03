import { key, fail } from "./protocol.mjs";
import { cashTypes } from "./cash-types.mjs";
export const operator = { role: "admin" };
export class Library {
  #locks = new Map();
  constructor({
    framework,
    store,
    journal,
    game,
    acceptedCashTypes = [1, 2, 4],
  }) {
    this.core = framework;
    this.store = store;
    this.journal = journal;
    this.game = game;
    this.acceptedCashTypes = acceptedCashTypes;
  }
  actor(person) {
    if (
      !Number.isSafeInteger(person?.accountId) ||
      person.accountId < 1 ||
      typeof person.name !== "string"
    )
      fail("UNAUTHENTICATED", "Please sign in to your game account.", 401);
    return {
      userId: this.core.registerUser(operator, {
        provider: "maplestory.v83",
        subject: String(person.accountId),
        displayName: person.name,
      }).id,
    };
  }
  async state(person) {
    const actor = this.actor(person),
      wallet = await this.game("/wallet", { accountId: person.accountId });
    const codePage = this.codePage(person),
      codes = codePage.items;
    wallet.acceptedCashTypes = (wallet.acceptedCashTypes ?? [1, 2, 4]).filter(
      (t) => this.acceptedCashTypes.includes(t),
    );
    return {
      owner: person.name,
      wallet,
      packs: this.core.packs(actor).filter((pack) => !pack.openedAt),
      inventory: this.core.inventory(actor),
      codes,
      albums: this.core.albums(actor),
      codeNext: codePage.next,
      codeTotal: codePage.total,
      orders: this.journal.orders(person.accountId).map((o) => ({
        id: o.id,
        state: o.state,
        result: o.result,
        createdAt: o.createdAt,
      })),
    };
  }
  codePage(person, { after = "", limit = 50 } = {}) {
    const page = this.core.codeHistory(this.actor(person), { after, limit });
    return {
      ...page,
      items: page.items.map((c) => ({
        ...c,
        registration: this.journal.registration(c.id),
      })),
    };
  }
  quote(person, input) {
    const actor = this.actor(person),
      cashType = input.cashType ?? 1;
    if (!this.acceptedCashTypes.includes(cashType))
      fail("UNSUPPORTED_CASH_TYPE", "Choose an accepted cash balance.");
    return {
      ...this.core.quote(actor, {
        productId: input.productId,
        quantity: input.quantity ?? 1,
      }),
      cashType,
    };
  }
  async buy(person, input) {
    key(input.key);
    const clean = {
      productId: input.productId,
      quantity: input.quantity ?? 1,
      catalogVersion: input.catalogVersion,
      productRevision: input.productRevision,
      cashType: input.cashType ?? 1,
    };
    const actor = this.actor(person),
      existing = this.journal.find(person.accountId, input.key);
    if (existing) {
      const restored = this.journal.create(
        person.accountId,
        input.key,
        clean,
        actor.userId,
        existing.quote,
      );
      return this.#exclusive(restored.id, () => this.#resume(restored));
    }
    if (this.journal.pending().some((o) => o.accountId === person.accountId))
      fail(
        "PURCHASE_PENDING",
        "Your previous purchase is still being completed. Please check the saved purchase shortly.",
        409,
      );
    const quote = this.quote(person, clean);
    if (quote.price.amount < 1 || quote.price.currencyId !== "nx")
      fail(
        "INVALID_PRODUCT",
        "This installation purchases packs with a selected game cash balance.",
        409,
      );
    if (
      quote.catalogVersion !== clean.catalogVersion ||
      quote.productRevision !== clean.productRevision
    )
      fail(
        "STALE_QUOTE",
        "The pack changed. Please review the current price.",
        409,
      );
    const order = this.journal.create(
      person.accountId,
      input.key,
      clean,
      actor.userId,
      quote,
    );
    return this.#exclusive(order.id, () => this.#resume(order));
  }
  async #exclusive(id, work) {
    if (this.#locks.has(id)) return this.#locks.get(id);
    const pending = work();
    this.#locks.set(id, pending);
    try {
      return await pending;
    } finally {
      this.#locks.delete(id);
    }
  }
  async #resume(order, { shouldStop = () => false } = {}) {
    if (order.state === "complete") return order.result;
    if (order.state === "rejected")
      fail(
        "PURCHASE_REJECTED",
        "This purchase was declined. Review your balance and try a new purchase.",
        409,
      );
    if (order.state === "pending") {
      try {
        const paid = await this.game("/debit", {
          orderId: order.id,
          accountId: order.accountId,
          amount: order.quote.price.amount,
          cashType: order.input.cashType ?? 1,
        });
        if (
          paid.orderId !== order.id ||
          paid.amount !== order.quote.price.amount ||
          paid.accountId !== order.accountId ||
          paid.cashType !== (order.input.cashType ?? 1)
        )
          fail("GAME_UNAVAILABLE", "Invalid payment receipt.", 503);
        order.payment = paid;
        this.journal.save(order, "paid");
        order.state = "paid";
      } catch (e) {
        if (
          e.code === "INSUFFICIENT_FUNDS" ||
          e.code === "ACCOUNT_UNAVAILABLE"
        ) {
          this.journal.save(order, "rejected");
        }
        throw e;
      }
    }
    // Retried settlement and purchase share durable identities; neither can mint twice.
    this.core.settleExternalCredit(operator, {
      providerId: "maplestory.v83",
      transactionId: order.id,
      userId: order.userId,
      currencyId: "nx",
      amount: order.quote.price.amount,
      externalCurrency: cashTypes.find(
        (c) => c.cashType === (order.input.cashType ?? 1),
      ).externalCurrency,
      externalUnits: String(order.quote.price.amount),
    });
    order.result = this.core.purchase(
      { userId: order.userId },
      { key: "purchase-" + order.id, ...order.input },
    );
    this.journal.save(order, "complete");
    await this.reconcile({ accountId: order.accountId, shouldStop });
    return order.result;
  }
  async recover({ shouldStop = () => false } = {}) {
    for (const order of this.journal.pending()) {
      if (shouldStop()) return;
      try {
        await this.#exclusive(order.id, () =>
          this.#resume(order, { shouldStop }),
        );
      } catch (error) {
        if (error.code === "GAME_UNAVAILABLE") return;
        /* Durable order remains available for the next recovery pass. */
      }
    }
  }
  async reconcile({
    accountId: scope,
    force = false,
    shouldStop = () => false,
  } = {}) {
    let after = "";
    do {
      const page = this.core.codeInventory(operator, { limit: 200, after });
      after = page.next;
      for (const row of page.items) {
        if (shouldStop()) return;
        if (
          !row.holderId ||
          !row.copyId ||
          ["redeemed", "revoked"].includes(row.status)
        )
          continue;
        const accountId = this.store.read((s) =>
          Number(s.users[row.holderId]?.subject),
        );
        if (
          !Number.isSafeInteger(accountId) ||
          accountId < 1 ||
          (scope && scope !== accountId)
        )
          continue;
        try {
          if (this.journal.registration(row.id) !== "ready") {
            const material = this.core.codeRegistrationMaterial(
              operator,
              row.id,
            );
            const result = await this.game("/codes/register", {
              issuanceId: row.id,
              accountId,
              code: material.code,
              itemId: material.metadata.itemId,
              quantity: material.metadata.quantity,
              petDays: material.metadata.petDays,
              series: 1,
            });
            if (result.issuanceId !== row.id)
              fail("GAME_UNAVAILABLE", "Invalid registration receipt.", 503);
            this.journal.register(row.id, "ready");
          }
          if (!row.revealedAt || !this.journal.due(row.id, force)) continue;
          const state = await this.game("/codes/status", {
            issuanceId: row.id,
          });
          this.journal.checked(row.id);
          if (state.status === "USED")
            this.used({
              issuanceId: row.id,
              receiptId: state.receiptId,
              occurredAt: state.usedAt,
            });
        } catch (error) {
          if (error.code === "GAME_UNAVAILABLE") return;
          /* Registration and status are retried without exposing plaintext codes. */
        }
      }
    } while (after);
  }
  used({ issuanceId, receiptId, occurredAt }) {
    if (
      typeof receiptId !== "string" ||
      !/^[a-zA-Z0-9-]{16,100}$/.test(receiptId)
    )
      fail("INVALID_RECEIPT", "Invalid reward receipt.");
    return this.core.confirmCodeStatus(operator, {
      providerId: "maplestory.v83",
      codeId: issuanceId,
      eventId: receiptId,
      status: "redeemed",
      occurredAt,
    });
  }
  open(person, input) {
    key(input.key);
    return this.core.openPack(this.actor(person), {
      key: input.key,
      packId: input.packId,
    });
  }
  reveal(person, input) {
    key(input.key);
    const actor = this.actor(person);
    if (this.journal.registration(input.codeId) !== "ready")
      fail(
        "CODE_PREPARING",
        "The server is registering this code with the Cash Shop. Please try shortly.",
        409,
      );
    return this.core.revealCode(actor, {
      key: input.key,
      codeId: input.codeId,
    });
  }
  album(person, input) {
    key(input.key);
    return this.core.saveAlbum(this.actor(person), {
      key: input.key,
      albumId: input.albumId,
      name: input.name,
      visibility: "private",
      placements: input.placements,
      expectedVersion: input.expectedVersion,
    });
  }
}
