import { logger, type TriggeredAlert } from "@eve-market-scout/shared";

/**
 * This is one implementation of a "notifier". If you later want Telegram,
 * email, or ntfy.sh, add a sibling package with the same
 * `sendAlerts(webhookUrl, alerts)` shape and wire it up in the collector —
 * nothing else needs to change.
 */
export async function sendDiscordAlerts(
  webhookUrl: string,
  alerts: TriggeredAlert[]
): Promise<void> {
  if (alerts.length === 0) return;

  const embeds = alerts.map((a) => ({
    title: describeAlert(a),
    color: a.rule.direction === "sell_at_or_below" ? 0x2ecc71 : 0xe67e22,
    fields: [
      { name: "Region", value: String(a.row.regionId), inline: true },
      { name: "Type ID", value: String(a.row.typeId), inline: true },
      {
        name: "Best sell",
        value: a.row.bestSell?.toLocaleString("de-DE") ?? "—",
        inline: true,
      },
      {
        name: "Best buy",
        value: a.row.bestBuy?.toLocaleString("de-DE") ?? "—",
        inline: true,
      },
    ],
    timestamp: a.triggeredAt,
  }));

  // Discord webhooks accept up to 10 embeds per message.
  for (let i = 0; i < embeds.length; i += 10) {
    const batch = embeds.slice(i, i + 10);
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: batch }),
    });
    if (!res.ok) {
      logger.error("Discord webhook failed", { status: res.status });
    }
  }
}

function describeAlert(alert: TriggeredAlert): string {
  return alert.rule.direction === "sell_at_or_below"
    ? `Günstig kaufen: Type ${alert.row.typeId} ≤ ${alert.rule.thresholdIsk.toLocaleString("de-DE")} ISK`
    : `Gut verkaufen: Type ${alert.row.typeId} ≥ ${alert.rule.thresholdIsk.toLocaleString("de-DE")} ISK`;
}
