import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers";
import { createInboxController } from "./inboxController.js";
import { ApiError } from "../../../shared/api/apiClient.js";
import { ANONYMOUS_SESSION, COUPLE_SESSION, IDS, MEMORY_DETAIL, MEDIA_DETAIL } from "../../../shared/api/v1/fixtures.js";

const copy = value => structuredClone(value);
const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

function fixture() {
  const calls = [];
  const api = {
    getSession: async () => { calls.push("session"); return copy(COUPLE_SESSION); },
    listMemories: async options => { calls.push(["list", options]); return { items: [copy(MEMORY_DETAIL)], nextCursor: "next-page" }; },
    getMemory: async () => copy(MEMORY_DETAIL),
    reviewMemory: async (_id, change) => ({ ...copy(MEMORY_DETAIL), reviewStatus: change.reviewStatus, revision: change.revision + 1 }),
  };
  const controller = createInboxController({ api });
  return { api, controller, calls };
}

async function entered() {
  const f = fixture();
  await f.controller.loadSession();
  return f;
}

test("foreground recheck preserves current memory, filter, page cache and presentation while refreshing access", async () => {
  const f = await entered();
  await f.controller.loadInbox("KEEP", "page-two");
  await f.controller.openMemory(IDS.text);
  const before = f.controller.getSnapshot(), phases = [];
  f.controller.subscribe(state => phases.push(state.phase));
  f.api.getSession = async () => ({ ...copy(COUPLE_SESSION), csrfToken: "fresh-foreground-token" });
  await f.controller.recheckSession();
  const after = f.controller.getSnapshot();
  assert.equal(after.phase, "detail");
  assert.equal(after.detail, before.detail);
  assert.equal(after.items, before.items);
  assert.equal(after.reviewStatus, "KEEP");
  assert.equal(after.nextCursor, before.nextCursor);
  assert.equal(after.pageResetVersion, before.pageResetVersion);
  assert.equal(after.tags, before.tags);
  assert.equal(after.session.csrfToken, "fresh-foreground-token");
  assert.ok(phases.every(phase => phase === "detail"));
  assert.equal(f.calls.filter(call => Array.isArray(call)).length, 2, "recheck does not reload or replace the current page");
  f.controller.dispose();
});

test("focus and visibility return events share one in-flight session recheck", async () => {
  const f = await entered(), held = deferred();
  let checks = 0;
  f.api.getSession = () => { checks++; return held.promise; };
  const first = f.controller.recheckSession();
  const second = f.controller.recheckSession();
  assert.equal(second, first);
  await turn(); assert.equal(checks, 1);
  held.resolve(copy(COUPLE_SESSION)); await first;
  assert.equal(f.controller.getSnapshot().phase, "inbox");
  f.controller.dispose();
});

test("a verified original stays loaded after successful recheck and is revoked if access expires", async () => {
  const f = fixture(), revoked = [];
  const photo = { ...copy(MEDIA_DETAIL), media: { ...copy(MEDIA_DETAIL.media), byteSize: 3, detectedContentType: "image/png" } };
  f.api.getMemory = async () => copy(photo);
  f.api.getPlayback = async () => ({ url: "https://storage.example.test/photo", expiresAt: "2099-01-01T00:00:00Z" });
  const controller = createInboxController({ api: f.api,
    fetchImpl: async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png", "Content-Length": "3" } }),
    digest: async () => photo.media.checksumSha256,
    createObjectURL: () => "blob:verified-original", revokeObjectURL: url => revoked.push(url),
  });
  await controller.loadSession(); await controller.openMemory(IDS.photo);
  const preview = controller.getSnapshot().photo;
  assert.equal(preview.phase, "ready");
  await controller.recheckSession();
  assert.equal(controller.getSnapshot().photo, preview); assert.deepEqual(revoked, []);
  f.api.getSession = async () => copy(ANONYMOUS_SESSION);
  await controller.recheckSession();
  assert.equal(controller.getSnapshot().photo.url, null); assert.deepEqual(revoked, ["blob:verified-original"]);
  controller.dispose(); f.controller.dispose();
});

test("switching back to a sign-in form does not request or replace its anonymous session", async () => {
  const f = fixture();
  f.api.getSession = async () => copy(ANONYMOUS_SESSION);
  await f.controller.loadSession();
  const before = f.controller.getSnapshot();
  f.api.getSession = () => { throw new Error("anonymous foreground recheck is unnecessary"); };
  await f.controller.recheckSession();
  assert.equal(f.controller.getSnapshot(), before);
  f.controller.dispose();
});

for (const access of ["anonymous", 401, 403, 503]) {
  test(`foreground access loss (${access}) clears private state`, async () => {
    const f = await entered(); await f.controller.openMemory(IDS.text);
    f.api.getSession = async () => {
      if (access === "anonymous") return copy(ANONYMOUS_SESSION);
      throw new ApiError("raw server content", { status: access });
    };
    await f.controller.recheckSession();
    const state = f.controller.getSnapshot();
    assert.equal(state.phase, access === "anonymous" || access === 401 ? "login" : "unavailable");
    assert.equal(state.session, null); assert.equal(state.detail, null); assert.equal(state.items.length, 0);
    assert.equal(state.photo.url, null); assert.equal(state.busy, false);
    assert.equal(JSON.stringify(state).includes("raw server content"), false);
    f.controller.dispose();
  });
}

test("foreground recheck does not cancel or replace an in-flight review", async () => {
  const f = await entered(); await f.controller.openMemory(IDS.text);
  const held = deferred(); let signal;
  f.api.reviewMemory = (_id, _change, options) => { signal = options.signal; return held.promise; };
  const saving = f.controller.reviewMemory("KEEP"); await turn();
  f.api.getSession = () => { throw new Error("a running mutation must own its operation"); };
  const before = f.controller.getSnapshot(); await f.controller.recheckSession();
  assert.equal(f.controller.getSnapshot(), before); assert.equal(signal.aborted, false);
  held.resolve({ ...copy(MEMORY_DETAIL), reviewStatus: "KEEP", revision: MEMORY_DETAIL.revision + 1 });
  await saving; assert.equal(f.controller.getSnapshot().detail.reviewStatus, "KEEP");
  f.controller.dispose();
});

test("navigation owns the view when a stale foreground check later reports anonymous access", async () => {
  const f = await entered(), held = deferred(); let signal;
  f.api.getSession = options => { signal = options.signal; return held.promise; };
  const checking = f.controller.recheckSession(); await turn();
  await f.controller.openMemory(IDS.text);
  assert.equal(signal.aborted, true);
  held.resolve(copy(ANONYMOUS_SESSION)); await checking;
  assert.equal(f.controller.getSnapshot().phase, "detail");
  assert.equal(f.controller.getSnapshot().detail.memoryId, IDS.text);
  f.controller.dispose();
});
