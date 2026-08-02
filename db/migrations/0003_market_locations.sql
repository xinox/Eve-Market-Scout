-- Phase 1.4+: track *where* the best sell/buy order was found, so alerts
-- can say "Jita IV - Moon 4" instead of just a region name.
-- Apply with: wrangler d1 execute eve-market-scout --file=db/migrations/0003_market_locations.sql

ALTER TABLE market_snapshot ADD COLUMN best_sell_location_id INTEGER;
ALTER TABLE market_snapshot ADD COLUMN best_sell_system_id INTEGER;
ALTER TABLE market_snapshot ADD COLUMN best_buy_location_id INTEGER;
ALTER TABLE market_snapshot ADD COLUMN best_buy_system_id INTEGER;
