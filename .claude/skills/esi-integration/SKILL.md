---
name: esi-integration
description: Domain knowledge for working with EVE Online's ESI API in this repo — endpoint shapes, pagination, rate limits, region-vs-system, and where things live in packages/esi-client and packages/collector. Use when adding or debugging ESI calls, aggregation logic, or anything touching market_snapshot data.
---

# ESI integration

Full detail lives in `docs/ESI_NOTES.md` — read that file when you need the
complete picture (endpoint table, region IDs, rate-limit specifics). This
skill is the pointer so that content doesn't sit in CLAUDE.md and load into
every session regardless of what you're working on.

## Fast facts worth having without opening the doc

- Markets are per-**region**, not per solar system. ~100 regions exist; we
  poll 5 (the major trade hubs) via `config/regions.json`.
- `/markets/{region_id}/orders/` is paginated (`X-Pages` header) and cached
  server-side for 300s — our 3-4h cadence has huge headroom, no need to
  optimize for speed here.
- `/markets/{region_id}/history/` gives ~380 days of daily aggregates for
  free — this is the Phase 3 shortcut, don't build a "wait and collect our
  own history" system before checking if this endpoint already covers it.
- No OAuth needed for anything region/station-related. Structure markets
  (citadels) DO need EVE SSO + Bearer auth — that's `packages/eve-sso` +
  `fetchStructureOrders` in `esi-client`, a separate optional module with
  its own collector entrypoint (`structureIndex.ts`). Don't conflate the
  two paths when touching either.

## Where the code lives

- `packages/esi-client/src/http.ts` — retry/backoff/error-budget handling.
  Change here if you need different retry behavior, not per-call.
- `packages/esi-client/src/index.ts` — the actual endpoint functions
  (`fetchRegionOrders`, `fetchRegionHistory`, `fetchRegionTypeIds`).
  Add new endpoints here, following the same pattern.
- `packages/collector/src/aggregate.ts` — turns raw orders into the
  best-sell/best-buy snapshot rows we actually store. If a feature needs
  order-book depth instead of just best price, this is what to extend.

## When debugging a live ESI response

Prefer running a throwaway script or the Bash tool to fetch and inspect one
response directly rather than pasting large raw JSON into the main
conversation — a subagent or a quick `node -e "..."` call keeps that bulk
out of context. Only pull in the specific fields that matter to whatever
you're debugging.
