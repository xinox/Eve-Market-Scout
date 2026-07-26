# EVE Market Scout

Modular EVE Online market intelligence: automated data collection, price
alerts (Discord + browser), trade opportunity analysis, and historical
market analytics. Built to run on free-tier infrastructure only.

## Why this exists

EVE's market is huge and organized per-region (not per solar system — see
`docs/ESI_NOTES.md`). This project polls the public ESI API on a schedule,
stores compact price snapshots, and layers alerting, trade analysis, and
historical analytics on top — each as an independently swappable module.

## Status

Phase 1 (data collection + alerts) is scaffolded and ready to run locally.
See `docs/ROADMAP.md` for the full plan and what's implemented vs. planned.

## Quick start (local, zero cloud accounts needed)

```bash
npm install
cp config/watchlist.example.json config/watchlist.json   # optional, edit freely
cp config/alert-rules.example.json config/alert-rules.json
cp .env.example .env                                      # optional for now
npm run collect
```

This fetches live order books for 5 major trade hubs, aggregates best
buy/sell per watchlist item, writes a JSON snapshot under `data/snapshots/`,
and evaluates your alert rules (Discord fires only if `DISCORD_WEBHOOK_URL`
is set in `.env`).

> This sandbox couldn't live-test against `esi.evetech.net` (network egress
> is restricted here) — run the above on your own machine first to confirm
> it works end to end before wiring up GitHub Actions.

## Optional: player-owned structure (citadel) markets

Region/station data above needs no login. If you also want prices from a
player-owned Upwell structure, see `packages/eve-sso/README.md` for the
one-time EVE SSO setup, then:

```bash
cp config/structures.example.json config/structures.json   # add your structure IDs
npm run collect:structures
```

This is a fully separate, optional module — leave `config/structures.json`
empty (the default) and it's a clean no-op.

## Repo layout

```
packages/
  shared/               types, config loading, logger — no dependencies
  esi-client/           ESI API wrapper (pagination, retry, rate-limit aware)
  eve-sso/              EVE SSO OAuth2 — only needed for structure markets
  collector/            fetch -> aggregate -> store -> alert (region + structures)
  alert-engine/         pure threshold evaluation logic
  notifiers-discord/    Discord webhook sender
  ingest-api/           Cloudflare Worker: HTTP -> D1 (region + structure tables)
  trade-analyzer/       profit math + opportunity ranking (region or structure)
  historical-analytics/ Phase 3 — placeholder
apps/web/               dashboard frontend — placeholder (Phase 1.5)
config/                 regions, watchlist, alert rules, structures (JSON)
db/migrations/          D1 SQL schema
.github/workflows/      the actual scheduler (cron) + CI
docs/                   architecture, roadmap, ESI-specific notes
```

## Design principles (per project brief)

- **Modular**: every capability is its own package with one job. Add or
  remove a module without touching the others — the `MarketStore` interface
  in `packages/collector/src/store/store.ts` is a concrete example of the
  pattern to follow for future swappable pieces (notifiers, storage, etc).
- **Simple over clever**: no framework magic, plain TypeScript, JSON config
  files instead of a config UI, npm workspaces instead of a monorepo tool.
- **Zero cost to run**: GitHub Actions (public repo) for the scheduler,
  Cloudflare Workers + D1 free tier for storage/API, Cloudflare Pages or
  Vercel free tier for the dashboard. See `docs/ARCHITECTURE.md` for the
  free-tier numbers this was checked against.

## Deploying

See `packages/ingest-api/README.md` for the Cloudflare setup walkthrough,
and `docs/ROADMAP.md` for the order to do things in.

## License

MIT — see `LICENSE`.
