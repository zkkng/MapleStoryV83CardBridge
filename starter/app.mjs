const $ = (id) => document.getElementById(id);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const num = (v) => Number(v).toLocaleString();
const empty = (title, text) =>
  `<div class="empty"><strong>${esc(title)}</strong>${esc(text)}</div>`;
let session = { signedIn: false },
  catalog,
  state,
  generation = 0,
  busy = false,
  opening = new Set(),
  collectionLimit = 60,
  confirmedInput = null;
const message = (text, error = false) => {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
};
async function api(route, value) {
  const res = await fetch("/api/library/" + route, {
    credentials: "same-origin",
    method: value === undefined ? "GET" : "POST",
    signal: AbortSignal.timeout(18000),
    headers:
      value === undefined
        ? {}
        : {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrf ?? "",
          },
    body: value === undefined ? undefined : JSON.stringify(value),
  });
  const data = await res.json();
  if (!res.ok)
    throw Object.assign(Error(data.error ?? "Please try again."), {
      code: data.code,
    });
  return data;
}
const intentKey = () => "cosmic-pack:" + session.username;
function intent() {
  try {
    return JSON.parse(sessionStorage.getItem(intentKey()) ?? "null");
  } catch {
    return null;
  }
}
function saveIntent(value) {
  try {
    value
      ? sessionStorage.setItem(intentKey(), JSON.stringify(value))
      : sessionStorage.removeItem(intentKey());
  } catch {
    throw Error(
      "Your browser cannot save purchase recovery. Enable session storage before buying.",
    );
  }
}
const rarity = (id) => catalog?.rarities.find((r) => r.id === id)?.name ?? id;
const setName = (id) => catalog?.lines.find((l) => l.id === id)?.name ?? id;
function art(card) {
  const path = card.definition.metadata?.image;
  return typeof path === "string" &&
    /^\/assets\/library\/[a-zA-Z0-9_./-]+\.(png|jpg|jpeg|webp)$/.test(path)
    ? `<img src="${esc(path)}" alt="${esc(card.definition.name)}" loading="lazy">`
    : `<span aria-hidden="true">${esc(card.definition.metadata?.symbol ?? "◇")}</span>`;
}
function cardMarkup(card, copies = 0, interactive = true) {
  const tag = interactive ? "button" : "article";
  return `<${tag} class="card rarity-${esc(card.rarityId)}" ${interactive ? `data-card="${esc(card.id)}"` : ""}><div class="card-art">${art(card)}</div><strong>${esc(card.definition.name)}</strong><small>${esc(rarity(card.rarityId))}${card.definition.type === "code" ? " · Code card" : ""}</small>${copies ? `<span class="copies">×${copies}</span>` : ""}</${tag}>`;
}
function detail(id) {
  const card = state?.inventory.find((c) => c.id === id);
  if (!card) return;
  const owned = state.inventory.filter(
    (c) => c.variantId === card.variantId,
  ).length;
  $("detail-content").innerHTML =
    `<p class="eyebrow">${esc(setName(card.definition.lineId))}</p><h2>${esc(card.definition.name)}</h2><div class="card-art">${art(card)}</div><dl><dt>Rarity</dt><dd>${esc(rarity(card.rarityId))}</dd><dt>Copies owned</dt><dd>${owned}</dd></dl>${card.definition.metadata?.description ? `<p>${esc(card.definition.metadata.description)}</p>` : ""}`;
  $("detail").showModal();
}
function collection() {
  const cards =
    state?.inventory.filter((c) => c.definition.type !== "code") ?? [];
  const grouped = new Map();
  for (const c of cards) {
    const k = c.variantId;
    const row = grouped.get(k);
    row ? row.count++ : grouped.set(k, { card: c, count: 1 });
  }
  const search = $("search").value.trim().toLocaleLowerCase();
  let rows = [...grouped.values()].filter(
    ({ card: c }) =>
      c.definition.name.toLocaleLowerCase().includes(search) &&
      (!$("line-filter").value ||
        c.definition.lineId === $("line-filter").value) &&
      (!$("rarity-filter").value || c.rarityId === $("rarity-filter").value),
  );
  rows.sort(
    (a, b) =>
      ($("sort").value === "quantity"
        ? b.count - a.count
        : $("sort").value === "rarity"
          ? (catalog.rarities.find((r) => r.id === b.card.rarityId)?.rank ??
              0) -
            (catalog.rarities.find((r) => r.id === a.card.rarityId)?.rank ?? 0)
          : 0) || a.card.definition.name.localeCompare(b.card.definition.name),
  );
  $("card-count").textContent = num(cards.length);
  $("collection-summary").textContent = cards.length
    ? `${num(grouped.size)} unique cards · ${num(cards.length)} total`
    : "";
  $("collection").innerHTML = rows.length
    ? `<div class="card-grid">${rows
        .slice(0, collectionLimit)
        .map((r) => cardMarkup(r.card, r.count))
        .join("")}</div>`
    : empty(
        session.signedIn
          ? cards.length
            ? "No matching cards"
            : "Your collection starts here"
          : "A collection of your own",
        session.signedIn
          ? cards.length
            ? "Try a different search or filter."
            : "Open your first pack to add cards."
          : "Sign in to see your cards.",
      );
  $("more-cards").hidden = rows.length <= collectionLimit;
  $("collection")
    .querySelectorAll("[data-card]")
    .forEach((b) => (b.onclick = () => detail(b.dataset.card)));
}
function codes() {
  const rows =
    state?.codes.filter(
      (c) =>
        $("code-filter").value === "all" ||
        ($("code-filter").value === "ready"
          ? !["redeemed", "revoked"].includes(c.status)
          : c.status === "redeemed"),
    ) ?? [];
  $("codes").innerHTML = rows.length
    ? rows
        .map(
          (c) =>
            `<article class="code"><div class="code-heading"><strong>${esc(c.name)}</strong><span class="badge ${c.status === "redeemed" ? "used" : ""}">${c.status === "redeemed" ? "USED" : c.status === "revoked" ? "REVOKED" : c.registration === "ready" ? "READY" : "PREPARING"}</span></div><p>Added ${esc(new Date(c.createdAt).toLocaleDateString())}</p>${["redeemed", "revoked"].includes(c.status) ? "<p>This code is no longer available to redeem.</p>" : `<button data-code="${esc(c.id)}" ${c.registration !== "ready" ? "disabled" : ""}>Reveal code</button><div class="secret"></div>`}</article>`,
        )
        .join("")
    : empty(
        "No reward codes here",
        state?.codes.length
          ? "No codes match this filter."
          : "This server can offer collectible packs without rewards. Any enabled reward codes will appear after you open their packs.",
      );
  $("more-codes").hidden = !state?.codeNext;
  $("codes")
    .querySelectorAll("[data-code]")
    .forEach(
      (button) =>
        (button.onclick = async () => {
          const version = generation;
          button.disabled = true;
          try {
            const value = await api("reveal", {
              key: crypto.randomUUID(),
              codeId: button.dataset.code,
            });
            if (version !== generation) return;
            const secret = button.parentElement.querySelector(".secret");
            secret.replaceChildren();
            const text = document.createElement("div");
            text.className = "code-text";
            text.textContent = value.code;
            const copy = document.createElement("button");
            copy.className = "quiet";
            copy.textContent = "Copy code";
            copy.onclick = async () => {
              try {
                await navigator.clipboard.writeText(value.code);
                message("Code copied. Redeem it in the in-game Cash Shop.");
              } catch {
                message("Select the code text and copy it manually.", true);
              }
            };
            secret.append(text, copy);
            button.hidden = true;
          } catch (e) {
            if (version === generation) {
              message(e.message, true);
              button.disabled = false;
            }
          }
        }),
    );
}
function total() {
  const product = catalog?.products.find((p) => p.id === $("product").value),
    quantity = Number($("quantity").value),
    type = Number($("cash-type").value),
    balance = state?.wallet.balances.find((b) => b.cashType === type);
  $("quantity").max = product?.maxQuantity ?? 1;
  const valid =
    product &&
    Number.isSafeInteger(quantity) &&
    quantity >= 1 &&
    quantity <= product.maxQuantity;
  const amount = valid ? product.price.amount * quantity : 0;
  $("total").textContent = valid
    ? `${num(amount)} ${$("cash-type").selectedOptions[0]?.textContent ?? "points"}`
    : "Choose a valid quantity";
  const pending =
    state?.orders.some((o) => !["complete", "rejected"].includes(o.state)) ||
    !!intent();
  $("pending").hidden = !session.signedIn || !pending;
  $("purchase").disabled =
    busy ||
    !session.signedIn ||
    !valid ||
    !balance ||
    amount > balance.amount ||
    pending;
  $("purchase-note").textContent = !session.signedIn
    ? "Sign in to buy packs."
    : pending
      ? "Finish your saved purchase first."
      : !valid
        ? `Choose 1–${product?.maxQuantity ?? 1} packs.`
        : !balance
          ? "Choose an accepted balance."
          : amount > balance.amount
            ? "Not enough funds in this balance."
            : "";
}
function render() {
  $("account").hidden = session.signedIn;
  $("signed-in").hidden = !session.signedIn;
  $("signin-link").hidden = session.signedIn;
  $("welcome").textContent = session.signedIn ? session.username : "";
  const selected = $("product").value,
    selectedType = $("cash-type").value;
  $("product").innerHTML = catalog.products
    .map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`)
    .join("");
  if (catalog.products.some((p) => p.id === selected))
    $("product").value = selected;
  const accepted = state?.wallet.acceptedCashTypes ?? catalog.acceptedCashTypes;
  const balances = state?.wallet.balances ?? [
    { cashType: 1, name: "NX Credit" },
    { cashType: 2, name: "Maple Points" },
    { cashType: 4, name: "NX Prepaid" },
  ];
  $("cash-type").innerHTML = balances
    .filter((b) => accepted.includes(b.cashType))
    .map((b) => `<option value="${b.cashType}">${esc(b.name)}</option>`)
    .join("");
  if (accepted.includes(Number(selectedType)))
    $("cash-type").value = selectedType;
  $("wallet").innerHTML = session.signedIn
    ? balances
        .filter((b) => accepted.includes(b.cashType))
        .map(
          (b) =>
            `<div class="balance">${esc(b.name)}<strong>${num(b.amount)}</strong></div>`,
        )
        .join("")
    : empty(
        "Your game balances, in one place",
        "Sign in to see NX Credit, Maple Points, and NX Prepaid.",
      );
  $("products").innerHTML = catalog.products.length
    ? catalog.products
        .map(
          (p) =>
            `<article class="product"><div class="product-mark" aria-hidden="true">◇</div><h3>${esc(p.name)}</h3><p>${p.slots.reduce((n, s) => n + s.count, 0)} cards per pack · ${num(p.price.amount)} points</p><small>${esc(setName(p.lineId))} · Random cards, duplicates possible</small><div><button class="quiet" data-product="${esc(p.id)}">Choose this pack</button><button class="quiet" data-contents="${esc(p.id)}">View contents</button></div></article>`,
        )
        .join("")
    : empty("No packs available", "Check back when your server adds a pack.");
  $("products")
    .querySelectorAll("[data-product]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          $("product").value = b.dataset.product;
          $("quantity").value = 1;
          total();
          $("product").focus();
        }),
    );
  $("products")
    .querySelectorAll("[data-contents]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          const p = catalog.products.find((p) => p.id === b.dataset.contents);
          $("detail-content").innerHTML =
            `<h2>${esc(p.name)}</h2><p>Each slot draws independently. Duplicates are possible.</p>` +
            p.slots
              .map(
                (s) =>
                  `<h3>${s.count} ${s.role === "insert" ? "insert" : "card"}${s.count === 1 ? "" : "s"}</h3><ul>` +
                  s.pool
                    .map((v) => {
                      const variant = catalog.variants.find(
                          (x) => x.id === v.variantId,
                        ),
                        c = catalog.cards.find((x) => x.id === variant?.cardId),
                        weight = s.pool.reduce((n, r) => n + r.weight, 0);
                      return `<li>${esc(c?.name)} · ${esc(rarity(variant?.rarityId))} · ${Number(((v.weight / weight) * 100).toFixed(2))}% per draw</li>`;
                    })
                    .join("") +
                  "</ul>",
              )
              .join("");
          $("detail").showModal();
        }),
    );
  const packs = state?.packs.filter((p) => !p.openedAt) ?? [];
  $("pack-count").textContent = num(packs.length);
  $("packs").innerHTML = packs.length
    ? packs
        .map(
          (p) =>
            `<button class="pack" data-pack="${esc(p.id)}" ${opening.has(p.id) ? "disabled" : ""}><strong>${esc(catalog.products.find((v) => v.id === p.productId)?.name ?? "Pack")}</strong><span>${opening.has(p.id) ? "Opening…" : "Open pack →"}</span></button>`,
        )
        .join("")
    : empty(
        "No unopened packs",
        session.signedIn
          ? "Find your next pack in the shop. Opened cards live in your collection."
          : "Sign in to see packs waiting for you.",
      );
  $("packs")
    .querySelectorAll("[data-pack]")
    .forEach((b) => (b.onclick = () => openPack(b.dataset.pack)));
  for (const [id, items, label] of [
    ["line-filter", catalog.lines, "sets"],
    ["rarity-filter", catalog.rarities, "rarities"],
  ]) {
    const value = $(id).value;
    $(id).innerHTML =
      `<option value="">All ${label}</option>` +
      items
        .map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`)
        .join("");
    $(id).value = value;
  }
  collection();
  codes();
  total();
}
async function refresh() {
  const version = generation,
    next = await api("session");
  if (version !== generation) return;
  const freshCatalog = await api("catalog");
  if (version !== generation) return;
  session = next;
  catalog = freshCatalog;
  const nextState = session.signedIn ? await api("state") : null;
  if (version !== generation) return;
  state = nextState;
  if (!session.signedIn) {
    $("opened").replaceChildren();
    $("detail").close();
    $("detail-content").replaceChildren();
    $("confirm").close();
  }
  render();
}
async function openPack(id) {
  if (busy || opening.has(id) || !session.signedIn) return;
  const version = generation;
  opening.add(id);
  render();
  try {
    const result = await api("open", { key: "open-" + id, packId: id });
    if (version !== generation) return;
    $("opened").innerHTML =
      `<div class="opening"><h3>Your new cards</h3><p>Saved to your collection. They're yours to keep.</p><div class="card-grid">${result.cards.map((c) => cardMarkup(c, 0, false)).join("")}</div><div class="actions"><button id="finish-opening">Done</button><a class="button quiet" href="#collection-section">View collection</a></div></div>`;
    $("finish-opening").onclick = () => $("opened").replaceChildren();
    await refresh();
    if (version === generation)
      message("Your cards are saved in your collection.");
  } catch (e) {
    if (version === generation) message(e.message, true);
  } finally {
    opening.delete(id);
    if (version === generation && state) render();
  }
}
async function purchase(saved) {
  if (busy || !session.signedIn) return;
  busy = true;
  total();
  const version = generation;
  try {
    const input = saved ?? {
      key: crypto.randomUUID(),
      ...(await api("quote", {
        productId: $("product").value,
        quantity: Number($("quantity").value),
        cashType: Number($("cash-type").value),
      })),
    };
    if (version !== generation) return;
    saveIntent(input);
    message("Completing your purchase…");
    const result = await api("buy", input);
    if (version !== generation) return;
    saveIntent(null);
    await refresh();
    if (version === generation)
      message(
        `Purchased ${result.packs.length} pack${result.packs.length === 1 ? "" : "s"}. Ready to open whenever you are.`,
      );
  } catch (e) {
    if (version === generation) {
      if (
        [
          "INSUFFICIENT_FUNDS",
          "PURCHASE_REJECTED",
          "STALE_QUOTE",
          "UNSUPPORTED_CASH_TYPE",
        ].includes(e.code)
      )
        saveIntent(null);
      message(
        e.message +
          (intent()
            ? " Your purchase is saved. Use Check purchase to recover it."
            : ""),
        true,
      );
    }
  } finally {
    busy = false;
    if (version === generation) total();
  }
}
$("signin-link").onclick = () => {
  $("account").scrollIntoView();
  $("login").elements.username.focus();
};
$("login").onsubmit = async (e) => {
  e.preventDefault();
  if (busy) return;
  const button = e.currentTarget.querySelector("button");
  if (button.disabled) return;
  button.disabled = true;
  const version = ++generation;
  try {
    const result = await api("login", {
      username: $("login").elements.username.value,
      password: $("login").elements.password.value,
    });
    if (version !== generation) return;
    session = result;
    await refresh();
    if (version === generation) message("Welcome. Your library is ready.");
  } catch (e) {
    if (version === generation) message(e.message, true);
  } finally {
    $("login").elements.password.value = "";
    button.disabled = false;
  }
};
$("logout").onclick = async () => {
  if (busy) return;
  busy = true;
  const version = ++generation;
  const previous = session;
  session = { signedIn: false, csrf: previous.csrf };
  state = null;
  render();
  $("opened").replaceChildren();
  $("detail").close();
  $("detail-content").replaceChildren();
  $("confirm").close();
  try {
    await api("logout", {});
    await refresh();
    if (version === generation) message("Signed out.");
  } catch (e) {
    message(e.message + " Refresh to verify your sign-out.", true);
  } finally {
    busy = false;
    total();
  }
};
$("refresh").onclick = async () => {
  if (busy) return;
  busy = true;
  $("refresh").disabled = true;
  const version = generation;
  try {
    if (session.signedIn) await api("refresh", {});
    await refresh();
    if (version === generation)
      message("Your balances, cards, and code status are up to date.");
  } catch (e) {
    if (version === generation) message(e.message, true);
  } finally {
    busy = false;
    $("refresh").disabled = false;
    total();
  }
};
$("buy").onsubmit = async (e) => {
  e.preventDefault();
  if ($("purchase").disabled) return;
  const version = generation,
    product = catalog.products.find((p) => p.id === $("product").value),
    quantity = Number($("quantity").value),
    cashType = Number($("cash-type").value),
    label = $("cash-type").selectedOptions[0].textContent;
  busy = true;
  total();
  try {
    const quote = await api("quote", {
      productId: product.id,
      quantity,
      cashType,
    });
    if (version !== generation) return;
    if (
      quote.catalogVersion !== catalog.version ||
      quote.productRevision !== product.revision ||
      quote.price.amount !== product.price.amount * quantity
    )
      throw Error(
        "This pack changed. Refresh and review the current price before buying.",
      );
    confirmedInput = { key: crypto.randomUUID(), ...quote };
    $("confirm-text").textContent =
      `${quantity} × ${product.name} for ${num(quote.price.amount)} ${label}. Only this balance will be charged.`;
    $("confirm").showModal();
  } catch (e) {
    if (version === generation) message(e.message, true);
  } finally {
    busy = false;
    total();
  }
};
$("confirm-buy").onclick = () => {
  const input = confirmedInput;
  confirmedInput = null;
  $("confirm").close();
  if (input) purchase(input);
};
$("confirm").addEventListener("close", () => {
  confirmedInput = null;
});
$("cancel-buy").onclick = () => $("confirm").close();
$("retry").onclick = async () => {
  const saved = intent();
  saved ? await purchase(saved) : await $("refresh").onclick();
};
for (const id of ["product", "cash-type", "quantity"])
  $(id).addEventListener("input", total);
for (const id of ["search", "line-filter", "rarity-filter", "sort"])
  $(id).addEventListener("input", () => {
    collectionLimit = 60;
    collection();
  });
$("more-cards").onclick = () => {
  collectionLimit += 60;
  collection();
};
$("code-filter").onchange = codes;
$("more-codes").onclick = async () => {
  const version = generation;
  const button = $("more-codes");
  button.disabled = true;
  try {
    const page = await api("codes", { after: state.codeNext, limit: 50 });
    if (version !== generation) return;
    const ids = new Set(state.codes.map((c) => c.id));
    state.codes.push(...page.items.filter((c) => !ids.has(c.id)));
    state.codeNext = page.next;
    codes();
  } catch (e) {
    if (version === generation) message(e.message, true);
  } finally {
    button.disabled = false;
  }
};
refresh()
  .then(() => message("Choose a pack to begin."))
  .catch((e) => message(e.message + " Refresh the page to try again.", true));
