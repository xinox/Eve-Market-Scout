import { logger, type TriggeredAlert } from "@eve-market-scout/shared";

/**
 * This is one implementation of a "notifier". If you later want Telegram,
 * email, or ntfy.sh, add a sibling package with the same
 * `sendAlerts(webhookUrl, alerts)` shape and wire it up in the collector —
 * nothing else needs to change.
 */
export interface DiscordAlertContext {
  /** typeId -> display name, from the watchlist. */
  itemNames?: Record<number, string>;
  /** regionId -> display name, from config/regions.json. */
  regionNames?: Record<number, string>;
  /** Where the embed title links to — the local alert-manager-ui by default. */
  appUrl?: string;
}

/** Resolves a station/structure id to a human name via ESI's public
 * universe endpoint. Player structures (id >= 1e9) require an authenticated
 * call we don't have here, so those fall back to a plain id label instead
 * of failing the whole alert send. In-memory cache since a single run can
 * reference the same station across several alerts. */
const stationNameCache = new Map<number, Promise<string>>();

async function resolveStationName(locationId: number | null | undefined): Promise<string | null> {
  if (!locationId) return null;
  if (locationId >= 1_000_000_000) return `Structure ${locationId} (player-owned, not resolvable here)`;

  let pending = stationNameCache.get(locationId);
  if (!pending) {
    pending = fetch(`https://esi.evetech.net/latest/universe/stations/${locationId}/`, {
      headers: { "User-Agent": process.env.ESI_USER_AGENT ?? "eve-market-scout/0.1" },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => (data as { name?: string } | null)?.name ?? `Station ${locationId}`)
      .catch(() => `Station ${locationId}`);
    stationNameCache.set(locationId, pending);
  }
  return pending;
}

export async function sendDiscordAlerts(
  webhookUrl: string,
  alerts: TriggeredAlert[],
  context: DiscordAlertContext = {}
): Promise<void> {
  if (alerts.length === 0) return;

  const appUrl = context.appUrl ?? "http://localhost:4310";

  const embeds = await Promise.all(
    alerts.map(async (a) => {
      const isSell = a.rule.direction === "sell_at_or_below";
      const locationId = isSell ? a.row.bestSellLocationId : a.row.bestBuyLocationId;
      const locationName = await resolveStationName(locationId);

      return {
        title: describeAlert(a, context.itemNames),
        url: appUrl,
        color: isSell ? 0x2ecc71 : 0xe67e22,
        fields: [
          { name: "Region", value: regionLabel(a.row.regionId, context.regionNames), inline: true },
          { name: "Ort", value: locationName ?? "unbekannt", inline: true },
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
        // Discord renders `timestamp` in the embed footer as a localized,
        // relative-friendly date — this doubles as the "how fresh is this"
        // indicator (it's the collector run's timestamp, not send time).
        timestamp: a.row.timestamp,
        footer: { text: `Marktdaten von: ${new Date(a.row.timestamp).toLocaleString("de-DE")}` },
      };
    })
  );

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

function itemLabel(typeId: number, itemNames?: Record<number, string>): string {
  return itemNames?.[typeId] ?? `Type ${typeId}`;
}

function regionLabel(regionId: number, regionNames?: Record<number, string>): string {
  return regionNames?.[regionId] ?? `Region ${regionId}`;
}

function describeAlert(alert: TriggeredAlert, itemNames?: Record<number, string>): string {
  const item = itemLabel(alert.row.typeId, itemNames);
  return alert.rule.direction === "sell_at_or_below"
    ? `Günstig kaufen: ${item} ≤ ${alert.rule.thresholdIsk.toLocaleString("de-DE")} ISK`
    : `Gut verkaufen: ${item} ≥ ${alert.rule.thresholdIsk.toLocaleString("de-DE")} ISK`;
}
