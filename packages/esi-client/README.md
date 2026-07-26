# @eve-market-scout/esi-client

Thin, dependency-free wrapper around the parts of CCP's ESI API we need for
market data. No OAuth here on purpose — regional market orders and history
are public endpoints. We only need EVE SSO if we later add character-specific
features (personal orders, wallet, structure markets).

## What it handles for you

- **Pagination** via the `X-Pages` response header (`/orders/`, `/types/`).
- **Retry + backoff** on 429/420/5xx, with a proactive log warning when the
  `X-Esi-Error-Limit-Remain` header gets low.
- **User-Agent** identification (ESI asks every client to identify itself —
  set `ESI_USER_AGENT` in your `.env`).

## What it deliberately does NOT do

- No caching layer of its own — ESI already caches `/orders/` for 300s
  server-side, so re-requesting sooner is wasted but harmless.
- No full-universe scanning helpers. `fetchRegionOrders` operates one region
  at a time by design — see `docs/ESI_NOTES.md` for why we start with a
  handful of trade hub regions instead of all ~100.

## Note for local testing

This sandbox's network egress doesn't include `esi.evetech.net`, so this
client is written against the documented ESI contract but hasn't been
live-tested from here. Run `npm run collect` locally (see root README) to
verify against the real API before wiring up GitHub Actions.
