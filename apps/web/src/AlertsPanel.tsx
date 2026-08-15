import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

type AlertDirection = "sell_at_or_below" | "buy_at_or_above";
type AlertChannel = "discord" | "browser" | "both";
type ThresholdUnit = "isk" | "million";

interface AlertRule {
  id: string;
  regionId: number;
  typeId: number;
  direction: AlertDirection;
  thresholdIsk: number;
  channel: AlertChannel;
  cooldownMinutes?: number;
}

interface RecentAlert {
  id: number;
  ruleId: string;
  regionId: number;
  typeId: number;
  direction: AlertDirection;
  thresholdIsk: number;
  channel: AlertChannel;
  triggeredAt: string;
  bestSell: number | null;
  bestBuy: number | null;
}

interface CatalogEntry {
  readonly id: number;
  readonly name: string;
}

interface AlertsPanelProps {
  apiBase: string;
  regions: readonly CatalogEntry[];
  items: readonly CatalogEntry[];
}

function formatIsk(value: number | null): string {
  if (value === null) return "—";
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: value < 10_000 ? 2 : 0 }).format(value)} ISK`;
}

function labelFor(entries: readonly CatalogEntry[], id: number): string {
  return entries.find((entry) => entry.id === id)?.name ?? String(id);
}

function parseLocalizedNumber(value: string): number {
  return Number(value.trim().replace(",", "."));
}

export function AlertsPanel({ apiBase, regions, items }: AlertsPanelProps) {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [recent, setRecent] = useState<RecentAlert[]>([]);
  const [message, setMessage] = useState<string>("");
  const [adminKey, setAdminKey] = useState("");
  const [regionId, setRegionId] = useState(regions[0].id);
  const [typeId, setTypeId] = useState(items[0].id);
  const [direction, setDirection] = useState<AlertDirection>("sell_at_or_below");
  const [thresholdIsk, setThresholdIsk] = useState("");
  const [thresholdUnit, setThresholdUnit] = useState<ThresholdUnit>("million");
  const [channel, setChannel] = useState<AlertChannel>("both");
  const [cooldownMinutes, setCooldownMinutes] = useState("240");
  const [browserEnabled, setBrowserEnabled] = useState(false);
  const knownAlertIds = useRef(new Set<number>());
  const initialized = useRef(false);

  const api = useCallback((path: string) => `${apiBase}${path}`, [apiBase]);

  const loadAlerts = useCallback(async () => {
    try {
      const [rulesResponse, recentResponse] = await Promise.all([
        fetch(api("/api/alerts/rules")),
        fetch(api("/api/alerts/recent?limit=20")),
      ]);
      if (!rulesResponse.ok || !recentResponse.ok) throw new Error("Alarm-API nicht erreichbar");
      const rulesPayload = await rulesResponse.json() as { rows: AlertRule[] };
      const recentPayload = await recentResponse.json() as { rows: RecentAlert[] };
      setRules(rulesPayload.rows);
      setRecent(recentPayload.rows);

      if (initialized.current && browserEnabled && Notification.permission === "granted") {
        for (const alert of recentPayload.rows) {
          if (knownAlertIds.current.has(alert.id)) continue;
          const price = alert.direction === "sell_at_or_below" ? alert.bestSell : alert.bestBuy;
          new Notification("EVE Market Scout", {
            body: `${labelFor(items, alert.typeId)} · ${labelFor(regions, alert.regionId)} · ${formatIsk(price)}`,
          });
        }
      }
      knownAlertIds.current = new Set(recentPayload.rows.map((alert) => alert.id));
      initialized.current = true;
    } catch {
      setMessage("Alarmdaten konnten nicht geladen werden.");
    }
  }, [api, browserEnabled, items, regions]);

  useEffect(() => {
    void loadAlerts();
    const timer = window.setInterval(() => void loadAlerts(), 60_000);
    return () => window.clearInterval(timer);
  }, [loadAlerts]);

  async function createRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adminKey && !import.meta.env.DEV) {
      setMessage("Zum Speichern wird der Admin-Schlüssel benötigt.");
      return;
    }
    const threshold = parseLocalizedNumber(thresholdIsk);
    if (!Number.isFinite(threshold) || threshold <= 0) {
      setMessage("Bitte eine gültige positive Preisschwelle eingeben.");
      return;
    }
    try {
      const response = await fetch(api("/api/alerts/rules"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(adminKey ? { "X-Ingest-Secret": adminKey } : {}),
        },
        body: JSON.stringify({
          regionId,
          typeId,
          direction,
          thresholdIsk: threshold * (thresholdUnit === "million" ? 1_000_000 : 1),
          channel,
          cooldownMinutes: Number(cooldownMinutes),
        }),
      });
      if (!response.ok) {
        setMessage(response.status === 401 ? "Admin-Schlüssel ist falsch." : "Regel konnte nicht gespeichert werden.");
        return;
      }
      setThresholdIsk("");
      setMessage("Alarmregel gespeichert.");
      await loadAlerts();
    } catch {
      setMessage("Regel konnte nicht gespeichert werden: API nicht erreichbar.");
    }
  }

  function changeThresholdUnit(nextUnit: ThresholdUnit) {
    if (nextUnit === thresholdUnit) return;
    const currentValue = parseLocalizedNumber(thresholdIsk);
    if (thresholdIsk !== "" && Number.isFinite(currentValue)) {
      const converted = nextUnit === "million"
        ? currentValue / 1_000_000
        : currentValue * 1_000_000;
      setThresholdIsk(String(converted));
    }
    setThresholdUnit(nextUnit);
  }

  async function deleteRule(rule: AlertRule) {
    if (!adminKey && !import.meta.env.DEV) {
      setMessage("Zum Löschen wird der Admin-Schlüssel benötigt.");
      return;
    }
    if (!window.confirm("Diese Alarmregel wirklich löschen?")) return;
    try {
      const response = await fetch(api(`/api/alerts/rules/${encodeURIComponent(rule.id)}`), {
        method: "DELETE",
        headers: adminKey ? { "X-Ingest-Secret": adminKey } : {},
      });
      if (!response.ok) {
        setMessage(response.status === 401 ? "Admin-Schlüssel ist falsch." : "Regel konnte nicht gelöscht werden.");
        return;
      }
      setMessage("Alarmregel gelöscht.");
      await loadAlerts();
    } catch {
      setMessage("Regel konnte nicht gelöscht werden: API nicht erreichbar.");
    }
  }

  async function enableBrowserAlerts() {
    if (!("Notification" in window)) {
      setMessage("Dieser Browser unterstützt keine Desktop-Benachrichtigungen.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setMessage("Benachrichtigungen wurden nicht freigegeben.");
      return;
    }
    setBrowserEnabled(true);
    new Notification("EVE Market Scout", { body: "Browser-Alarme sind für diesen Tab aktiv." });
    setMessage("Testalarm gesendet. Der Tab muss für Browser-Alarme geöffnet bleiben.");
  }

  return (
    <section id="alerts" className="panel alerts-panel" aria-labelledby="alerts-heading">
      <div className="panel-heading">
        <div><p className="eyebrow">Preiswache</p><h2 id="alerts-heading">Alarme</h2></div>
        <button className="text-button alert-enable" type="button" onClick={() => void enableBrowserAlerts()}>
          {browserEnabled ? "Browser-Alarme aktiv" : "Browser-Testalarm"}
        </button>
      </div>

      <div className="alerts-layout">
        <form className="alert-form" onSubmit={(event) => void createRule(event)}>
          <h3>Neue Regel</h3>
          <label><span>Produkt</span><select value={typeId} onChange={(event) => setTypeId(Number(event.target.value))}>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>Region</span><select value={regionId} onChange={(event) => setRegionId(Number(event.target.value))}>{regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}</select></label>
          <label><span>Bedingung</span><select value={direction} onChange={(event) => setDirection(event.target.value as AlertDirection)}><option value="sell_at_or_below">Best Sell höchstens</option><option value="buy_at_or_above">Best Buy mindestens</option></select></label>
          <label>
            <span>Preisschwelle</span>
            <span className="threshold-control">
              <input required inputMode="decimal" value={thresholdIsk} onChange={(event) => setThresholdIsk(event.target.value)} placeholder={thresholdUnit === "million" ? "z. B. 6,5" : "z. B. 250"} />
              <select aria-label="Einheit der Preisschwelle" value={thresholdUnit} onChange={(event) => changeThresholdUnit(event.target.value as ThresholdUnit)}>
                <option value="million">Mio. ISK</option>
                <option value="isk">ISK</option>
              </select>
            </span>
          </label>
          <label><span>Kanal</span><select value={channel} onChange={(event) => setChannel(event.target.value as AlertChannel)}><option value="both">Discord + Browser</option><option value="discord">Nur Discord</option><option value="browser">Nur Browser</option></select></label>
          <label><span>Cooldown in Minuten</span><input required min="1" max="10080" type="number" value={cooldownMinutes} onChange={(event) => setCooldownMinutes(event.target.value)} /></label>
          <label className="admin-key"><span>Admin-Schlüssel{import.meta.env.DEV ? " · lokal optional" : ""}</span><input required={!import.meta.env.DEV} type="password" autoComplete="current-password" value={adminKey} onChange={(event) => setAdminKey(event.target.value)} placeholder={import.meta.env.DEV ? "Im lokalen Modus nicht nötig" : "INGEST_SECRET"} /></label>
          <button className="primary-button" type="submit">Alarm speichern</button>
          {message ? <p className="form-message" role="status">{message}</p> : null}
        </form>

        <div className="alert-columns">
          <section aria-labelledby="active-alerts-heading">
            <h3 id="active-alerts-heading">Aktive Regeln <span>{rules.length}</span></h3>
            {rules.length === 0 ? <p className="quiet-copy">Noch keine Online-Regel vorhanden.</p> : (
              <ul className="alert-list">
                {rules.map((rule) => (
                  <li key={rule.id}>
                    <div><strong>{labelFor(items, rule.typeId)} · {labelFor(regions, rule.regionId)}</strong><span>{rule.direction === "sell_at_or_below" ? "Sell ≤" : "Buy ≥"} {formatIsk(rule.thresholdIsk)} · {rule.channel}</span></div>
                    <button className="delete-button" type="button" onClick={() => void deleteRule(rule)}>Löschen</button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="recent-alerts-heading">
            <h3 id="recent-alerts-heading">Zuletzt ausgelöst</h3>
            {recent.length === 0 ? <p className="quiet-copy">Noch kein Browser-Alarm ausgelöst.</p> : (
              <ul className="alert-list recent-list">
                {recent.slice(0, 5).map((alert) => (
                  <li key={alert.id}>
                    <div><strong>{labelFor(items, alert.typeId)} · {labelFor(regions, alert.regionId)}</strong><span>{new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(alert.triggeredAt))} · {formatIsk(alert.direction === "sell_at_or_below" ? alert.bestSell : alert.bestBuy)}</span></div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
      <p className="alert-footnote">Discord läuft unabhängig über den Collector. Browser-Benachrichtigungen werden alle 60 Sekunden geprüft und benötigen einen geöffneten Dashboard-Tab.</p>
    </section>
  );
}
