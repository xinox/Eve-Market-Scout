#!/usr/bin/env node
/**
 * Run this ONCE, locally, to authorize a character for structure-market
 * access and obtain a refresh token. Usage:
 *
 *   EVE_CLIENT_ID=... EVE_CLIENT_SECRET=... EVE_CALLBACK_URL=... npm run login
 *   (from packages/eve-sso, or `npm run login --workspace=@eve-market-scout/eve-sso`)
 *
 * This deliberately does NOT run a local HTTP server to catch the OAuth
 * callback automatically -- EVE's callback URL doesn't need to actually be
 * reachable. Instead: open the printed URL, log in, and EVE will redirect
 * your browser to your registered callback URL (even if nothing is
 * listening there -- the browser will just show "can't connect" or a blank
 * page). Copy the FULL resulting URL from your browser's address bar and
 * paste it back here when prompted. This avoids a class of local-server
 * bugs (port conflicts, firewalls, cross-platform "open browser" quirks)
 * that can't be tested from a sandbox with no live EVE account anyway.
 *
 * The refresh token this prints is a long-lived credential for this
 * character's granted scopes. Store it as a GitHub Actions secret
 * (EVE_REFRESH_TOKEN) -- never commit it, paste it in chat, or log it
 * anywhere other than this one-time terminal output.
 */
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import {
  buildAuthorizationUrl,
  exchangeCodeForToken,
  extractCharacterInfo,
} from "../src/sso.js";
import { STRUCTURE_MARKET_SCOPES } from "../src/types.js";

async function main() {
  const clientId = process.env.EVE_CLIENT_ID;
  const clientSecret = process.env.EVE_CLIENT_SECRET;
  const redirectUri = process.env.EVE_CALLBACK_URL ?? "https://localhost/callback";

  if (!clientId || !clientSecret) {
    console.error(
      "Set EVE_CLIENT_ID and EVE_CLIENT_SECRET (from your EVE Developer Application) first."
    );
    process.exitCode = 1;
    return;
  }

  const state = randomBytes(16).toString("hex");
  const url = await buildAuthorizationUrl({
    clientId,
    redirectUri,
    scopes: STRUCTURE_MARKET_SCOPES,
    state,
  });

  console.log("\n1. Open this URL and log in with the character you want to track:\n");
  console.log(url);
  console.log(
    `\n2. EVE will redirect to your callback URL (${redirectUri}). That page`
  );
  console.log("   doesn't need to load successfully -- just copy the FULL URL");
  console.log("   from your browser's address bar afterward.\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const pastedUrl = await rl.question("Paste the redirected URL here: ");
  rl.close();

  const parsed = new URL(pastedUrl.trim());
  const code = parsed.searchParams.get("code");
  const returnedState = parsed.searchParams.get("state");

  if (!code) {
    console.error("No 'code' parameter found in that URL -- did you paste the right one?");
    process.exitCode = 1;
    return;
  }
  if (returnedState !== state) {
    console.error(
      "State mismatch -- the pasted URL doesn't match this login attempt. Aborting for safety."
    );
    process.exitCode = 1;
    return;
  }

  const token = await exchangeCodeForToken(clientId, clientSecret, code);
  const character = extractCharacterInfo(token);

  console.log(`\nAuthorized as: ${character.characterName} (character_id ${character.characterId})`);
  console.log(`Granted scopes: ${character.scopes.join(", ") || "(none returned)"}\n`);
  console.log("Refresh token (store this as the EVE_REFRESH_TOKEN GitHub secret,");
  console.log("do not commit it or paste it anywhere else):\n");
  console.log(token.refresh_token);
  console.log("");
}

main().catch((err) => {
  console.error("Login failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
