import type {
  AlertChannel,
  AlertDirection,
  AlertRule,
  AlertRulesResponse,
  LatestMarketResponse,
  MarketHistoryResponse,
  MarketSnapshotRow,
  RecentAlert,
  RecentAlertsResponse,
  SnapshotBatch,
  StructureSnapshotBatch,
  StructureSnapshotRow,
  TriggeredAlert,
  WatchlistItem,
  WatchlistResponse,
} from "@eve-market-scout/shared/types";

export interface Env {
  DB: D1Database;
  INGEST_SECRET?: string;
  LOCAL_DEV?: string;
  GITHUB_ACTIONS_TOKEN?: string;
  GITHUB_REPOSITORY?: string;
  GITHUB_REF?: string;
}

interface D1MarketRow {
  region_id: number;
  type_id: number;
  ts: string;
  best_sell: number | null;
  best_buy: number | null;
  sell_volume: number;
  buy_volume: number;
  sell_order_count: number;
  buy_order_count: number;
  best_sell_location_id: number | null;
  best_sell_system_id: number | null;
  best_buy_location_id: number | null;
  best_buy_system_id: number | null;
}

interface D1AlertRuleRow {
  id: string;
  region_id: number;
  type_id: number;
  direction: AlertDirection;
  threshold_isk: number;
  channel: AlertChannel;
  cooldown_minutes: number;
}

interface D1RecentAlertRow extends D1AlertRuleRow {
  log_id: number;
  triggered_at: string;
  best_sell: number | null;
  best_buy: number | null;
}

interface D1WatchlistRow {
  type_id: number;
  name: string;
}


const MAX_BATCH_ROWS = 500;
const MAX_BODY_BYTES = 1_000_000;
const DEFAULT_HISTORY_LIMIT = 168;
const MAX_HISTORY_LIMIT = 1_000;
const MAX_ALERT_LOG_BATCH = 100;

function json(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(value), { ...init, headers });
}

function error(message: string, status: number): Response {
  return json({ error: message }, { status });
}

function parsePositiveInteger(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function isFiniteNullable(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 20 &&
    value.length <= 40 &&
    Number.isFinite(Date.parse(value))
  );
}

function isAlertDirection(value: unknown): value is AlertDirection {
  return value === "sell_at_or_below" || value === "buy_at_or_above";
}

function isAlertChannel(value: unknown): value is AlertChannel {
  return value === "discord" || value === "browser" || value === "both";
}

function isAlertRuleInput(value: unknown): value is Omit<AlertRule, "id"> {
  if (!value || typeof value !== "object") return false;
  const rule = value as Partial<AlertRule>;
  return (
    isNonNegativeInteger(rule.regionId) && rule.regionId > 0 &&
    isNonNegativeInteger(rule.typeId) && rule.typeId > 0 &&
    isAlertDirection(rule.direction) &&
    typeof rule.thresholdIsk === "number" && Number.isFinite(rule.thresholdIsk) && rule.thresholdIsk > 0 &&
    isAlertChannel(rule.channel) &&
    (rule.cooldownMinutes === undefined ||
      (isNonNegativeInteger(rule.cooldownMinutes) && rule.cooldownMinutes >= 1 && rule.cooldownMinutes <= 10_080))
  );
}

function isWatchlistInput(value: unknown): value is Required<WatchlistItem> {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<WatchlistItem>;
  return (
    isNonNegativeInteger(item.typeId) && item.typeId > 0 &&
    typeof item.name === "string" && item.name.trim().length > 0 && item.name.trim().length <= 128
  );
}

function isMarketRow(value: unknown): value is MarketSnapshotRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<MarketSnapshotRow>;
  return (
    isNonNegativeInteger(row.regionId) && row.regionId > 0 &&
    isNonNegativeInteger(row.typeId) && row.typeId > 0 &&
    isIsoTimestamp(row.timestamp) &&
    isFiniteNullable(row.bestSell) &&
    isFiniteNullable(row.bestBuy) &&
    isNonNegativeInteger(row.sellVolume) &&
    isNonNegativeInteger(row.buyVolume) &&
    isNonNegativeInteger(row.sellOrderCount) &&
    isNonNegativeInteger(row.buyOrderCount)
  );
}

function isStructureRow(value: unknown): value is StructureSnapshotRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<StructureSnapshotRow>;
  return (
    isNonNegativeInteger(row.structureId) && row.structureId > 0 &&
    isNonNegativeInteger(row.typeId) && row.typeId > 0 &&
    isIsoTimestamp(row.timestamp) &&
    isFiniteNullable(row.bestSell) &&
    isFiniteNullable(row.bestBuy) &&
    isNonNegativeInteger(row.sellVolume) &&
    isNonNegativeInteger(row.buyVolume) &&
    isNonNegativeInteger(row.sellOrderCount) &&
    isNonNegativeInteger(row.buyOrderCount)
  );
}

function hasValidBatchEnvelope(value: unknown): value is {
  runId: string;
  timestamp: string;
  rows: unknown[];
} {
  if (!value || typeof value !== "object") return false;
  const batch = value as { runId?: unknown; timestamp?: unknown; rows?: unknown };
  return (
    typeof batch.runId === "string" &&
    batch.runId.length > 0 &&
    batch.runId.length <= 128 &&
    isIsoTimestamp(batch.timestamp) &&
    Array.isArray(batch.rows) &&
    batch.rows.length > 0 &&
    batch.rows.length <= MAX_BATCH_ROWS
  );
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > MAX_BODY_BYTES) throw new RangeError("Request body is too large");
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) throw new RangeError("Request body is too large");
  return JSON.parse(body);
}

function checkAuth(request: Request, env: Env): Response | null {
  const hostname = new URL(request.url).hostname;
  if (env.LOCAL_DEV === "true" && (hostname === "127.0.0.1" || hostname === "localhost")) {
    return null;
  }
  if (!env.INGEST_SECRET) return error("Ingest secret is not configured", 503);
  const providedSecret = request.headers.get("X-Ingest-Secret");
  return providedSecret === env.INGEST_SECRET ? null : error("Unauthorized", 401);
}

function mapMarketRow(row: D1MarketRow): MarketSnapshotRow {
  return {
    regionId: row.region_id,
    typeId: row.type_id,
    timestamp: row.ts,
    bestSell: row.best_sell,
    bestBuy: row.best_buy,
    sellVolume: row.sell_volume,
    buyVolume: row.buy_volume,
    sellOrderCount: row.sell_order_count,
    buyOrderCount: row.buy_order_count,
    bestSellLocationId: row.best_sell_location_id,
    bestSellSystemId: row.best_sell_system_id,
    bestBuyLocationId: row.best_buy_location_id,
    bestBuySystemId: row.best_buy_system_id,
  };
}

function mapAlertRule(row: D1AlertRuleRow): AlertRule {
  return {
    id: row.id,
    regionId: row.region_id,
    typeId: row.type_id,
    direction: row.direction,
    thresholdIsk: row.threshold_isk,
    channel: row.channel,
    cooldownMinutes: row.cooldown_minutes,
  };
}

async function readAlertRules(env: Env): Promise<AlertRule[]> {
  const result = await env.DB.prepare(
    `SELECT id, region_id, type_id, direction, threshold_isk, channel, cooldown_minutes
     FROM alert_rules WHERE enabled = 1 ORDER BY type_id, region_id, id`
  ).all<D1AlertRuleRow>();
  return result.results.map(mapAlertRule);
}

async function handleAlertRuleCreate(request: Request, env: Env): Promise<Response> {
  const input = await readJsonBody(request);
  if (!isAlertRuleInput(input)) return error("Invalid alert rule", 400);
  const rule: AlertRule = {
    ...input,
    id: crypto.randomUUID(),
    cooldownMinutes: input.cooldownMinutes ?? 240,
  };
  await env.DB.prepare(
    `INSERT INTO alert_rules
      (id, region_id, type_id, direction, threshold_isk, channel, cooldown_minutes, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
  ).bind(
    rule.id, rule.regionId, rule.typeId, rule.direction,
    rule.thresholdIsk, rule.channel, rule.cooldownMinutes
  ).run();
  return json(rule, { status: 201 });
}

async function handleAlertRuleDelete(id: string, env: Env): Promise<Response> {
  if (!id || id.length > 128) return error("Invalid alert rule id", 400);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM alert_log WHERE rule_id = ?").bind(id),
    env.DB.prepare("DELETE FROM alert_rules WHERE id = ?").bind(id),
  ]);
  return json({ ok: true });
}

async function handleRecentAlerts(url: URL, env: Env): Promise<Response> {
  const requestedLimit = parsePositiveInteger(url.searchParams.get("limit"));
  const limit = Math.min(requestedLimit ?? 30, 100);
  const result = await env.DB.prepare(
    `SELECT l.id AS log_id, l.triggered_at, l.best_sell, l.best_buy,
            r.id, r.region_id, r.type_id, r.direction, r.threshold_isk,
            r.channel, r.cooldown_minutes
     FROM alert_log AS l
     JOIN alert_rules AS r ON r.id = l.rule_id
     WHERE r.channel IN ('browser', 'both')
     ORDER BY l.triggered_at DESC LIMIT ?`
  ).bind(limit).all<D1RecentAlertRow>();
  const rows: RecentAlert[] = result.results.map((row) => ({
    id: row.log_id,
    ruleId: row.id,
    regionId: row.region_id,
    typeId: row.type_id,
    direction: row.direction,
    thresholdIsk: row.threshold_isk,
    channel: row.channel,
    triggeredAt: row.triggered_at,
    bestSell: row.best_sell,
    bestBuy: row.best_buy,
  }));
  const response: RecentAlertsResponse = { rows };
  return json(response, { headers: { "Cache-Control": "no-store" } });
}

async function handleTriggeredAlerts(request: Request, env: Env): Promise<Response> {
  const input = await readJsonBody(request) as { alerts?: unknown };
  if (!input || !Array.isArray(input.alerts) || input.alerts.length > MAX_ALERT_LOG_BATCH) {
    return error("Invalid triggered alert batch", 400);
  }
  const alerts = input.alerts as TriggeredAlert[];
  const valid = alerts.every((alert) =>
    alert && typeof alert === "object" && isIsoTimestamp(alert.triggeredAt) &&
    alert.rule && typeof alert.rule.id === "string" && alert.rule.id.length <= 128 &&
    isMarketRow(alert.row)
  );
  if (!valid) return error("Invalid triggered alert batch", 400);
  if (alerts.length === 0) return json({ ok: true, rowsWritten: 0 });
  const statement = env.DB.prepare(
    `INSERT INTO alert_log (rule_id, triggered_at, best_sell, best_buy)
     SELECT id, ?, ?, ? FROM alert_rules WHERE id = ? AND enabled = 1`
  );
  await env.DB.batch(alerts.map((alert) => statement.bind(
    alert.triggeredAt, alert.row.bestSell, alert.row.bestBuy, alert.rule.id
  )));
  return json({ ok: true, rowsWritten: alerts.length });
}

async function readWatchlist(env: Env): Promise<WatchlistItem[]> {
  const result = await env.DB.prepare(
    "SELECT type_id, name FROM watchlist ORDER BY name COLLATE NOCASE"
  ).all<D1WatchlistRow>();
  return result.results.map((row) => ({ typeId: row.type_id, name: row.name }));
}

type CollectorDispatch = "queued" | "local" | "not_configured" | "failed";

async function dispatchCollector(env: Env): Promise<CollectorDispatch> {
  if (env.LOCAL_DEV === "true") return "local";
  if (!env.GITHUB_ACTIONS_TOKEN) return "not_configured";
  const repository = env.GITHUB_REPOSITORY ?? "xinox/Eve-Market-Scout";
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) return "failed";
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/actions/workflows/collect-market-data.yml/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${env.GITHUB_ACTIONS_TOKEN}`,
          "X-GitHub-Api-Version": "2026-03-10",
          "User-Agent": "eve-market-scout",
        },
        body: JSON.stringify({ ref: env.GITHUB_REF ?? "main" }),
      }
    );
    if (!response.ok) console.error("Collector dispatch failed", response.status);
    return response.ok ? "queued" : "failed";
  } catch (error) {
    console.error("Collector dispatch failed", error);
    return "failed";
  }
}

async function handleWatchlistCreate(request: Request, env: Env): Promise<Response> {
  const input = await readJsonBody(request);
  if (!isWatchlistInput(input)) return error("Invalid watchlist item", 400);
  const item = { typeId: input.typeId, name: input.name.trim() };
  await env.DB.prepare(
    `INSERT INTO watchlist (type_id, name) VALUES (?, ?)
     ON CONFLICT(type_id) DO UPDATE SET name = excluded.name`
  ).bind(item.typeId, item.name).run();
  const collector = await dispatchCollector(env);
  return json({ ...item, collector }, { status: 201 });
}

async function handleWatchlistDelete(typeId: number | null, env: Env): Promise<Response> {
  if (typeId === null) return error("Invalid type id", 400);
  await env.DB.prepare("DELETE FROM watchlist WHERE type_id = ?").bind(typeId).run();
  return json({ ok: true });
}


async function handleRegionIngest(request: Request, env: Env): Promise<Response> {
  const input = await readJsonBody(request);
  if (!hasValidBatchEnvelope(input) || !input.rows.every(isMarketRow)) {
    return error("Invalid market snapshot batch", 400);
  }
  const batch = input as SnapshotBatch;
  const historyStatement = env.DB.prepare(
    `INSERT OR IGNORE INTO market_snapshot
      (region_id, type_id, ts, best_sell, best_buy, sell_volume, buy_volume,
       sell_order_count, buy_order_count, best_sell_location_id,
       best_sell_system_id, best_buy_location_id, best_buy_system_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const latestStatement = env.DB.prepare(
    `INSERT INTO market_latest
      (region_id, type_id, ts, best_sell, best_buy, sell_volume, buy_volume,
       sell_order_count, buy_order_count, best_sell_location_id,
       best_sell_system_id, best_buy_location_id, best_buy_system_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(region_id, type_id) DO UPDATE SET
       ts = excluded.ts,
       best_sell = excluded.best_sell,
       best_buy = excluded.best_buy,
       sell_volume = excluded.sell_volume,
       buy_volume = excluded.buy_volume,
       sell_order_count = excluded.sell_order_count,
       buy_order_count = excluded.buy_order_count,
       best_sell_location_id = excluded.best_sell_location_id,
       best_sell_system_id = excluded.best_sell_system_id,
       best_buy_location_id = excluded.best_buy_location_id,
       best_buy_system_id = excluded.best_buy_system_id
     WHERE excluded.ts >= market_latest.ts`
  );
  const bindRow = (statement: D1PreparedStatement, row: MarketSnapshotRow) =>
    statement.bind(
      row.regionId, row.typeId, row.timestamp, row.bestSell, row.bestBuy,
      row.sellVolume, row.buyVolume, row.sellOrderCount, row.buyOrderCount,
      row.bestSellLocationId ?? null, row.bestSellSystemId ?? null,
      row.bestBuyLocationId ?? null, row.bestBuySystemId ?? null
    );
  await env.DB.batch(
    batch.rows.flatMap((row) => [
      bindRow(historyStatement, row),
      bindRow(latestStatement, row),
    ])
  );
  return json({ ok: true, rowsWritten: batch.rows.length });
}

async function handleStructureIngest(request: Request, env: Env): Promise<Response> {
  const input = await readJsonBody(request);
  if (!hasValidBatchEnvelope(input) || !input.rows.every(isStructureRow)) {
    return error("Invalid structure snapshot batch", 400);
  }
  const batch = input as StructureSnapshotBatch;
  const stmt = env.DB.prepare(
    `INSERT OR REPLACE INTO structure_snapshot
      (structure_id, type_id, ts, best_sell, best_buy, sell_volume, buy_volume,
       sell_order_count, buy_order_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  await env.DB.batch(
    batch.rows.map((row) =>
      stmt.bind(
        row.structureId, row.typeId, row.timestamp, row.bestSell, row.bestBuy,
        row.sellVolume, row.buyVolume, row.sellOrderCount, row.buyOrderCount
      )
    )
  );
  return json({ ok: true, rowsWritten: batch.rows.length });
}

async function handleLatestMarkets(url: URL, env: Env): Promise<Response> {
  const regionId = parsePositiveInteger(url.searchParams.get("regionId"));
  const typeId = parsePositiveInteger(url.searchParams.get("typeId"));
  if (url.searchParams.has("regionId") && regionId === null) return error("Invalid regionId", 400);
  if (url.searchParams.has("typeId") && typeId === null) return error("Invalid typeId", 400);

  const conditions: string[] = [];
  const bindings: number[] = [];
  if (regionId !== null) {
    conditions.push("m.region_id = ?");
    bindings.push(regionId);
  }
  if (typeId !== null) {
    conditions.push("m.type_id = ?");
    bindings.push(typeId);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const query = `SELECT m.* FROM market_latest AS m ${where} ORDER BY m.type_id, m.region_id`;
  const result = await env.DB.prepare(query).bind(...bindings).all<D1MarketRow>();
  const response: LatestMarketResponse = {
    generatedAt: new Date().toISOString(),
    rows: result.results.map(mapMarketRow),
  };
  return json(response, { headers: { "Cache-Control": "public, max-age=30" } });
}

async function handleMarketHistory(url: URL, env: Env): Promise<Response> {
  const regionId = parsePositiveInteger(url.searchParams.get("regionId"));
  const typeId = parsePositiveInteger(url.searchParams.get("typeId"));
  if (regionId === null || typeId === null) {
    return error("regionId and typeId are required positive integers", 400);
  }
  const requestedLimit = parsePositiveInteger(url.searchParams.get("limit"));
  const limit = Math.min(requestedLimit ?? DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT);
  const result = await env.DB.prepare(
    `SELECT * FROM market_snapshot
     WHERE region_id = ? AND type_id = ?
     ORDER BY ts DESC
     LIMIT ?`
  ).bind(regionId, typeId, limit).all<D1MarketRow>();
  const response: MarketHistoryResponse = {
    regionId,
    typeId,
    rows: result.results.map(mapMarketRow),
  };
  return json(response, { headers: { "Cache-Control": "public, max-age=60" } });
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return json({ ok: true, service: "eve-market-scout", timestamp: new Date().toISOString() });
  }
  if (request.method === "GET" && url.pathname === "/api/markets/latest") {
    return handleLatestMarkets(url, env);
  }
  if (request.method === "GET" && url.pathname === "/api/markets/history") {
    return handleMarketHistory(url, env);
  }
  if (request.method === "GET" && url.pathname === "/api/alerts/rules") {
    const response: AlertRulesResponse = { rows: await readAlertRules(env) };
    return json(response, { headers: { "Cache-Control": "no-store" } });
  }
  if (request.method === "GET" && url.pathname === "/api/alerts/recent") {
    return handleRecentAlerts(url, env);
  }
  if (request.method === "GET" && url.pathname === "/api/watchlist") {
    const response: WatchlistResponse = { rows: await readWatchlist(env) };
    return json(response, { headers: { "Cache-Control": "no-store" } });
  }
  if (request.method === "POST" && url.pathname === "/api/watchlist") {
    const authError = checkAuth(request, env);
    return authError ?? handleWatchlistCreate(request, env);
  }
  if (request.method === "DELETE" && url.pathname.startsWith("/api/watchlist/")) {
    const authError = checkAuth(request, env);
    if (authError) return authError;
    return handleWatchlistDelete(parsePositiveInteger(url.pathname.slice("/api/watchlist/".length)), env);
  }
  if (request.method === "POST" && url.pathname === "/api/alerts/rules") {
    const authError = checkAuth(request, env);
    return authError ?? handleAlertRuleCreate(request, env);
  }
  if (request.method === "DELETE" && url.pathname.startsWith("/api/alerts/rules/")) {
    const authError = checkAuth(request, env);
    if (authError) return authError;
    return handleAlertRuleDelete(decodeURIComponent(url.pathname.slice("/api/alerts/rules/".length)), env);
  }
  if (request.method === "GET" && url.pathname === "/ingest/alert-rules") {
    const authError = checkAuth(request, env);
    if (authError) return authError;
    const response: AlertRulesResponse = { rows: await readAlertRules(env) };
    return json(response);
  }
  if (request.method === "GET" && url.pathname === "/ingest/watchlist") {
    const authError = checkAuth(request, env);
    if (authError) return authError;
    const response: WatchlistResponse = { rows: await readWatchlist(env) };
    return json(response);
  }
  if (request.method === "POST" && url.pathname === "/ingest/alerts") {
    const authError = checkAuth(request, env);
    return authError ?? handleTriggeredAlerts(request, env);
  }
  if (
    request.method === "POST" &&
    (url.pathname === "/ingest" || url.pathname === "/ingest/structures")
  ) {
    const authError = checkAuth(request, env);
    if (authError) return authError;
    if (url.pathname === "/ingest") return handleRegionIngest(request, env);
    if (url.pathname === "/ingest/structures") return handleStructureIngest(request, env);
  }
  return error("Not found", 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (caught) {
      if (caught instanceof SyntaxError) return error("Invalid JSON", 400);
      if (caught instanceof RangeError) return error(caught.message, 413);
      console.error("Unhandled request error", caught);
      return error("Internal server error", 500);
    }
  },
};
