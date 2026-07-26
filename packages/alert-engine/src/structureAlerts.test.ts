import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateStructureAlerts } from "./index.js";
import type { StructureAlertRule, StructureSnapshotRow } from "@eve-market-scout/shared";

function row(overrides: Partial<StructureSnapshotRow>): StructureSnapshotRow {
  return {
    structureId: 1035466617946,
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

function rule(overrides: Partial<StructureAlertRule>): StructureAlertRule {
  return {
    id: "structure-test-rule",
    structureId: 1035466617946,
    typeId: 44992,
    direction: "sell_at_or_below",
    thresholdIsk: 3_500_000,
    channel: "discord",
    ...overrides,
  };
}

test("fires when sell price at a structure is at or below threshold", () => {
  const rows = [row({ bestSell: 3_000_000 })];
  const rules = [rule({ thresholdIsk: 3_500_000 })];
  assert.equal(evaluateStructureAlerts(rows, rules).length, 1);
});

test("does not match a rule for a different structureId", () => {
  const rows = [row({ structureId: 999, bestSell: 1 })];
  const rules = [rule({ structureId: 1035466617946 })];
  assert.equal(evaluateStructureAlerts(rows, rules).length, 0);
});

test("respects cooldown same as region alerts", () => {
  const rows = [row({ bestSell: 1 })];
  const rules = [rule({ thresholdIsk: 3_500_000, cooldownMinutes: 240 })];
  const lastTriggered = new Map([["structure-test-rule", new Date()]]);
  assert.equal(evaluateStructureAlerts(rows, rules, lastTriggered).length, 0);
});
