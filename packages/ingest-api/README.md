# @eve-market-scout/ingest-api

Cloudflare Worker für Dashboard, öffentliche Lese-API und authentifizierten
Collector-Ingest. Die Daten liegen in D1.

Die öffentlichen Alarm-Leserouten sind `/api/alerts/rules` und
`/api/alerts/recent`. Änderungen sowie Collector-Ereignisse liegen unter
geschützten Routen und benötigen `X-Ingest-Secret`.

## One-time setup

Siehe `docs/DEPLOYMENT.md`. Kurzfassung ab Repository-Wurzel:

```bash
npx wrangler login
npm run verify:deploy
npm run deploy:cloudflare
npm run secret:set --workspace @eve-market-scout/ingest-api
```

Then set in your GitHub repo (Settings → Secrets and variables → Actions):

- `INGEST_API_URL` = `https://eve-market-scout-ingest.<you>.workers.dev/ingest`
- `INGEST_API_SECRET` = the same string you gave `wrangler secret put`

And switch the collector workflow's `STORAGE_MODE` from `json` to `http`
(see `.github/workflows/collect-market-data.yml`).

## Free-tier headroom

D1 Free erlaubt derzeit 5 Mio. gelesene und 100.000 geschriebene Zeilen pro
Tag sowie 5 GB Speicher. Bei fünf Regionen, acht Items und stündlicher
Erfassung entstehen inklusive Latest-Upsert ungefähr 2.000 Writes pro Tag.
Beim Ausbau auf sehr große Watchlists die Nutzung erneut prüfen.

## Structure market route (optional module)

`POST /ingest/structures` writes to a separate `structure_snapshot` table
(same shared secret, same Worker) — only relevant once you've set up
`packages/eve-sso` and configured `config/structures.json`. Nothing to do
here beyond running the second migration above; the route is already live
once you deploy.
