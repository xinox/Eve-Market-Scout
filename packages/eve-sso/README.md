# @eve-market-scout/eve-sso

EVE SSO (OAuth2) for structure-market access. Ported from the auth flow in
a prior EVE trading project of the user's — same SSO metadata discovery,
same JWT-payload decoding, same scope set.

## Why this exists

Public region-market data (everything in `packages/esi-client`) needs no
authentication. Player-owned Upwell structures (citadels) are different:
ESI only exposes their orders via `/markets/structures/{structure_id}/`,
which requires an authenticated character with docking access to that
structure and the `esi-markets.structure_markets.v1` scope.

## One-time setup

1. **Register an application** at
   https://developers.eveonline.com/applications — choose
   "Authentication & API Access", add these scopes:
   - `esi-markets.structure_markets.v1`
   - `esi-search.search_structures.v1` (only needed if you want structure
     search/discovery later, not for reading a structure_id you already know)
   - `esi-universe.read_structures.v1`
   - Callback URL: anything valid, e.g. `https://localhost/callback` — it
     does **not** need to be a real, reachable server (see below).
2. **Run the login script once, locally**:
   ```bash
   cd packages/eve-sso
   EVE_CLIENT_ID=... EVE_CLIENT_SECRET=... EVE_CALLBACK_URL=https://localhost/callback npm run login
   ```
3. Open the printed URL, log in with the character that has docking access
   to the structure(s) you want to track, and authorize the scopes.
4. EVE redirects your browser to your callback URL. **That page doesn't
   need to load** — copy the full URL from your browser's address bar
   (it contains `?code=...&state=...`) and paste it back into the terminal
   when prompted.
5. The script prints a **refresh token**. Store it as a GitHub Actions
   secret named `EVE_REFRESH_TOKEN`, alongside `EVE_CLIENT_ID` and
   `EVE_CLIENT_SECRET`. **Never commit it, log it elsewhere, or paste it
   into a chat/issue** — treat it like a password scoped to those three
   read-only scopes on that one character.

The refresh token doesn't expire on its own (EVE SSO refresh tokens are
long-lived); it's only invalidated by revoking the app's authorization,
changing your EVE account password, or the app's scopes changing. The
automated `structureCollector` (see `packages/collector`) uses it to mint a
fresh short-lived access token (~20 min) on every run via `refreshAccessToken()`.

## Security note on JWT decoding

`decodeJwtPayload()` reads the token's payload without verifying its
cryptographic signature. That's fine here — we're reading a token we just
received directly from EVE's token endpoint over HTTPS, not validating a
token handed to us by someone else. Don't reuse this function in a context
where you need to trust a token's origin; verify against
`https://login.eveonline.com/oauth/jwks` instead in that case.

## What's NOT implemented here

Structure search (finding a structure_id by name) needs the
`esi-search.search_structures.v1` scope and a live authenticated call to
`/characters/{character_id}/search/` — not built yet. For now, configure
`config/structures.json` with structure IDs you already know (e.g. from
in-game, right-click a structure → Show Info → the numeric ID, or from a
previous session of the old EvETrading app):

```json
[
  { "structureId": 1035466617946, "name": "My Trade Citadel" }
]
```

`config/structures.example.json` ships as an empty array on purpose —
unlike NPC trade hubs, there's no universal structure every user has
access to, so the safe default is "do nothing" rather than a placeholder ID
that would fail every run until replaced. See `docs/ESI_NOTES.md` for how
to add structure search later if you want it.
