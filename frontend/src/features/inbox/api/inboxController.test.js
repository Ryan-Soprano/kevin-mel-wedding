import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { setImmediate } from "node:timers";
import test from "node:test";
import { createInboxController } from "./inboxController.js";
import { createArchiveApi } from "../../../shared/api/archiveApi.js";
import { ApiError, createApiClient } from "../../../shared/api/apiClient.js";
import { ANONYMOUS_SESSION, COUPLE_SESSION, IDS, MEDIA_DETAIL, MEMORY_DETAIL, PLAYBACK } from "../../../shared/api/v1/fixtures.js";

const copy = value => structuredClone(value);
const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const hash = createHash("sha256").update(bytes).digest("hex");
const photo = { ...MEDIA_DETAIL, media: { ...MEDIA_DETAIL.media, originalFilename: "fixture.png",
  detectedContentType: "image/png", byteSize: bytes.length, checksumSha256: hash } };
const response = () => new Response(bytes, { headers: { "Content-Type": "image/png", "Content-Length": String(bytes.length) } });
const authError = status => new ApiError("secret raw error", { status, code: status === 403 ? "ARCHIVE_UNAVAILABLE" : "UNAUTHORIZED" });
const turn = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function timers() {
  const pending = new Map();
  let id = 0;
  return { pending,
    setTimeoutImpl(callback, milliseconds) { const key = ++id; pending.set(key, { callback, milliseconds }); return key; },
    clearTimeoutImpl(key) { pending.delete(key); },
    expire() {
      assert.equal(pending.size, 1);
      const [key, timer] = [...pending][0];
      pending.delete(key);
      timer.callback();
      return timer.milliseconds;
    },
  };
}

function fixture(overrides = {}) {
  const calls = [], created = [], revoked = [];
  const api = {
    getSession: async options => { calls.push(["session", options]); return copy(COUPLE_SESSION); },
    login: async (credentials, options) => { calls.push(["login", { ...credentials }, options]); return copy(COUPLE_SESSION); },
    logout: async options => { calls.push(["logout", options]); },
    listMemories: async options => { calls.push(["list", options]); return { items: [copy(MEMORY_DETAIL), copy(photo)], nextCursor: "next-page" }; },
    getMemory: async (id, options) => { calls.push(["detail", id, options]); return copy(id === IDS.photo ? photo : MEMORY_DETAIL); },
    getPlayback: async (id, options) => { calls.push(["playback", id, options]); return copy(PLAYBACK); },
    ...overrides.api,
  };
  const { api: ignored, ...options } = overrides;
  void ignored;
  const controller = createInboxController({ api,
    fetchImpl: async (url, request) => { calls.push(["media", url, request]); return response(); },
    createObjectURL: blob => { const url = "blob:original-" + (created.length + 1); created.push({ url, blob }); return url; },
    revokeObjectURL: url => revoked.push(url), ...options });
  return { controller, calls, created, revoked, api };
}

async function entered(f) {
  await f.controller.loadSession();
  assert.equal(f.controller.getSnapshot().phase, "inbox");
  return f;
}

test("session initialization distinguishes anonymous access and freezes authenticated inbox snapshots", async () => {
  const anonymous = fixture({ api: { getSession: async () => copy(ANONYMOUS_SESSION) } });
  await anonymous.controller.loadSession();
  assert.equal(anonymous.controller.getSnapshot().phase, "login");
  assert.equal(anonymous.calls.length, 0);
  const f = await entered(fixture());
  const state = f.controller.getSnapshot();
  assert.equal(state.busy, false);
  assert.equal(state.items.length, 2);
  assert.equal(state.nextCursor, "next-page");
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(state.items[1].media), true);
  assert.equal(Object.isFrozen(state.session.user.roles), true);
  assert.throws(() => { state.items[1].media.byteSize = 1; }, TypeError);
  assert.equal(f.controller.getSnapshot(), state);
  assert.deepEqual(f.calls.map(call => call[0]), ["session", "list"]);
});

test("each login gets fresh CSRF and uses the rotated authenticated session without retaining credentials", async () => {
  const observed = [], attempts = [];
  let count = 0;
  const f = fixture({ api: {
    getSession: async () => ({ ...ANONYMOUS_SESSION, csrfToken: "fresh-session-token-" + (++count) }),
    login: async (credentials, options) => { attempts.push([credentials, options]); return { ...COUPLE_SESSION, csrfToken: "rotated-session-token" }; },
  } });
  f.controller.subscribe(state => observed.push(state));
  await f.controller.login({ username: "fixture-user", password: "private-test-password" });
  await f.controller.login({ username: "fixture-user", password: "private-test-password" });
  assert.deepEqual(attempts.map(attempt => attempt[1].csrfToken), ["fresh-session-token-1", "fresh-session-token-2"]);
  assert.equal(f.controller.getSnapshot().session.csrfToken, "rotated-session-token");
  for (const state of observed) {
    assert.equal(JSON.stringify(state).includes("private-test-password"), false);
    assert.equal(JSON.stringify(state).includes("fixture-user"), false);
  }
});

test("invalid credentials show a safe sign-in error without returning server messages", async () => {
  const f = fixture({ api: { login: async () => { throw new ApiError("raw credential content", { status: 401, code: "INVALID_CREDENTIALS" }); } } });
  await f.controller.login({ username: "example", password: "private" });
  assert.equal(f.controller.getSnapshot().phase, "login");
  assert.match(f.controller.getSnapshot().error, /not accepted/);
  assert.equal(f.controller.getSnapshot().session, null);
  assert.equal(JSON.stringify(f.controller.getSnapshot()).includes("raw credential"), false);
});

test("inbox pages replace rather than append and returning from detail preserves the current page", async () => {
  const f = await entered(fixture({ api: { listMemories: async options => ({
    items: [copy(options.cursor ? photo : MEMORY_DETAIL)], nextCursor: options.cursor ? null : "page-two",
  }) } }));
  await f.controller.loadInbox("PENDING", "page-two");
  const items = f.controller.getSnapshot().items;
  await f.controller.openMemory(IDS.text);
  f.controller.backToInbox();
  assert.equal(f.controller.getSnapshot().items, items);
  assert.equal(f.controller.getSnapshot().items.length, 1);
  assert.equal(f.controller.getSnapshot().items[0].memoryId, IDS.photo);
  assert.equal(f.controller.getSnapshot().nextCursor, null);
  assert.equal(f.controller.getSnapshot().detail, null);
});

test("a changed filter clears the previous filter's private rows while loading", async () => {
  const held = deferred();
  const f = await entered(fixture());
  f.api.listMemories = () => held.promise;
  const loading = f.controller.loadInbox("ARCHIVED");
  assert.equal(f.controller.getSnapshot().reviewStatus, "ARCHIVED");
  assert.equal(f.controller.getSnapshot().items.length, 0);
  held.resolve({ items: [], nextCursor: null });
  await loading;
});

for (const status of [401, 403]) {
  test(`${status} on private API access clears rows, detail, session and verified Blob URLs`, async () => {
    const f = await entered(fixture());
    await f.controller.openMemory(IDS.photo);
    assert.equal(f.created.length, 1);
    f.api.listMemories = async () => { throw authError(status); };
    await f.controller.loadInbox();
    const state = f.controller.getSnapshot();
    assert.equal(state.phase, status === 401 ? "login" : "unavailable");
    assert.equal(state.items.length, 0);
    assert.equal(state.session, null);
    assert.equal(state.detail, null);
    assert.equal(state.photo.url, null);
    assert.deepEqual(f.revoked, ["blob:original-1"]);
  });
}

test("logout clears private content immediately and obtains fresh CSRF before invalidation", async () => {
  const held = deferred();
  const f = await entered(fixture());
  await f.controller.openMemory(IDS.photo);
  f.api.getSession = async () => ({ ...COUPLE_SESSION, csrfToken: "fresh-token-before-logout" });
  f.api.logout = options => { f.calls.push(["logout", options]); return held.promise; };
  const leaving = f.controller.logout();
  assert.equal(f.controller.getSnapshot().detail, null);
  assert.equal(f.controller.getSnapshot().session, null);
  assert.equal(f.controller.getSnapshot().items.length, 0);
  assert.deepEqual(f.revoked, ["blob:original-1"]);
  await turn();
  assert.equal(f.calls.at(-1)[1].csrfToken, "fresh-token-before-logout");
  assert.equal(f.controller.getSnapshot().busy, true);
  held.resolve();
  await leaving;
  assert.equal(f.controller.getSnapshot().phase, "login");
  assert.equal(f.controller.getSnapshot().logoutUnconfirmed, false);
});

test("lost logout response stays unconfirmed until an anonymous session or successful retry proves invalidation", async () => {
  const f = await entered(fixture());
  let deletes = 0;
  f.api.logout = async () => { deletes++; throw new ApiError("lost", { code: "NETWORK_ERROR", unknownOutcome: true }); };
  await f.controller.logout();
  assert.equal(f.controller.getSnapshot().phase, "unavailable");
  assert.equal(f.controller.getSnapshot().logoutUnconfirmed, true);
  assert.match(f.controller.getSnapshot().error, /Sign-out could not be confirmed/);
  assert.equal(f.controller.getSnapshot().session, null);
  f.api.getSession = async () => copy(ANONYMOUS_SESSION);
  await f.controller.loadSession();
  assert.equal(deletes, 1);
  assert.equal(f.controller.getSnapshot().phase, "login");
  assert.equal(f.controller.getSnapshot().error, null);
  assert.equal(f.controller.getSnapshot().logoutUnconfirmed, false);
});

test("logout retry uses a fresh token when the old session is still active", async () => {
  const f = await entered(fixture());
  const tokens = [];
  let count = 0;
  f.api.getSession = async () => ({ ...COUPLE_SESSION, csrfToken: "logout-retry-token-" + (++count) });
  f.api.logout = async options => { tokens.push(options.csrfToken); if (tokens.length === 1) throw new Error("lost"); };
  await f.controller.logout();
  await f.controller.logout();
  assert.deepEqual(tokens, ["logout-retry-token-1", "logout-retry-token-2"]);
  assert.equal(f.controller.getSnapshot().logoutUnconfirmed, false);
});

test("a late inbox response cannot restore private content after logout, even when abort is ignored", async () => {
  const held = deferred();
  let signal;
  const f = await entered(fixture());
  f.api.listMemories = options => { signal = options.signal; return held.promise; };
  const old = f.controller.loadInbox();
  await turn();
  await f.controller.logout();
  assert.equal(signal.aborted, true);
  held.resolve({ items: [MEMORY_DETAIL], nextCursor: "stale" });
  await old;
  assert.equal(f.controller.getSnapshot().phase, "login");
  assert.equal(f.controller.getSnapshot().items.length, 0);
});

test("new detail selection owns state and ignores a late older detail", async () => {
  const held = deferred();
  const f = await entered(fixture());
  const original = f.api.getMemory;
  f.api.getMemory = (id, options) => id === IDS.text ? held.promise : original(id, options);
  const old = f.controller.openMemory(IDS.text);
  await turn();
  await f.controller.openMemory(IDS.photo);
  held.resolve(MEMORY_DETAIL);
  await old;
  assert.equal(f.controller.getSnapshot().detail.memoryId, IDS.photo);
  assert.equal(f.controller.getSnapshot().photo.phase, "ready");
});

test("API deadline covers an adapter's stalled JSON body and rejects late decoded content", async () => {
  const held = deferred(), clock = timers();
  let signal;
  const api = createArchiveApi({ client: createApiClient({ fetchImpl: async (_url, options) => {
    signal = options.signal;
    return { status: 200, ok: true, headers: new Headers({ "Content-Type": "application/json" }), json: () => held.promise };
  } }) });
  const f = fixture({ api, ...clock });
  const checking = f.controller.loadSession();
  await turn();
  assert.equal(clock.expire(), 30_000);
  await checking;
  assert.equal(signal.aborted, true);
  assert.equal(f.controller.getSnapshot().phase, "unavailable");
  held.resolve(COUPLE_SESSION);
  await turn();
  assert.equal(f.controller.getSnapshot().session, null);
  assert.equal(clock.pending.size, 0);
});

test("original photo is fetched without credentials or redirects and shown only after integrity verification", async () => {
  const f = await entered(fixture());
  await f.controller.openMemory(IDS.photo);
  const state = f.controller.getSnapshot();
  const [, url, options] = f.calls.find(call => call[0] === "media");
  assert.equal(url, PLAYBACK.url);
  assert.equal(options.credentials, "omit");
  assert.equal(options.redirect, "error");
  assert.equal(options.referrerPolicy, "no-referrer");
  assert.equal(options.cache, "no-store");
  assert.equal(options.headers, undefined);
  assert.equal(state.photo.phase, "ready");
  assert.equal(state.photo.url, "blob:original-1");
  assert.equal(f.created[0].blob.size, photo.media.byteSize);
  assert.equal(f.created[0].blob.type, "image/png");
  assert.deepEqual(Buffer.from(await f.created[0].blob.arrayBuffer()), bytes);
  assert.equal(JSON.stringify(state).includes(PLAYBACK.url), false);
});

for (const [name, makeResponse] of [
  ["wrong checksum", () => new Response(Buffer.alloc(bytes.length), { headers: { "Content-Type": "image/png" } })],
  ["wrong content type", () => new Response(bytes, { headers: { "Content-Type": "text/html" } })],
  ["wrong declared length", () => new Response(bytes, { headers: { "Content-Type": "image/png", "Content-Length": String(bytes.length + 1) } })],
  ["truncated bytes", () => new Response(bytes.subarray(0, 10), { headers: { "Content-Type": "image/png" } })],
  ["oversized streamed bytes", () => new Response(Buffer.concat([bytes, bytes]), { headers: { "Content-Type": "image/png" } })],
]) {
  test(`${name} never produces a photo object URL`, async () => {
    const f = await entered(fixture({ fetchImpl: async () => makeResponse() }));
    await f.controller.openMemory(IDS.photo);
    assert.equal(f.controller.getSnapshot().photo.phase, "error");
    assert.match(f.controller.getSnapshot().photo.error, /did not match/);
    assert.equal(f.created.length, 0);
    assert.equal(f.controller.getSnapshot().detail.memoryId, IDS.photo);
  });
}

test("photo metadata above the bounded byte limit prevents playback authorization and download", async () => {
  const f = await entered(fixture({ api: { getMemory: async () => ({ ...photo, media: { ...photo.media, byteSize: 10_000_001 } }) } }));
  await f.controller.openMemory(IDS.photo);
  assert.equal(f.calls.some(call => ["playback", "media"].includes(call[0])), false);
  assert.equal(f.controller.getSnapshot().photo.phase, "error");
});

test("expired playback is not fetched and deliberate retry obtains a fresh signed link", async () => {
  let grants = 0, fetched = 0;
  const f = await entered(fixture({ now: () => Date.parse("2026-10-09T15:00:00Z"),
    api: { getPlayback: async () => ({ ...PLAYBACK, expiresAt: ++grants === 1 ? "2026-10-09T15:00:00Z" : PLAYBACK.expiresAt }) },
    fetchImpl: async () => { fetched++; return response(); },
  }));
  await f.controller.openMemory(IDS.photo);
  assert.equal(fetched, 0);
  assert.match(f.controller.getSnapshot().photo.error, /expired/);
  await f.controller.retryPhoto();
  assert.equal(grants, 2);
  assert.equal(fetched, 1);
  assert.equal(f.controller.getSnapshot().photo.phase, "ready");
});

test("storage signature rejection is a photo retry state, not an application session-expiry event", async () => {
  const f = await entered(fixture({ fetchImpl: async () => new Response(null, { status: 403 }) }));
  await f.controller.openMemory(IDS.photo);
  assert.equal(f.controller.getSnapshot().phase, "detail");
  assert.equal(f.controller.getSnapshot().session.authenticated, true);
  assert.match(f.controller.getSnapshot().photo.error, /expired/);
});

test("application authorization rejection during playback clears all private state", async () => {
  const f = await entered(fixture({ api: { getPlayback: async () => { throw authError(401); } } }));
  await f.controller.openMemory(IDS.photo);
  assert.equal(f.controller.getSnapshot().phase, "login");
  assert.equal(f.controller.getSnapshot().detail, null);
  assert.equal(f.controller.getSnapshot().items.length, 0);
});

test("photo deadline covers a stalled stream and cancels its reader", async () => {
  const clock = timers();
  let cancelled = false, signal;
  const f = await entered(fixture({ ...clock, fetchImpl: async (_url, options) => {
    signal = options.signal;
    return new Response(new ReadableStream({ pull() {}, cancel() { cancelled = true; } }), { headers: { "Content-Type": "image/png" } });
  } }));
  const loading = f.controller.openMemory(IDS.photo);
  await turn();
  assert.equal(clock.expire(), 60_000);
  await loading;
  assert.equal(signal.aborted, true);
  assert.equal(cancelled, true);
  assert.equal(f.controller.getSnapshot().photo.phase, "error");
  assert.match(f.controller.getSnapshot().photo.error, /too long/);
  assert.equal(f.created.length, 0);
  assert.equal(clock.pending.size, 0);
});

test("logout during checksum verification prevents late object-URL creation", async () => {
  const held = deferred();
  const f = await entered(fixture({ digest: () => held.promise }));
  const loading = f.controller.openMemory(IDS.photo);
  await turn();
  await f.controller.logout();
  held.resolve(hash);
  await loading;
  assert.equal(f.created.length, 0);
  assert.equal(f.controller.getSnapshot().detail, null);
  assert.equal(f.controller.getSnapshot().phase, "login");
});

test("back, selection, photo retry and disposal revoke owned Blob URLs once", async () => {
  const f = await entered(fixture());
  await f.controller.openMemory(IDS.photo);
  await f.controller.retryPhoto();
  assert.deepEqual(f.revoked, ["blob:original-1"]);
  f.controller.backToInbox();
  assert.deepEqual(f.revoked, ["blob:original-1", "blob:original-2"]);
  await f.controller.openMemory(IDS.photo);
  await f.controller.openMemory(IDS.text);
  assert.deepEqual(f.revoked, ["blob:original-1", "blob:original-2", "blob:original-3"]);
  await f.controller.openMemory(IDS.photo);
  f.controller.dispose();
  f.controller.dispose();
  assert.equal(f.revoked.length, 4);
  assert.equal(f.controller.getSnapshot().session, null);
  assert.equal(f.controller.getSnapshot().items.length, 0);
  assert.equal(f.controller.getSnapshot().photo.url, null);
});

test("disposal aborts in-flight private work and ignores late success", async () => {
  const held = deferred();
  let signal;
  const f = await entered(fixture());
  f.api.getMemory = (_id, options) => { signal = options.signal; return held.promise; };
  const opening = f.controller.openMemory(IDS.text);
  await turn();
  f.controller.dispose();
  held.resolve(MEMORY_DETAIL);
  await opening;
  assert.equal(signal.aborted, true);
  assert.equal(f.controller.getSnapshot().detail, null);
});

test("subscriptions tolerate failures, removals and reentrant navigation without delivering stale photo snapshots", async () => {
  const f = await entered(fixture());
  const delivered = [];
  f.controller.subscribe(() => { throw new Error("presentation fault"); });
  const unsubscribe = f.controller.subscribe(state => {
    if (state.photo.phase === "ready") f.controller.backToInbox();
  });
  f.controller.subscribe(state => delivered.push(state));
  await f.controller.openMemory(IDS.photo);
  assert.equal(f.controller.getSnapshot().phase, "inbox");
  assert.equal(delivered.some(state => state.photo.phase === "ready"), false);
  assert.deepEqual(f.revoked, ["blob:original-1"]);
  unsubscribe();
  await f.controller.openMemory(IDS.photo);
  assert.equal(f.controller.getSnapshot().photo.phase, "ready");
});

test("raw transport messages and signed links never enter presentation errors", async () => {
  const f = await entered(fixture({ fetchImpl: async () => { throw new Error(PLAYBACK.url); } }));
  await f.controller.openMemory(IDS.photo);
  assert.equal(JSON.stringify(f.controller.getSnapshot()).includes(PLAYBACK.url), false);
  assert.equal(f.controller.getSnapshot().photo.phase, "error");
});

test("real adapter sends the session contract and rotates CSRF before decoded inbox/detail and verified photo playback", async () => {
  const requests = [], mediaRequests = [];
  const freshToken = "fresh-anonymous-token-for-integration";
  const rotatedToken = "rotated-couple-token-for-integration";
  let authenticated = false;
  const api = createArchiveApi({ client: createApiClient({ fetchImpl: async (path, options) => {
    requests.push({ path, options });
    let payload;
    if (path === "/api/session" && options.method === "GET") {
      payload = { ...ANONYMOUS_SESSION, csrfToken: freshToken };
    } else if (path === "/api/session" && options.method === "POST") {
      assert.equal(options.headers.get("X-CSRF-Token"), freshToken);
      assert.deepEqual(JSON.parse(options.body), { username: "integration-couple", password: "synthetic-private-password" });
      authenticated = true;
      payload = { ...COUPLE_SESSION, csrfToken: rotatedToken };
    } else if (path === "/api/memories?reviewStatus=PENDING&limit=20") {
      assert.equal(authenticated, true);
      payload = { items: [MEMORY_DETAIL, photo], nextCursor: "opaque-page-two" };
    } else if (path === "/api/memories/" + IDS.photo) {
      payload = photo;
    } else if (path === "/api/memories/" + IDS.photo + "/playback") {
      assert.equal(authenticated, true);
      payload = PLAYBACK;
    } else throw new Error("Unexpected fixture request.");
    return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
  } }) });
  const f = fixture({ api, fetchImpl: async (url, options) => {
    mediaRequests.push({ url, options });
    return response();
  } });
  await f.controller.login({ username: "integration-couple", password: "synthetic-private-password" });
  assert.equal(f.controller.getSnapshot().session.csrfToken, rotatedToken);
  assert.equal(f.controller.getSnapshot().items[1].media.checksumSha256, hash);
  assert.equal(f.controller.getSnapshot().nextCursor, "opaque-page-two");
  await f.controller.openMemory(IDS.photo);
  assert.deepEqual(requests.map(request => [request.path, request.options.method]), [
    ["/api/session", "GET"], ["/api/session", "POST"],
    ["/api/memories?reviewStatus=PENDING&limit=20", "GET"],
    ["/api/memories/" + IDS.photo, "GET"], ["/api/memories/" + IDS.photo + "/playback", "GET"],
  ]);
  for (const { options } of requests) {
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.cache, "no-store");
    assert.equal(options.headers.get("X-Api-Contract"), "1");
    assert.equal(options.headers.get("Accept"), "application/json");
    assert.equal(options.headers.get("Authorization"), null);
    assert.equal(options.signal instanceof AbortSignal, true);
    if (options.method === "GET") {
      assert.equal(options.body, undefined);
      assert.equal(options.headers.get("X-CSRF-Token"), null);
    }
  }
  assert.equal(requests[1].options.headers.get("Content-Type"), "application/json");
  assert.equal(mediaRequests.length, 1);
  assert.equal(mediaRequests[0].url, PLAYBACK.url);
  assert.equal(mediaRequests[0].options.credentials, "omit");
  assert.equal(mediaRequests[0].options.headers, undefined);
  assert.equal(mediaRequests[0].options.redirect, "error");
  assert.equal(mediaRequests[0].options.referrerPolicy, "no-referrer");
  assert.equal(f.controller.getSnapshot().photo.phase, "ready");
  assert.deepEqual(Buffer.from(await f.created[0].blob.arrayBuffer()), bytes);
  assert.equal(JSON.stringify(f.controller.getSnapshot()).includes(PLAYBACK.url), false);
  f.controller.dispose();
});

test("real private API 401/403 responses clear decoded inbox/details and revoke verified original URLs", async () => {
  for (const status of [401, 403]) {
    let accessFailure = false;
    const api = createArchiveApi({ client: createApiClient({ fetchImpl: async (path, options) => {
      assert.equal(options.headers.get("X-Api-Contract"), "1");
      assert.equal(options.credentials, "same-origin");
      if (accessFailure && path.startsWith("/api/memories")) {
        return new Response(JSON.stringify({ error: { code: status === 401 ? "UNAUTHORIZED" : "ARCHIVE_UNAVAILABLE",
          message: "Raw private content must not appear in the UI", requestId: IDS.request } }), {
          status, headers: { "Content-Type": "application/json", "X-Request-ID": IDS.request },
        });
      }
      const payload = path === "/api/session" ? COUPLE_SESSION
        : path.includes("?") ? { items: [MEMORY_DETAIL, photo], nextCursor: null }
          : path.endsWith("/playback") ? PLAYBACK : photo;
      return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
    } }) });
    const f = await entered(fixture({ api }));
    await f.controller.openMemory(IDS.photo);
    assert.equal(f.controller.getSnapshot().photo.phase, "ready");
    accessFailure = true;
    await f.controller.retryPhoto();
    const state = f.controller.getSnapshot();
    assert.equal(state.phase, status === 401 ? "login" : "unavailable");
    assert.equal(state.session, null);
    assert.equal(state.items.length, 0);
    assert.equal(state.detail, null);
    assert.equal(state.photo.url, null);
    assert.deepEqual(f.revoked, ["blob:original-1"]);
    assert.equal(JSON.stringify(state).includes("Raw private content"), false);
    f.controller.dispose();
  }
});

test("real playback missing-object errors preserve decoded metadata and deliberate retry verifies the original", async () => {
  let storageAvailable = false, playbackRequests = 0;
  const api = createArchiveApi({ client: createApiClient({ fetchImpl: async path => {
    if (path.endsWith("/playback")) {
      playbackRequests++;
      if (!storageAvailable) return new Response(JSON.stringify({ error: { code: "MEDIA_UNAVAILABLE",
        message: "Private object missing at a sensitive storage key", requestId: IDS.request } }), {
        status: 503, headers: { "Content-Type": "application/json" },
      });
    }
    const payload = path === "/api/session" ? COUPLE_SESSION
      : path.includes("?") ? { items: [photo], nextCursor: null }
        : path.endsWith("/playback") ? PLAYBACK : photo;
    return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
  } }) });
  const f = await entered(fixture({ api }));
  await f.controller.openMemory(IDS.photo);
  const detail = f.controller.getSnapshot().detail;
  assert.equal(detail.media.originalFilename, "fixture.png");
  assert.equal(detail.media.byteSize, bytes.length);
  assert.equal(detail.media.uploadState, "UPLOADED");
  assert.equal(f.controller.getSnapshot().phase, "detail");
  assert.equal(f.controller.getSnapshot().session.authenticated, true);
  assert.equal(f.controller.getSnapshot().photo.phase, "error");
  assert.equal(f.created.length, 0);
  assert.equal(JSON.stringify(f.controller.getSnapshot()).includes("sensitive storage key"), false);
  storageAvailable = true;
  await f.controller.retryPhoto();
  assert.equal(playbackRequests, 2);
  assert.equal(f.controller.getSnapshot().detail, detail);
  assert.equal(f.controller.getSnapshot().photo.phase, "ready");
  assert.equal(f.created[0].blob.size, bytes.length);
  f.controller.dispose();
});
