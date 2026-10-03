import { createAdministration } from "./admin.mjs";
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
  confirmedInput = null,
  refreshSequence = 0,
  syncing = false,
  packsLoading = false,
  available = false,
  displayedCards = new Map();
const message = (text, error = false) => {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
};
async function api(route, value) {
  const requestGeneration = generation;
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
  let data;
  try {
    data = await res.json();
  } catch {
    throw Error("The server is temporarily unavailable. Please try again.");
  }
  if (
    res.status === 401 &&
    requestGeneration === generation &&
    route !== "login" &&
    route !== "session"
  ) {
    generation++;
    session = { signedIn: false };
    state = null;
    clearPrivateViews();
    if (catalog) render();
    message("Your session expired. Sign in again to continue.", true);
  }
  if (
    res.status === 403 &&
    requestGeneration === generation &&
    route.startsWith("admin/")
  ) {
    session.role = "collector";
    administration.clear();
    message(
      "Your administration access has changed. Collector access is still available.",
      true,
    );
  }
  if (!res.ok)
    throw Object.assign(Error(data.error ?? "Please try again."), {
      code: data.code,
    });
  return data;
}
const administration = createAdministration({
  api,
  current: () => ({ session, generation, available }),
  onPublish: refresh,
});
const dialogFocus = new Map();
function showDialog(id) {
  dialogFocus.set(id, document.activeElement);
  $(id).showModal();
}
for (const id of ["detail", "confirm"]) {
  $(id).addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const controls = [
      ...$(id).querySelectorAll(
        "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex='0']",
      ),
    ].filter((e) => !e.hidden && e.getClientRects().length);
    if (!controls.length) {
      event.preventDefault();
      return;
    }
    const first = controls[0],
      last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  $(id).addEventListener("close", () => {
    const previous = dialogFocus.get(id);
    dialogFocus.delete(id);
    if (previous?.isConnected && previous.getClientRects().length)
      previous.focus();
  });
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
function clearPrivateViews() {
  packsLoading = false;
  administration.clear();
  $("opened").replaceChildren();
  $("detail").close();
  $("detail-content").replaceChildren();
  $("confirm").close();
  confirmedInput = null;
  $("search").value = "";
  $("line-filter").value = "";
  $("rarity-filter").value = "";
  $("collection-view").value = "owned";
  collectionLimit = 60;
}
function art(card) {
  const path = card.definition.metadata?.image;
  const valid =
    typeof path === "string" &&
    (/^\/assets\/library\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp)$/.test(
      path,
    ) ||
      /^https:\/\/maplestoryitcg\.weebly\.com\/uploads\/(?:\d+\/)+[a-zA-Z0-9_.-]+\.(png|jpg|jpeg)$/.test(
        path,
      ));
  return valid
    ? `<img src="${esc(path)}" alt="${esc(card.definition.name)}" loading="lazy" decoding="async" referrerpolicy="no-referrer"><span class="image-fallback" hidden>Image unavailable</span>`
    : `<span aria-hidden="true">${esc(card.definition.metadata?.symbol ?? "◇")}</span>`;
}
function imageFallbacks(root) {
  root.querySelectorAll("img").forEach((img) => {
    const fail = () => {
      img.hidden = true;
      img.nextElementSibling.hidden = false;
    };
    img.addEventListener("error", fail, { once: true });
    if (img.complete && !img.naturalWidth) fail();
  });
}
function cardMarkup(card, copies = 0, interactive = true) {
  const tag = interactive ? "button" : "article";
  const missing = card.preview && copies === 0;
  return `<${tag} class="card rarity-${esc(card.rarityId)}${missing ? " missing" : ""}" ${interactive ? `data-card="${esc(card.id)}"` : ""}><div class="card-art">${art(card)}</div><strong>${esc(card.definition.name)}</strong><small>${esc(rarity(card.rarityId))}${card.definition.type === "code" ? " · Code card" : ""}</small>${copies ? `<span class="copies">×${copies}</span>` : missing ? '<span class="copies">Not owned</span>' : ""}</${tag}>`;
}
function detail(id) {
  const card =
    displayedCards.get(id) ?? state?.inventory.find((c) => c.id === id);
  if (!card) return;
  const owned = ownedCollection().get(card.variantId)?.count ?? 0;
  $("detail-content").innerHTML =
    `<p class="eyebrow">${esc(setName(card.definition.lineId))}</p><h2>${esc(card.definition.name)}</h2><div class="card-art">${art(card)}</div><dl><dt>Rarity</dt><dd>${esc(rarity(card.rarityId))}</dd><dt>Copies owned</dt><dd>${owned}</dd></dl>${card.definition.metadata?.description ? `<p>${esc(card.definition.metadata.description)}</p>` : ""}`;
  imageFallbacks($("detail-content"));
  showDialog("detail");
}
function ownedCollection() {
  if (Array.isArray(state?.collection?.items))
    return new Map(
      state.collection.items
        .filter((row) => row.card?.definition?.type !== "code")
        .map((row) => [row.variantId, { card: row.card, count: row.count }]),
    );
  const grouped = new Map();
  for (const card of state?.inventory ?? []) {
    if (card.definition.type === "code") continue;
    const row = grouped.get(card.variantId);
    if (row) row.count++;
    else grouped.set(card.variantId, { card, count: 1 });
  }
  return grouped;
}
function collectionStats(grouped = ownedCollection()) {
  return {
    total:
      state?.collection?.totalCards ??
      [...grouped.values()].reduce((n, row) => n + row.count, 0),
    unique: state?.collection?.uniqueCards ?? grouped.size,
  };
}
function unopenedCount() {
  return (
    state?.packTotal ?? state?.packs.filter((p) => !p.openedAt).length ?? 0
  );
}
function collection() {
  if (!catalog) return;
  const grouped = ownedCollection(),
    totals = collectionStats(grouped);
  const definitions = new Map(catalog.cards.map((card) => [card.id, card]));
  const available = catalog.variants.flatMap((v) => {
    const definition = definitions.get(v.cardId);
    if (!definition || definition.type === "code") return [];
    return [
      {
        card: {
          id: "preview:" + v.id,
          variantId: v.id,
          rarityId: v.rarityId,
          definition,
          preview: true,
        },
        count: grouped.get(v.id)?.count ?? 0,
      },
    ];
  });
  const view = session.signedIn ? $("collection-view").value : "all";
  $("collection-view").value = view;
  $("collection-view")
    .querySelectorAll("option")
    .forEach((o) => (o.disabled = !session.signedIn && o.value !== "all"));
  const search = $("search").value.trim().toLocaleLowerCase();
  let rows = (
    view === "owned" || view === "duplicates"
      ? [...grouped.values()]
      : available
  ).filter(
    ({ card: c, count }) =>
      (view !== "missing" || count === 0) &&
      (view !== "duplicates" || count > 1) &&
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
  displayedCards = new Map(rows.map((r) => [r.card.id, r.card]));
  $("card-count").textContent = num(totals.total);
  $("collection-summary").textContent = session.signedIn
    ? `${num(totals.unique)} unique cards · ${num(totals.total)} total`
    : "Browse cards before you buy. Sign in to start collecting.";
  $("filter-summary").textContent =
    `${num(rows.length)} matching card${rows.length === 1 ? "" : "s"}`;
  $("set-progress").innerHTML = session.signedIn
    ? catalog.lines
        .map((line) => {
          const lineCards = available.filter(
            (r) => r.card.definition.lineId === line.id,
          );
          const owned = lineCards.filter((r) => r.count > 0).length;
          return `<article><div><strong>${esc(line.name)}</strong><span>${owned} / ${lineCards.length}</span></div><progress aria-label="${esc(line.name)} completion" value="${owned}" max="${lineCards.length || 1}"></progress></article>`;
        })
        .join("")
    : "";
  $("collection").innerHTML = rows.length
    ? `<div class="card-grid">${rows
        .slice(0, collectionLimit)
        .map((r) => cardMarkup(r.card, r.count))
        .join("")}</div>`
    : empty(
        view === "owned" && !totals.total
          ? "Your collection starts here"
          : "No matching cards",
        view === "owned" && !totals.total
          ? "Open your first pack to add cards, or browse all cards in the catalog."
          : "Try a different view, search or filter.",
      );
  $("more-cards").hidden = rows.length <= collectionLimit;
  $("collection")
    .querySelectorAll("[data-card]")
    .forEach((b) => (b.onclick = () => detail(b.dataset.card)));
  imageFallbacks($("collection"));
}
function walletMarkup() {
  return (state?.wallet.balances ?? [])
    .filter((b) =>
      (state.wallet.acceptedCashTypes ?? catalog.acceptedCashTypes).includes(
        b.cashType,
      ),
    )
    .map(
      (b) =>
        `<div class="balance">${esc(b.name)}<strong>${num(b.amount)}</strong></div>`,
    )
    .join("");
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
    productAvailable(product) &&
    Number.isSafeInteger(quantity) &&
    quantity >= 1 &&
    quantity <= product.maxQuantity;
  const amount = valid ? product.price.amount * quantity : 0;
  $("total").textContent = valid
    ? `${num(amount)} ${$("cash-type").selectedOptions[0]?.textContent ?? "points"}`
    : "Choose a valid quantity";
  $("checkout-balance").textContent =
    session.signedIn && balance
      ? `Available: ${num(balance.amount)} ${balance.name}${valid && amount <= balance.amount ? " · After purchase: " + num(balance.amount - amount) : ""}`
      : "";
  const pending =
    state?.orders.some(
      (o) => !["complete", "rejected", "compensated"].includes(o.state),
    ) || !!intent();
  $("pending").hidden = !session.signedIn || !pending;
  $("purchase").disabled =
    busy ||
    !session.signedIn ||
    !available ||
    !valid ||
    !balance ||
    amount > balance.amount ||
    pending;
  $("purchase-note").textContent = !session.signedIn
    ? "Sign in to buy packs."
    : !available
      ? "Purchases are paused until the game connection recovers."
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
function productAvailable(product) {
  const now = Date.now();
  return (
    product.enabled !== false &&
    product.available !== false &&
    product.availability?.available !== false &&
    product.availability?.state !== "out_of_stock" &&
    (!product.availableFrom || now >= Date.parse(product.availableFrom)) &&
    (!product.availableUntil || now < Date.parse(product.availableUntil))
  );
}
function constrainedDraws(product, slot) {
  const policy = product.duplicatePolicy;
  return (
    !!product.pity ||
    (!!policy && policy !== "allow" && policy.scope !== "none") ||
    (slot ? [slot] : product.slots).some((s) =>
      s.pool.some(
        (v) =>
          catalog.variants.find((x) => x.id === v.variantId)?.supplyLimit !==
          undefined,
      ),
    )
  );
}
function render() {
  if (!catalog) return;
  administration.sync();
  $("hero-title").textContent = session.signedIn
    ? "Your card library"
    : "Your next favorite card is waiting in a pack.";
  const hasRewards =
    catalog.variants.some((v) => v.codes?.length) || !!state?.codes.length;
  $("code-link").hidden = !hasRewards;
  $("code-section").hidden = !hasRewards;
  document.body.classList.toggle("authenticated", session.signedIn);
  $("account-strip").hidden = !session.signedIn;
  $("header-wallet").innerHTML = walletMarkup();
  $("overview").hidden = !session.signedIn;
  const owned = collectionStats();
  $("overview").innerHTML =
    `<div><strong>${num(unopenedCount())}</strong><span>Packs to open</span></div><div><strong>${num(owned.total)}</strong><span>Cards collected</span></div><div><strong>${num(owned.unique)}</strong><span>Unique cards</span></div>`;
  $("account").hidden = session.signedIn;
  $("signed-in").hidden = !session.signedIn;
  $("signin-link").hidden = session.signedIn;
  $("welcome").textContent = session.signedIn ? session.username : "";
  const selected = $("product").value,
    selectedType = $("cash-type").value;
  const offers = catalog.products.filter(productAvailable);
  $("product").innerHTML = offers
    .map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`)
    .join("");
  if (offers.some((p) => p.id === selected)) $("product").value = selected;
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
  $("products").innerHTML = offers.length
    ? offers
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
            `<h2>${esc(p.name)}</h2><p>${constrainedDraws(p) ? "This pack has draw constraints. Pool weights are relative preferences; actual chances can change with remaining supply and draw rules." : "Each slot draws independently. Duplicates are possible."}</p>` +
            p.slots
              .map(
                (s) =>
                  `<h3>${s.count} ${s.role === "insert" ? "insert" : "card"}${s.count === 1 ? "" : "s"}</h3><ul>` +
                  s.pool
                    .filter((entry) => {
                      const variant = catalog.variants.find(
                        (v) => v.id === entry.variantId,
                      );
                      return (
                        variant &&
                        variant.enabled !== false &&
                        variant.remaining !== 0
                      );
                    })
                    .map((v) => {
                      const variant = catalog.variants.find(
                          (x) => x.id === v.variantId,
                        ),
                        c = catalog.cards.find((x) => x.id === variant?.cardId),
                        weight = s.pool
                          .filter((entry) => {
                            const candidate = catalog.variants.find(
                              (v) => v.id === entry.variantId,
                            );
                            return (
                              candidate &&
                              candidate.enabled !== false &&
                              candidate.remaining !== 0
                            );
                          })
                          .reduce((n, r) => n + r.weight, 0);
                      const constrained = constrainedDraws(p, s);
                      return `<li>${esc(c?.name)} · ${esc(rarity(variant?.rarityId))} · ${constrained ? "weight " + v.weight : Number(((v.weight / weight) * 100).toFixed(2)) + "% per draw"}</li>`;
                    })
                    .join("") +
                  "</ul>",
              )
              .join("");
          showDialog("detail");
        }),
    );
  const packs = state?.packs.filter((p) => !p.openedAt) ?? [];
  $("pack-count").textContent = num(unopenedCount());
  $("more-packs").hidden = !session.signedIn || !state?.packNext;
  $("more-packs").disabled = packsLoading || !available;
  $("packs").innerHTML = packs.length
    ? packs
        .map(
          (p) =>
            `<button class="pack" data-pack="${esc(p.id)}" ${opening.has(p.id) || !available ? "disabled" : ""}><strong>${esc(catalog.products.find((v) => v.id === p.productId)?.name ?? "Pack")}</strong><span>${opening.has(p.id) ? "Opening…" : "Open pack →"}</span></button>`,
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
    sequence = ++refreshSequence;
  const current = () => version === generation && sequence === refreshSequence;
  const [publicResult, accountResult] = await Promise.allSettled([
    api("catalog"),
    api("session"),
  ]);
  if (publicResult.status !== "fulfilled") throw publicResult.reason;
  const freshCatalog = publicResult.value;
  if (!current()) return;
  catalog = freshCatalog;
  let next, nextState;
  try {
    if (accountResult.status !== "fulfilled") throw accountResult.reason;
    next = accountResult.value;
    if (!current()) return;
    nextState = next.signedIn ? await api("state") : null;
  } catch (e) {
    if (!current()) return;
    available = false;
    $("connection-notice").hidden = false;
    render();
    $("sync-status").textContent = "Connection paused · Retry connection";
    return;
  }
  if (!current()) return;
  available = true;
  $("connection-notice").hidden = true;
  if (
    nextState?.owner &&
    nextState.owner.toLowerCase() !== next.username.toLowerCase()
  )
    throw Error("Your account changed. Refresh before continuing.");
  if (
    next.username !== session.username ||
    next.signedIn !== session.signedIn
  ) {
    generation++;
    clearPrivateViews();
  } else if (!next.signedIn) clearPrivateViews();
  session = next;
  catalog = freshCatalog;
  state = nextState;
  $("sync-status").textContent =
    "Updated " +
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  render();
}
async function openPack(id) {
  if (busy || opening.has(id) || !session.signedIn || !available) return;
  const version = generation;
  opening.add(id);
  render();
  try {
    const result = await api("open", { key: "open-" + id, packId: id });
    if (version !== generation) return;
    $("opened").innerHTML =
      `<div class="opening"><h3>Your new cards</h3><p>Saved to your collection. They're yours to keep.</p><div class="card-grid">${result.cards.map((c) => cardMarkup(c, 0, false)).join("")}</div><div class="actions"><button id="finish-opening">Done</button><a class="button quiet" href="#collection-section">View collection</a></div></div>`;
    imageFallbacks($("opened"));
    $("finish-opening").onclick = () => {
      $("opened").replaceChildren();
      $("collection-section").scrollIntoView();
    };
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
  if (busy || !session.signedIn || !available) return;
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
    clearPrivateViews();
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
  clearPrivateViews();
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
$("connection-retry").onclick = () =>
  refresh().catch((e) => message(e.message, true));
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
    const balance = state?.wallet.balances.find((b) => b.cashType === cashType);
    $("confirm-wallet").innerHTML = walletMarkup();
    $("confirm-balance").textContent = balance
      ? `Available: ${num(balance.amount)} ${label} · After purchase: ${num(balance.amount - quote.price.amount)}`
      : "";
    showDialog("confirm");
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
for (const id of [
  "search",
  "line-filter",
  "rarity-filter",
  "sort",
  "collection-view",
])
  $(id).addEventListener("input", () => {
    collectionLimit = 60;
    collection();
  });
$("clear-filters").onclick = () => {
  $("search").value = "";
  $("line-filter").value = "";
  $("rarity-filter").value = "";
  collectionLimit = 60;
  collection();
};
$("more-cards").onclick = () => {
  collectionLimit += 60;
  collection();
};
$("code-filter").onchange = codes;
$("more-packs").onclick = async () => {
  if (packsLoading || !available || !session.signedIn || !state?.packNext)
    return;
  const version = generation,
    sequence = refreshSequence,
    button = $("more-packs");
  packsLoading = true;
  button.disabled = true;
  try {
    const page = await api("packs", { after: state.packNext, limit: 50 });
    if (version !== generation || sequence !== refreshSequence) return;
    const ids = new Set(state.packs.map((p) => p.id)),
      added = page.items.filter((p) => !p.openedAt && !ids.has(p.id));
    state.packs.push(...added);
    state.packNext = page.next;
    state.packTotal = page.total;
    render();
    if (!page.next && added.length) {
      const first = [...$("packs").querySelectorAll("[data-pack]")].find(
        (b) => b.dataset.pack === added[0].id,
      );
      first?.focus();
    }
    message(
      `${num(state.packs.length)} of ${num(unopenedCount())} unopened packs loaded.`,
    );
  } catch (e) {
    if (version === generation)
      message(e.message + " Retry loading unopened packs.", true);
  } finally {
    if (version === generation) {
      packsLoading = false;
      button.disabled = !available;
    }
  }
};
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

const layoutObserver = new ResizeObserver(() => {
  document.documentElement.style.setProperty(
    "--topbar-height",
    document.querySelector(".topbar").offsetHeight + "px",
  );
  document.documentElement.style.setProperty(
    "--wallet-height",
    $("account-strip").offsetHeight + "px",
  );
});
layoutObserver.observe(document.querySelector(".topbar"));
layoutObserver.observe($("account-strip"));
async function backgroundRefresh() {
  if (
    !session.signedIn ||
    document.hidden ||
    busy ||
    syncing ||
    opening.size ||
    packsLoading ||
    $("confirm").open ||
    $("detail").open ||
    administration.hasDraft() ||
    document.querySelector(".code-text") ||
    (document.activeElement !== document.body &&
      document.activeElement?.closest("#main"))
  )
    return;
  syncing = true;
  try {
    await refresh();
  } catch {
    $("sync-status").textContent = "Updates paused · use Refresh";
  } finally {
    syncing = false;
  }
}
setInterval(backgroundRefresh, 30000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) backgroundRefresh();
});
window.addEventListener("focus", backgroundRefresh);
window.addEventListener("online", backgroundRefresh);
