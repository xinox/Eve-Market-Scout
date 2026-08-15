# Architecture

## Data flow

```
GitHub Actions (cron, every 30 minutes)
        │
        ▼
  packages/collector
        │  fetchRegionOrders() per configured region
        ▼
  packages/esi-client  ──────►  esi.evetech.net (public, no auth needed)
        │
        ▼
  aggregate.ts  (raw orders -> best sell/buy per type_id)
        │
        ▼
  MarketStore interface
        │
        ├── JsonFileStore (local dev, zero infra)
        └── HttpIngestStore ──► packages/ingest-api (Cloudflare Worker) ──► D1
        │
        ▼
  alert-engine.evaluateAlerts()
        │
        ▼
  notifiers-discord (webhook)  +  browser alerts (via query-api, Phase 1.5)
```

Later (Phase 2/3), `trade-analyzer` and `historical-analytics` read from the
same D1 tables — they don't touch the collector at all, they're pure
consumers of `market_snapshot`.

## Why GitHub Actions runs the collector, not a Cloudflare Worker Cron

Checked as of July 2026:

| Platform | Free-tier constraint that matters here |
|---|---|
| Cloudflare Workers (Free) | **10ms CPU time per invocation.** Fine for serving a read API, too tight for fetching + parsing multi-region order books. |
| Vercel (Hobby) | Cron via `vercel.json` is capped at **once per day** on Hobby; per-minute cadence needs Pro. Function timeout is 10s by default. |
| GitHub Actions | **Unlimited free minutes on public repos**, 6-hour job timeout, real Node.js environment, first-class cron syntax. |

So: GitHub Actions owns the "fetch ESI, aggregate, alert" job. Cloudflare
Workers own the always-on read API, authenticated ingest routes and static
dashboard assets in one deployment. The 10ms limit is a non-issue for the
small D1 queries used here.

One caveat: GitHub disables scheduled workflows on a public repo automatically
after 60 days of zero repo activity. Any commit, or a manual
`workflow_dispatch` run, resets that clock — unlikely to matter while
actively developing, worth remembering if the project goes dormant.

GitHub's `schedule` trigger is best-effort and can delay or skip runs under
load. The configured 30-minute cadence (`7,37 * * * *`) is offset from the
top of the hour to reduce that risk. If minute-precise execution becomes
necessary, the fix is to stop
relying on GitHub's scheduler entirely: run the collector logic as an HTTP
endpoint (e.g. a route on the `ingest-api` Worker) and have an external,
minute-precise pinger (Vercel Cron on a paid plan, cron-job.org, etc.)
call it — decouples the trigger from any single platform's scheduler.

## Why D1 over KV or a full Postgres

- **KV** is a poor fit for time-series rows with range queries (get history
  for type X over the last 30 days) — it's a flat key-value store.
- **D1** (SQLite-based) gives real SQL, 5 GB storage, 5M rows read per day
  and 100k rows written per day on Free, and integrates natively with the Worker that already needs to
  exist for ingestion. At the data volumes here (a handful of hubs, a
  watchlist rather than all ~8000 types), this is nowhere near the limit for
  a long time.
- **Managed Postgres** (Supabase/Neon free tiers) is a reasonable alternative
  if you outgrow D1 or want Postgres-specific features (window functions,
  extensions) for Phase 3 analytics — the `MarketStore` interface is exactly
  the seam to swap this in later without touching the collector.

## Why aggregate-only storage, not every raw order

A region's full order book can be tens of thousands of orders across all
types. Storing every order every hour would burn through D1's free tier
fast and mostly store noise (99% of a station's order book is irrelevant to
"what's the best price right now"). `aggregate.ts` collapses this to one row
per (region, type) per run: best sell, best buy, total volume on each side.

If Phase 2's arbitrage analysis later needs order-book depth (e.g. "how much
can I actually buy at that price before it moves"), extend `aggregate.ts` to
keep the top N orders per side instead of just the best one — a targeted
change, not a redesign.

## Why region scope starts narrow

ESI has no single endpoint for "all orders, all regions" — you fetch region
by region, and EVE has ~100 regions (most with negligible trade volume).
Scanning everything means tens of thousands of paginated requests per cycle.
The 5 major trade hubs (Jita, Amarr, Dodixie, Rens, Hek) represent the vast
majority of tradeable volume; expanding the `config/regions.json` list later
is a config change, not a code change — but do it gradually and watch the
collector's run time (GitHub Actions job has a 10-minute timeout configured
in the workflow; raise it if you expand scope).
