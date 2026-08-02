// Plain vanilla JS on purpose — this whole page is a CRUD form over two
// JSON files, no framework/build step needed for that.

let watchlist = [];
let regions = [];
let latestPrices = [];

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json();
}

function priceHint(regionId, typeId) {
  const row = latestPrices.find((r) => r.regionId === regionId && r.typeId === typeId);
  if (!row) return "";
  const sell = row.bestSell != null ? row.bestSell.toLocaleString("de-DE") : "–";
  const buy = row.bestBuy != null ? row.bestBuy.toLocaleString("de-DE") : "–";
  return `Sell ${sell} / Buy ${buy} ISK`;
}

function renderWatchlist() {
  const tbody = document.querySelector("#watchlist-table tbody");
  tbody.innerHTML = "";
  if (watchlist.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="3">Noch keine Items auf der Watchlist.</td></tr>';
  }
  for (const item of watchlist) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.typeId}</td>
      <td>${item.name ?? ""}</td>
      <td><button class="delete-btn" data-typeid="${item.typeId}">Entfernen</button></td>
    `;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      watchlist = await api(`/api/watchlist/${btn.dataset.typeid}`, { method: "DELETE" });
      renderWatchlist();
      renderRuleFormOptions();
    });
  });
}

function renderRuleFormOptions() {
  const typeSelect = document.getElementById("rule-typeid");
  typeSelect.innerHTML = watchlist
    .map((i) => `<option value="${i.typeId}">${i.name ?? "Type " + i.typeId}</option>`)
    .join("");

  const regionSelect = document.getElementById("rule-region");
  regionSelect.innerHTML = regions
    .map((r) => `<option value="${r.regionId}">${r.name}</option>`)
    .join("");
}

function itemLabel(typeId) {
  const item = watchlist.find((i) => i.typeId === typeId);
  return item?.name ?? `Type ${typeId}`;
}

function regionLabel(regionId) {
  const region = regions.find((r) => r.regionId === regionId);
  return region?.name ?? `Region ${regionId}`;
}

async function renderRules() {
  const rules = await api("/api/alert-rules");
  const tbody = document.querySelector("#rules-table tbody");
  tbody.innerHTML = "";
  if (rules.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7">Noch keine Alarme angelegt.</td></tr>';
  }
  for (const rule of rules) {
    const directionLabel =
      rule.direction === "sell_at_or_below" ? "Sell ≤" : "Buy ≥";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${itemLabel(rule.typeId)}</td>
      <td>${regionLabel(rule.regionId)}</td>
      <td>${directionLabel}</td>
      <td>${rule.thresholdIsk.toLocaleString("de-DE")} ISK
        <div class="price-hint">${priceHint(rule.regionId, rule.typeId)}</div>
      </td>
      <td>${rule.channel}</td>
      <td>${rule.cooldownMinutes ?? "–"} min</td>
      <td><button class="delete-btn" data-id="${rule.id}">Entfernen</button></td>
    `;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/api/alert-rules/${encodeURIComponent(btn.dataset.id)}`, { method: "DELETE" });
      renderRules();
    });
  });
}

document.getElementById("watchlist-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const typeId = Number(document.getElementById("wl-typeid").value);
  const name = document.getElementById("wl-name").value;
  try {
    watchlist = await api("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ typeId, name: name || undefined }),
    });
    e.target.reset();
    renderWatchlist();
    renderRuleFormOptions();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("rule-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {
    typeId: Number(document.getElementById("rule-typeid").value),
    regionId: Number(document.getElementById("rule-region").value),
    direction: document.getElementById("rule-direction").value,
    thresholdIsk: Number(document.getElementById("rule-threshold").value),
    channel: document.getElementById("rule-channel").value,
    cooldownMinutes: Number(document.getElementById("rule-cooldown").value) || undefined,
  };
  try {
    await api("/api/alert-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    document.getElementById("rule-threshold").value = "";
    renderRules();
  } catch (err) {
    alert(err.message);
  }
});

// --- Raw config-file editor -------------------------------------------

function setConfigStatus(msg, kind) {
  const el = document.getElementById("config-status");
  el.textContent = msg;
  el.className = "price-hint" + (kind ? ` ${kind}` : "");
}

async function loadConfigFile(name) {
  setConfigStatus("Lade…", "");
  try {
    const data = await api(`/api/config/${encodeURIComponent(name)}`);
    document.getElementById("config-editor").value = data.content;
    setConfigStatus(`Geladen: ${data.path}`, "ok");
  } catch (err) {
    setConfigStatus(err.message, "error");
  }
}

async function initConfigEditor() {
  const files = await api("/api/config-files");
  const select = document.getElementById("config-select");
  select.innerHTML = files.map((f) => `<option value="${f}">${f}</option>`).join("");
  select.addEventListener("change", () => loadConfigFile(select.value));
  document.getElementById("config-reload").addEventListener("click", () => loadConfigFile(select.value));
  document.getElementById("config-save").addEventListener("click", async () => {
    const content = document.getElementById("config-editor").value;
    setConfigStatus("Speichere…", "");
    try {
      await api(`/api/config/${encodeURIComponent(select.value)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      setConfigStatus("Gespeichert.", "ok");
      // Reflect changes elsewhere on the page (e.g. watchlist/rule tables)
      // without a full page reload.
      init();
    } catch (err) {
      setConfigStatus(err.message, "error");
    }
  });
  await loadConfigFile(select.value);
}

function renderLastUpdated() {
  const el = document.getElementById("last-updated");
  if (latestPrices.length === 0) {
    el.textContent = "noch keine Daten (Alarm auslösen oder `npm run collect`)";
    return;
  }
  const newest = latestPrices.reduce(
    (max, r) => (r.timestamp > max ? r.timestamp : max),
    latestPrices[0].timestamp
  );
  const ageMs = Date.now() - new Date(newest).getTime();
  const ageMin = Math.round(ageMs / 60000);
  const relative =
    ageMin < 1 ? "gerade eben" : ageMin < 60 ? `vor ${ageMin} Min.` : `vor ${Math.round(ageMin / 60)} Std.`;
  el.textContent = `${new Date(newest).toLocaleString("de-DE")} (${relative})`;
  el.className = ageMin > 240 ? "error" : "";
}

async function init() {
  [watchlist, regions, latestPrices] = await Promise.all([
    api("/api/watchlist"),
    api("/api/regions"),
    api("/api/latest-prices"),
  ]);
  renderWatchlist();
  renderRuleFormOptions();
  renderLastUpdated();
  await renderRules();
}

document.getElementById("trigger-collect").addEventListener("click", async () => {
  const btn = document.getElementById("trigger-collect");
  const status = document.getElementById("collect-status");
  btn.disabled = true;
  status.className = "price-hint";
  status.textContent = "Läuft… (ruft ESI live ab, kann ein paar Sekunden dauern)";
  try {
    const result = await api("/api/collect", { method: "POST" });
    status.textContent =
      result.triggered === null
        ? "Fertig, Ergebnis unklar — siehe Server-Log."
        : `Fertig — ${result.triggered} Alarm(e) ausgelöst.`;
    status.className = "price-hint ok";
    await init();
  } catch (err) {
    status.textContent = err.message;
    status.className = "price-hint error";
  } finally {
    btn.disabled = false;
  }
});

// --- Settings (.env) ----------------------------------------------------

function setSettingStatus(msg, kind) {
  const el = document.getElementById("setting-status");
  el.textContent = msg;
  el.className = "price-hint" + (kind ? ` ${kind}` : "");
}

async function initSettings() {
  try {
    const settings = await api("/api/settings");
    document.getElementById("setting-discord").value = settings.DISCORD_WEBHOOK_URL ?? "";
  } catch (err) {
    setSettingStatus(err.message, "error");
  }
  document.getElementById("setting-save-discord").addEventListener("click", async () => {
    const value = document.getElementById("setting-discord").value.trim();
    setSettingStatus("Speichere…", "");
    try {
      await api("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "DISCORD_WEBHOOK_URL", value }),
      });
      setSettingStatus(
        "Gespeichert. Gilt ab dem nächsten `npm run collect` / `npm run manage` (Prozess neu starten).",
        "ok"
      );
    } catch (err) {
      setSettingStatus(err.message, "error");
    }
  });
}

init();
initConfigEditor();
initSettings();
