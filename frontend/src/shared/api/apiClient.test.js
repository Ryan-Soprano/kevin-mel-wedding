import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApiClient } from "./apiClient.js";
import { IDS, VALIDATION_ERROR } from "./v1/fixtures.js";

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", ...headers },
});

async function startLocalServer(context, handler) {
  const server = createServer(handler);
  context.after(async () => {
    server.closeAllConnections();
    if (!server.listening) return;
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  return `http://127.0.0.1:${server.address().port}`;
}

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
  assert.equal(observed.redirect, "error");
  assert.equal(observed.cache, "no-store");
  assert.equal(observed.headers.get("X-Api-Contract"), "1");
  assert.equal(observed.headers.get("Content-Type"), "application/json");
  assert.equal(observed.headers.get("Idempotency-Key"), IDS.key);
  assert.deepEqual(JSON.parse(observed.body), { message: "Example" });
  await assert.rejects(client.request("https://other.example/api/session"), TypeError);
  await assert.rejects(client.request("/api/session#fragment"), TypeError);
});

for (const destination of ["same origin", "another origin"]) {
  for (const method of ["GET", "POST"]) {
    test(`JSON ${method} rejects a redirect to ${destination} before forwarding private headers or content`, {
      timeout: 5_000,
    }, async context => {
      const forwarded = [];
      const collect = (request, response) => {
        let body = "";
        request.setEncoding("utf8");
        request.on("data", chunk => { body += chunk; });
        request.on("error", () => response.destroy());
        request.on("end", () => {
          forwarded.push({
            method: request.method,
            csrfToken: request.headers["x-csrf-token"],
            idempotencyKey: request.headers["idempotency-key"],
            body,
          });
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: true }));
        });
      };
      const otherOrigin = await startLocalServer(context, collect);
      let location;
      let initialRequests = 0;
      const origin = await startLocalServer(context, (request, response) => {
        if (request.url !== "/api/session") {
          collect(request, response);
          return;
        }
        initialRequests += 1;
        request.resume();
        response.writeHead(307, { Location: location });
        response.end();
      });
      location = destination === "same origin"
        ? `${origin}/outside-api`
        : `${otherOrigin}/outside-api`;
      const client = createApiClient({
        fetchImpl: (path, options) => fetch(origin + path, options),
      });
      let failure;
      try {
        await client.request("/api/session", {
          method,
          headers: {
            "X-CSRF-TOKEN": "synthetic-csrf-token",
            "Idempotency-Key": IDS.key,
          },
          body: method === "POST"
            ? { username: "synthetic-user", password: "synthetic-password" }
            : undefined,
          signal: AbortSignal.timeout(2_000),
        });
      } catch (error) {
        failure = error;
      }
      assert.equal(initialRequests, 1);
      assert.deepEqual(forwarded, []);
      assert.equal(failure?.code, "NETWORK_ERROR");
      assert.equal(failure.unknownOutcome, method === "POST");
    });
  }
}

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
