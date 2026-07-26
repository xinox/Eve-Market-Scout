# EVE Market Scout

Modular EVE Online market intelligence: collection → alerts → trade
analysis → historical analytics. See `docs/ARCHITECTURE.md` and
`docs/ROADMAP.md` for the full picture — don't duplicate that here.

## Conventions

- TypeScript everywhere, strict mode. npm workspaces, package names under
  `@eve-market-scout/*`.
- Each `packages/*` folder is independently swappable. New capability =
  new package with one clear job, not a new function bolted onto an
  existing package.
- Storage and notifications are behind interfaces (`MarketStore` in
  `packages/collector/src/store/store.ts` is the reference pattern) —
  follow that shape for new swappable pieces.
- No new runtime dependency for something 10 lines of plain code can do
  (see `packages/shared/src/logger.ts`).

## Commands

- `npm run collect` — run the collector locally (writes to `data/snapshots/`
  unless `STORAGE_MODE=http` is set)
- `npm run typecheck` — typecheck all packages
- `npm test` — run tests (add them as you build each package out)

## Commit style

Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`), one logical
change per commit.

## Where NOT to look

ESI-specific quirks (pagination, error-limit headers, region-vs-system,
endpoint list) live in the `esi-integration` skill, not here — it only
loads when you're actually touching `esi-client` or `collector` code, which
keeps this file short for everything else (frontend, alert-engine logic,
docs work).
