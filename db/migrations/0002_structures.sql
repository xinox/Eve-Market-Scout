-- Phase 1 (structures module): schema for Upwell structure market snapshots.
-- Kept as a separate table from market_snapshot -- structureId and regionId
-- are different identity spaces, and querying "my citadel's history" vs
-- "The Forge's history" are naturally different queries anyway.
-- Apply with: wrangler d1 execute eve-market-scout --file=db/migrations/0002_structures.sql

CREATE TABLE IF NOT EXISTS structure_snapshot (
  structure_id INTEGER NOT NULL,
  type_id INTEGER NOT NULL,
  ts TEXT NOT NULL,
  best_sell REAL,
  best_buy REAL,
  sell_volume INTEGER NOT NULL DEFAULT 0,
  buy_volume INTEGER NOT NULL DEFAULT 0,
  sell_order_count INTEGER NOT NULL DEFAULT 0,
  buy_order_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (structure_id, type_id, ts)
);

CREATE INDEX IF NOT EXISTS idx_structure_snapshot_type_ts
  ON structure_snapshot (type_id, ts DESC);

CREATE TABLE IF NOT EXISTS structure_alert_rules (
  id TEXT PRIMARY KEY,
  structure_id INTEGER NOT NULL,
  type_id INTEGER NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('sell_at_or_below', 'buy_at_or_above')),
  threshold_isk REAL NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('discord', 'browser', 'both')),
  cooldown_minutes INTEGER NOT NULL DEFAULT 240,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS structure_alert_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id TEXT NOT NULL REFERENCES structure_alert_rules(id),
  triggered_at TEXT NOT NULL,
  best_sell REAL,
  best_buy REAL
);
