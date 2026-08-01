import { randomUUID } from "node:crypto";
import {
  loadRegions,
  loadWatchlist,
  loadAlertRules,
  logger,
  type SnapshotBatch,
  type MarketSnapshotRow,
} from "@eve-market-scout/shared";
import { fetchRegionOrders } from "@eve-market-scout/esi-client";
import { evaluateAlerts } from "@eve-market-scout/alert-engine";
import { sendDiscordAlerts } from "@eve-market-scout/notifiers-discord";
import { aggregateOrders } from "./aggregate.js";
import type { MarketStore } from "./store/store.js";
import { JsonFileStore } from "./store/jsonFileStore.js";
import { HttpIngestStore } from "./store/httpIngestStore.js";

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

async function main() {
  const runId = randomUUID();
  const timestamp = new Date().toISOString();
  const regions = loadRegions();
  const watchlist = loadWatchlist();
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
    logger.info("Fetching region orders", { region: region.name });
    const orders = await fetchRegionOrders(region.regionId);

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

  const rules = loadAlertRules();
  const triggered = evaluateAlerts(allRows, rules);
  logger.info("Alert evaluation complete", { triggered: triggered.length });

  const discordWebhook = process.env.DISCORD_WEBHOOK_URL;
  if (discordWebhook && triggered.length > 0) {
    await sendDiscordAlerts(discordWebhook, triggered);
    logger.info("Sent triggered alerts to Discord", { count: triggered.length });
  } else if (triggered.length > 0) {
    logger.warn("Alerts triggered but DISCORD_WEBHOOK_URL is not set — nothing was sent", {
      count: triggered.length,
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
