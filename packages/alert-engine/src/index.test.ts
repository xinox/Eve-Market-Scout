import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateAlerts } from "./index.js";
import type { AlertRule, MarketSnapshotRow } from "@eve-market-scout/shared";

function row(overrides: Partial<MarketSnapshotRow>): MarketSnapshotRow {
  return {
    regionId: 10000002,
    typeId: 44992,
    timestamp: "2026-07-26T00:00:00Z",
    bestSell: 4_000_000,
    bestBuy: 3_800_000,
    sellVolume: 10,
    buyVolume: 5,
    sellOrderCount: 2,
    buyOrderCount: 1,
    ...overrides,
  };
}

function rule(overrides: Partial<AlertRule>): AlertRule {
  return {
    id: "test-rule",
    regionId: 10000002,
    typeId: 44992,
    direction: "sell_at_or_below",
    thresholdIsk: 3_500_000,
    channel: "discord",
    ...overrides,
  };
}

test("fires when sell price is at or below threshold", () => {
  const rows = [row({ bestSell: 3_400_000 })];
  const rules = [rule({ thresholdIsk: 3_500_000 })];
  const triggered = evaluateAlerts(rows, rules);
  assert.equal(triggered.length, 1);
});

test("does not fire when sell price is above threshold", () => {
  const rows = [row({ bestSell: 3_600_000 })];
  const rules = [rule({ thresholdIsk: 3_500_000 })];
  assert.equal(evaluateAlerts(rows, rules).length, 0);
});

test("fires when buy price is at or above threshold (opposite direction)", () => {
  const rows = [row({ bestBuy: 4_200_000 })];
  const rules = [rule({ direction: "buy_at_or_above", thresholdIsk: 4_000_000 })];
  assert.equal(evaluateAlerts(rows, rules).length, 1);
});

test("respects cooldown: does not re-fire within the window", () => {
  const rows = [row({ bestSell: 3_000_000 })];
  const rules = [rule({ thresholdIsk: 3_500_000, cooldownMinutes: 240 })];
  const lastTriggered = new Map([["test-rule", new Date()]]);
  assert.equal(evaluateAlerts(rows, rules, lastTriggered).length, 0);
});

test("fires again once cooldown has elapsed", () => {
  const rows = [row({ bestSell: 3_000_000 })];
  const rules = [rule({ thresholdIsk: 3_500_000, cooldownMinutes: 60 })];
  const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
  const lastTriggered = new Map([["test-rule", fiveHoursAgo]]);
  assert.equal(evaluateAlerts(rows, rules, lastTriggered).length, 1);
});

test("ignores rules for regions/types with no matching snapshot row", () => {
  const rows = [row({ typeId: 34 })];
  const rules = [rule({ typeId: 44992 })];
  assert.equal(evaluateAlerts(rows, rules).length, 0);
});
