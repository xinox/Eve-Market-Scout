import type { EsiMarketOrder, MarketSnapshotRow } from "@eve-market-scout/shared";

/**
 * Collapse a region's raw order book down to one row per type_id:
 * best (lowest) sell price, best (highest) buy price, and total remaining
 * volume on each side. This is deliberately lossy — we throw away individual
 * orders — because storing every order for every poll would grow the
 * database far faster than the "best price" data we actually act on.
 *
 * If you later want full order-book depth (Phase 2 arbitrage with volume
 * limits), extend this to keep the top N orders per side instead of just 1.
 */
export function aggregateOrders(
  orders: EsiMarketOrder[],
  timestamp: string
): MarketSnapshotRow[] {
  const byType = new Map<
    number,
    {
      regionId: number;
      bestSell: number | null;
      bestBuy: number | null;
      sellVolume: number;
      buyVolume: number;
      sellOrderCount: number;
      buyOrderCount: number;
    }
  >();

  for (const order of orders) {
    const key = order.type_id;
    const entry = byType.get(key) ?? {
      regionId: order.region_id ?? 0,
      bestSell: null,
      bestBuy: null,
      sellVolume: 0,
      buyVolume: 0,
      sellOrderCount: 0,
      buyOrderCount: 0,
    };

    if (order.is_buy_order) {
      entry.buyVolume += order.volume_remain;
      entry.buyOrderCount += 1;
      if (entry.bestBuy === null || order.price > entry.bestBuy) {
        entry.bestBuy = order.price;
      }
    } else {
      entry.sellVolume += order.volume_remain;
      entry.sellOrderCount += 1;
      if (entry.bestSell === null || order.price < entry.bestSell) {
        entry.bestSell = order.price;
      }
    }

    byType.set(key, entry);
  }

  return Array.from(byType.entries()).map(([typeId, e]) => ({
    regionId: e.regionId,
    typeId,
    timestamp,
    bestSell: e.bestSell,
    bestBuy: e.bestBuy,
    sellVolume: e.sellVolume,
    buyVolume: e.buyVolume,
    sellOrderCount: e.sellOrderCount,
    buyOrderCount: e.buyOrderCount,
  }));
}
