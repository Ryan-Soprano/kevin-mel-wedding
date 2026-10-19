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
    reviewMemory: async (id, change, options) => {
      calls.push(["review", id, change, options]);
      return { ...copy(id === IDS.photo ? photo : MEMORY_DETAIL), reviewStatus: change.reviewStatus,
        revision: change.revision + 1, deleteAfter: change.reviewStatus === "DELETE" ? "2027-11-09T15:00:00Z" : null };
    },
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
  const f = await entered(fixture({ api: { listAlbums: async () => ({ items: [], nextCursor: null }), listMemories: async options => ({
    items: [copy(options.cursor ? photo : MEMORY_DETAIL)], nextCursor: options.cursor ? null : "page-two",
  }) } }));
  await f.controller.loadInbox("PENDING", "page-two");
  const items = f.controller.getSnapshot().items;
  const version = f.controller.getSnapshot().pageResetVersion;
  await f.controller.openMemory(IDS.text);
  f.controller.backToInbox();
  assert.equal(f.controller.getSnapshot().items, items);
  assert.equal(f.controller.getSnapshot().items.length, 1);
  assert.equal(f.controller.getSnapshot().items[0].memoryId, IDS.photo);
  assert.equal(f.controller.getSnapshot().nextCursor, null);
  assert.equal(f.controller.getSnapshot().detail, null);
  assert.equal(f.controller.getSnapshot().pageResetVersion, version, "a cached detail return preserves its loaded cursor stack");

  await f.controller.loadAlbums();
  await f.controller.loadInbox("PENDING");
  assert.equal(f.controller.getSnapshot().items[0].memoryId, IDS.text);
  assert.equal(f.controller.getSnapshot().pageResetVersion, version + 1, "an explicit first-page return resets shell cursors");

  await f.controller.loadInbox("PENDING", "page-two");
  f.controller.beginCreation();
  await f.controller.backToInbox();
  assert.equal(f.controller.getSnapshot().items[0].memoryId, IDS.text);
  assert.equal(f.controller.getSnapshot().pageResetVersion, version + 2, "discarding creation reloads the first page and resets shell cursors");
});

test("detail404 removes the stale cached page and reloads the same filter on Back while temporary failures preserve it", async () => {
  for (const status of [404, 503]) {
    const f = await entered(fixture());
    const deleted = { ...MEMORY_DETAIL, reviewStatus: "DELETE", deleteAfter: "2027-11-09T15:00:00Z" };
    let missing = false;
    f.api.listMemories = async options => {
      f.calls.push(["list", options]);
      return { items: missing ? [] : [deleted], nextCursor: missing ? null : "old-next-page" };
    };
    await f.controller.loadInbox("DELETE", "loaded-page-two");
    const cached = f.controller.getSnapshot().items;
    const before = f.calls.filter(call => call[0] === "list").length;
    missing = true;
    f.api.getMemory = async () => { throw new ApiError("synthetic detail failure", { status }); };
    await f.controller.openMemory(IDS.text);
    if (status === 404) {
      assert.equal(f.controller.getSnapshot().items.length, 0);
      assert.equal(f.controller.getSnapshot().nextCursor, null);
      assert.equal(f.controller.getSnapshot().pageResetVersion, 1);
    } else {
      assert.equal(f.controller.getSnapshot().items, cached);
      assert.equal(f.controller.getSnapshot().nextCursor, "old-next-page");
      assert.equal(f.controller.getSnapshot().pageResetVersion, 0);
    }
    await f.controller.backToInbox();
    const state = f.controller.getSnapshot();
    assert.equal(state.phase, "inbox");
    assert.equal(state.reviewStatus, "DELETE");
    assert.equal(state.error, null);
    if (status === 404) {
      assert.equal(f.calls.filter(call => call[0] === "list").length, before + 1);
      assert.equal(f.calls.at(-1)[1].reviewStatus, "DELETE");
      assert.equal(f.calls.at(-1)[1].cursor, undefined);
      assert.equal(state.items.length, 0);
    } else {
      assert.equal(f.calls.filter(call => call[0] === "list").length, before);
      assert.equal(state.items, cached);
    }
  }
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

test("access unavailable can still sign out a live non-couple session with fresh CSRF and cleared private content", async () => {
  const held = deferred();
  const f = await entered(fixture());
  await f.controller.openMemory(IDS.photo);
  f.api.listMemories = async () => { throw authError(403); };
  await f.controller.loadInbox();
  assert.equal(f.controller.getSnapshot().phase, "unavailable");
  assert.equal(f.controller.getSnapshot().session, null);
  f.api.getSession = async () => ({ ...COUPLE_SESSION, csrfToken: "fresh-unavailable-signout-token",
    user: { displayName: "Synthetic developer", roles: ["DEVELOPER"] } });
  f.api.logout = options => { f.calls.push(["logout", options]); return held.promise; };
  const leaving = f.controller.logout();
  await turn();
  const request = f.calls.at(-1);
  assert.equal(request[0], "logout");
  assert.equal(request[1].csrfToken, "fresh-unavailable-signout-token");
  const pending = f.controller.getSnapshot();
  assert.equal(pending.busy, true);
  assert.equal(pending.session, null);
  assert.equal(pending.detail, null);
  assert.equal(pending.items.length, 0);
  assert.equal(pending.photo.url, null);
  assert.deepEqual(f.revoked, ["blob:original-1"]);
  held.resolve();
  await leaving;
  assert.equal(f.controller.getSnapshot().phase, "login");
  assert.equal(f.controller.getSnapshot().logoutUnconfirmed, false);
});

test("unavailable sign-out lost response requires deliberate retry before access can be reopened", async () => {
  const f = await entered(fixture());
  f.api.listMemories = async () => { throw authError(403); };
  await f.controller.loadInbox();
  const tokens = [];
  let sessions = 0;
  f.api.getSession = async () => ({ ...COUPLE_SESSION, csrfToken: "unavailable-signout-token-" + (++sessions) });
  f.api.logout = async options => {
    tokens.push(options.csrfToken);
    if (tokens.length === 1) throw new ApiError("synthetic lost logout response", { unknownOutcome: true });
  };
  await f.controller.logout();
  const unconfirmed = f.controller.getSnapshot();
  assert.equal(unconfirmed.phase, "unavailable");
  assert.equal(unconfirmed.logoutUnconfirmed, true);
  assert.equal(unconfirmed.session, null);
  assert.equal(unconfirmed.items.length, 0);
  const listCount = f.calls.filter(call => call[0] === "list").length;
  await f.controller.loadSession();
  assert.deepEqual(tokens, ["unavailable-signout-token-1", "unavailable-signout-token-2"]);
  assert.equal(f.calls.filter(call => call[0] === "list").length, listCount);
  assert.equal(f.controller.getSnapshot().phase, "login");
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
    } else if (path === "/api/library/memories/" + IDS.photo + "/tags?limit=20") {
      payload = { memoryId: IDS.photo, items: [], nextCursor: null };
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
    ["/api/memories/" + IDS.photo, "GET"], ["/api/library/memories/" + IDS.photo + "/tags?limit=20", "GET"],
    ["/api/memories/" + IDS.photo + "/playback", "GET"],
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
  assert.equal(f.controller.getSnapshot().tags.error, null);
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

for (const [fromStatus, targetStatus] of [["PENDING", "KEEP"], ["KEEP", "ARCHIVED"], ["ARCHIVED", "PENDING"], ["DELETE", "PENDING"]]) {
  test(`confirmed ${fromStatus} to ${targetStatus} uses persisted revision and resets only the inbox page`, async () => {
    const f = await entered(fixture({ api: { getMemory: async () => ({ ...MEMORY_DETAIL, reviewStatus: fromStatus,
      revision: 7, deleteAfter: fromStatus === "DELETE" ? "2027-11-09T15:00:00Z" : null }) } }));
    await f.controller.loadInbox("ARCHIVED", "old-page-two");
    await f.controller.openMemory(IDS.text);
    await f.controller.reviewMemory(targetStatus);
    const state = f.controller.getSnapshot();
    assert.equal(state.phase, "detail");
    assert.equal(state.detail.reviewStatus, targetStatus);
    assert.equal(state.detail.revision, 8);
    assert.equal(state.review.phase, "idle");
    assert.equal(state.items.length, 0);
    assert.equal(state.pageResetVersion, 1);
    assert.equal(state.reviewStatus, "ARCHIVED");
    const call = f.calls.find(call => call[0] === "review");
    assert.deepEqual(call[2], { reviewStatus: targetStatus, revision: 7 });
    assert.equal(call[3].csrfToken, COUPLE_SESSION.csrfToken);
    assert.equal(call[3].signal instanceof AbortSignal, true);
    await f.controller.backToInbox();
    assert.equal(f.calls.at(-1)[0], "list");
    assert.equal(f.calls.at(-1)[1].reviewStatus, "ARCHIVED");
    assert.equal(f.calls.at(-1)[1].cursor, undefined);
    assert.equal(f.controller.getSnapshot().detail, null);
  });
}

test("same-state review accepts an unchanged persisted revision, while a changed status requires exactly one increment", async () => {
  const f = await entered(fixture({ api: { reviewMemory: async () => copy(MEMORY_DETAIL) } }));
  await f.controller.openMemory(IDS.text);
  await f.controller.reviewMemory("PENDING");
  assert.equal(f.controller.getSnapshot().detail.revision, MEMORY_DETAIL.revision);
  assert.equal(f.controller.getSnapshot().review.phase, "idle");
  f.api.reviewMemory = async () => ({ ...MEMORY_DETAIL, reviewStatus: "KEEP" });
  await f.controller.reviewMemory("KEEP");
  assert.equal(f.controller.getSnapshot().review.phase, "uncertain");
  assert.equal(f.controller.getSnapshot().detail.reviewStatus, "PENDING");
});

test("pending review coalesces repeated taps and prevents navigation, sign-out and another mutation from cancelling it", async () => {
  const held = deferred();
  const f = await entered(fixture());
  await f.controller.openMemory(IDS.photo);
  let mutationCalls = 0, mutationSignal;
  f.api.reviewMemory = (_id, _change, options) => { mutationCalls++; mutationSignal = options.signal; return held.promise; };
  const saving = f.controller.reviewMemory("KEEP");
  assert.equal(f.controller.reviewMemory("ARCHIVED"), saving);
  await turn();
  const callsBefore = f.calls.length;
  await f.controller.loadInbox("DELETE");
  await f.controller.openMemory(IDS.text);
  await f.controller.retryPhoto();
  await f.controller.logout();
  await f.controller.loadSession();
  await f.controller.login({ username: "synthetic", password: "synthetic" });
  f.controller.backToInbox();
  assert.equal(f.calls.length, callsBefore);
  assert.equal(mutationSignal.aborted, false);
  assert.equal(mutationCalls, 1);
  assert.equal(f.controller.getSnapshot().review.targetStatus, "KEEP");
  assert.equal(f.controller.getSnapshot().photo.url, null);
  assert.deepEqual(f.revoked, ["blob:original-1"]);
  held.resolve({ ...photo, reviewStatus: "KEEP", revision: 2 });
  await saving;
  assert.equal(f.controller.getSnapshot().detail.reviewStatus, "KEEP");
  assert.equal(f.controller.getSnapshot().photo.phase, "ready");
});

test("an unknown review remains locked after an old-revision read and retries only the frozen original change", async () => {
  const f = await entered(fixture());
  await f.controller.openMemory(IDS.text);
  const attempts = [];
  f.api.reviewMemory = async (id, change, options) => {
    attempts.push({ id, change, csrfToken: options.csrfToken });
    if (attempts.length === 1) throw new ApiError("raw lost result", { code: "NETWORK_ERROR", unknownOutcome: true });
    return { ...MEMORY_DETAIL, reviewStatus: "KEEP", revision: 2 };
  };
  await f.controller.reviewMemory("KEEP");
  assert.equal(f.controller.getSnapshot().review.phase, "uncertain");
  await f.controller.retryReview();
  assert.equal(attempts.length, 1);
  await f.controller.reloadReview();
  assert.equal(f.controller.getSnapshot().review.phase, "uncertain");
  assert.equal(f.controller.getSnapshot().review.canRetry, true);
  const locked = f.controller.getSnapshot();
  await f.controller.reviewMemory("DELETE");
  await f.controller.logout();
  f.controller.backToInbox();
  assert.equal(f.controller.getSnapshot(), locked);
  await f.controller.retryReview();
  assert.deepEqual(attempts[0], attempts[1]);
  assert.deepEqual(attempts[1].change, { reviewStatus: "KEEP", revision: 1 });
  assert.equal(f.controller.getSnapshot().review.phase, "idle");
  assert.equal(f.controller.getSnapshot().detail.reviewStatus, "KEEP");
  assert.equal(JSON.stringify(f.controller.getSnapshot()).includes("raw lost result"), false);
});

for (const currentStatus of ["KEEP", "ARCHIVED"]) {
  test(`advanced revision reconciliation shows current ${currentStatus} without resending or claiming attribution`, async () => {
    const f = await entered(fixture());
    await f.controller.openMemory(IDS.text);
    let attempts = 0;
    f.api.reviewMemory = async () => { attempts++; throw new ApiError("lost", { unknownOutcome: true }); };
    await f.controller.reviewMemory("KEEP");
    f.api.getMemory = async () => ({ ...MEMORY_DETAIL, reviewStatus: currentStatus, revision: 3 });
    await f.controller.reloadReview();
    const state = f.controller.getSnapshot();
    assert.equal(attempts, 1);
    assert.equal(state.review.phase, "idle");
    assert.equal(state.detail.reviewStatus, currentStatus);
    assert.equal(state.detail.revision, 3);
    assert.match(state.notice, /does not identify who changed it/);
    assert.equal(state.pageResetVersion, 1);
  });
}

for (const status of [412, 428]) {
  test(`known ${status} rejection requires current-state reload before another explicit action`, async () => {
    const f = await entered(fixture());
    await f.controller.openMemory(IDS.text);
    let attempts = 0;
    f.api.reviewMemory = async () => { attempts++; throw new ApiError("raw conflict", { status }); };
    await f.controller.reviewMemory("KEEP");
    assert.equal(f.controller.getSnapshot().review.phase, "conflict");
    await f.controller.retryReview();
    await f.controller.reviewMemory("DELETE");
    assert.equal(attempts, 1);
    await f.controller.reloadReview();
    assert.equal(f.controller.getSnapshot().review.phase, "idle");
    assert.equal(f.controller.getSnapshot().detail.revision, 1);
    assert.equal(attempts, 1);
  });
}

test("CSRF rejection refreshes the session and memory explicitly, never automatically resending", async () => {
  const f = await entered(fixture());
  await f.controller.openMemory(IDS.text);
  const tokens = [];
  f.api.reviewMemory = async (_id, change, options) => {
    tokens.push(options.csrfToken);
    if (tokens.length === 1) throw new ApiError("raw csrf", { status: 403, code: "CSRF_INVALID" });
    return { ...MEMORY_DETAIL, reviewStatus: change.reviewStatus, revision: change.revision + 1 };
  };
  await f.controller.reviewMemory("KEEP");
  assert.equal(f.controller.getSnapshot().review.phase, "csrf");
  assert.equal(f.controller.getSnapshot().session.authenticated, true);
  f.api.getSession = async () => ({ ...COUPLE_SESSION, csrfToken: "fresh-review-session-token" });
  await f.controller.refreshReviewSession();
  assert.equal(tokens.length, 1);
  assert.equal(f.controller.getSnapshot().review.phase, "idle");
  await f.controller.reviewMemory("KEEP");
  assert.deepEqual(tokens, [COUPLE_SESSION.csrfToken, "fresh-review-session-token"]);
});

test("CSRF recovery rejects lower revisions and preserves the frozen recovery lock", async () => {
  const f = await entered(fixture({ api: { getMemory: async () => ({ ...MEMORY_DETAIL, revision: 4 }),
    reviewMemory: async () => { throw new ApiError("csrf", { status: 403, code: "CSRF_INVALID" }); } } }));
  await f.controller.openMemory(IDS.text);
  await f.controller.reviewMemory("KEEP");
  f.api.getMemory = async () => ({ ...MEMORY_DETAIL, revision: 3 });
  await f.controller.refreshReviewSession();
  assert.equal(f.controller.getSnapshot().review.phase, "csrf");
  assert.equal(f.controller.getSnapshot().detail.revision, 4);
});

for (const [status, code] of [[400, "VALIDATION_FAILED"], [412, "REVISION_CONFLICT"], [428, "PRECONDITION_REQUIRED"], [429, "RATE_LIMITED"], [403, "CSRF_INVALID"]]) {
  test(`a known ${status} retry rejection cannot erase the original mutation's uncertainty`, async () => {
    const f = await entered(fixture());
    await f.controller.openMemory(IDS.text);
    let attempts = 0;
    f.api.reviewMemory = async () => {
      attempts++;
      if (attempts === 1) throw new ApiError("first result lost", { unknownOutcome: true });
      throw new ApiError("retry rejected", { status, code });
    };
    await f.controller.reviewMemory("KEEP");
    await f.controller.reloadReview();
    await f.controller.retryReview();
    if (status === 403) await f.controller.refreshReviewSession();
    else await f.controller.reloadReview();
    assert.equal(attempts, 2);
    assert.equal(f.controller.getSnapshot().review.phase, "uncertain");
    assert.equal(f.controller.getSnapshot().review.canRetry, true);
    await f.controller.reviewMemory("ARCHIVED");
    await f.controller.logout();
    assert.equal(f.controller.getSnapshot().phase, "detail");
    assert.equal(attempts, 2);
    f.api.getMemory = async () => ({ ...MEMORY_DETAIL, reviewStatus: "KEEP", revision: 2 });
    await f.controller.reloadReview();
    assert.equal(f.controller.getSnapshot().review.phase, "idle");
  });
}

for (const status of [401, 403]) {
  test(`${status} on mutation clears content, session, intent and owned preview without exposing raw errors`, async () => {
    const f = await entered(fixture({ api: { reviewMemory: async () => { throw authError(status); } } }));
    await f.controller.openMemory(IDS.photo);
    await f.controller.reviewMemory("KEEP");
    const state = f.controller.getSnapshot();
    assert.equal(state.phase, status === 401 ? "login" : "unavailable");
    assert.equal(state.detail, null);
    assert.equal(state.session, null);
    assert.equal(state.items.length, 0);
    assert.equal(state.photo.url, null);
    assert.equal(state.review.phase, "idle");
    assert.deepEqual(f.revoked, ["blob:original-1"]);
    assert.equal(JSON.stringify(state).includes("secret raw error"), false);
  });
}

test("delete revokes original preview, forbids playback and restore obtains a fresh original", async () => {
  const f = await entered(fixture());
  await f.controller.openMemory(IDS.photo);
  await f.controller.reviewMemory("DELETE");
  const deleted = f.controller.getSnapshot().detail;
  assert.equal(deleted.reviewStatus, "DELETE");
  assert.equal(deleted.deleteAfter, "2027-11-09T15:00:00Z");
  assert.equal(f.controller.getSnapshot().photo.phase, "idle");
  const playbackCount = f.calls.filter(call => call[0] === "playback").length;
  await f.controller.retryPhoto();
  f.controller.backToInbox();
  f.api.getMemory = async () => copy(deleted);
  await f.controller.openMemory(IDS.photo);
  assert.equal(f.calls.filter(call => call[0] === "playback").length, playbackCount);
  await f.controller.reviewMemory("PENDING");
  assert.equal(f.controller.getSnapshot().detail.deleteAfter, null);
  assert.equal(f.controller.getSnapshot().photo.phase, "ready");
  assert.deepEqual(f.revoked, ["blob:original-1"]);
});

test("expired deletion discovered during reconciliation clears detail and reloads inbox page one", async () => {
  const f = await entered(fixture());
  await f.controller.openMemory(IDS.text);
  f.api.reviewMemory = async () => { throw new ApiError("lost", { unknownOutcome: true }); };
  await f.controller.reviewMemory("DELETE");
  f.api.getMemory = async () => { throw new ApiError("expired", { status: 404 }); };
  await f.controller.reloadReview();
  assert.equal(f.controller.getSnapshot().detail, null);
  assert.equal(f.controller.getSnapshot().review.phase, "idle");
  await f.controller.backToInbox();
  assert.equal(f.calls.at(-1)[0], "list");
  assert.equal(f.calls.at(-1)[1].cursor, undefined);
});

test("a confirmed review stays confirmed when reloading its photo fails", async () => {
  const f = await entered(fixture());
  await f.controller.openMemory(IDS.photo);
  f.api.getPlayback = async () => { throw new ApiError("storage unavailable", { status: 503 }); };
  await f.controller.reviewMemory("KEEP");
  assert.equal(f.controller.getSnapshot().detail.reviewStatus, "KEEP");
  assert.equal(f.controller.getSnapshot().review.phase, "idle");
  assert.match(f.controller.getSnapshot().notice, /Kept privately/);
  assert.equal(f.controller.getSnapshot().photo.phase, "error");
});

test("mutation deadline covers a stalled real JSON body and ignores its late result after same-revision recovery", async () => {
  const held = deferred(), clock = timers();
  let signal, attempts = 0;
  const api = createArchiveApi({ client: createApiClient({ fetchImpl: async (path, options) => {
    if (options.method === "PATCH") {
      attempts++;
      signal = options.signal;
      return { status: 200, ok: true, headers: new Headers({ "Content-Type": "application/json", ETag: '"2"' }), json: () => held.promise };
    }
    const payload = path === "/api/session" ? COUPLE_SESSION
      : path.includes("?") ? { items: [MEMORY_DETAIL], nextCursor: null } : MEMORY_DETAIL;
    return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
  } }) });
  const f = await entered(fixture({ api, ...clock }));
  await f.controller.openMemory(IDS.text);
  const saving = f.controller.reviewMemory("KEEP");
  await turn();
  assert.equal(clock.expire(), 30_000);
  await saving;
  assert.equal(signal.aborted, true);
  assert.equal(f.controller.getSnapshot().review.phase, "uncertain");
  await f.controller.reloadReview();
  assert.equal(f.controller.getSnapshot().review.canRetry, true);
  const recovered = f.controller.getSnapshot();
  held.resolve({ ...MEMORY_DETAIL, reviewStatus: "KEEP", revision: 2 });
  await turn();
  assert.equal(f.controller.getSnapshot(), recovered);
  assert.equal(attempts, 1);
  assert.equal(clock.pending.size, 0);
});

test("an advanced reconciliation cannot be overwritten by a late timed-out PATCH or disposal", async () => {
  const held = deferred(), clock = timers();
  const f = await entered(fixture({ ...clock }));
  await f.controller.openMemory(IDS.text);
  f.api.reviewMemory = () => held.promise;
  const saving = f.controller.reviewMemory("KEEP");
  await turn();
  clock.expire();
  await saving;
  f.api.getMemory = async () => ({ ...MEMORY_DETAIL, reviewStatus: "ARCHIVED", revision: 3 });
  await f.controller.reloadReview();
  assert.equal(f.controller.getSnapshot().detail.reviewStatus, "ARCHIVED");
  held.resolve({ ...MEMORY_DETAIL, reviewStatus: "KEEP", revision: 2 });
  await turn();
  assert.equal(f.controller.getSnapshot().detail.reviewStatus, "ARCHIVED");
  f.controller.dispose();
  assert.equal(f.controller.getSnapshot().detail, null);
  assert.equal(f.controller.getSnapshot().session, null);
  assert.equal(clock.pending.size, 0);
});

test("suspending a private photo immediately clears all presentation and revokes its owned preview", async () => {
  const f = await entered(fixture());
  await f.controller.openMemory(IDS.photo);
  assert.equal(f.controller.getSnapshot().photo.phase, "ready");
  const before = f.calls.length;
  const hidden = f.controller.suspend();
  assert.equal(hidden.phase, "checking"); assert.equal(hidden.session, null);
  assert.deepEqual(hidden.items, []); assert.equal(hidden.detail, null); assert.equal(hidden.nextCursor, null);
  assert.equal(hidden.photo.url, null); assert.equal(hidden.notice, null); assert.equal(hidden.busy, false);
  assert.deepEqual(f.revoked, ["blob:original-1"]);
  assert.equal(f.calls.length, before, "hiding never makes a request");
  assert.equal(f.controller.suspend(), hidden, "repeated hidden events are idempotent");
});

test("restoration shares one fresh session check and never redisplays old rows before authorization", async () => {
  const f = await entered(fixture());
  const waiting = deferred();
  let checks = 0, lists = 0;
  f.api.getSession = async () => { checks++; return waiting.promise; };
  f.api.listMemories = async () => { lists++; return { items: [{ ...MEMORY_DETAIL, message: "freshly authorized text" }], nextCursor: null }; };
  f.controller.suspend();
  const restoring = f.controller.resume();
  assert.equal(f.controller.resume(), restoring);
  await turn();
  assert.equal(checks, 1); assert.equal(lists, 0);
  assert.equal(f.controller.getSnapshot().session, null); assert.deepEqual(f.controller.getSnapshot().items, []);
  waiting.resolve(copy(COUPLE_SESSION));
  await restoring;
  assert.equal(lists, 1); assert.equal(f.controller.getSnapshot().phase, "inbox");
  assert.equal(f.controller.getSnapshot().items[0].message, "freshly authorized text");
  assert.equal(f.controller.getSnapshot().photo.url, null);
  const restored = f.controller.getSnapshot();
  await f.controller.resume(); assert.equal(f.controller.getSnapshot(), restored); assert.equal(checks, 1);
});

for (const status of [0, 401, 403]) {
  test(`restored ${status || "anonymous"} session cannot redisplay content or request private records`, async () => {
    const f = await entered(fixture());
    await f.controller.openMemory(IDS.photo);
    const before = f.calls.length;
    f.api.getSession = async () => { if (status) throw authError(status); return copy(ANONYMOUS_SESSION); };
    f.controller.suspend(); await f.controller.resume();
    const state = f.controller.getSnapshot();
    assert.equal(state.phase, status === 403 ? "unavailable" : "login");
    assert.equal(state.session, null); assert.deepEqual(state.items, []); assert.equal(state.detail, null); assert.equal(state.photo.url, null);
    assert.equal(f.calls.length, before); assert.deepEqual(f.revoked, ["blob:original-1"]);
  });
}

test("suspending an in-flight review keeps only its action identity and reconciles before deliberate retry", async () => {
  const f = await entered(fixture());
  await f.controller.openMemory(IDS.text);
  const waiting = deferred(), attempts = [];
  f.api.reviewMemory = async (id, change, options) => {
    attempts.push({ id, change, options });
    return attempts.length === 1 ? waiting.promise : { ...MEMORY_DETAIL, reviewStatus: change.reviewStatus, revision: change.revision + 1 };
  };
  const first = f.controller.reviewMemory("KEEP"); await turn();
  const hidden = f.controller.suspend(); await first;
  assert.equal(attempts[0].options.signal.aborted, true);
  assert.equal(hidden.detail, null); assert.equal(hidden.session, null); assert.deepEqual(hidden.items, []);
  assert.equal(JSON.stringify(hidden).includes(MEMORY_DETAIL.message), false);
  await f.controller.reloadReview(); await f.controller.retryReview();
  assert.equal(attempts.length, 1, "a hidden action cannot issue requests");
  f.api.getSession = async () => ({ ...COUPLE_SESSION, csrfToken: "fresh-after-return" });
  await f.controller.resume();
  assert.equal(attempts.length, 1, "restoration never resends a review mutation");
  assert.equal(f.controller.getSnapshot().review.phase, "uncertain");
  assert.equal(f.controller.getSnapshot().review.canRetry, true);
  await f.controller.reviewMemory("DELETE"); assert.equal(attempts.length, 1);
  await f.controller.retryReview();
  assert.equal(attempts.length, 2); assert.equal(attempts[1].id, attempts[0].id);
  assert.deepEqual(attempts[1].change, attempts[0].change); assert.deepEqual(attempts[1].change, { reviewStatus: "KEEP", revision: 1 });
  assert.equal(attempts[1].options.csrfToken, "fresh-after-return");
  waiting.resolve({ ...MEMORY_DETAIL, reviewStatus: "ARCHIVED", revision: 3 }); await turn();
  assert.equal(f.controller.getSnapshot().detail.reviewStatus, "KEEP", "late original mutation cannot restore its private response");
});

test("a failed restoration keeps an uncertain review hidden and recoverable through checking access again", async () => {
  const f = await entered(fixture());
  await f.controller.openMemory(IDS.text);
  let mutations = 0, sessions = 0;
  f.api.reviewMemory = async () => { mutations++; throw new ApiError("lost", { unknownOutcome: true }); };
  await f.controller.reviewMemory("KEEP"); f.controller.suspend();
  f.api.getSession = async () => {
    if (++sessions === 1) throw new ApiError("private response", { status: 503 });
    return copy(COUPLE_SESSION);
  };
  await f.controller.resume();
  assert.equal(f.controller.getSnapshot().phase, "unavailable"); assert.equal(f.controller.getSnapshot().detail, null);
  assert.equal(f.controller.getSnapshot().session, null); assert.deepEqual(f.controller.getSnapshot().items, []);
  f.api.getMemory = async () => ({ ...MEMORY_DETAIL, reviewStatus: "KEEP", revision: 2 });
  await f.controller.loadSession();
  assert.equal(sessions, 2); assert.equal(mutations, 1);
  assert.equal(f.controller.getSnapshot().phase, "detail"); assert.equal(f.controller.getSnapshot().review.phase, "idle");
  assert.equal(f.controller.getSnapshot().detail.reviewStatus, "KEEP");
});

test("hiding during restoration aborts its request and ignores a late authorized result", async () => {
  const f = await entered(fixture());
  const waiting = deferred(); let signal, lists = 0;
  f.api.getSession = async options => { signal = options.signal; return waiting.promise; };
  f.api.listMemories = async () => { lists++; return { items: [MEMORY_DETAIL], nextCursor: null }; };
  f.controller.suspend(); const restoring = f.controller.resume(); await turn();
  f.controller.suspend(); await restoring;
  assert.equal(signal.aborted, true); assert.equal(f.controller.getSnapshot().session, null);
  waiting.resolve(copy(COUPLE_SESSION)); await turn();
  assert.equal(lists, 0); assert.deepEqual(f.controller.getSnapshot().items, []);
  f.api.getSession = async () => copy(COUPLE_SESSION);
  await f.controller.resume(); assert.equal(lists, 1);
});

test("hiding an unfinished sign-out keeps it unconfirmed and restoration resolves it before private access", async () => {
  const f = await entered(fixture());
  const waiting = deferred(); let signouts = 0, firstSignal;
  f.api.logout = async options => {
    if (++signouts === 1) { firstSignal = options.signal; return waiting.promise; }
  };
  const signout = f.controller.logout(); await turn();
  assert.equal(signouts, 1);
  f.controller.suspend(); await signout;
  assert.equal(firstSignal.aborted, true); assert.equal(f.controller.getSnapshot().logoutUnconfirmed, true);
  const before = f.calls.length;
  await f.controller.resume();
  assert.equal(signouts, 2); assert.equal(f.controller.getSnapshot().phase, "login");
  assert.equal(f.controller.getSnapshot().logoutUnconfirmed, false);
  assert.ok(f.calls.slice(before).every(call => call[0] === "session"), "return never opens the private inbox during sign-out recovery");
  waiting.resolve(); await turn();
  assert.equal(f.controller.getSnapshot().phase, "login"); assert.deepEqual(f.controller.getSnapshot().items, []);
});

for (const action of ["logout", "suspend", "dispose"]) {
  test(`${action} prevents abort callbacks from starting replacement private reads`, async () => {
    const clock = timers(), firstResult = deferred(), replacementResult = deferred();
    let replacement, replacementCalls = 0;
    const f = await entered(fixture({ ...clock }));
    f.api.getMemory = (id, { signal }) => {
      if (id !== IDS.text) { replacementCalls++; return replacementResult.promise; }
      signal.addEventListener("abort", () => { replacement = f.controller.openMemory(IDS.photo); }, { once: true });
      return firstResult.promise;
    };
    const first = f.controller.openMemory(IDS.text); await turn();
    try {
      await f.controller[action]();
      replacementResult.resolve({ ...MEMORY_DETAIL, memoryId: IDS.photo, textContent: "Late replacement private content" });
      firstResult.resolve(copy(MEMORY_DETAIL));
      await Promise.all([first, replacement]);
      const state = f.controller.getSnapshot();
      assert.equal(replacementCalls, 0);
      assert.equal(state.session, null); assert.equal(state.detail, null);
      assert.deepEqual(state.items, []); assert.equal(state.photo.url, null);
      assert.equal(state.busy, false); assert.equal(clock.pending.size, 0);
    } finally {
      firstResult.resolve(copy(MEMORY_DETAIL)); replacementResult.resolve(copy(MEMORY_DETAIL));
      f.controller.dispose(); await Promise.all([first, replacement]);
    }
  });
}

test("suspension during cancellation owns the view before an outer navigation can start its read", async () => {
  const clock = timers(), held = deferred();
  const f = await entered(fixture({ ...clock }));
  f.api.getMemory = (_id, { signal }) => {
    signal.addEventListener("abort", () => f.controller.suspend(), { once: true });
    return held.promise;
  };
  const first = f.controller.openMemory(IDS.text); await turn();
  const listCount = f.calls.filter(call => call[0] === "list").length;
  try {
    await f.controller.loadInbox("KEEP");
    held.resolve(copy(MEMORY_DETAIL)); await first;
    assert.equal(f.calls.filter(call => call[0] === "list").length, listCount);
    const state = f.controller.getSnapshot();
    assert.equal(state.phase, "checking"); assert.equal(state.session, null);
    assert.equal(state.detail, null); assert.deepEqual(state.items, []);
    assert.equal(state.busy, false); assert.equal(clock.pending.size, 0);
  } finally { held.resolve(copy(MEMORY_DETAIL)); f.controller.dispose(); await first; }
});

test("preview cleanup callbacks cannot register a new review while logout invalidates private work", async () => {
  const clock = timers(), held = deferred();
  let saving, reviewCalls = 0, f;
  f = await entered(fixture({ ...clock, revokeObjectURL() { saving = f.controller.reviewMemory("KEEP"); } }));
  await f.controller.openMemory(IDS.photo);
  f.api.reviewMemory = () => { reviewCalls++; return held.promise; };
  try {
    await f.controller.logout();
    held.resolve({ ...photo, reviewStatus: "KEEP", revision: 2 }); await saving;
    assert.equal(reviewCalls, 0);
    const state = f.controller.getSnapshot();
    assert.equal(state.phase, "login"); assert.equal(state.session, null); assert.equal(state.detail, null);
    assert.equal(state.review.phase, "idle"); assert.equal(state.photo.url, null);
    assert.equal(state.busy, false); assert.equal(clock.pending.size, 0);
  } finally { held.resolve({ ...photo, reviewStatus: "KEEP", revision: 2 }); f.controller.dispose(); await saving; }
});

test("ordinary publication reentry still gives the newest detail selection exclusive ownership", async () => {
  const clock = timers();
  const f = await entered(fixture({ ...clock }));
  let replacement;
  const unsubscribe = f.controller.subscribe(state => {
    if (state.phase === "detail" && state.requestedMemoryId === IDS.text && !state.detail) {
      replacement = f.controller.openMemory(IDS.photo);
    }
  });
  try {
    await f.controller.openMemory(IDS.text); await replacement;
    const detailCalls = f.calls.filter(call => call[0] === "detail");
    assert.deepEqual(detailCalls.map(call => call[1]), [IDS.photo]);
    assert.equal(f.controller.getSnapshot().detail.memoryId, IDS.photo);
    assert.equal(f.controller.getSnapshot().photo.phase, "ready");
    assert.equal(f.controller.getSnapshot().busy, false); assert.equal(clock.pending.size, 0);
  } finally { unsubscribe(); f.controller.dispose(); }
});

for (const action of ["beginCreation", "backToInbox"]) {
  test(`${action} preserves suspension triggered by preview cleanup`, async () => {
    const clock = timers(); let f;
    f = await entered(fixture({ ...clock, revokeObjectURL() { f.controller.suspend(); } }));
    try {
      await f.controller.openMemory(IDS.photo); await f.controller[action]();
      const state = f.controller.getSnapshot();
      assert.equal(state.phase, "checking"); assert.equal(state.session, null); assert.equal(state.detail, null);
      assert.deepEqual(state.items, []); assert.equal(state.busy, false); assert.equal(clock.pending.size, 0);
    } finally { f.controller.dispose(); }
  });
}

test("suspension during logout cleanup retains sign-out intent until restoration confirms invalidation", async () => {
  const clock = timers(); let f, signouts = 0;
  f = await entered(fixture({ ...clock, revokeObjectURL() { f.controller.suspend(); },
    api: { logout: async () => { signouts++; } } }));
  try {
    await f.controller.openMemory(IDS.photo); await f.controller.logout();
    assert.equal(f.controller.getSnapshot().logoutUnconfirmed, true);
    const listCount = f.calls.filter(call => call[0] === "list").length;
    await f.controller.resume();
    const state = f.controller.getSnapshot();
    assert.equal(signouts, 1); assert.equal(state.phase, "login"); assert.equal(state.session, null);
    assert.equal(state.logoutUnconfirmed, false); assert.deepEqual(state.items, []); assert.equal(state.detail, null);
    assert.equal(f.calls.filter(call => call[0] === "list").length, listCount);
    assert.equal(state.busy, false); assert.equal(clock.pending.size, 0);
  } finally { f.controller.dispose(); }
});
