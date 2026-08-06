# ESI Notes

Practical notes on CCP's ESI API as it relates to this project. Written so
the reasoning survives even if you're not looking at the live ESI docs.

## Regions, not solar systems

Markets in EVE are scoped to **regions**, not individual solar systems.
A region contains many systems; only certain stations within a region host
significant player trade, but ESI's market endpoints operate at the region
level regardless — you can't ask "just this station" for public orders
(structure-specific orders are a separate, authenticated endpoint,
see below). This is good news for data volume: ~100 regions total, most
with negligible trade, rather than thousands of systems each needing their
own poll.

Trade hub region IDs used in `config/regions.json`:

| Hub | Region | region_id |
|---|---|---|
| Jita | The Forge | 10000002 |
| Amarr | Domain | 10000043 |
| Dodixie | Sinq Laison | 10000032 |
| Rens | Heimatar | 10000030 |
| Hek | Metropolis | 10000042 |

## Key endpoints

- `GET /markets/{region_id}/orders/` — all public buy/sell orders in a
  region, paginated via the `X-Pages` response header. Cached by ESI for
  300 seconds — polling more often than every 5 minutes returns identical
  data. Our hourly cadence still has enormous headroom.
- `GET /markets/{region_id}/history/?type_id=...` — daily aggregates
  (average/high/low price, volume, order_count) for one type in one region,
  looking back roughly a year. No auth needed. This is the Phase 3 shortcut
  — CCP is already keeping the history we'd otherwise have to collect ourselves.
- `GET /markets/{region_id}/types/` — which type_ids currently have any
  order in a region. Useful if you ever want to discover "everything
  tradeable in Jita" instead of a hand-maintained watchlist; not used yet
  because it multiplies request volume a lot (thousands of types × need to
  then fetch orders for each, or just fetch the whole region's orders and
  filter client-side, which is what `collector` currently does).
- `GET /markets/structures/{structure_id}/` — orders inside a specific
  player-owned (Upwell) structure. Requires OAuth2 with the
  `esi-markets.structure_markets.v1` scope and docking access. **Not used
  in this project** — public region orders already capture the vast
  majority of NPC-station trade hub activity, and adding OAuth is a real
  jump in complexity (EVE SSO app registration, token refresh, per-character
  scope) for questionable benefit at this stage. Revisit only if you
  specifically want citadel-market coverage.

## API versioning: X-Compatibility-Date

ESI versions its entire API through a single `X-Compatibility-Date` header
(ISO `YYYY-MM-DD`) instead of per-route URL versions — CCP rolled this out
in mid-2025 to replace the old `/v4/`, `/v6/`-per-route scheme. Every
request in `esi-client` sends this, defaulting to "yesterday in UTC" (ESI's
rollover happens at 11:00 UTC, so "today" is ambiguous near that boundary)
unless `ESI_COMPATIBILITY_DATE` is pinned in the environment. Pin it once
you've reviewed a given date's behavior against ESI's changelog, and bump it
deliberately rather than always floating — that's the whole point of the
scheme. https://developers.eveonline.com/docs/services/esi/overview/

## Rate limits and error budget

ESI doesn't publish a hard requests/second cap, but it does track an
"error budget" per client via response headers:

- `X-Esi-Error-Limit-Remain` — errors left in the current window
- `X-Esi-Error-Limit-Reset` — seconds until the window resets

Exhausting this budget gets you temporarily blocked (HTTP 420). Our
`esi-client` package logs a warning once remaining budget drops below 10 and
backs off on 420/429/5xx with exponential retry — see `packages/esi-client/src/http.ts`.
At our polling cadence and region count, we should never get close to this
in practice; it matters more if you expand to many more regions or poll
much more frequently.

## Identify yourself

ESI asks every client to send a descriptive `User-Agent` with contact info,
so CCP can reach you if your app misbehaves instead of just blocking it.
Set `ESI_USER_AGENT` in `.env` / GitHub Actions repo variables — see
`.env.example`.

## Static data (item names, categories)

ESI's market endpoints only return numeric `type_id`s. To show human-readable
names in the dashboard, you'll want CCP's Static Data Export (SDE) or the
`/universe/types/{type_id}/` ESI endpoint (one call per unseen type_id,
worth caching locally since names don't change). Not wired up yet in this
scaffold — `config/watchlist.example.json` includes names manually for now.
Fuzzwork (https://www.fuzzwork.co.uk/dump/) publishes ready-to-use SDE
exports if you want a static local lookup table instead of ESI calls for this.

## Alternative data source: Fuzzwork market aggregates

`market.fuzzwork.co.uk/aggregates/` is a free third-party endpoint that
returns pre-aggregated best buy/sell + volume + order count **per station**
(not per region) for a batch of type_ids in one call. A prior EVE trading
project of the user's used this alongside ESI. Tradeoffs vs. calling ESI
directly ourselves:

- **Pro**: station-level aggregation without fetching+filtering a whole
  region's order book yourself; one call can batch ~100 type_ids.
- **Con**: third-party dependency outside CCP — availability/format aren't
  guaranteed the way ESI's are. Treat as a supplement, not a replacement.

Not wired up in this scaffold; worth adding as an alternate `esi-client`-like
package if station-level (not region-level) precision becomes important —
see the note below.

## Known simplification: region-level, not station-level, prices

`aggregate.ts` currently computes best sell/buy across an **entire region's**
order book. In practice, a region's biggest hub station usually dominates
its region's price, so this is a reasonable approximation — but it's not
exactly "the Jita price," it's "the best price anywhere in The Forge," which
occasionally differs if an outlier order sits at a minor station. The prior
project stored orders per `station_id` (via `location_id` on each order) to
get exact per-station prices. If you need that precision later, it's a
targeted change to `aggregate.ts`: group by `(regionId, locationId, typeId)`
instead of `(regionId, typeId)`, and filter to your specific station IDs
(see `hub_refresh` station IDs noted below) rather than the whole region.

Station IDs for the 5 hubs, if you want this later:

| Hub | station_id |
|---|---|
| Jita IV - Moon 4 - Caldari Navy Assembly Plant | 60003760 |
| Amarr VIII (Oris) - Emperor Family Academy | 60008494 |
| Dodixie IX - Moon 20 - Federation Navy Assembly Plant | 60011866 |
| Rens VI - Moon 8 - Brutor Tribe Treasury | 60005686 |
| Hek VIII - Moon 12 - Boundless Creation Factory | 60004588 |

## Upwell structure (citadel) markets — implemented

A meaningful share of real player trading happens in player-owned "Upwell"
structures (citadels), not just NPC stations — and ESI only exposes their
orders via the authenticated `/markets/structures/{structure_id}/` endpoint,
requiring EVE SSO (OAuth2) with `esi-markets.structure_markets.v1` (plus
`esi-search.search_structures.v1` and `esi-universe.read_structures.v1` if
you also want structure search/discovery later).

This is now a separate, optional module — `packages/eve-sso` (OAuth2 +
token refresh, ported from a prior project's validated auth flow) and
`packages/collector/src/structureIndex.ts` (its own entrypoint, own GitHub
Actions workflow, own D1 table). It doesn't touch the region collector at
all: if `config/structures.json` is empty, `npm run collect:structures`
logs one line and exits — no error, no impact on the region path. See
`packages/eve-sso/README.md` for the one-time setup (register an EVE app,
run the login script once to get a refresh token).

Structure search itself (finding a structure_id by name in-game) isn't
built — you configure known structure IDs directly. Adding search is a
contained follow-up: a new function in `packages/esi-client` calling
`/characters/{character_id}/search/` with `categories=structure`, using the
same Bearer-auth pattern `fetchStructureOrders` already establishes.

One difference from region orders worth knowing: `/markets/structures/{id}/`
does not reliably support server-side filtering by `type_id` the way region
orders do (a prior project's use of that query param appears to have been
silently ignored by ESI), so `fetchStructureOrders` fetches everything for
the structure, paginated, and filters client-side — same approach as the
region collector already uses.
