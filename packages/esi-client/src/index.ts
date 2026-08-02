import type { EsiMarketOrder, EsiMarketHistoryEntry } from "@eve-market-scout/shared";
import { ESI_BASE_URL, esiFetch, esiFetchAllPages, type EsiFetchOptions } from "./http.js";

/**
 * All public order book entries for a region (buy + sell, all types unless
 * `typeId` is given). This endpoint is server-side cached by ESI for 300s —
 * polling faster than every 5 minutes returns identical data, so our
 * 30-minute cadence is still extremely conservative and well inside any budget.
 *
 * Docs: https://esi.evetech.net/ui/#/Market/get_markets_region_id_orders
 */
export async function fetchRegionOrders(
  regionId: number,
  opts: { typeId?: number; orderType?: "buy" | "sell" | "all" } & EsiFetchOptions = {}
): Promise<EsiMarketOrder[]> {
  const params = new URLSearchParams({ order_type: opts.orderType ?? "all" });
  if (opts.typeId) params.set("type_id", String(opts.typeId));

  const buildUrl = (page: number) => {
    const p = new URLSearchParams(params);
    p.set("page", String(page));
    return `${ESI_BASE_URL}/markets/${regionId}/orders/?${p.toString()}`;
  };

  const orders = await esiFetchAllPages<EsiMarketOrder>(buildUrl, opts);
  // ESI doesn't stamp region_id on each order — attach it so downstream code
  // (aggregation, storage) doesn't need to carry regionId separately.
  return orders.map((o) => ({ ...o, region_id: regionId }));
}

/**
 * Daily aggregated history for one (region, type) pair — up to ~380 days.
 * This is the shortcut for Phase 3: we don't need a year of our own
 * snapshots to do historical/event-correlation analysis, ESI already has it.
 *
 * Docs: https://esi.evetech.net/ui/#/Market/get_markets_region_id_history
 */
export async function fetchRegionHistory(
  regionId: number,
  typeId: number,
  opts: EsiFetchOptions = {}
): Promise<EsiMarketHistoryEntry[]> {
  const url = `${ESI_BASE_URL}/markets/${regionId}/history/?type_id=${typeId}`;
  const res = await esiFetch(url, opts);
  return (await res.json()) as EsiMarketHistoryEntry[];
}

/**
 * All type_ids that currently have at least one active order in a region.
 * Useful later if you want to expand beyond an explicit watchlist and index
 * "everything tradable in Jita" — expensive, so not used in the Phase 1 MVP.
 *
 * Docs: https://esi.evetech.net/ui/#/Market/get_markets_region_id_types
 */
export async function fetchRegionTypeIds(
  regionId: number,
  opts: EsiFetchOptions = {}
): Promise<number[]> {
  const buildUrl = (page: number) =>
    `${ESI_BASE_URL}/markets/${regionId}/types/?page=${page}`;
  return esiFetchAllPages<number>(buildUrl, opts);
}

/**
 * Orders inside a specific player-owned (Upwell) structure. Requires an
 * access token from a character with docking access and the
 * esi-markets.structure_markets.v1 scope -- see packages/eve-sso.
 *
 * Unlike region orders, this endpoint doesn't support filtering by
 * type_id server-side (a prior project's use of that query param appears
 * to have been silently ignored by ESI) -- fetch everything and filter to
 * your watchlist client-side, same as fetchRegionOrders does.
 *
 * Docs: https://esi.evetech.net/ui/#/Market/get_markets_structures_structure_id
 */
export async function fetchStructureOrders(
  structureId: number,
  accessToken: string,
  opts: EsiFetchOptions = {}
): Promise<EsiMarketOrder[]> {
  const buildUrl = (page: number) =>
    `${ESI_BASE_URL}/markets/structures/${structureId}/?page=${page}`;

  const orders = await esiFetchAllPages<EsiMarketOrder>(buildUrl, {
    ...opts,
    extraHeaders: { Authorization: `Bearer ${accessToken}`, ...opts.extraHeaders },
  });
  return orders;
}

/**
 * Global, region-less average price per type_id (updated daily by CCP).
 * Fallback for items that don't trade through a normal region order book
 * anymore — PLEX being the practical example, see docs/ESI_NOTES.md.
 * Not paginated; one call returns every tradable type_id (~16k rows).
 *
 * Docs: https://esi.evetech.net/ui/#/Market/get_markets_prices
 */
export async function fetchGlobalPrices(
  opts: EsiFetchOptions = {}
): Promise<Map<number, number>> {
  const res = await esiFetch(`${ESI_BASE_URL}/markets/prices/`, opts);
  const rows = (await res.json()) as Array<{ type_id: number; average_price?: number }>;
  return new Map(
    rows.filter((r) => r.average_price != null).map((r) => [r.type_id, r.average_price as number])
  );
}

export * from "./http.js";
