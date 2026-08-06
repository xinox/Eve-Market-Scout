# @eve-market-scout/ingest-api

Cloudflare Worker that receives snapshot batches from the collector
(GitHub Actions) and writes them into D1. This is the one piece of Phase 1
that needs a real Cloudflare account. Everything else (collector, GH Actions,
JsonFileStore) runs without any cloud account at all.

## One-time setup

```bash
npm install -g wrangler   # or use npx wrangler ...
wrangler login

cd packages/ingest-api
wrangler d1 create eve-market-scout
# copy the printed database_id into wrangler.toml

npm run db:migrate        # applies db/migrations/0001_init.sql

wrangler secret put INGEST_SECRET
# paste the same long random string you'll put in
# the GitHub Actions secret INGEST_API_SECRET

npm run deploy
# prints your Worker URL, e.g. https://eve-market-scout-ingest.<you>.workers.dev
```

Then set in your GitHub repo (Settings → Secrets and variables → Actions):

- `INGEST_API_URL` = `https://eve-market-scout-ingest.<you>.workers.dev/ingest`
- `INGEST_API_SECRET` = the same string you gave `wrangler secret put`

And switch the collector workflow's `STORAGE_MODE` from `json` to `http`
(see `.github/workflows/collect-market-data.yml`).

## Free-tier headroom

D1's free tier is 5 GB storage and 5M row reads/writes per month. At 5 trade
hub regions × ~8 watchlist items × 24 runs/day (hourly cadence), we're
writing on the order of ~1,000 rows a day (~30k/month) — nowhere near the
limit even after months of history. Re-check this if you expand the watchlist to
"everything" or shorten the cadence further, see `docs/ESI_NOTES.md`.

## Structure market route (optional module)

`POST /ingest/structures` writes to a separate `structure_snapshot` table
(same shared secret, same Worker) — only relevant once you've set up
`packages/eve-sso` and configured `config/structures.json`. Nothing to do
here beyond running the second migration above; the route is already live
once you deploy.
