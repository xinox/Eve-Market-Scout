# Kostenlos auf Cloudflare deployen

Die Anwendung läuft als ein Cloudflare Worker: statisches React-Dashboard, Lese-/Ingest-API und D1-Datenbank. Der Collector läuft alle 30 Minuten als GitHub Action im öffentlichen Repository.

## Voraussetzungen

- Node.js 20.19 oder neuer
- kostenloses Cloudflare-Konto
- öffentliches GitHub-Repository für kostenlose Actions-Laufzeit

## Erster Deploy

```bash
npm ci
npx wrangler login
npm run verify:deploy
npm run deploy:cloudflare
npm run secret:set --workspace @eve-market-scout/ingest-api
```

Die D1-Datenbank ist bereits angelegt und über `database_id` verbunden. Beim letzten Befehl einen langen zufälligen Wert eingeben. Derselbe Wert ist der Admin-Schlüssel für Änderungen im Dashboard.

Danach unter GitHub → Settings → Secrets and variables → Actions setzen:

- Secret `INGEST_API_URL`: `https://<worker>.workers.dev/ingest`
- Secret `INGEST_API_SECRET`: derselbe Wert wie `INGEST_SECRET`
- Variable `STORAGE_MODE`: `http`
- Variable `ESI_USER_AGENT`: aussagekräftiger Kontakt
- Optional Secret `DISCORD_WEBHOOK_URL`

Den Workflow „Collect market data“ einmal manuell starten. Nach erfolgreichem Lauf erscheinen die Live-Daten im Dashboard.

Neue Items werden direkt im Tab „Items“ gesucht und zur D1-Watchlist hinzugefügt. Ohne weitere Einrichtung übernimmt der nächste Collector-Lauf die Änderung.

Soll der Collector sofort nach dem Hinzufügen starten, einen feingranularen GitHub-Token nur für dieses Repository mit `Actions: write` erstellen und als Worker-Secret speichern:

```bash
npm run secret:set:github --workspace @eve-market-scout/ingest-api
```

Standardmäßig werden `xinox/Eve-Market-Scout`, Branch `main` und der Workflow `collect-market-data.yml` verwendet. Abweichend können die Worker-Variablen `GITHUB_REPOSITORY` und `GITHUB_REF` gesetzt werden. Lokal wird kein GitHub-Lauf ausgelöst.

## Alarme

- Regeln werden im Dashboard unter „Alarme“ verwaltet und in D1 gespeichert.
- Der Collector lädt diese Regeln bei jedem Lauf.
- `discord` und `both` werden über `DISCORD_WEBHOOK_URL` versendet.
- `browser` und `both` erscheinen als Desktop-Benachrichtigung, solange das Dashboard geöffnet ist.
- „Browser-Testalarm“ prüft nur lokal die Browserfreigabe und sendet nichts an Discord.

## Deploy über GitHub

Nach dem ersten lokalen Deploy zwei weitere Repository-Secrets setzen:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN` mit Schreibrechten für Workers und D1

Der manuelle Workflow „Deploy Cloudflare“ baut, migriert und deployed.

## Kontrolle

```bash
npm test
npm run typecheck
npm run build:web
npm run check:worker
```

Öffentliche Prüfpfade nach dem Deploy:

- `/` – Dashboard
- `/health` – Worker-Status
- `/api/markets/latest` – aktuelle Preise
