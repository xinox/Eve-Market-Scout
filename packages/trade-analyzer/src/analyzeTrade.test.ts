import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeTrade } from "./analyzeTrade.js";
import type { MarketSnapshotRow } from "@eve-market-scout/shared";
import { DEFAULT_FEE_CONFIG } from "./types.js";

function row(overrides: Partial<MarketSnapshotRow>): MarketSnapshotRow {
  return {
    regionId: 10000002,
    typeId: 34,
    timestamp: "2026-07-26T00:00:00Z",
    bestSell: 5,
    bestBuy: 4,
    sellVolume: 1_000_000,
    buyVolume: 1_000_000,
    sellOrderCount: 10,
    buyOrderCount: 10,
    ...overrides,
  };
}

test("computes net profit and margin with default fees", () => {
  // Buy 100 at 5 ISK (source sell), sell at 4 ISK (destination buy) — a
  // loss, since this is a same-hub spread with bestSell > bestBuy (normal).
  const result = analyzeTrade(row({}), row({}), 100, DEFAULT_FEE_CONFIG);
  assert.equal(result.buyPrice, 5);
  assert.equal(result.sellPrice, 4);
  assert.ok(result.netProfit! < 0, "buying above the bid should be a loss");
});

test("profitable cross-hub trade nets a positive margin", () => {
  const source = row({ regionId: 10000002, bestSell: 100 });
  const destination = row({ regionId: 10000043, bestBuy: 150 });
  const result = analyzeTrade(source, destination, 10, {
    salesTaxRate: 0.036,
    brokerFeeRate: 0.03,
    sccSurchargeRate: 0,
    includeBrokerOnBuy: true,
  });

  // gross buy = 1000, buy broker = 30 -> totalBuyCost = 1030
  assert.equal(result.totalBuyCost, 1030);
  // gross sell = 1500, sell broker = 45, sales tax = 54 -> revenue = 1401
  assert.equal(result.totalSellRevenue, 1401);
  assert.equal(result.netProfit, 1401 - 1030);
  assert.ok(result.marginPercent! > 0);
});

test("includeBrokerOnBuy=false skips the buy-side broker fee", () => {
  const source = row({ bestSell: 100 });
  const destination = row({ bestBuy: 150 });
  const result = analyzeTrade(source, destination, 1, {
    salesTaxRate: 0,
    brokerFeeRate: 0.03,
    sccSurchargeRate: 0,
    includeBrokerOnBuy: false,
  });
  assert.equal(result.totalBuyCost, 100); // no buy-side broker fee added
});

test("warns and returns nulls when a side has no matching order", () => {
  const source = row({ bestSell: null });
  const destination = row({ bestBuy: 150 });
  const result = analyzeTrade(source, destination, 5);
  assert.equal(result.netProfit, null);
  assert.ok(result.warnings.some((w) => w.includes("source")));
});

test("warns when requested quantity exceeds available volume", () => {
  const source = row({ sellVolume: 10 });
  const destination = row({ buyVolume: 10 });
  const result = analyzeTrade(source, destination, 500);
  assert.ok(result.warnings.some((w) => w.includes("Only 10 available")));
  assert.ok(result.warnings.some((w) => w.includes("buy-side demand")));
});
