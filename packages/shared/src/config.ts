import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { RegionConfig, WatchlistItem, AlertRule, StructureConfig, StructureAlertRule } from "./types.js";

// Resolve paths relative to the repo root regardless of which package calls this.
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../"
);

function loadJson<T>(relativePath: string, fallback: T): T {
  const fullPath = path.join(REPO_ROOT, relativePath);
  if (!existsSync(fullPath)) return fallback;
  return JSON.parse(readFileSync(fullPath, "utf-8")) as T;
}

function saveJson<T>(relativePath: string, value: T): void {
  const fullPath = path.join(REPO_ROOT, relativePath);
  writeFileSync(fullPath, JSON.stringify(value, null, 2) + "\n", "utf-8");
}

export function loadRegions(): RegionConfig[] {
  return loadJson<RegionConfig[]>("config/regions.json", []);
}

export function loadWatchlist(): WatchlistItem[] {
  // Falls back to the example file so a fresh clone runs out of the box.
  const path_ = existsSync(path.join(REPO_ROOT, "config/watchlist.json"))
    ? "config/watchlist.json"
    : "config/watchlist.example.json";
  return loadJson<WatchlistItem[]>(path_, []);
}

export function saveWatchlist(items: WatchlistItem[]): void {
  saveJson("config/watchlist.json", items);
}

export function loadAlertRules(): AlertRule[] {
  const path_ = existsSync(path.join(REPO_ROOT, "config/alert-rules.json"))
    ? "config/alert-rules.json"
    : "config/alert-rules.example.json";
  return loadJson<AlertRule[]>(path_, []);
}

export function saveAlertRules(rules: AlertRule[]): void {
  saveJson("config/alert-rules.json", rules);
}

export function loadStructures(): StructureConfig[] {
  const path_ = existsSync(path.join(REPO_ROOT, "config/structures.json"))
    ? "config/structures.json"
    : "config/structures.example.json";
  return loadJson<StructureConfig[]>(path_, []);
}

export function loadStructureAlertRules(): StructureAlertRule[] {
  const path_ = existsSync(path.join(REPO_ROOT, "config/structure-alert-rules.json"))
    ? "config/structure-alert-rules.json"
    : "config/structure-alert-rules.example.json";
  return loadJson<StructureAlertRule[]>(path_, []);
}
