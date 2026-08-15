import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { AlertsPanel } from "./AlertsPanel";
import type { ChartMarketRow } from "./HistoryChart";

const HistoryChart = lazy(() => import("./HistoryChart"));
const ItemsPanel = lazy(() => import("./ItemsPanel").then((module) => ({ default: module.ItemsPanel })));

interface MarketRow extends ChartMarketRow {
  regionId: number;
  typeId: number;
  timestamp: string;
  bestSell: number | null;
  bestBuy: number | null;
  sellVolume: number;
  buyVolume: number;
  sellOrderCount: number;
  buyOrderCount: number;
}

interface LatestResponse {
  generatedAt: string;
  rows: MarketRow[];
}

interface HistoryResponse {
  regionId: number;
  typeId: number;
  rows: MarketRow[];
}

type LoadState = "loading" | "live" | "demo" | "empty" | "error";
type Theme = "dark" | "light";
type View = "market" | "alerts" | "items";

const REGIONS = [
  { id: 10000002, name: "Jita", detail: "The Forge" },
  { id: 10000043, name: "Amarr", detail: "Domain" },
  { id: 10000032, name: "Dodixie", detail: "Sinq Laison" },
  { id: 10000030, name: "Rens", detail: "Heimatar" },
  { id: 10000042, name: "Hek", detail: "Metropolis" },
  { id: 19000001, name: "Global", detail: "PLEX-Markt" },
] as const;

const DEFAULT_ITEMS = [
  { id: 44992, name: "PLEX" },
  { id: 40, name: "Megacyte" },
] as const;

const DEMO_ROWS: MarketRow[] = [
  [10000002, 44992, 5_940_000, 5_820_000, 8_190, 5_460],
  [10000043, 44992, 6_760_000, 6_690_000, 2_410, 1_840],
  [10000032, 44992, 6_410_000, 6_280_000, 1_430, 1_220],
  [10000030, 44992, 6_620_000, 6_440_000, 690, 520],
  [10000042, 44992, 6_510_000, 6_390_000, 740, 610],
  [10000002, 40, 1_840, 1_790, 1_280_000, 920_000],
  [10000043, 40, 2_180, 2_090, 360_000, 280_000],
  [10000032, 40, 2_040, 1_960, 210_000, 180_000],
  [10000030, 40, 2_120, 2_020, 120_000, 90_000],
  [10000042, 40, 2_090, 2_000, 140_000, 110_000],
].map(([regionId, typeId, bestSell, bestBuy, sellVolume, buyVolume]) => ({
  regionId,
  typeId,
  bestSell,
  bestBuy,
  sellVolume,
  buyVolume,
  sellOrderCount: Math.max(4, Math.round(sellVolume / 250)),
  buyOrderCount: Math.max(3, Math.round(buyVolume / 300)),
  timestamp: new Date().toISOString(),
}));

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const FEE_RATE_BUY = 0.03;
const FEE_RATE_SELL = 0.066;

function endpoint(path: string): string {
  return `${API_BASE}${path}`;
}

function regionName(id: number): string {
  return REGIONS.find((region) => region.id === id)?.name ?? String(id);
}

function itemName(id: number, items: readonly { id: number; name: string }[]): string {
  return items.find((item) => item.id === id)?.name ?? `Type ${id}`;
}

function viewFromHash(): View {
  if (window.location.hash === "#alerts") return "alerts";
  if (window.location.hash === "#items") return "items";
  return "market";
}

function formatIsk(value: number | null, compact = false): string {
  if (value === null) return "—";
  if (compact) {
    return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2, notation: "compact" }).format(value)} ISK`;
  }
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: value < 10_000 ? 2 : 0 }).format(value)} ISK`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("de-DE", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatTime(value: string | null): string {
  if (!value) return "Noch keine Daten";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function newestTimestamp(rows: MarketRow[]): string | null {
  return rows.reduce<string | null>((latest, row) => {
    if (latest === null || Date.parse(row.timestamp) > Date.parse(latest)) return row.timestamp;
    return latest;
  }, null);
}

function makeDemoHistory(row: MarketRow): MarketRow[] {
  return Array.from({ length: 24 }, (_, index) => {
    const age = 23 - index;
    const wave = Math.sin(index / 2.6) * 0.017 + (index - 12) * 0.0008;
    return {
      ...row,
      timestamp: new Date(Date.now() - age * 60 * 60 * 1000).toISOString(),
      bestSell: row.bestSell === null ? null : Math.round(row.bestSell * (1 + wave)),
      bestBuy: row.bestBuy === null ? null : Math.round(row.bestBuy * (1 + wave * 0.85)),
    };
  });
}

export function App() {
  const [activeView, setActiveView] = useState<View>(viewFromHash);
  const [items, setItems] = useState<Array<{ id: number; name: string }>>([...DEFAULT_ITEMS]);
  const [rows, setRows] = useState<MarketRow[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<number>(DEFAULT_ITEMS[0].id);
  const [selectedRegion, setSelectedRegion] = useState<number>(REGIONS[0].id);
  const [history, setHistory] = useState<MarketRow[]>([]);
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  );

  const loadLatest = useCallback(async () => {
    setState((current) => (current === "live" || current === "demo" ? current : "loading"));
    try {
      const response = await fetch(endpoint("/api/markets/latest"));
      if (!response.ok) throw new Error(`API ${response.status}`);
      const payload = (await response.json()) as LatestResponse;
      if (payload.rows.length === 0) {
        if (import.meta.env.DEV) {
          setRows(DEMO_ROWS);
          setState("demo");
          setUpdatedAt(DEMO_ROWS[0].timestamp);
        } else {
          setRows([]);
          setState("empty");
          setUpdatedAt(null);
        }
        return;
      }
      setRows(payload.rows);
      setState("live");
      setUpdatedAt(newestTimestamp(payload.rows));
    } catch {
      if (import.meta.env.DEV) {
        setRows(DEMO_ROWS);
        setState("demo");
        setUpdatedAt(DEMO_ROWS[0].timestamp);
      } else {
        setState("error");
      }
    }
  }, []);

  const loadWatchlist = useCallback(async () => {
    try {
      const response = await fetch(endpoint("/api/watchlist"));
      if (!response.ok) throw new Error(`API ${response.status}`);
      const payload = await response.json() as { rows: Array<{ typeId: number; name?: string }> };
      setItems(payload.rows.map((item) => ({ id: item.typeId, name: item.name ?? `Type ${item.typeId}` })));
    } catch {
      if (!import.meta.env.DEV) setItems([]);
    }
  }, []);

  useEffect(() => {
    void loadLatest();
    void loadWatchlist();
    const timer = window.setInterval(() => void loadLatest(), 60_000);
    return () => window.clearInterval(timer);
  }, [loadLatest, loadWatchlist]);

  useEffect(() => {
    if (items.length > 0 && !items.some((item) => item.id === selectedType)) {
      setSelectedType(items[0].id);
    }
  }, [items, selectedType]);

  useEffect(() => {
    const regionsWithData = REGIONS.filter((region) =>
      rows.some((row) => row.typeId === selectedType && row.regionId === region.id)
    );
    if (regionsWithData.length > 0 && !regionsWithData.some((region) => region.id === selectedRegion)) {
      setSelectedRegion(regionsWithData[0].id);
    }
  }, [rows, selectedRegion, selectedType]);

  useEffect(() => {
    if (state === "demo") {
      const base = rows.find((row) => row.typeId === selectedType && row.regionId === selectedRegion);
      setHistory(base ? makeDemoHistory(base) : []);
      return;
    }
    if (state !== "live") {
      setHistory([]);
      return;
    }
    const params = new URLSearchParams({
      regionId: String(selectedRegion),
      typeId: String(selectedType),
      limit: "168",
    });
    const controller = new AbortController();
    fetch(endpoint(`/api/markets/history?${params}`), { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`API ${response.status}`);
        return response.json() as Promise<HistoryResponse>;
      })
      .then((payload) => setHistory([...payload.rows].reverse()))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setHistory([]);
      });
    return () => controller.abort();
  }, [rows, selectedRegion, selectedType, state]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("eve-scout-theme", theme);
  }, [theme]);

  useEffect(() => {
    const syncViewFromHash = () => setActiveView(viewFromHash());
    window.addEventListener("hashchange", syncViewFromHash);
    return () => window.removeEventListener("hashchange", syncViewFromHash);
  }, []);

  const selectedRows = useMemo(
    () => REGIONS.map((region) => rows.find((row) => row.typeId === selectedType && row.regionId === region.id)).filter((row): row is MarketRow => Boolean(row)),
    [rows, selectedType],
  );

  const selectableRegions = useMemo(() => {
    const withData = REGIONS.filter((region) =>
      rows.some((row) => row.typeId === selectedType && row.regionId === region.id)
    );
    return withData.length > 0 ? withData : REGIONS;
  }, [rows, selectedType]);

  const routes = useMemo(() => {
    const opportunities: Array<{
      source: number;
      destination: number;
      typeId: number;
      profit: number;
      margin: number;
    }> = [];
    for (const source of rows) {
      if (source.bestSell === null) continue;
      for (const destination of rows) {
        if (destination.regionId === source.regionId || destination.typeId !== source.typeId || destination.bestBuy === null) continue;
        const cost = source.bestSell * (1 + FEE_RATE_BUY);
        const revenue = destination.bestBuy * (1 - FEE_RATE_SELL);
        const profit = revenue - cost;
        opportunities.push({
          source: source.regionId,
          destination: destination.regionId,
          typeId: source.typeId,
          profit,
          margin: cost === 0 ? 0 : (profit / cost) * 100,
        });
      }
    }
    return opportunities.filter((route) => route.profit > 0).sort((a, b) => b.margin - a.margin).slice(0, 5);
  }, [rows]);

  const bestAsk = selectedRows.reduce<number | null>((best, row) =>
    row.bestSell !== null && (best === null || row.bestSell < best) ? row.bestSell : best, null);
  const strongestBid = selectedRows.reduce<number | null>((best, row) =>
    row.bestBuy !== null && (best === null || row.bestBuy > best) ? row.bestBuy : best, null);
  const statusText = state === "live" ? "Live" : state === "demo" ? "Demo-Daten" : state === "loading" ? "Lädt" : state === "empty" ? "Keine Daten" : "API nicht erreichbar";

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#market" aria-label="EVE Market Scout Marktübersicht">
          <span className="brand-mark" aria-hidden="true">EMS</span>
          <span>EVE Market Scout</span>
        </a>
        <nav className="main-nav" aria-label="Hauptnavigation">
          <a href="#market" aria-current={activeView === "market" ? "page" : undefined}>Markt</a>
          <a href="#alerts" aria-current={activeView === "alerts" ? "page" : undefined}>Alarme</a>
          <a href="#items" aria-current={activeView === "items" ? "page" : undefined}>Items</a>
        </nav>
        <div className="topbar-actions">
          <span className={`status status-${state}`}><span className="status-dot" />{statusText}</span>
          <button className="text-button" type="button" onClick={() => void loadLatest()}>Aktualisieren</button>
          <button className="text-button" type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? "Heller Modus" : "Dunkler Modus"}
          </button>
        </div>
      </header>

      <main id="top">
        {activeView === "market" ? (
          <>
        <section className="hero" aria-labelledby="page-title">
          <div>
            <p className="eyebrow">Market intelligence · Tranquility</p>
            <h1 id="page-title">Spreads, bevor sie schließen.</h1>
            <p className="hero-copy">Fünf Handelsregionen. Konservative Gebühren. Eine klare nächste Route.</p>
          </div>
          <dl className="market-pulse">
            <div><dt>Bester Ask</dt><dd>{formatIsk(bestAsk, true)}</dd></div>
            <div><dt>Stärkster Bid</dt><dd>{formatIsk(strongestBid, true)}</dd></div>
            <div><dt>Stand</dt><dd>{formatTime(updatedAt)}</dd></div>
          </dl>
        </section>

        <section className="control-strip" aria-label="Marktfilter">
          <label>
            <span>Produkt</span>
            <select value={selectedType} onChange={(event) => setSelectedType(Number(event.target.value))}>
              {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>
            <span>Verlauf für Hub</span>
            <select value={selectedRegion} onChange={(event) => setSelectedRegion(Number(event.target.value))}>
              {selectableRegions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
            </select>
          </label>
          <p className="fee-note">Modell: 3,0 % Kauf · 6,6 % Verkauf</p>
        </section>

        {state === "empty" || state === "error" ? (
          <section className="empty-state" aria-live="polite">
            <p className="eyebrow">{state === "empty" ? "Bereit für den ersten Lauf" : "Verbindung unterbrochen"}</p>
            <h2>{state === "empty" ? "Noch keine Marktdaten vorhanden." : "Die Markt-API antwortet nicht."}</h2>
            <p>{state === "empty" ? "Starte den Collector einmal oder warte auf den nächsten GitHub-Actions-Lauf." : "Prüfe Worker, D1-Bindung und VITE_API_BASE_URL."}</p>
            <button type="button" className="primary-button" onClick={() => void loadLatest()}>Erneut versuchen</button>
          </section>
        ) : (
          <div className="dashboard-grid">
            <section className="panel market-panel" aria-labelledby="market-heading">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Regionenvergleich</p>
                  <h2 id="market-heading">{itemName(selectedType, items)}</h2>
                </div>
                <span className="record-count">{selectedRows.length} Hubs</span>
              </div>
              <div className="table-scroll">
                <table>
                  <thead><tr><th>Hub</th><th>Best Sell</th><th>Best Buy</th><th>Rohspread</th><th>Sell-Vol.</th><th>Buy-Vol.</th></tr></thead>
                  <tbody>
                    {selectedRows.map((row) => {
                      const spread = row.bestSell !== null && row.bestBuy !== null ? row.bestSell - row.bestBuy : null;
                      const selected = row.regionId === selectedRegion;
                      return (
                        <tr key={row.regionId} className={selected ? "is-selected" : undefined}>
                          <td><button type="button" className="hub-button" onClick={() => setSelectedRegion(row.regionId)}><strong>{regionName(row.regionId)}</strong><span>{REGIONS.find((region) => region.id === row.regionId)?.detail}</span></button></td>
                          <td>{formatIsk(row.bestSell)}</td>
                          <td>{formatIsk(row.bestBuy)}</td>
                          <td>{formatIsk(spread)}</td>
                          <td>{formatNumber(row.sellVolume)}</td>
                          <td>{formatNumber(row.buyVolume)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <aside className="panel route-panel" aria-labelledby="route-heading">
              <div className="panel-heading">
                <div><p className="eyebrow">Nach Gebühren</p><h2 id="route-heading">Top-Routen</h2></div>
              </div>
              {routes.length === 0 ? <p className="quiet-copy">Aktuell keine positive Sofort-Route.</p> : (
                <ol className="route-list">
                  {routes.map((route, index) => (
                    <li key={`${route.source}-${route.destination}-${route.typeId}`}>
                      <span className="route-rank">{String(index + 1).padStart(2, "0")}</span>
                      <div><strong>{regionName(route.source)} → {regionName(route.destination)}</strong><span>{itemName(route.typeId, items)} · {formatIsk(route.profit)} / Einheit</span></div>
                      <b>{route.margin.toFixed(1)} %</b>
                    </li>
                  ))}
                </ol>
              )}
            </aside>

            <section className="panel history-panel" aria-labelledby="history-heading">
              <div className="panel-heading">
                <div><p className="eyebrow">Preisverlauf</p><h2 id="history-heading">{itemName(selectedType, items)} · {regionName(selectedRegion)}</h2></div>
                <span className="record-count">Letzte {history.length} Messpunkte</span>
              </div>
              <div className="chart" role="img" aria-label={`Preisverlauf für ${itemName(selectedType, items)} in ${regionName(selectedRegion)}`}>
                {history.length < 2 ? <p className="quiet-copy">Für einen Verlauf werden mindestens zwei Messpunkte benötigt.</p> : (
                  <Suspense fallback={<p className="quiet-copy">Diagramm wird geladen …</p>}>
                    <HistoryChart rows={history} />
                  </Suspense>
                )}
              </div>
            </section>

          </div>
        )}
          </>
        ) : activeView === "alerts" ? (
          <>
            <section className="hero alerts-hero" aria-labelledby="alerts-page-title">
              <div>
                <p className="eyebrow">Automatisierte Preiswache</p>
                <h1 id="alerts-page-title">Der Markt meldet sich bei dir.</h1>
                <p className="hero-copy">Schwellen definieren, Discord oder Browser wählen und den Collector den Rest erledigen lassen.</p>
              </div>
            </section>
            <div className="alerts-view">
              <AlertsPanel apiBase={API_BASE} regions={REGIONS} items={items} />
            </div>
          </>
        ) : (
          <>
            <section className="hero items-hero" aria-labelledby="items-page-title">
              <div>
                <p className="eyebrow">Persönliche Watchlist</p>
                <h1 id="items-page-title">Finde, was du handeln willst.</h1>
                <p className="hero-copy">Nach EVE-Items suchen und mit einem Klick in Marktansicht, Collector und Alarmregeln übernehmen.</p>
              </div>
            </section>
            <div className="items-view">
              <Suspense fallback={<section className="panel"><p className="quiet-copy">Itemkatalog wird geladen …</p></section>}>
                <ItemsPanel apiBase={API_BASE} items={items} onChanged={loadWatchlist} />
              </Suspense>
            </div>
          </>
        )}
      </main>

      <footer><span>EVE Market Scout</span><span>Preise sind Momentaufnahmen, keine Gewinngarantie.</span></footer>
    </div>
  );
}
