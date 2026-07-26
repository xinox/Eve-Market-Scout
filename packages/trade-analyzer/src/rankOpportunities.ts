import type { PriceSnapshot } from "@eve-market-scout/shared";
import { analyzeTrade } from "./analyzeTrade.js";
import { DEFAULT_FEE_CONFIG, type TradeFeeConfig, type ProfitAnalysis } from "./types.js";

export interface RankOptions {
  quantity?: number;
  fees?: TradeFeeConfig;
  /** Drop opportunities below this margin % (after fees). */
  minMarginPercent?: number;
  /** Drop opportunities below this available quantity on both sides. */
  minTradableQuantity?: number;
}

function passesFilters(analysis: ProfitAnalysis, opts: RankOptions): boolean {
  if (analysis.marginPercent === null) return false;
  if (opts.minMarginPercent !== undefined && analysis.marginPercent < opts.minMarginPercent) {
    return false;
  }
  if (opts.minTradableQuantity !== undefined && analysis.warnings.length > 0) {
    // Any volume warning already means we're below the requested quantity
    // on at least one side — good enough as a liquidity gate for the MVP.
    // Refine to compare exact numbers if you need finer control later.
    return false;
  }
  return true;
}

/**
 * Classic "station trading" spread: within a single region/hub snapshot,
 * rank every item by (bestBuy - bestSell) margin, i.e. buy the ask and
 * capture the gap to the bid. This is `analyzeTrade(row, row, ...)` for
 * every row — same math as cross-hub, just source === destination.
 */
export function rankSingleHubOpportunities<T extends PriceSnapshot>(
  rows: T[],
  opts: RankOptions = {}
): ProfitAnalysis[] {
  const quantity = opts.quantity ?? 1;
  const fees = opts.fees ?? DEFAULT_FEE_CONFIG;

  return rows
    .map((row) => analyzeTrade(row, row, quantity, fees))
    .filter((analysis) => passesFilters(analysis, opts))
    .sort((a, b) => (b.marginPercent ?? -Infinity) - (a.marginPercent ?? -Infinity));
}

/**
 * Cross-hub arbitrage: match rows by typeId between a source region's
 * snapshot and a destination region's snapshot, rank by margin. Does not
 * account for hauling cost/distance yet — see docs/ROADMAP.md Phase 2 for
 * the planned jump-distance weighting.
 */
export function rankCrossHubOpportunities<
  TSource extends PriceSnapshot,
  TDest extends PriceSnapshot,
>(sourceRows: TSource[], destinationRows: TDest[], opts: RankOptions = {}): ProfitAnalysis[] {
  const quantity = opts.quantity ?? 1;
  const fees = opts.fees ?? DEFAULT_FEE_CONFIG;
  const destByType = new Map(destinationRows.map((r) => [r.typeId, r]));

  const results: ProfitAnalysis[] = [];
  for (const source of sourceRows) {
    const destination = destByType.get(source.typeId);
    if (!destination) continue;
    results.push(analyzeTrade(source, destination, quantity, fees));
  }

  return results
    .filter((analysis) => passesFilters(analysis, opts))
    .sort((a, b) => (b.marginPercent ?? -Infinity) - (a.marginPercent ?? -Infinity));
}
