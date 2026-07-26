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
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
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
const ENV_PATH = path.join(REPO_ROOT, ".env");

// Keys we allow setting from the browser. Deliberately a whitelist — this
// writes to .env, so we don't want an open "set any env var" endpoint.
// Values are read back masked (see readEnvSettings) except where noted.
const SETTABLE_ENV_KEYS = [
  "DISCORD_WEBHOOK_URL",
  "ESI_USER_AGENT",
  "STORAGE_MODE",
  "INGEST_API_URL",
  "INGEST_API_SECRET",
] as const;
type SettableEnvKey = (typeof SETTABLE_ENV_KEYS)[number];

/** Minimal .env parser: KEY=value per line, '#' comments, optional quotes.
 * Good enough for this local tool — not meant to handle every dotenv edge
 * case (multiline values, escaping, etc.). */
function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function readEnvSettings(): Record<SettableEnvKey, string> {
  const content = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf-8") : "";
  const parsed = parseEnvFile(content);
  const result = {} as Record<SettableEnvKey, string>;
  for (const key of SETTABLE_ENV_KEYS) result[key] = parsed[key] ?? "";
  return result;
}

/** Updates a single KEY=value line in .env, preserving every other line
 * (including comments) exactly as-is. Appends a new line if the key isn't
 * present yet. Creates .env from scratch if it doesn't exist. */
function writeEnvSetting(key: SettableEnvKey, value: string): void {
  const content = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf-8") : "";
  const lines = content.split("\n");
  const needsQuotes = /[\s#]/.test(value);
  const newLine = `${key}=${needsQuotes ? JSON.stringify(value) : value}`;
  let found = false;
  const nextLines = lines.map((rawLine) => {
    const line = rawLine.trim();
    if (!found && line && !line.startsWith("#") && line.startsWith(`${key}=`)) {
      found = true;
      return newLine;
    }
    return rawLine;
  });
  if (!found) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1].trim() !== "") {
      nextLines.push("");
    }
    nextLines.push(newLine);
  }
  writeFileSync(ENV_PATH, nextLines.join("\n").replace(/\n*$/, "\n"), "utf-8");
}

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

/**
 * Raw JSON editor for every config/*.json file, for fast prototyping —
 * lets us tweak regions/structures/events etc. from the browser instead of
 * a terminal, without hand-rolling typed forms for every one of them like
 * watchlist/alert-rules got above. Whitelisted by name to avoid writing
 * to arbitrary paths.
 */
const CONFIG_FILES: Record<string, string> = {
  regions: "regions.json",
  watchlist: "watchlist.json",
  "alert-rules": "alert-rules.json",
  structures: "structures.json",
  "structure-alert-rules": "structure-alert-rules.json",
  events: "events.json",
};

function configFilePath(name: string): string | null {
  const file = CONFIG_FILES[name];
  if (!file) return null;
  const realPath = path.join(REPO_ROOT, "config", file);
  if (existsSync(realPath)) return realPath;
  const examplePath = path.join(REPO_ROOT, "config", file.replace(/\.json$/, ".example.json"));
  return existsSync(examplePath) ? examplePath : realPath;
}

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const urlPath = req.url === "/" ? "/index.html" : (req.url ?? "/index.html");
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  let contents: Buffer;
  try {
    contents = readFileSync(filePath);
  } catch {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
  res.end(contents);
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

    if (url.pathname === "/api/settings" && req.method === "GET") {
      return sendJson(res, 200, readEnvSettings());
    }

    if (url.pathname === "/api/settings" && req.method === "PUT") {
      const body = JSON.parse(await readBody(req)) as { key: string; value: string };
      if (!SETTABLE_ENV_KEYS.includes(body.key as SettableEnvKey)) {
        return sendJson(res, 400, { error: `Unknown setting: ${body.key}` });
      }
      writeEnvSetting(body.key as SettableEnvKey, body.value ?? "");
      logger.info("Saved setting via UI", { key: body.key });
      // Note: this process itself doesn't reload .env — it only affects
      // future `npm run collect` / `npm run manage` invocations, which now
      // load .env via --env-file-if-exists (see root package.json).
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === "/api/config-files" && req.method === "GET") {
      return sendJson(res, 200, Object.keys(CONFIG_FILES));
    }

    if (url.pathname.startsWith("/api/config/") && req.method === "GET") {
      const name = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      const filePath = configFilePath(name);
      if (!filePath) return sendJson(res, 404, { error: `Unknown config file: ${name}` });
      const content = existsSync(filePath) ? readFileSync(filePath, "utf-8") : "[]\n";
      return sendJson(res, 200, { content, path: path.relative(REPO_ROOT, filePath) });
    }

    if (url.pathname.startsWith("/api/config/") && req.method === "PUT") {
      const name = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      const file = CONFIG_FILES[name];
      if (!file) return sendJson(res, 404, { error: `Unknown config file: ${name}` });
      const body = JSON.parse(await readBody(req)) as { content: string };
      let parsed: unknown;
      try {
        parsed = JSON.parse(body.content);
      } catch (err) {
        return sendJson(res, 400, { error: `Invalid JSON: ${String(err)}` });
      }
      // Always write to the real (non-.example) file, even if we were
      // editing the example fallback — prototyping edits shouldn't silently
      // overwrite the checked-in template.
      const realPath = path.join(REPO_ROOT, "config", file);
      writeFileSync(realPath, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
      logger.info("Saved config file via UI", { name, path: path.relative(REPO_ROOT, realPath) });
      return sendJson(res, 200, { ok: true });
    }

    return serveStatic(req, res);
  } catch (err) {
    logger.error("Request failed", { path: url.pathname, err: String(err) });
    // Guard against double-responding (e.g. a handler that already wrote
    // headers before throwing) — that would crash the whole process with
    // ERR_HTTP_HEADERS_SENT instead of just failing this one request.
    if (!res.headersSent) return sendJson(res, 500, { error: String(err) });
    res.end();
  }
});

// Last-resort safety net: an uncaught error in a request handler should
// never take down this local dev tool's whole process.
server.on("clientError", (err, socket) => {
  logger.error("Client error", { err: String(err) });
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

server.listen(PORT, () => {
  logger.info(`Alert manager UI running at http://localhost:${PORT}`);
});
