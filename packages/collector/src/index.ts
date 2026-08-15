import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import {
  loadRegions,
  loadWatchlist,
  loadAlertRules,
  logger,
  type AlertRule,
  type SnapshotBatch,
  type MarketSnapshotRow,
  type TriggeredAlert,
  type WatchlistItem,
} from "@eve-market-scout/shared";
import { fetchRegionOrders, fetchGlobalPrices } from "@eve-market-scout/esi-client";
import { evaluateAlerts } from "@eve-market-scout/alert-engine";
import { sendDiscordAlerts } from "@eve-market-scout/notifiers-discord";
import { aggregateOrders } from "./aggregate.js";
import type { MarketStore } from "./store/store.js";
import { JsonFileStore } from "./store/jsonFileStore.js";
import { HttpIngestStore } from "./store/httpIngestStore.js";

const COOLDOWN_STATE_FILE = path.join("data", "alert-cooldowns.json");
const GLOBAL_PLEX_REGION_ID = 19_000_001;
const PLEX_TYPE_ID = 44_992;

/** Per-rule "last triggered at" state, persisted to a small local JSON file
 * so cooldownMinutes actually holds across separate collector runs. Without
 * this, evaluateAlerts starts fresh every run and cooldowns are a no-op —
 * fine at a 4h cadence where you'd barely notice, but at hourly a stuck
 * threshold would otherwise re-fire every single run.
 * In CI (GitHub Actions), the workflow restores/saves this file via
 * actions/cache across runs — see .github/workflows/collect-market-data.yml. */
function loadCooldownState(): Map<string, Date> {
  if (!existsSync(COOLDOWN_STATE_FILE)) return new Map();
  try {
    const raw = JSON.parse(readFileSync(COOLDOWN_STATE_FILE, "utf-8")) as Record<string, string>;
    return new Map(Object.entries(raw).map(([id, iso]) => [id, new Date(iso)]));
  } catch {
    return new Map();
  }
}

function saveCooldownState(state: Map<string, Date>): void {
  mkdirSync(path.dirname(COOLDOWN_STATE_FILE), { recursive: true });
  const raw = Object.fromEntries([...state.entries()].map(([id, d]) => [id, d.toISOString()]));
  writeFileSync(COOLDOWN_STATE_FILE, JSON.stringify(raw, null, 2) + "\n", "utf-8");
}

function buildStore(): MarketStore {
  const mode = process.env.STORAGE_MODE ?? "json";
  if (mode === "http") {
    const url = process.env.INGEST_API_URL;
    const secret = process.env.INGEST_API_SECRET;
    if (!url || !secret) {
      throw new Error(
        "STORAGE_MODE=http requires INGEST_API_URL and INGEST_API_SECRET"
      );
    }
    return new HttpIngestStore(url, secret);
  }
  return new JsonFileStore();
}

function ingestApiUrl(path: "alert-rules" | "alerts" | "watchlist"): string {
  const ingestUrl = process.env.INGEST_API_URL;
  if (!ingestUrl) throw new Error("INGEST_API_URL is required for remote alert rules");
  return `${ingestUrl.replace(/\/+$/, "")}/${path}`;
}

async function loadRuntimeAlertRules(): Promise<AlertRule[]> {
  if ((process.env.STORAGE_MODE ?? "json") !== "http") return loadAlertRules();
  const secret = process.env.INGEST_API_SECRET;
  if (!secret) throw new Error("INGEST_API_SECRET is required for remote alert rules");
  const response = await fetch(ingestApiUrl("alert-rules"), {
    headers: { "X-Ingest-Secret": secret },
  });
  if (!response.ok) {
    throw new Error(`Could not load remote alert rules: ${response.status} ${await response.text()}`);
  }
  const payload = await response.json() as { rows: AlertRule[] };
  return payload.rows;
}

async function loadRuntimeWatchlist(): Promise<WatchlistItem[]> {
  if ((process.env.STORAGE_MODE ?? "json") !== "http") return loadWatchlist();
  const secret = process.env.INGEST_API_SECRET;
  if (!secret) throw new Error("INGEST_API_SECRET is required for remote watchlist access");
  const response = await fetch(ingestApiUrl("watchlist"), {
    headers: { "X-Ingest-Secret": secret },
  });
  if (!response.ok) {
    throw new Error(`Could not load remote watchlist: ${response.status} ${await response.text()}`);
  }
  const payload = await response.json() as { rows: WatchlistItem[] };
  return payload.rows;
}

async function saveTriggeredAlerts(alerts: TriggeredAlert[]): Promise<void> {
  if ((process.env.STORAGE_MODE ?? "json") !== "http" || alerts.length === 0) return;
  const secret = process.env.INGEST_API_SECRET;
  if (!secret) throw new Error("INGEST_API_SECRET is required for browser alert delivery");
  const response = await fetch(ingestApiUrl("alerts"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Ingest-Secret": secret,
    },
    body: JSON.stringify({ alerts }),
  });
  if (!response.ok) {
    throw new Error(`Could not persist triggered alerts: ${response.status} ${await response.text()}`);
  }
}

async function main() {
  const runId = randomUUID();
  const timestamp = new Date().toISOString();
  const regions = loadRegions();
  const watchlist = await loadRuntimeWatchlist();
  const watchlistIds = new Set(watchlist.map((w) => w.typeId));

  if (regions.length === 0) {
    logger.warn("No regions configured — see config/regions.json");
    return;
  }

  logger.info("Starting collector run", {
    runId,
    regions: regions.length,
    watchlistItems: watchlist.length,
  });

  const allRows: MarketSnapshotRow[] = [];

  for (const region of regions) {
    if (region.regionId === GLOBAL_PLEX_REGION_ID && !watchlistIds.has(PLEX_TYPE_ID)) continue;
    logger.info("Fetching region orders", { region: region.name });
    const orders = await fetchRegionOrders(
      region.regionId,
      region.regionId === GLOBAL_PLEX_REGION_ID ? { typeId: PLEX_TYPE_ID } : {}
    );

    // MVP scope control: only aggregate items on the watchlist. Drop this
    // filter (or make it configurable) once you're ready to index everything
    // ESI returns for a region — see docs/ESI_NOTES.md for the tradeoffs.
    const relevant =
      watchlistIds.size > 0
        ? orders.filter((o) => watchlistIds.has(o.type_id))
        : orders;

    allRows.push(...aggregateOrders(relevant, timestamp));
  }

  const batch: SnapshotBatch = { runId, timestamp, rows: allRows };
  const store = buildStore();
  await store.saveSnapshot(batch);

  const rules = await loadRuntimeAlertRules();

  // Some watchlist items (PLEX being the practical case) have stopped
  // trading through the normal region order book entirely, so they never
  // get a row from aggregateOrders — their alert rules would just silently
  // never fire. Fall back to ESI's global average price for exactly those
  // rules, as a synthetic row used for evaluation only (never persisted —
  // it's not a real region price, saving it to storage would be misleading).
  const rulesNeedingFallback = rules.filter((rule) => {
    const row = allRows.find((r) => r.regionId === rule.regionId && r.typeId === rule.typeId);
    const relevant = row && (rule.direction === "sell_at_or_below" ? row.bestSell : row.bestBuy);
    return relevant == null;
  });

  const alertRows = [...allRows];
  if (rulesNeedingFallback.length > 0) {
    const globalPrices = await fetchGlobalPrices();
    for (const rule of rulesNeedingFallback) {
      const price = globalPrices.get(rule.typeId);
      if (price == null) continue;
      alertRows.push({
        regionId: rule.regionId,
        typeId: rule.typeId,
        timestamp,
        bestSell: price,
        bestBuy: price,
        sellVolume: 0,
        buyVolume: 0,
        sellOrderCount: 0,
        buyOrderCount: 0,
        isGlobalAverage: true,
      });
    }
  }

  const cooldownState = loadCooldownState();
  const triggered = evaluateAlerts(alertRows, rules, cooldownState);
  logger.info("Alert evaluation complete", { triggered: triggered.length });

  if (triggered.length > 0) {
    for (const t of triggered) cooldownState.set(t.rule.id, new Date(t.triggeredAt));
    saveCooldownState(cooldownState);
    await saveTriggeredAlerts(triggered);
  }

  const discordWebhook = process.env.DISCORD_WEBHOOK_URL;
  const discordAlerts = triggered.filter(
    (alert) => alert.rule.channel === "discord" || alert.rule.channel === "both"
  );
  if (discordWebhook && discordAlerts.length > 0) {
    const itemNames = Object.fromEntries(
      watchlist.filter((w) => w.name).map((w) => [w.typeId, w.name as string])
    );
    const regionNames = Object.fromEntries(regions.map((r) => [r.regionId, r.name]));
    await sendDiscordAlerts(discordWebhook, discordAlerts, {
      itemNames,
      regionNames,
      appUrl: process.env.APP_URL ?? "http://localhost:4310",
    });
    logger.info("Sent triggered alerts to Discord", { count: discordAlerts.length });
  } else if (discordAlerts.length > 0) {
    logger.warn("Alerts triggered but DISCORD_WEBHOOK_URL is not set — nothing was sent", {
      count: discordAlerts.length,
    });
  }

  logger.info("Collector run finished", {
    runId,
    rows: allRows.length,
    triggered: triggered.length,
  });
}

main().catch((err) => {
  logger.error("Collector run failed", { error: String(err) });
  process.exitCode = 1;
});
