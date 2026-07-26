# Roadmap

Three stages, matching the original brief, plus a Phase 0 that's already
scaffolded in this repo.

## Phase 0 — Foundations (done in this scaffold)

- [x] Monorepo structure, npm workspaces, TypeScript
- [x] `esi-client`: region orders + history, pagination, retry/backoff
- [x] `collector`: fetch → aggregate → store → alert pipeline
- [x] `alert-engine`: pure threshold logic with cooldown
- [x] `notifiers-discord`: webhook sender
- [x] `MarketStore` abstraction: `JsonFileStore` (local) / `HttpIngestStore` (prod)
- [x] `ingest-api`: Cloudflare Worker + D1 schema (needs your Cloudflare account to activate)
- [x] GitHub Actions: scheduled collector (every 4h) + CI typecheck
- [x] `trade-analyzer`: profit/margin math + single-hub and cross-hub
      ranking, ported and tested from a prior EVE trading project
- [x] `X-Compatibility-Date` header on every ESI request (found missing
      by comparing against that prior project — see docs/ESI_NOTES.md)
- [x] `eve-sso`: EVE SSO OAuth2 (auth URL, token exchange/refresh, JWT
      decode) ported from that project's validated auth flow
- [x] Structure market module: `fetchStructureOrders`, a separate
      `structureIndex.ts` collector entrypoint, `evaluateStructureAlerts`,
      a second D1 table, its own GitHub Actions workflow — fully optional,
      no-ops cleanly if `config/structures.json` is empty

**Milestone**: `npm run collect` runs locally, writes a JSON snapshot, and
(if configured) sends a Discord message when a watchlist item crosses a
threshold.

## Phase 1 — Data collection & alerts (your "erster Schritt")

1. **Verify Phase 0 locally.** Run `npm run collect`, check
   `data/snapshots/*.json` has sane best-sell/best-buy numbers for the
   watchlist. This is the first real checkpoint — do this before anything else.
2. **Stand up `ingest-api` + D1.** Follow `packages/ingest-api/README.md`.
   Flip `STORAGE_MODE` to `http` in GitHub Actions repo variables once deployed.
3. **Push the repo to GitHub, enable the scheduled workflow.** Add the
   secrets (`INGEST_API_URL`, `INGEST_API_SECRET`, `DISCORD_WEBHOOK_URL`) in
   repo settings. Trigger `workflow_dispatch` manually once to confirm the
   whole chain works before trusting the cron.
4. **Tune your watchlist and alert rules** in `config/watchlist.json` and
   `config/alert-rules.json` (gitignored copies of the `.example` files, or
   commit them — they contain no secrets).
5. **Browser alerts (simplest version first).** Build a minimal `query-api`
   Worker route (`GET /alerts/recent`) and have `apps/web` poll it every
   60s, showing a toast/notification. Real Web Push (VAPID + service worker,
   `push_subscriptions` table already in the schema) is a clean follow-up
   once polling works — don't start with it, it's meaningfully more complex
   for the same user-visible result at MVP stage.

**Milestone**: "Ich bekomme eine Discord-Nachricht (und sehe eine
Browser-Benachrichtigung), wenn PLEX in Jita unter X ISK fällt" — running
unattended on GitHub Actions, costing nothing. If you set up
`packages/eve-sso`, the same for a price at your own structure works too
(`npm run collect:structures`, its own workflow).

## Phase 2 — Trade opportunity analysis

**Update**: the core profit math is already implemented and tested in
`packages/trade-analyzer` (ported from a prior EVE trading project's
validated fee model — sales tax, broker fee on both sides, SCC surcharge,
liquidity warnings). What's left is wiring it up, not designing it.

1. ~~Single-hub spread ranking~~ **done**: `rankSingleHubOpportunities()`
   ranks watchlist items by `(bestBuy - bestSell)` margin within one region,
   filtered by `minMarginPercent`. ~~Cross-hub arbitrage~~ **done**:
   `rankCrossHubOpportunities()` matches items by `typeId` across two
   regions' snapshots. Neither accounts for hauling distance/jumps yet —
   that's the next real gap, see #2.
2. **Jump-distance weighting** (not yet done): start with a small
   hand-maintained JSON of jump counts between the 5 hubs rather than real
   routing — good enough to rank "margin per jump" as a rough hauling-effort
   proxy.
3. **Liquidity filter using history data**: wire `minAverageDailyVolume`
   (7d/30d, from `/markets/{region_id}/history/`) into the ranking filters —
   currently only `minTradableQuantity` (current order-book depth) is
   implemented; historical average volume is a better signal for "is this
   actually a real, repeatable opportunity" vs. a one-off large order.
4. **Expose it via `query-api`**: `GET /trades/top?region=...`.
5. **Dashboard view**: "Top trades right now" list in `apps/web`
   (see `apps/web/README.md` for the carried-over design direction),
   optionally its own alert type ("notify me when a >20% margin trade
   appears"). With `packages/eve-sso` set up, this can include structure
   prices too — `analyzeTrade` already accepts either a region row or a
   structure row (`PriceSnapshot` covers both), so "buy in Jita region,
   sell into my citadel" is `analyzeTrade(regionRow, structureRow, ...)`
   with no special-casing needed.

**Milestone**: dashboard answers "welches Item lohnt sich gerade besonders,
gut zu verkaufen/kaufen" without you eyeballing raw prices.

## Phase 3 — Historical analytics (+ AI)

1. **Pull `/markets/{region_id}/history/`** for watchlist items — ESI gives
   ~380 days of daily aggregates per (region, type) for free. This means
   Phase 3 doesn't have to wait for months of Phase 1 data collection; it
   can start as soon as you want to build it.
2. **Maintain `config/events.json`**: hand-curated list of known store
   sales / patch dates you want to check against (start small, add as you
   notice interesting ones).
3. **Correlation view**: overlay event dates on the price/volume history
   chart in `apps/web` — even just visually, this answers "did prices move
   around that date" for a human looking at it.
4. **AI commentary layer**: a scheduled job (GitHub Actions or a Worker
   cron) sends the aggregated series + nearby events to the Claude API,
   asking for a short natural-language summary ("Item X's sell price dropped
   ~12% in the 3 days after the Y sale started, consistent with increased
   supply"). Store the result, show it in the dashboard. This is intentionally
   last — it's the least well-specified part and benefits from having real
   history data to test against first.

**Milestone**: click an item, see its price history with sale-events marked,
plus a one-paragraph AI-written note on any correlation.

## Working on this with Claude Code (token-usage notes)

This repo ships a `.claude/CLAUDE.md` and a `.claude/skills/esi-integration/`
skill so that ESI-specific quirks (pagination, error-limit headers, region
vs. system) only load into context when you're actually touching
`esi-client` or `collector` code — not on every session. See those files
directly; the short version is: keep working on one package/phase at a time,
`/clear` between unrelated work (e.g. don't carry ESI-client context into a
dashboard-styling session), and reach for a subagent when you want Claude to
explore ESI's raw JSON responses without that bulk landing in your main
conversation.
