/**
 * Core domain types shared by every package. Keep this file dependency-free
 * so any package (Worker, Node script, frontend) can import it without
 * pulling in Node-only or DOM-only APIs.
 */

/** A single EVE region we actively poll. Regions are the real market boundary
 * in EVE — not solar systems. See docs/ESI_NOTES.md. */
export interface RegionConfig {
  regionId: number;
  name: string;
}

/** An item (type_id) the user cares about, plus optional alert rules. */
export interface WatchlistItem {
  typeId: number;
  name?: string;
}

export interface WatchlistResponse {
  rows: WatchlistItem[];
}

export type AlertDirection =
  /** Fire when the best sell order is at or below the threshold (cheap buy). */
  | "sell_at_or_below"
  /** Fire when the best buy order is at or above the threshold (good sell). */
  | "buy_at_or_above";

export type AlertChannel = "discord" | "browser" | "both";

export interface AlertRule {
  id: string;
  regionId: number;
  typeId: number;
  direction: AlertDirection;
  thresholdIsk: number;
  channel: AlertChannel;
  /** Cooldown in minutes to avoid spamming the same alert every collector run. */
  cooldownMinutes?: number;
}

export interface AlertRulesResponse {
  rows: AlertRule[];
}

export interface RecentAlert {
  id: number;
  ruleId: string;
  regionId: number;
  typeId: number;
  direction: AlertDirection;
  thresholdIsk: number;
  channel: AlertChannel;
  triggeredAt: string;
  bestSell: number | null;
  bestBuy: number | null;
}

export interface RecentAlertsResponse {
  rows: RecentAlert[];
}

/** Raw order shape as returned by ESI's /markets/{region_id}/orders/ endpoint. */
export interface EsiMarketOrder {
  order_id: number;
  type_id: number;
  region_id?: number; // ESI doesn't include this field itself; we attach it after fetch.
  location_id: number;
  system_id: number;
  is_buy_order: boolean;
  price: number;
  volume_remain: number;
  volume_total: number;
  min_volume: number;
  duration: number;
  issued: string;
  range: string;
}

/** One EVE daily history entry from /markets/{region_id}/history/. */
export interface EsiMarketHistoryEntry {
  date: string;
  average: number;
  highest: number;
  lowest: number;
  order_count: number;
  volume: number;
}

/** Aggregated per (region, type) snapshot — what we actually persist,
 * instead of every raw order, to keep storage small. */
export interface MarketSnapshotRow {
  regionId: number;
  typeId: number;
  timestamp: string; // ISO string, when the collector run happened
  bestSell: number | null;
  bestBuy: number | null;
  sellVolume: number;
  buyVolume: number;
  sellOrderCount: number;
  buyOrderCount: number;
  /** Station/structure id of the order that set bestSell, if any — lets
   * alerts say *where* the best price was found, not just which region. */
  bestSellLocationId?: number | null;
  bestSellSystemId?: number | null;
  bestBuyLocationId?: number | null;
  bestBuySystemId?: number | null;
  /** True for a synthetic row built from ESI's global average price
   * (fallback for items with no live region order book, e.g. PLEX) —
   * never persisted to storage, only used to let alerts still evaluate.
   * See collector/src/index.ts. */
  isGlobalAverage?: boolean;
}

export interface SnapshotBatch {
  runId: string;
  timestamp: string;
  rows: MarketSnapshotRow[];
}

/** Public query API payload used by the dashboard. */
export interface LatestMarketResponse {
  generatedAt: string;
  rows: MarketSnapshotRow[];
}

/** Historical points for one item in one region, newest first. */
export interface MarketHistoryResponse {
  regionId: number;
  typeId: number;
  rows: MarketSnapshotRow[];
}

/** The minimal shape both region snapshots and structure snapshots satisfy.
 * TypeScript's structural typing means MarketSnapshotRow and
 * StructureSnapshotRow both already conform to this without inheritance --
 * it's what lets analyzeTrade() compare a region price against a structure
 * price with no special-casing. */
export interface PriceSnapshot {
  typeId: number;
  bestSell: number | null;
  bestBuy: number | null;
  sellVolume: number;
  buyVolume: number;
}

export interface TriggeredAlert {
  rule: AlertRule;
  row: MarketSnapshotRow;
  triggeredAt: string;
}

/** A player-owned Upwell structure (citadel) whose market you track.
 * Unlike regions, structures need an authenticated character with docking
 * access -- see packages/eve-sso. */
export interface StructureConfig {
  structureId: number;
  name: string;
}

export interface StructureSnapshotRow {
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

export interface StructureSnapshotBatch {
  runId: string;
  timestamp: string;
  rows: StructureSnapshotRow[];
}

export interface StructureAlertRule {
  id: string;
  structureId: number;
  typeId: number;
  direction: AlertDirection;
  thresholdIsk: number;
  channel: AlertChannel;
  cooldownMinutes?: number;
}

export interface TriggeredStructureAlert {
  rule: StructureAlertRule;
  row: StructureSnapshotRow;
  triggeredAt: string;
}
