import test from "node:test";
import assert from "node:assert/strict";
import { createApiClient } from "./apiClient.js";
import { IDS, VALIDATION_ERROR } from "./v1/fixtures.js";

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", ...headers },
});

test("JSON transport sends same-origin cookies and the v1 contract header", async () => {
  let observed;
  const client = createApiClient({ fetchImpl: async (path, options) => {
    observed = { path, ...options };
    return json({ ok: true }, 201);
  } });
  assert.deepEqual(await client.request("/api/contributions", {
    method: "POST", body: { message: "Example" }, statuses: [201],
    headers: { "Idempotency-Key": IDS.key },
  }), { ok: true });
  assert.equal(observed.credentials, "same-origin");
  assert.equal(observed.cache, "no-store");
  assert.equal(observed.headers.get("X-Api-Contract"), "1");
  assert.equal(observed.headers.get("Content-Type"), "application/json");
  assert.equal(observed.headers.get("Idempotency-Key"), IDS.key);
  assert.deepEqual(JSON.parse(observed.body), { message: "Example" });
  await assert.rejects(client.request("https://other.example/api/session"), TypeError);
  await assert.rejects(client.request("/api/session#fragment"), TypeError);
});

test("structured errors retain safe request IDs and field-level validation", async () => {
  const client = createApiClient({ fetchImpl: async () => json(VALIDATION_ERROR, 400) });
  await assert.rejects(client.request("/api/contributions"), (error) => {
    assert.equal(error.status, 400);
    assert.equal(error.code, "VALIDATION_FAILED");
    assert.equal(error.requestId, IDS.request);
    assert.equal(error.fieldErrors[0].field, "message");
    return true;
  });
});

test("HTML error pages and unsafe request IDs cannot leak diagnostic content", async () => {
  const client = createApiClient({ fetchImpl: async () => new Response("<html>private debug</html>", {
    status: 500, headers: { "X-Request-ID": "private debug", "Content-Type": "text/html" },
  }) });
  await assert.rejects(client.request("/api/contributions", { method: "POST" }), (error) => {
    assert.equal(error.code, "HTTP_ERROR");
    assert.equal(error.requestId, null);
    assert.equal(error.unknownOutcome, true);
    assert.ok(!error.message.includes("private debug"));
    return true;
  });
});

for (const response of [
  () => new Response("not JSON", { headers: { "Content-Type": "application/json" } }),
  () => new Response("<html>ok</html>"),
  () => json({}, 202),
]) {
  test("unexpected successful content/status is not silently accepted", async () => {
    const client = createApiClient({ fetchImpl: async () => response() });
    await assert.rejects(client.request("/api/contributions", { method: "POST" }), {
      code: "CONTRACT_MISMATCH", unknownOutcome: true,
    });
  });
}

test("Retry-After supports seconds and an HTTP date", async () => {
  for (const value of ["30", new Date(Date.now() + 30000).toUTCString()]) {
    const client = createApiClient({ fetchImpl: async () => json(VALIDATION_ERROR, 429, { "Retry-After": value }) });
    await assert.rejects(client.request("/api/session"), (error) => {
      assert.ok(error.retryAfterSeconds >= 29 && error.retryAfterSeconds <= 30);
      assert.equal(error.unknownOutcome, false);
      return true;
    });
  }
});

test("network failures never trigger automatic retries; only mutations are uncertain", async () => {
  let calls = 0;
  const client = createApiClient({ fetchImpl: async () => { calls += 1; throw new TypeError("Offline"); } });
  await assert.rejects(client.request("/api/contributions", { method: "POST" }), {
    code: "NETWORK_ERROR", unknownOutcome: true,
  });
  await assert.rejects(client.request("/api/session"), {
    code: "NETWORK_ERROR", unknownOutcome: false,
  });
  assert.equal(calls, 2);
});

test("cancellation of a submission does not imply a server rollback", async () => {
  const client = createApiClient({ fetchImpl: async () => { throw new DOMException("Cancelled", "AbortError"); } });
  await assert.rejects(client.request("/api/contributions", { method: "POST" }), {
    code: "REQUEST_ABORTED", unknownOutcome: true,
  });
});

test("204 responses need no JSON body", async () => {
  const client = createApiClient({ fetchImpl: async () => new Response(null, { status: 204 }) });
  assert.equal(await client.request("/api/session", { method: "DELETE", statuses: [204] }), undefined);
});
