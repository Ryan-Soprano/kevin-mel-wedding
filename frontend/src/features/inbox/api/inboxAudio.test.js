import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { setImmediate } from "node:timers";
import { createInboxController } from "./inboxController.js";
import { COUPLE_SESSION, IDS, MEDIA_DETAIL, PLAYBACK } from "../../../shared/api/v1/fixtures.js";

// Controller transport/integrity fixture; actual codec verification is a server responsibility.
const bytes = new TextEncoder().encode("synthetic private audio transport bytes");
const checksum = createHash("sha256").update(bytes).digest("hex");
const memory = { ...MEDIA_DETAIL, memoryType: "AUDIO", media: { ...MEDIA_DETAIL.media, originalFilename: "message.webm",
  detectedContentType: "audio/webm", byteSize: bytes.length, durationSeconds: 2.5, checksumSha256: checksum } };
const response = (body = bytes, headers = {}) => new Response(body, { headers: {
  "Content-Type": "audio/webm", "Content-Length": String(bytes.length), ...headers,
} });
const turn = () => new Promise(resolve => setImmediate(resolve));
function fixture(overrides = {}) {
  const calls = [], created = [], revoked = [];
  const api = { getSession: async () => COUPLE_SESSION,
    listMemories: async () => ({ items: [memory], nextCursor: null }), getMemory: async () => memory,
    getPlayback: async (...args) => { calls.push(["playback", ...args]); return PLAYBACK; },
    reviewMemory: async (_id, change) => ({ ...memory, reviewStatus: change.reviewStatus, revision: change.revision + 1,
      deleteAfter: change.reviewStatus === "DELETE" ? "2099-11-09T15:00:00Z" : null }), ...overrides.api };
  const { api: unused, ...options } = overrides; void unused;
  const controller = createInboxController({ api,
    fetchImpl: async (url, request) => { calls.push(["bytes", url, request]); return response(); },
    createObjectURL: blob => { const url = "blob:private-audio-" + (created.length + 1); created.push({ url, blob }); return url; },
    revokeObjectURL: url => revoked.push(url), ...options });
  return { controller, api, calls, created, revoked };
}
async function open(f) { await f.controller.loadSession(); await f.controller.openMemory(IDS.photo); return f; }

test("private audio is downloaded with no credentials and hash-checked before playback/download receives a Blob URL", async () => {
  const f = await open(fixture()); const state = f.controller.getSnapshot();
  assert.equal(state.photo.phase, "ready"); assert.equal(state.photo.url, "blob:private-audio-1");
  assert.equal(f.created[0].blob.type, "audio/webm"); assert.equal(f.created[0].blob.size, bytes.length);
  assert.deepEqual(new Uint8Array(await f.created[0].blob.arrayBuffer()), bytes);
  const request = f.calls.find(call => call[0] === "bytes")[2];
  assert.equal(request.credentials, "omit"); assert.equal(request.redirect, "error");
  assert.equal(request.cache, "no-store"); assert.equal(request.referrerPolicy, "no-referrer");
  assert.equal(JSON.stringify(state).includes(PLAYBACK.url), false);
});

test("wrong MIME, checksum, declared length or excess streaming bytes never reach an audio element", async () => {
  for (const fetchImpl of [async () => response(bytes, { "Content-Type": "video/webm" }),
    async () => response(new Uint8Array(bytes.length).fill(0)),
    async () => response(bytes, { "Content-Length": String(bytes.length + 1) }),
    async () => response(new Uint8Array(bytes.length + 1), { "Content-Length": String(bytes.length) })]) {
    const f = await open(fixture({ fetchImpl }));
    assert.equal(f.controller.getSnapshot().photo.phase, "error"); assert.equal(f.created.length, 0);
    assert.match(f.controller.getSnapshot().photo.error, /audio did not match/);
  }
});

test("audio size/type/duration policy is checked even when a custom API bypasses the decoder", async () => {
  for (const change of [{ byteSize: 25_000_001 }, { detectedContentType: "audio/mpeg" }, { durationSeconds: 121 }]) {
    const f = await open(fixture({ api: { getMemory: async () => ({ ...memory, media: { ...memory.media, ...change } }) } }));
    assert.equal(f.controller.getSnapshot().photo.phase, "error"); assert.equal(f.calls.length, 0); assert.equal(f.created.length, 0);
  }
});

test("navigation, lifecycle suspension, sign-out and disposal revoke the owned audio preview", async () => {
  for (const action of [controller => controller.backToInbox(), controller => controller.suspend(),
    controller => controller.dispose(), controller => controller.logout()]) {
    const f = await open(fixture({ api: { logout: async () => {} } })); await action(f.controller);
    assert.deepEqual(f.revoked, ["blob:private-audio-1"]); assert.equal(f.controller.getSnapshot().photo.url, null);
  }
});

test("audio review/delete revokes preview immediately; deleted audio has no grant and restore verifies the original again", async () => {
  const f = await open(fixture());
  await f.controller.reviewMemory("DELETE");
  assert.equal(f.controller.getSnapshot().detail.reviewStatus, "DELETE");
  assert.deepEqual(f.revoked, ["blob:private-audio-1"]); assert.equal(f.created.length, 1);
  await f.controller.retryMedia(); assert.equal(f.created.length, 1);
  await f.controller.reviewMemory("PENDING");
  assert.equal(f.controller.getSnapshot().photo.phase, "ready"); assert.equal(f.created.length, 2);
  assert.equal(f.calls.filter(call => call[0] === "playback").length, 2);
});

test("suspending before the private audio response arrives prevents stale preview creation even if transport ignores abort", async () => {
  let finish;
  const delayed = new Promise(resolve => { finish = resolve; });
  const f = fixture({ fetchImpl: () => delayed }); await f.controller.loadSession();
  const opening = f.controller.openMemory(IDS.photo); await turn(); f.controller.suspend();
  finish(response()); await opening;
  assert.equal(f.created.length, 0); assert.equal(f.controller.getSnapshot().detail, null);
  assert.equal(f.controller.getSnapshot().photo.url, null);
});
