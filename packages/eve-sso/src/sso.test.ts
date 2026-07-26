import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeJwtPayload,
  extractCharacterInfo,
  buildAuthorizationUrlFromEndpoint,
} from "./sso.js";
import { STRUCTURE_MARKET_SCOPES } from "./types.js";

function fakeJwt(payload: Record<string, unknown>): string {
  const base64url = (input: string) =>
    Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  return `${header}.${body}.fake-signature`;
}

test("decodeJwtPayload decodes a well-formed token", () => {
  const token = fakeJwt({ sub: "CHARACTER:EVE:123456", name: "Test Pilot" });
  const decoded = decodeJwtPayload(token);
  assert.equal(decoded.sub, "CHARACTER:EVE:123456");
  assert.equal(decoded.name, "Test Pilot");
});

test("decodeJwtPayload returns empty object for garbage input", () => {
  assert.deepEqual(decodeJwtPayload("not-a-jwt"), {});
  assert.deepEqual(decodeJwtPayload(""), {});
});

test("extractCharacterInfo parses character id out of the sub claim", () => {
  const token = {
    access_token: fakeJwt({
      sub: "CHARACTER:EVE:2114794365",
      name: "Some Capsuleer",
      scp: STRUCTURE_MARKET_SCOPES,
      exp: 1234567890,
    }),
    refresh_token: "r",
    expires_in: 1200,
    token_type: "Bearer",
    claims: {
      sub: "CHARACTER:EVE:2114794365",
      name: "Some Capsuleer",
      scp: STRUCTURE_MARKET_SCOPES,
      exp: 1234567890,
    },
  };
  const info = extractCharacterInfo(token);
  assert.equal(info.characterId, 2114794365);
  assert.equal(info.characterName, "Some Capsuleer");
  assert.equal(info.scopes.length, 3);
  assert.equal(info.tokenExpiresAt, 1234567890);
});

test("extractCharacterInfo handles a null token", () => {
  const info = extractCharacterInfo(null);
  assert.equal(info.characterId, 0);
  assert.deepEqual(info.scopes, []);
});

test("extractCharacterInfo handles a single space-separated scope string", () => {
  const info = extractCharacterInfo({
    access_token: "x",
    refresh_token: "r",
    expires_in: 1200,
    token_type: "Bearer",
    claims: { sub: "CHARACTER:EVE:1", scp: STRUCTURE_MARKET_SCOPES.join(" ") },
  });
  assert.equal(info.scopes.length, 3);
});

test("buildAuthorizationUrlFromEndpoint produces a well-formed authorize URL", () => {
  const url = buildAuthorizationUrlFromEndpoint(
    "https://login.eveonline.com/v2/oauth/authorize",
    {
      clientId: "abc123",
      redirectUri: "https://localhost/callback",
      scopes: STRUCTURE_MARKET_SCOPES,
      state: "xyz",
    }
  );
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, "https://login.eveonline.com/v2/oauth/authorize");
  assert.equal(parsed.searchParams.get("response_type"), "code");
  assert.equal(parsed.searchParams.get("client_id"), "abc123");
  assert.equal(parsed.searchParams.get("redirect_uri"), "https://localhost/callback");
  assert.equal(parsed.searchParams.get("state"), "xyz");
  assert.equal(
    parsed.searchParams.get("scope"),
    STRUCTURE_MARKET_SCOPES.join(" ")
  );
});
