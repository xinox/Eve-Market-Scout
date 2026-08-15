import assert from "node:assert/strict";
import { test } from "node:test";
import worker, { type Env } from "./index.js";

const emptyEnv = {} as Env;

test("health endpoint is public", async () => {
  const response = await worker.fetch(new Request("https://example.test/health"), emptyEnv);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json() as { ok: boolean }).ok, true);
});

test("ingest refuses requests until a secret is configured", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/ingest", { method: "POST", body: "{}" }),
    emptyEnv
  );
  assert.equal(response.status, 503);
});

test("ingest rejects malformed JSON without touching D1", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/ingest", {
      method: "POST",
      headers: { "X-Ingest-Secret": "test-secret" },
      body: "{",
    }),
    { INGEST_SECRET: "test-secret" } as Env
  );
  assert.equal(response.status, 400);
});

test("query API validates numeric filters before touching D1", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/api/markets/latest?regionId=nope"),
    emptyEnv
  );
  assert.equal(response.status, 400);
});

test("unknown POST routes return 404 without requiring ingest auth", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/not-an-ingest-route", { method: "POST" }),
    emptyEnv
  );
  assert.equal(response.status, 404);
});

test("alert rule writes require the admin secret", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/api/alerts/rules", { method: "POST", body: "{}" }),
    { INGEST_SECRET: "test-secret" } as Env
  );
  assert.equal(response.status, 401);
});

test("alert rule input is validated before D1 is touched", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/api/alerts/rules", {
      method: "POST",
      headers: { "X-Ingest-Secret": "test-secret" },
      body: JSON.stringify({ thresholdIsk: -1 }),
    }),
    { INGEST_SECRET: "test-secret" } as Env
  );
  assert.equal(response.status, 400);
});

test("watchlist writes require the admin secret", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/api/watchlist", { method: "POST", body: "{}" }),
    { INGEST_SECRET: "test-secret" } as Env
  );
  assert.equal(response.status, 401);
});

test("watchlist input is validated before D1 is touched", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/api/watchlist", {
      method: "POST",
      headers: { "X-Ingest-Secret": "test-secret" },
      body: JSON.stringify({ typeId: 0, name: "" }),
    }),
    { INGEST_SECRET: "test-secret" } as Env
  );
  assert.equal(response.status, 400);
});
