import type { EsiMarketOrder, StructureSnapshotRow } from "@eve-market-scout/shared";

/**
 * Same reduction as packages/collector/src/aggregate.ts (best sell/buy per
 * type, plus volumes and order counts), but keyed by a single structureId
 * passed in by the caller rather than a region_id read off each order --
 * structure market orders don't carry a region_id field the way region
 * orders do, since a structure lives at one specific location, not a
 * whole region.
 */
export function aggregateStructureOrders(
  orders: EsiMarketOrder[],
  structureId: number,
  timestamp: string
): StructureSnapshotRow[] {
  const byType = new Map<
    number,
    {
      bestSell: number | null;
      bestBuy: number | null;
      sellVolume: number;
      buyVolume: number;
      sellOrderCount: number;
      buyOrderCount: number;
    }
  >();

  for (const order of orders) {
    const entry = byType.get(order.type_id) ?? {
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

    byType.set(order.type_id, entry);
  }

  return Array.from(byType.entries()).map(([typeId, e]) => ({
    structureId,
    typeId,
    timestamp,
    ...e,
  }));
}
