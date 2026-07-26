import type {
  AlertRule,
  MarketSnapshotRow,
  TriggeredAlert,
  StructureAlertRule,
  StructureSnapshotRow,
  TriggeredStructureAlert,
} from "@eve-market-scout/shared";

/**
 * Pure function: given the latest snapshot rows and the configured alert
 * rules, return every rule that is currently triggered. No I/O here on
 * purpose — makes this trivial to unit test, and keeps notification
 * channels (Discord, browser push, ...) as a separate concern.
 *
 * `lastTriggeredAt` lets the caller enforce per-rule cooldowns so the same
 * alert doesn't fire on every single collector run while a price stays past
 * the threshold. Pass an empty map if you don't have persisted state yet.
 */
export function evaluateAlerts(
  rows: MarketSnapshotRow[],
  rules: AlertRule[],
  lastTriggeredAt: Map<string, Date> = new Map()
): TriggeredAlert[] {
  const now = new Date();
  const triggered: TriggeredAlert[] = [];

  for (const rule of rules) {
    const row = rows.find(
      (r) => r.regionId === rule.regionId && r.typeId === rule.typeId
    );
    if (!row) continue;

    const cooldownMs = (rule.cooldownMinutes ?? 240) * 60_000;
    const last = lastTriggeredAt.get(rule.id);
    if (last && now.getTime() - last.getTime() < cooldownMs) continue;

    const isTriggered =
      rule.direction === "sell_at_or_below"
        ? row.bestSell !== null && row.bestSell <= rule.thresholdIsk
        : row.bestBuy !== null && row.bestBuy >= rule.thresholdIsk;

    if (isTriggered) {
      triggered.push({ rule, row, triggeredAt: now.toISOString() });
    }
  }

  return triggered;
}

/**
 * Same logic as evaluateAlerts, for structure rules/rows instead of region
 * ones. Kept as a near-duplicate rather than a shared generic -- the two
 * rule/row shapes differ only in structureId vs regionId, and a generic
 * abstraction here would cost more readability than the ~15 duplicated
 * lines save. See CLAUDE.md: "simple over clever."
 */
export function evaluateStructureAlerts(
  rows: StructureSnapshotRow[],
  rules: StructureAlertRule[],
  lastTriggeredAt: Map<string, Date> = new Map()
): TriggeredStructureAlert[] {
  const now = new Date();
  const triggered: TriggeredStructureAlert[] = [];

  for (const rule of rules) {
    const row = rows.find(
      (r) => r.structureId === rule.structureId && r.typeId === rule.typeId
    );
    if (!row) continue;

    const cooldownMs = (rule.cooldownMinutes ?? 240) * 60_000;
    const last = lastTriggeredAt.get(rule.id);
    if (last && now.getTime() - last.getTime() < cooldownMs) continue;

    const isTriggered =
      rule.direction === "sell_at_or_below"
        ? row.bestSell !== null && row.bestSell <= rule.thresholdIsk
        : row.bestBuy !== null && row.bestBuy >= rule.thresholdIsk;

    if (isTriggered) {
      triggered.push({ rule, row, triggeredAt: now.toISOString() });
    }
  }

  return triggered;
}
