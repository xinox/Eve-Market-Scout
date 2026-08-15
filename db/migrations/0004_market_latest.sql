-- Keep one materialized latest row per (region, type). The dashboard reads
-- this small table instead of scanning the full time-series on every refresh.
CREATE TABLE IF NOT EXISTS market_latest (
  region_id INTEGER NOT NULL,
  type_id INTEGER NOT NULL,
  ts TEXT NOT NULL,
  best_sell REAL,
  best_buy REAL,
  sell_volume INTEGER NOT NULL DEFAULT 0,
  buy_volume INTEGER NOT NULL DEFAULT 0,
  sell_order_count INTEGER NOT NULL DEFAULT 0,
  buy_order_count INTEGER NOT NULL DEFAULT 0,
  best_sell_location_id INTEGER,
  best_sell_system_id INTEGER,
  best_buy_location_id INTEGER,
  best_buy_system_id INTEGER,
  PRIMARY KEY (region_id, type_id)
);

CREATE INDEX IF NOT EXISTS idx_market_latest_type
  ON market_latest (type_id, region_id);

INSERT OR REPLACE INTO market_latest
SELECT snapshot.*
FROM market_snapshot AS snapshot
JOIN (
  SELECT region_id, type_id, MAX(ts) AS ts
  FROM market_snapshot
  GROUP BY region_id, type_id
) AS newest
  ON newest.region_id = snapshot.region_id
 AND newest.type_id = snapshot.type_id
 AND newest.ts = snapshot.ts;

PRAGMA optimize;
