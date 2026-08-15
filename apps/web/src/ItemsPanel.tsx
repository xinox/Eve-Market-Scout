import { useEffect, useState } from "react";
import itemCatalog from "./itemCatalog.json";

interface ItemEntry {
  readonly id: number;
  readonly name: string;
}

interface SearchResult {
  typeId: number;
  name: string;
}

interface ItemsPanelProps {
  apiBase: string;
  items: readonly ItemEntry[];
  onChanged: () => Promise<void>;
}

export function ItemsPanel({ apiBase, items, onChanged }: ItemsPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState("");
  const [adminKey, setAdminKey] = useState("");

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setSearching(true);
      const needle = normalized.toLocaleLowerCase("en");
      const matches = itemCatalog
        .map((item) => {
          const name = item.name.toLocaleLowerCase("en");
          const score = name === needle ? 0 : name.startsWith(needle) ? 1 : name.includes(needle) ? 2 : 3;
          return { item, score };
        })
        .filter((match) => match.score < 3)
        .sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name, "en"))
        .slice(0, 20)
        .map(({ item }) => ({ typeId: item.id, name: item.name }));
      setResults(matches);
      setMessage(matches.length === 0 ? "Keine passenden EVE-Marktitems gefunden." : "");
      setSearching(false);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [query]);

  async function addItem(item: SearchResult) {
    if (!adminKey && !import.meta.env.DEV) {
      setMessage("Zum Hinzufügen wird der Admin-Schlüssel benötigt.");
      return;
    }
    try {
      const response = await fetch(`${apiBase}/api/watchlist`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(adminKey ? { "X-Ingest-Secret": adminKey } : {}),
        },
        body: JSON.stringify(item),
      });
      if (!response.ok) {
        setMessage(response.status === 401 ? "Admin-Schlüssel ist falsch." : "Item konnte nicht hinzugefügt werden.");
        return;
      }
      const result = await response.json() as { collector?: "queued" | "local" | "not_configured" | "failed" };
      const collectorMessage = {
        queued: " Der Collector wurde gestartet.",
        local: " Lokal wird der Collector nicht automatisch gestartet.",
        not_configured: " Der Collector läuft beim nächsten Zeitplan.",
        failed: " Der Collector konnte nicht gestartet werden.",
      }[result.collector ?? "not_configured"];
      setMessage(`${item.name} wurde zur Watchlist hinzugefügt.${collectorMessage}`);
      setQuery("");
      setResults([]);
      await onChanged();
    } catch {
      setMessage("Item konnte nicht hinzugefügt werden: API nicht erreichbar.");
    }
  }

  async function removeItem(item: ItemEntry) {
    if (!adminKey && !import.meta.env.DEV) {
      setMessage("Zum Entfernen wird der Admin-Schlüssel benötigt.");
      return;
    }
    if (!window.confirm(`${item.name} aus der Watchlist entfernen? Historische Daten bleiben erhalten.`)) return;
    try {
      const response = await fetch(`${apiBase}/api/watchlist/${item.id}`, {
        method: "DELETE",
        headers: adminKey ? { "X-Ingest-Secret": adminKey } : {},
      });
      if (!response.ok) {
        setMessage(response.status === 401 ? "Admin-Schlüssel ist falsch." : "Item konnte nicht entfernt werden.");
        return;
      }
      setMessage(`${item.name} wurde entfernt.`);
      await onChanged();
    } catch {
      setMessage("Item konnte nicht entfernt werden: API nicht erreichbar.");
    }
  }

  const activeIds = new Set(items.map((item) => item.id));

  return (
    <section id="items" className="panel items-panel" aria-labelledby="item-search-heading">
      <div className="items-layout">
        <div className="item-search-area">
          <p className="eyebrow">EVE-Universum durchsuchen</p>
          <h2 id="item-search-heading">Item hinzufügen</h2>
          <label className="item-search-field">
            <span>Itemname</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="z. B. Tritanium, Rifter, PLEX …"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <p className="search-state" aria-live="polite">{searching ? "Suche in EVE ESI …" : message}</p>
          {results.length > 0 ? (
            <ul className="search-results">
              {results.map((result) => {
                const active = activeIds.has(result.typeId);
                return (
                  <li key={result.typeId}>
                    <button type="button" disabled={active} onClick={() => void addItem(result)}>
                      <span><strong>{result.name}</strong><small>Type ID {result.typeId}</small></span>
                      <b>{active ? "Bereits aktiv" : "Hinzufügen"}</b>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <label className="item-admin-key">
            <span>Admin-Schlüssel{import.meta.env.DEV ? " · lokal optional" : ""}</span>
            <input type="password" required={!import.meta.env.DEV} autoComplete="current-password" value={adminKey} onChange={(event) => setAdminKey(event.target.value)} placeholder={import.meta.env.DEV ? "Im lokalen Modus nicht nötig" : "INGEST_SECRET"} />
          </label>
        </div>

        <div className="watchlist-area">
          <div className="panel-heading">
            <div><p className="eyebrow">Collector-Auswahl</p><h2>Aktive Watchlist</h2></div>
            <span className="record-count">{items.length} Items</span>
          </div>
          {items.length === 0 ? <p className="quiet-copy">Die Watchlist ist leer.</p> : (
            <ul className="watchlist-list">
              {items.map((item) => (
                <li key={item.id}>
                  <span><strong>{item.name}</strong><small>Type ID {item.id}</small></span>
                  <button type="button" className="delete-button" onClick={() => void removeItem(item)}>Entfernen</button>
                </li>
              ))}
            </ul>
          )}
          <p className="item-footnote">Neue Items erscheinen nach dem nächsten Collector-Lauf mit echten Preisen im Markt-Tab.</p>
        </div>
      </div>
    </section>
  );
}
