import { test } from "node:test";
import assert from "node:assert/strict";
import { rankSingleHubOpportunities, rankCrossHubOpportunities } from "./rankOpportunities.js";
import type { MarketSnapshotRow } from "@eve-market-scout/shared";

function row(overrides: Partial<MarketSnapshotRow>): MarketSnapshotRow {
  return {
    regionId: 10000002,
    typeId: 34,
    timestamp: "2026-07-26T00:00:00Z",
    bestSell: 10,
    bestBuy: 9,
    sellVolume: 1000,
    buyVolume: 1000,
    sellOrderCount: 5,
    buyOrderCount: 5,
    ...overrides,
  };
}

test("ranks single-hub opportunities by margin, best first", () => {
  const rows = [
    row({ typeId: 1, bestSell: 100, bestBuy: 99 }), // thin margin
    row({ typeId: 2, bestSell: 100, bestBuy: 130 }), // fat margin
  ];
  const ranked = rankSingleHubOpportunities(rows, { quantity: 1 });
  assert.equal(ranked[0].typeId, 2);
});

test("minMarginPercent filters out low-margin rows", () => {
  const rows = [
    row({ typeId: 1, bestSell: 100, bestBuy: 101 }), // near break-even after fees -> negative
    row({ typeId: 2, bestSell: 100, bestBuy: 200 }), // clearly profitable
  ];
  const ranked = rankSingleHubOpportunities(rows, { minMarginPercent: 20 });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].typeId, 2);
});

test("cross-hub matches by typeId across two region snapshots", () => {
  const sourceRows = [
    row({ typeId: 34, regionId: 10000002, bestSell: 5 }),
    row({ typeId: 999, regionId: 10000002, bestSell: 1 }), // no destination match
  ];
  const destinationRows = [row({ typeId: 34, regionId: 10000043, bestBuy: 8 })];

  const ranked = rankCrossHubOpportunities(sourceRows, destinationRows);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].typeId, 34);
});
