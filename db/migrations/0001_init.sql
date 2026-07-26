-- Phase 1.2: schema for the Cloudflare D1-backed production store.
-- Apply with: wrangler d1 execute eve-market-scout --file=db/migrations/0001_init.sql

CREATE TABLE IF NOT EXISTS market_snapshot (
  region_id INTEGER NOT NULL,
  type_id INTEGER NOT NULL,
  ts TEXT NOT NULL,
  best_sell REAL,
  best_buy REAL,
  sell_volume INTEGER NOT NULL DEFAULT 0,
  buy_volume INTEGER NOT NULL DEFAULT 0,
  sell_order_count INTEGER NOT NULL DEFAULT 0,
  buy_order_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (region_id, type_id, ts)
);

-- Fast "give me the latest row per type" lookups for the dashboard.
CREATE INDEX IF NOT EXISTS idx_snapshot_type_ts
  ON market_snapshot (type_id, ts DESC);

CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY,
  region_id INTEGER NOT NULL,
  type_id INTEGER NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('sell_at_or_below', 'buy_at_or_above')),
  threshold_isk REAL NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('discord', 'browser', 'both')),
  cooldown_minutes INTEGER NOT NULL DEFAULT 240,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS alert_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id TEXT NOT NULL REFERENCES alert_rules(id),
  triggered_at TEXT NOT NULL,
  best_sell REAL,
  best_buy REAL
);

-- Phase 1.5+: browser push subscriptions (Web Push / VAPID). Empty for now,
-- kept here so the schema story lives in one place from the start.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL
);
