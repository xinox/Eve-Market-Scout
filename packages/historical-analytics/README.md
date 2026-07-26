# @eve-market-scout/historical-analytics (Phase 3 — not yet implemented)

Will pull `/markets/{region_id}/history/` (ESI gives ~380 days of daily
aggregates per region/type for free — no need to wait for our own snapshots
to accumulate) and correlate price/volume moves with a curated list of known
game events (store sales, patch days) in `config/events.json`.

Later step: feed the aggregated series + event annotations to the Claude API
for a natural-language summary ("did the last PLEX sale move prices?").

See `docs/ROADMAP.md` Phase 3 for the task breakdown.
