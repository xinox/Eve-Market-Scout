import type { SsoMetadata, EveTokenResponse, CharacterInfo } from "./types.js";

const SSO_METADATA_URL =
  "https://login.eveonline.com/.well-known/oauth-authorization-server";

/** Cached for the process lifetime -- this metadata doesn't change
 * between requests within a single collector run. */
let cachedMetadata: SsoMetadata | null = null;

export async function discoverSsoMetadata(): Promise<SsoMetadata> {
  if (cachedMetadata) return cachedMetadata;
  const res = await fetch(SSO_METADATA_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch EVE SSO metadata: ${res.status}`);
  }
  cachedMetadata = (await res.json()) as SsoMetadata;
  return cachedMetadata;
}

/**
 * Pure URL builder -- takes the discovered authorization_endpoint rather
 * than fetching it itself, so this stays unit-testable without a network
 * call. Use buildAuthorizationUrl() below for the convenience wrapper that
 * does the discovery for you.
 */
export function buildAuthorizationUrlFromEndpoint(
  authorizationEndpoint: string,
  params: {
    clientId: string;
    redirectUri: string;
    scopes: readonly string[];
    state: string;
  }
): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    scope: params.scopes.join(" "),
    state: params.state,
  });
  return `${authorizationEndpoint}?${query.toString()}`;
}

export async function buildAuthorizationUrl(params: {
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  state: string;
}): Promise<string> {
  const metadata = await discoverSsoMetadata();
  return buildAuthorizationUrlFromEndpoint(metadata.authorization_endpoint, params);
}

/** Decodes a JWT's payload without verifying its signature. This mirrors
 * the prior project's approach -- acceptable for a personal/hobby tool
 * reading its own freshly-issued token, but note this does NOT
 * cryptographically verify the token actually came from EVE SSO. Don't
 * reuse this pattern for anything that needs to trust tokens from
 * elsewhere; for that, verify against https://login.eveonline.com/oauth/jwks
 * instead. */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const payloadPart = token.split(".")[1];
    if (!payloadPart) return {};
    const padded = payloadPart + "=".repeat((4 - (payloadPart.length % 4)) % 4);
    const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(base64, "base64").toString("utf-8");
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function requestToken(
  clientId: string,
  clientSecret: string,
  body: URLSearchParams
): Promise<EveTokenResponse> {
  const metadata = await discoverSsoMetadata();
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`EVE SSO token request failed: ${res.status} ${await res.text()}`);
  }

  const tokenData = (await res.json()) as Omit<EveTokenResponse, "claims">;
  return { ...tokenData, claims: decodeJwtPayload(tokenData.access_token) };
}

/** One-time step (see scripts/login.ts) -- exchanges the authorization code
 * from the interactive browser login for the first access/refresh token
 * pair. Not used by the automated collector after that. */
export async function exchangeCodeForToken(
  clientId: string,
  clientSecret: string,
  code: string
): Promise<EveTokenResponse> {
  return requestToken(
    clientId,
    clientSecret,
    new URLSearchParams({ grant_type: "authorization_code", code })
  );
}

/** What the automated collector actually calls on every run -- mints a
 * fresh access token (short-lived, ~20 min) from the long-lived refresh
 * token stored as a secret. EVE SSO refresh tokens don't expire on their
 * own; they're only invalidated by revocation, a password change, or a
 * scope change on the authorized application. */
export async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<EveTokenResponse> {
  return requestToken(
    clientId,
    clientSecret,
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken })
  );
}

/** Character id comes from the JWT's `sub` claim, formatted as
 * "CHARACTER:EVE:<id>" -- same parsing as the prior project. */
export function extractCharacterInfo(token: EveTokenResponse | null): CharacterInfo {
  if (!token) {
    return { characterId: 0, characterName: null, scopes: [], tokenExpiresAt: null };
  }

  const claims = token.claims ?? {};
  const subject = typeof claims.sub === "string" ? claims.sub : "";
  let characterId = 0;
  if (subject.startsWith("CHARACTER:EVE:")) {
    const parsed = Number(subject.split(":").pop());
    if (Number.isFinite(parsed)) characterId = parsed;
  }

  const scopeClaim = claims.scp;
  const scopes = Array.isArray(scopeClaim)
    ? scopeClaim.map(String)
    : typeof scopeClaim === "string"
      ? scopeClaim.split(" ").filter(Boolean)
      : [];

  return {
    characterId,
    characterName: typeof claims.name === "string" ? claims.name : null,
    scopes,
    tokenExpiresAt: typeof claims.exp === "number" ? claims.exp : null,
  };
}
