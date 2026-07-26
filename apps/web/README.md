# apps/web (Phase 1.5 — not yet implemented)

The dashboard. Reads from a `query-api` Worker (a second set of routes
alongside `ingest-api`, or its own Worker — decide when you get here) and,
once available, from `@eve-market-scout/trade-analyzer` for the "top trades"
view.

Suggested stack given the rest of the repo: plain Vite + React + TypeScript,
deployed to Cloudflare Pages (keeps everything on one platform) or Vercel
(you already know it well). Either is a static build with client-side
fetches to the query API — no server-side rendering needed for v1.

## Design direction (carried over from a prior EVE trading project)

- **Audience**: station traders who want a fast, dense decision tool — buy
  cheap here, sell for a profit there. They value speed and trustworthy
  numbers over novelty.
- **Tone**: tactical, business, "market terminal for capsuleers" — not a
  game UI. Avoid playful/arcade styling and generic glowing cyberpunk
  cliches; lean into restrained sci-fi + operator-console mood instead.
- **Layout**: dense tabular views are first-class, not an afterthought —
  compact controls, strong information hierarchy, comparison panels that
  feel intentional rather than bolted on.
- **Theming**: support both dark and light modes, dark-bluish and
  structured in either, preserving contrast for long scanning sessions.
- Every layout decision should answer: does this help someone judge route
  viability, margin, and demand faster?

## MVP scope

- Table of watchlist items with latest best sell/buy per hub.
- Price history chart per item (line chart, data from `market_snapshot`).
- "Top trades right now" list, powered by
  `rankSingleHubOpportunities` / `rankCrossHubOpportunities` from
  `@eve-market-scout/trade-analyzer` (Phase 2).
- List of currently active alert rules + a manual "test alert" button.
- Simple polling (every 60s) for newly triggered alerts as the first
  "browser alert" mechanism — real Web Push (VAPID + service worker,
  `push_subscriptions` table already in the schema) is a clean follow-up
  once polling works.
