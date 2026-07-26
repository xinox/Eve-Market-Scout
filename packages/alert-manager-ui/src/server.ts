/**
 * Local-only web UI for managing the watchlist and alert rules without
 * hand-editing config/*.json. Deliberately built on node:http + a plain
 * static HTML/JS page instead of Vite/React/Express — this is a small
 * CRUD form over two JSON files, not worth a build pipeline for.
 *
 * This is a stopgap ahead of the real apps/web dashboard (see its README):
 * that one needs a deployed query-api + trade-analyzer wiring and is a
 * bigger project. This just answers "where do I set thresholds" today.
 *
 * Run with: npm run manage (see root package.json)
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  logger,
  loadRegions,
  loadWatchlist,
  saveWatchlist,
  loadAlertRules,
  saveAlertRules,
  type WatchlistItem,
  type AlertRule,
  type SnapshotBatch,
} from "@eve-market-scout/shared";

const PORT = Number(process.env.PORT ?? 4310);
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
const SNAPSHOTS_DIR = path.join(REPO_ROOT, "data", "snapshots");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

/** Reads the most recently written local JSON snapshot (JsonFileStore output),
 * used only to show "latest known price" hints in the UI — best-effort, not
 * authoritative (that's D1/query-api's job once it exists). */
function loadLatestSnapshotRows(): SnapshotBatch["rows"] {
  try {
    const files = readdirSync(SNAPSHOTS_DIR).filter((f) => f.endsWith(".json"));
    if (files.length === 0) return [];
    const newest = files
      .map((f) => ({ f, mtime: statSync(path.join(SNAPSHOTS_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)[0].f;
    const batch = JSON.parse(
      readFileSync(path.join(SNAPSHOTS_DIR, newest), "utf-8")
    ) as SnapshotBatch;
    return batch.rows;
  } catch {
    return [];
  }
}

/** Resolves a type_id's display name via ESI's public universe endpoint,
 * so the user doesn't have to look up item names by hand. Best-effort:
 * falls back to `Type {id}` if ESI is unreachable or the id is invalid. */
async function resolveTypeName(typeId: number): Promise<string> {
  try {
    const res = await fetch(`https://esi.evetech.net/latest/universe/types/${typeId}/`, {
      headers: { "User-Agent": process.env.ESI_USER_AGENT ?? "eve-market-scout/0.1" },
    });
    if (!res.ok) return `Type ${typeId}`;
    const data = (await res.json()) as { name?: string };
    return data.name ?? `Type ${typeId}`;
  } catch {
    return `Type ${typeId}`;
  }
}

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const urlPath = req.url === "/" ? "/index.html" : (req.url ?? "/index.html");
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
    res.end(readFileSync(filePath));
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  try {
    if (url.pathname === "/api/regions" && req.method === "GET") {
      return sendJson(res, 200, loadRegions());
    }

    if (url.pathname === "/api/watchlist" && req.method === "GET") {
      return sendJson(res, 200, loadWatchlist());
    }

    if (url.pathname === "/api/watchlist" && req.method === "POST") {
      const body = JSON.parse(await readBody(req)) as { typeId: number; name?: string };
      if (!body.typeId) return sendJson(res, 400, { error: "typeId is required" });
      const items = loadWatchlist();
      if (items.some((i) => i.typeId === body.typeId)) {
        return sendJson(res, 409, { error: "typeId already on watchlist" });
      }
      const name = body.name?.trim() || (await resolveTypeName(body.typeId));
      const next: WatchlistItem[] = [...items, { typeId: body.typeId, name }];
      saveWatchlist(next);
      logger.info("Added watchlist item", { typeId: body.typeId, name });
      return sendJson(res, 201, next);
    }

    if (url.pathname.startsWith("/api/watchlist/") && req.method === "DELETE") {
      const typeId = Number(url.pathname.split("/").pop());
      const next = loadWatchlist().filter((i) => i.typeId !== typeId);
      saveWatchlist(next);
      // Alert rules pointing at a removed item are left alone (they simply
      // won't match any snapshot row) — deleting them silently could surprise
      // someone who re-adds the item later.
      return sendJson(res, 200, next);
    }

    if (url.pathname === "/api/alert-rules" && req.method === "GET") {
      return sendJson(res, 200, loadAlertRules());
    }

    if (url.pathname === "/api/alert-rules" && req.method === "POST") {
      const body = JSON.parse(await readBody(req)) as Omit<AlertRule, "id">;
      if (!body.regionId || !body.typeId || !body.direction || !body.thresholdIsk) {
        return sendJson(res, 400, { error: "regionId, typeId, direction, thresholdIsk are required" });
      }
      const rule: AlertRule = {
        id: `${body.typeId}-${body.regionId}-${body.direction}-${Date.now()}`,
        regionId: body.regionId,
        typeId: body.typeId,
        direction: body.direction,
        thresholdIsk: body.thresholdIsk,
        channel: body.channel ?? "both",
        cooldownMinutes: body.cooldownMinutes ?? 240,
      };
      const next = [...loadAlertRules(), rule];
      saveAlertRules(next);
      logger.info("Added alert rule", { id: rule.id });
      return sendJson(res, 201, next);
    }

    if (url.pathname.startsWith("/api/alert-rules/") && req.method === "DELETE") {
      const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      const next = loadAlertRules().filter((r) => r.id !== id);
      saveAlertRules(next);
      return sendJson(res, 200, next);
    }

    if (url.pathname === "/api/latest-prices" && req.method === "GET") {
      return sendJson(res, 200, loadLatestSnapshotRows());
    }

    return serveStatic(req, res);
  } catch (err) {
    logger.error("Request failed", { path: url.pathname, err: String(err) });
    return sendJson(res, 500, { error: String(err) });
  }
});

server.listen(PORT, () => {
  logger.info(`Alert manager UI running at http://localhost:${PORT}`);
});
