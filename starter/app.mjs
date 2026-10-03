const $ = (id) => document.getElementById(id),
  esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
let session = { signedIn: false },
  catalog,
  state,
  sessionGeneration = 0,
  signingOut = false;
const message = (value) => ($("status").textContent = value);
async function api(route, value) {
  const res = await fetch("/api/library/" + route, {
    credentials: "same-origin",
    method: value ? "POST" : "GET",
    signal: AbortSignal.timeout(18000),
    headers: value
      ? {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrf ?? "",
        }
      : {},
    body: value ? JSON.stringify(value) : undefined,
  });
  const data = await res.json();
  if (!res.ok)
    throw Object.assign(Error(data.error ?? "Please try again."), {
      code: data.code,
    });
  return data;
}
function intentKey() {
  return "cosmic-pack:" + session.username;
}
async function refresh() {
  const generation = sessionGeneration;
  const nextSession = await api("session");
  if (generation !== sessionGeneration) return;
  catalog ??= await api("catalog");
  if (generation !== sessionGeneration) return;
  session = nextSession;
  $("login").hidden = session.signedIn;
  $("signed-in").hidden = !session.signedIn;
  $("welcome").textContent = session.signedIn
    ? "Welcome, " + session.username + "."
    : "";
  if (!session.signedIn) {
    state = null;
    $("purchase").disabled = true;
    $("wallet").textContent = "Sign in to view your balances.";
    $("packs").textContent = "Your sealed packs will wait here.";
    $("collection").textContent = "Your cards will appear here.";
    $("codes").replaceChildren();
  } else {
    const nextState = await api("state");
    if (generation !== sessionGeneration) return;
    state = nextState;
    $("purchase").disabled = false;
    $("wallet").innerHTML = state.wallet.balances
      .map(
        (b) =>
          '<span class="balance">' +
          esc(b.name) +
          ": " +
          b.amount.toLocaleString() +
          "</span>",
      )
      .join("");
    $("packs").innerHTML = state.packs.length
      ? state.packs
          .map(
            (p) =>
              '<button class="pack" data-pack="' +
              esc(p.id) +
              '">' +
              esc(
                catalog.products.find((v) => v.id === p.productId)?.name ??
                  "Pack",
              ) +
              " · " +
              (p.openedAt ? "Revisit" : "Open") +
              "</button>",
          )
          .join("")
      : "Your first pack is waiting in the shop.";
    $("packs")
      .querySelectorAll("[data-pack]")
      .forEach((button) => (button.onclick = () => open(button.dataset.pack)));
    $("collection").innerHTML =
      '<div class="card-grid">' +
      state.inventory
        .filter((c) => c.definition.type !== "code")
        .map(
          (c) =>
            '<article class="card"><strong>' +
            esc(c.definition.name) +
            "</strong><small>" +
            esc(c.rarityId) +
            "</small></article>",
        )
        .join("") +
      "</div>";
    $("codes").innerHTML = state.codes
      .map(
        (c) =>
          '<article class="code"><strong>' +
          esc(c.name) +
          '</strong> <span class="' +
          (c.status === "redeemed" ? "used" : "") +
          '">' +
          (c.status === "redeemed"
            ? "USED"
            : c.registration === "ready"
              ? "READY"
              : "BEING BOUND") +
          "</span><p>Created " +
          esc(new Date(c.createdAt).toLocaleString()) +
          '</p><button data-code="' +
          esc(c.id) +
          '">Reveal code</button><div class="secret"></div></article>',
      )
      .join("");
    $("codes")
      .querySelectorAll("[data-code]")
      .forEach(
        (button) =>
          (button.onclick = async () => {
            button.disabled = true;
            try {
              const value = await api("reveal", {
                key: crypto.randomUUID(),
                codeId: button.dataset.code,
              });
              const secret = button.parentElement.querySelector(".secret");
              secret.className = "secret code-text";
              secret.textContent = value.code;
              button.hidden = true;
            } catch (e) {
              message(e.message);
              button.disabled = false;
            }
          }),
      );
  }
  const selected = $("product").value;
  $("product").innerHTML = catalog.products
    .map(
      (p) =>
        '<option value="' +
        esc(p.id) +
        '">' +
        esc(p.name) +
        " · " +
        p.price.amount +
        " each</option>",
    )
    .join("");
  if (selected) $("product").value = selected;
  const accepted = state?.wallet.acceptedCashTypes ?? catalog.acceptedCashTypes,
    selectedType = $("cash-type").value;
  $("cash-type").innerHTML = [
    { id: 1, name: "NX Credit" },
    { id: 2, name: "Maple Points" },
    { id: 4, name: "NX Prepaid" },
  ]
    .filter((t) => accepted.includes(t.id))
    .map((t) => '<option value="' + t.id + '">' + t.name + "</option>")
    .join("");
  if (selectedType && accepted.includes(Number(selectedType)))
    $("cash-type").value = selectedType;
}
async function open(id) {
  if (signingOut || !session.signedIn) return;
  const generation = sessionGeneration;
  try {
    const opened = await api("open", { key: "open-" + id, packId: id });
    if (generation !== sessionGeneration) return;
    $("opened").innerHTML =
      '<h3>Your opening</h3><div class="card-grid">' +
      opened.cards
        .map(
          (c) =>
            '<article class="card">' +
            esc(c.definition.name) +
            "<small>" +
            esc(c.rarityId) +
            (c.definition.type === "code" ? " · CODE CARD" : "") +
            "</small></article>",
        )
        .join("") +
      "</div>";
    await refresh();
    if (generation !== sessionGeneration) return;
    message("Your cards are saved in your collection.");
  } catch (e) {
    if (generation === sessionGeneration) message(e.message);
  }
}
$("login").onsubmit = async (e) => {
  e.preventDefault();
  sessionGeneration++;
  const form = e.currentTarget,
    button = form.querySelector("button");
  button.disabled = true;
  try {
    session = await api("login", {
      username: form.elements.username.value,
      password: form.elements.password.value,
    });
    form.elements.password.value = "";
    await refresh();
    message("Your library is ready.");
  } catch (error) {
    message(error.message);
  } finally {
    button.disabled = false;
  }
};
$("refresh").onclick = async () => {
  const button = $("refresh");
  button.disabled = true;
  try {
    await api("refresh", {});
    await refresh();
    message("Your collection and code status are current.");
  } catch (e) {
    message(e.message);
  } finally {
    button.disabled = false;
  }
};
$("logout").onclick = async () => {
  signingOut = true;
  sessionGeneration++;
  try {
    await api("logout", {});
    $("opened").replaceChildren();
    await refresh();
    message("Signed out.");
  } catch (e) {
    message(e.message);
  } finally {
    signingOut = false;
  }
};
$("buy").onsubmit = async (e) => {
  e.preventDefault();
  $("purchase").disabled = true;
  try {
    let input;
    try {
      input = JSON.parse(sessionStorage.getItem(intentKey()) ?? "null");
    } catch {}
    if (!input) {
      input = {
        key: crypto.randomUUID(),
        ...(await api("quote", {
          productId: $("product").value,
          quantity: Number($("quantity").value),
          cashType: Number($("cash-type").value),
        })),
      };
      sessionStorage.setItem(intentKey(), JSON.stringify(input));
    }
    message("Completing your purchase…");
    const bought = await api("buy", input);
    sessionStorage.removeItem(intentKey());
    await refresh();
    message(
      "Purchased " +
        bought.packs.length +
        " pack(s). Choose a pack to open it.",
    );
  } catch (error) {
    message(
      error.message +
        " Your original purchase identifier is kept for recovery.",
    );
    if (
      ["INSUFFICIENT_FUNDS", "PURCHASE_REJECTED", "STALE_QUOTE"].includes(
        error.code,
      )
    )
      sessionStorage.removeItem(intentKey());
  } finally {
    $("purchase").disabled = !session.signedIn;
  }
};
refresh().catch((e) => message(e.message));
