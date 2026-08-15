CREATE TABLE IF NOT EXISTS watchlist (
  type_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO watchlist (type_id, name) VALUES
  (44992, 'PLEX'),
  (40, 'Megacyte');
