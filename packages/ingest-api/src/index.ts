/**
 * Cloudflare Worker: receives snapshot batches from the collector
 * (GitHub Actions) and writes them into D1. This is the only piece that
 * needs an actual Cloudflare account + `wrangler d1 create` to activate —
 * see the README in this package for the exact setup steps.
 *
 * Two routes, one Worker: POST /ingest (region snapshots) and
 * POST /ingest/structures (Upwell structure snapshots, optional module).
 * Same shared-secret auth for both -- no reason to split this into two
 * Workers when the only difference is which table gets written.
 */

export interface Env {
  DB: D1Database;
  INGEST_SECRET: string;
}

interface SnapshotRow {
  regionId: number;
  typeId: number;
  timestamp: string;
  bestSell: number | null;
  bestBuy: number | null;
  sellVolume: number;
  buyVolume: number;
  sellOrderCount: number;
  buyOrderCount: number;
  bestSellLocationId?: number | null;
  bestSellSystemId?: number | null;
  bestBuyLocationId?: number | null;
  bestBuySystemId?: number | null;
}

interface StructureSnapshotRow {
  structureId: number;
  typeId: number;
  timestamp: string;
  bestSell: number | null;
  bestBuy: number | null;
  sellVolume: number;
  buyVolume: number;
  sellOrderCount: number;
  buyOrderCount: number;
}

interface SnapshotBatch<TRow> {
  runId: string;
  timestamp: string;
  rows: TRow[];
}

function checkAuth(request: Request, env: Env): Response | null {
  const providedSecret = request.headers.get("X-Ingest-Secret");
  if (providedSecret !== env.INGEST_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}

async function handleRegionIngest(request: Request, env: Env): Promise<Response> {
  const batch = (await request.json()) as SnapshotBatch<SnapshotRow>;
  if (!batch.rows?.length) return new Response("No rows", { status: 400 });

  // D1 batch: one prepared statement, many bindings — much cheaper than
  // one round-trip per row against the free tier's 5M-writes/month cap.
  const stmt = env.DB.prepare(
    `INSERT INTO market_snapshot
      (region_id, type_id, ts, best_sell, best_buy, sell_volume, buy_volume, sell_order_count, buy_order_count,
       best_sell_location_id, best_sell_system_id, best_buy_location_id, best_buy_system_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  await env.DB.batch(
    batch.rows.map((r) =>
      stmt.bind(
        r.regionId,
        r.typeId,
        r.timestamp,
        r.bestSell,
        r.bestBuy,
        r.sellVolume,
        r.buyVolume,
        r.sellOrderCount,
        r.buyOrderCount,
        r.bestSellLocationId ?? null,
        r.bestSellSystemId ?? null,
        r.bestBuyLocationId ?? null,
        r.bestBuySystemId ?? null
      )
    )
  );

  return new Response(
    JSON.stringify({ ok: true, rowsWritten: batch.rows.length }),
    { headers: { "Content-Type": "application/json" } }
  );
}

async function handleStructureIngest(request: Request, env: Env): Promise<Response> {
  const batch = (await request.json()) as SnapshotBatch<StructureSnapshotRow>;
  if (!batch.rows?.length) return new Response("No rows", { status: 400 });

  const stmt = env.DB.prepare(
    `INSERT INTO structure_snapshot
      (structure_id, type_id, ts, best_sell, best_buy, sell_volume, buy_volume, sell_order_count, buy_order_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  await env.DB.batch(
    batch.rows.map((r) =>
      stmt.bind(
        r.structureId,
        r.typeId,
        r.timestamp,
        r.bestSell,
        r.bestBuy,
        r.sellVolume,
        r.buyVolume,
        r.sellOrderCount,
        r.buyOrderCount
      )
    )
  );

  return new Response(
    JSON.stringify({ ok: true, rowsWritten: batch.rows.length }),
    { headers: { "Content-Type": "application/json" } }
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST") return new Response("Not found", { status: 404 });

    const authError = checkAuth(request, env);
    if (authError) return authError;

    if (url.pathname === "/ingest") return handleRegionIngest(request, env);
    if (url.pathname === "/ingest/structures") return handleStructureIngest(request, env);
    return new Response("Not found", { status: 404 });
  },
};
