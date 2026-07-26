export interface SsoMetadata {
  authorization_endpoint: string;
  token_endpoint: string;
  [key: string]: unknown;
}

/** Raw OAuth2 token response from EVE SSO's token endpoint, plus the
 * decoded JWT payload attached under `claims` (mirrors the prior project's
 * convention of doing this once at exchange/refresh time). */
export interface EveTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  claims: Record<string, unknown>;
}

export interface CharacterInfo {
  characterId: number;
  characterName: string | null;
  scopes: string[];
  tokenExpiresAt: number | null;
}

/** Scopes needed for structure market comparison — matches what a prior
 * EVE trading project of the user's uses successfully. Structure search
 * needs esi-search.search_structures.v1 in addition to the market scope;
 * esi-universe.read_structures.v1 resolves a structure_id to its name and
 * solar system for display. */
export const STRUCTURE_MARKET_SCOPES = [
  "esi-markets.structure_markets.v1",
  "esi-search.search_structures.v1",
  "esi-universe.read_structures.v1",
] as const;
