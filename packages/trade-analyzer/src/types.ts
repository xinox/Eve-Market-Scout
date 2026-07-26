export interface TradeFeeConfig {
  /** EVE's sales tax on the sell side. 3.6% is the unskilled default. */
  salesTaxRate: number;
  /** Broker fee charged on placing orders (both buy and sell orders). */
  brokerFeeRate: number;
  /** Newer SCC surcharge on sell-side transactions; 0 if not applicable. */
  sccSurchargeRate: number;
  /** Whether to also charge broker fee on the buy side (placing a buy
   * order does cost a broker fee too, even though it's easy to forget). */
  includeBrokerOnBuy: boolean;
}

/** Unskilled-character defaults — override once you know your actual
 * skill-reduced rates (Broker Relations / Accounting / trade standings). */
export const DEFAULT_FEE_CONFIG: TradeFeeConfig = {
  salesTaxRate: 0.036,
  brokerFeeRate: 0.03,
  sccSurchargeRate: 0,
  includeBrokerOnBuy: true,
};

export interface ProfitAnalysis {
  typeId: number;
  quantity: number;
  /** Price paid per unit at the source (its best sell order — "instant
   * buy" convention, no assumption that undercutting an order works). */
  buyPrice: number | null;
  /** Price received per unit at the destination (its best buy order —
   * "instant sell" convention, same reasoning). */
  sellPrice: number | null;
  totalBuyCost: number | null;
  totalSellRevenue: number | null;
  totalFees: number | null;
  netProfit: number | null;
  netProfitPerUnit: number | null;
  marginPercent: number | null;
  warnings: string[];
}
