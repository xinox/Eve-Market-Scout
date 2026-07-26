import type { PriceSnapshot } from "@eve-market-scout/shared";
import { DEFAULT_FEE_CONFIG, type TradeFeeConfig, type ProfitAnalysis } from "./types.js";

/**
 * Single-route profit model. Pass the *same* row as both `source` and
 * `destination` to get the classic single-hub "station trading" spread
 * (buy the cheapest ask, capture the gap to the best bid) instead of a
 * cross-region hauling route — both are the same math, just different rows.
 *
 * Takes `PriceSnapshot` rather than a concrete region/structure type, so a
 * region's MarketSnapshotRow and a structure's StructureSnapshotRow can be
 * compared directly against each other with no special-casing — e.g.
 * "buy in Jita region, sell into my citadel" is just
 * `analyzeTrade(regionRow, structureRow, ...)`.
 *
 * Convention (adapted from a prior project's validated model): buy at the
 * source's best SELL order, sell into the destination's best BUY order.
 * This is the conservative "instant fill both ends" reading — no
 * assumption that undercutting an existing order actually works before
 * someone else takes it.
 */
export function analyzeTrade(
  source: PriceSnapshot,
  destination: PriceSnapshot,
  quantity: number,
  fees: TradeFeeConfig = DEFAULT_FEE_CONFIG
): ProfitAnalysis {
  const warnings: string[] = [];
  const buyPrice = source.bestSell;
  const sellPrice = destination.bestBuy;

  if (buyPrice === null) {
    warnings.push("No sell order at the source — nothing to instantly buy.");
  }
  if (sellPrice === null) {
    warnings.push("No buy order at the destination — nothing to instantly sell into.");
  }
  if (source.sellVolume < quantity) {
    warnings.push(
      `Only ${source.sellVolume} available at the source, requested ${quantity}.`
    );
  }
  if (destination.buyVolume < quantity) {
    warnings.push(
      `Only ${destination.buyVolume} of buy-side demand at the destination, requested ${quantity}.`
    );
  }

  if (buyPrice === null || sellPrice === null) {
    return {
      typeId: source.typeId,
      quantity,
      buyPrice,
      sellPrice,
      totalBuyCost: null,
      totalSellRevenue: null,
      totalFees: null,
      netProfit: null,
      netProfitPerUnit: null,
      marginPercent: null,
      warnings,
    };
  }

  const grossBuy = buyPrice * quantity;
  const buyFees = fees.includeBrokerOnBuy ? grossBuy * fees.brokerFeeRate : 0;
  const grossSell = sellPrice * quantity;
  const sellBroker = grossSell * fees.brokerFeeRate;
  const salesTax = grossSell * fees.salesTaxRate;
  const sccSurcharge = grossSell * fees.sccSurchargeRate;

  const totalBuyCost = grossBuy + buyFees;
  const totalFees = buyFees + sellBroker + salesTax + sccSurcharge;
  const totalSellRevenue = grossSell - sellBroker - salesTax - sccSurcharge;
  const netProfit = totalSellRevenue - totalBuyCost;
  const netProfitPerUnit = netProfit / quantity;
  const marginPercent = totalBuyCost !== 0 ? (netProfit / totalBuyCost) * 100 : null;

  return {
    typeId: source.typeId,
    quantity,
    buyPrice,
    sellPrice,
    totalBuyCost,
    totalFees,
    totalSellRevenue,
    netProfit,
    netProfitPerUnit,
    marginPercent,
    warnings,
  };
}
