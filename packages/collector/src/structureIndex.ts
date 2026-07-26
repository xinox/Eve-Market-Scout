/**
 * Structure market collector -- a separate, optional entrypoint from the
 * region collector (index.ts). Separate on purpose: it needs EVE SSO
 * credentials the region collector doesn't, and someone who only cares
 * about NPC station/region trading shouldn't need to set any of this up.
 * Delete .github/workflows/collect-structures.yml and this file's
 * dependents if you never want it -- that's the whole "module."
 */
import { randomUUID } from "node:crypto";
import {
  loadStructures,
  loadStructureAlertRules,
  logger,
  type StructureSnapshotBatch,
  type StructureSnapshotRow,
} from "@eve-market-scout/shared";
import { fetchStructureOrders } from "@eve-market-scout/esi-client";
import { refreshAccessToken } from "@eve-market-scout/eve-sso";
import { evaluateStructureAlerts } from "@eve-market-scout/alert-engine";
import { sendDiscordAlerts } from "@eve-market-scout/notifiers-discord";
import { aggregateStructureOrders } from "./aggregateStructures.js";
import type { StructureMarketStore } from "./store/store.js";
import { JsonFileStore } from "./store/jsonFileStore.js";
import { HttpIngestStore } from "./store/httpIngestStore.js";

function buildStructureStore(): StructureMarketStore {
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
  const structures = loadStructures();
  if (structures.length === 0) {
    logger.info(
      "No structures configured (config/structures.json) -- nothing to do. " +
        "This module is optional; see packages/eve-sso/README.md to set it up."
    );
    return;
  }

  const clientId = process.env.EVE_CLIENT_ID;
  const clientSecret = process.env.EVE_CLIENT_SECRET;
  const refreshToken = process.env.EVE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    logger.warn(
      "Structures are configured but EVE_CLIENT_ID / EVE_CLIENT_SECRET / " +
        "EVE_REFRESH_TOKEN are not all set -- skipping structure collection. " +
        "Run packages/eve-sso's login script once to obtain these."
    );
    return;
  }

  const runId = randomUUID();
  const timestamp = new Date().toISOString();

  logger.info("Starting structure collector run", {
    runId,
    structures: structures.length,
  });

  // Access tokens are short-lived (~20 min) -- mint one fresh token up
  // front and reuse it for every structure in this run rather than
  // refreshing per-structure.
  const token = await refreshAccessToken(clientId, clientSecret, refreshToken);

  const allRows: StructureSnapshotRow[] = [];
  for (const structure of structures) {
    logger.info("Fetching structure orders", { structure: structure.name });
    try {
      const orders = await fetchStructureOrders(
        structure.structureId,
        token.access_token
      );
      allRows.push(
        ...aggregateStructureOrders(orders, structure.structureId, timestamp)
      );
    } catch (err) {
      // One structure failing (e.g. docking access revoked, structure
      // unanchored) shouldn't take down the whole run.
      logger.error("Failed to fetch structure orders", {
        structure: structure.name,
        error: String(err),
      });
    }
  }

  const batch: StructureSnapshotBatch = { runId, timestamp, rows: allRows };
  const store = buildStructureStore();
  await store.saveStructureSnapshot(batch);

  const rules = loadStructureAlertRules();
  const triggered = evaluateStructureAlerts(allRows, rules);
  logger.info("Structure alert evaluation complete", { triggered: triggered.length });

  const discordWebhook = process.env.DISCORD_WEBHOOK_URL;
  if (discordWebhook && triggered.length > 0) {
    // sendDiscordAlerts expects TriggeredAlert (region-shaped); structure
    // alerts carry the same fields under different names, so adapt here
    // rather than widening the notifier's type for one caller.
    await sendDiscordAlerts(
      discordWebhook,
      triggered.map((t) => ({
        rule: {
          id: t.rule.id,
          regionId: t.rule.structureId,
          typeId: t.rule.typeId,
          direction: t.rule.direction,
          thresholdIsk: t.rule.thresholdIsk,
          channel: t.rule.channel,
          cooldownMinutes: t.rule.cooldownMinutes,
        },
        row: {
          regionId: t.row.structureId,
          typeId: t.row.typeId,
          timestamp: t.row.timestamp,
          bestSell: t.row.bestSell,
          bestBuy: t.row.bestBuy,
          sellVolume: t.row.sellVolume,
          buyVolume: t.row.buyVolume,
          sellOrderCount: t.row.sellOrderCount,
          buyOrderCount: t.row.buyOrderCount,
        },
        triggeredAt: t.triggeredAt,
      }))
    );
  }

  logger.info("Structure collector run finished", {
    runId,
    rows: allRows.length,
    triggered: triggered.length,
  });
}

main().catch((err) => {
  logger.error("Structure collector run failed", { error: String(err) });
  process.exitCode = 1;
});
