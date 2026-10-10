import test from "node:test";
import assert from "node:assert/strict";
import { createTextSubmission } from "../features/contribution/api/textSubmission.js";
import { createPhotoBatchSubmission } from "../features/media/api/photoBatchSubmission.js";
import { createAudioSubmission } from "../features/audio/api/audioSubmission.js";
import { createInboxController } from "../features/inbox/api/inboxController.js";
import { createMockArchiveApi } from "../shared/api/mockArchiveApi.js";

// Synthetic adapter/coordinator fixture: this exercises the real JSON decoders
// and private presentation controller, not DOM, codecs, R2 or physical-browser acceptance.
function fixture() {
  const time = Date.parse("2026-10-24T19:00:00Z");
  const mock = createMockArchiveApi({ scenario: "uncertainSubmission", now: () => time });
  const grants = new Map(), originals = new Map(), uploads = [], created = [], revoked = [], downloads = [];
  let playbackMemoryId;
  const api = {
    ...mock,
    async authorizeUpload(contributionId, memoryId, options) {
      const grant = await mock.authorizeUpload(contributionId, memoryId, options);
      grants.set(grant.grantId, memoryId);
      return grant;
    },
    async uploadMedia(grant, file, options) {
      const memoryId = grants.get(grant.grantId);
      const attempt = { memoryId, file, confirmed: false };
      uploads.push(attempt);
      const result = await mock.uploadMedia(grant, file, options);
      originals.set(memoryId, new Blob([await file.arrayBuffer()], { type: file.type }));
      attempt.confirmed = true;
      return result;
    },
    async getPlayback(memoryId, options) {
      const grant = await mock.getPlayback(memoryId, options);
      // The mock uses one synthetic playback URL. This sequential storage fixture
      // serves the bytes associated with the successfully authorized memory.
      playbackMemoryId = memoryId;
      return grant;
    },
  };
  const controller = createInboxController({ api, now: () => time,
    fetchImpl: async (url, request) => {
      const blob = originals.get(playbackMemoryId);
      assert.ok(blob, "playback must use an original from a successful guest upload");
      downloads.push({ memoryId: playbackMemoryId, url, request });
      return new Response(await blob.arrayBuffer(), { headers: {
        "Content-Type": blob.type, "Content-Length": String(blob.size),
      } });
    },
    createObjectURL: blob => {
      const url = "blob:private-journey-" + (created.length + 1);
      created.push({ url, blob });
      return url;
    },
    revokeObjectURL: url => revoked.push(url),
  });
  return { mock, api, controller, uploads, created, revoked, downloads, time };
}

test("guest notes, partial photos and anonymous audio reach one private inbox and survive review, recovery and sign-out", async context => {
  const f = fixture();
  const text = createTextSubmission({ api: f.api });
  const photos = createPhotoBatchSubmission({ api: f.api });
  const audio = createAudioSubmission({ api: f.api });
  context.after(() => { f.controller.dispose(); photos.dispose(); audio.dispose(); });

  const anonymousDraft = { guestName: "  ", message: " An anonymous wedding wish. " };
  await assert.rejects(text.submit(anonymousDraft), { code: "NETWORK_ERROR", unknownOutcome: true });
  assert.equal(text.pending, true);
  const anonymousNote = await text.submit(anonymousDraft);
  assert.equal(text.pending, false);
  assert.equal(anonymousNote.completion, "COMPLETE");
  assert.deepEqual(await text.submit(anonymousDraft), anonymousNote);
  text.startAnother();
  const namedNote = await text.submit({ guestName: " Named Guest ", message: " A named wedding wish. " });
  assert.notEqual(namedNote.contributionId, anonymousNote.contributionId);

  const selected = ["one", "two", "three"].map((name, index) => ({
    id: crypto.randomUUID(),
    file: new File(["synthetic photo bytes " + name], name + ".png", { type: "image/png" }),
    caption: index === 0 ? " First photo caption " : " ",
  }));
  f.mock.setScenario("partialUpload");
  const partial = await photos.submit({ guestName: " Photo Guest ", photos: selected });
  assert.equal(partial.savedCount, 2);
  assert.equal(partial.receipt.completion, "PARTIAL");
  assert.deepEqual(partial.items.map(item => item.status), ["saved", "failed", "saved"]);
  const photoIds = partial.receipt.memories.map(memory => memory.memoryId);
  f.mock.setScenario("success");
  const complete = await photos.retry([selected[1].id]);
  assert.equal(complete.savedCount, 3);
  assert.equal(complete.complete, true);
  assert.equal(complete.contributionId, partial.contributionId);
  assert.deepEqual(complete.receipt.memories.map(memory => memory.memoryId), photoIds);
  for (const index of [0, 2]) {
    assert.equal(f.uploads.filter(attempt => attempt.memoryId === photoIds[index]).length, 1,
      "confirmed photo siblings must not be transferred again");
  }
  assert.deepEqual(f.uploads.filter(attempt => attempt.memoryId === photoIds[1]).map(attempt => attempt.confirmed), [false, true]);
  assert.ok(f.uploads.filter(attempt => photoIds.includes(attempt.memoryId)).every(attempt =>
    attempt.file === selected[photoIds.indexOf(attempt.memoryId)].file));

  const clip = new File(["synthetic private audio bytes"], "wish.webm", { type: "audio/webm" });
  const voice = await audio.submit({ guestName: " ", file: clip, durationSeconds: 2.5, caption: " Voice wish " });
  assert.equal(voice.completion, "COMPLETE");
  const voiceId = voice.memories[0].memoryId;
  assert.equal(f.uploads.find(attempt => attempt.memoryId === voiceId).file, clip);

  const anonymousId = anonymousNote.memories[0].memoryId;
  const namedId = namedNote.memories[0].memoryId;
  await assert.rejects(f.api.listMemories(), { code: "AUTH_REQUIRED", status: 401 });
  await assert.rejects(f.api.getMemory(anonymousId), { code: "AUTH_REQUIRED", status: 401 });
  await f.controller.loadSession();
  assert.equal(f.controller.getSnapshot().phase, "login");
  await f.controller.login({ username: "synthetic-couple", password: "synthetic-password" });
  const rows = new Map(f.controller.getSnapshot().items.map(memory => [memory.memoryId, memory]));
  const expected = [anonymousId, namedId, ...photoIds, voiceId];
  assert.equal(f.controller.getSnapshot().items.filter(memory => expected.includes(memory.memoryId)).length, expected.length,
    "lost-response retry must not create a duplicate note");
  assert.equal(new Set(expected.map(id => rows.get(id).contributionId)).size, 4);
  assert.equal(rows.get(anonymousId).contributionId, anonymousNote.contributionId);
  assert.equal(rows.get(anonymousId).guestName, null);
  assert.equal(rows.get(anonymousId).textContent, "An anonymous wedding wish.");
  assert.equal(rows.get(namedId).contributionId, namedNote.contributionId);
  assert.equal(rows.get(namedId).guestName, "Named Guest");
  assert.equal(rows.get(namedId).textContent, "A named wedding wish.");
  photoIds.forEach((id, index) => {
    assert.equal(rows.get(id).contributionId, complete.contributionId);
    assert.equal(rows.get(id).guestName, "Photo Guest");
    assert.equal(rows.get(id).caption, index === 0 ? "First photo caption" : null);
    assert.equal(rows.get(id).media.originalFilename, selected[index].file.name);
  });
  assert.equal(rows.get(voiceId).contributionId, voice.contributionId);
  assert.equal(rows.get(voiceId).guestName, null);
  assert.equal(rows.get(voiceId).caption, "Voice wish");
  assert.equal(rows.get(voiceId).media.durationSeconds, 2.5);
  assert.ok(expected.every(id => rows.get(id).visibility === "COUPLE_ONLY" && rows.get(id).reviewStatus === "PENDING"));

  await f.controller.openMemory(namedId);
  for (const status of ["KEEP", "ARCHIVED", "PENDING"]) {
    await f.controller.reviewMemory(status);
    assert.equal(f.controller.getSnapshot().detail.reviewStatus, status);
    assert.equal(f.controller.getSnapshot().detail.visibility, "COUPLE_ONLY");
    await f.controller.backToInbox();
    await f.controller.loadInbox(status);
    assert.ok(f.controller.getSnapshot().items.some(memory => memory.memoryId === namedId));
    assert.ok(f.controller.getSnapshot().items.every(memory => memory.reviewStatus === status));
    await f.controller.openMemory(namedId);
  }
  assert.equal(f.controller.getSnapshot().detail.revision, 4);

  await f.controller.openMemory(photoIds[0]);
  assert.equal(f.controller.getSnapshot().photo.phase, "ready");
  assert.deepEqual(new Uint8Array(await f.created.at(-1).blob.arrayBuffer()),
    new Uint8Array(await selected[0].file.arrayBuffer()));
  await f.controller.reviewMemory("KEEP");
  await f.controller.backToInbox();
  await f.controller.loadInbox("KEEP");
  assert.deepEqual(f.controller.getSnapshot().items.map(memory => memory.memoryId), [photoIds[0]]);

  await f.controller.openMemory(voiceId);
  assert.equal(f.controller.getSnapshot().photo.phase, "ready");
  assert.equal(f.created.at(-1).blob.type, "audio/webm");
  assert.deepEqual(new Uint8Array(await f.created.at(-1).blob.arrayBuffer()), new Uint8Array(await clip.arrayBuffer()));
  const audioPreview = f.controller.getSnapshot().photo.url;
  await f.controller.reviewMemory("DELETE");
  let state = f.controller.getSnapshot();
  assert.equal(state.detail.revision, 2);
  assert.equal(state.detail.deleteAfter, new Date(f.time + 30 * 86400000).toISOString());
  assert.equal(state.photo.url, null);
  assert.ok(f.revoked.includes(audioPreview));
  await assert.rejects(f.api.getPlayback(voiceId), { code: "NOT_FOUND", status: 404 });
  await f.controller.backToInbox();
  await f.controller.loadInbox("PENDING");
  assert.ok(!f.controller.getSnapshot().items.some(memory => memory.memoryId === voiceId));
  await f.controller.loadInbox("DELETE");
  assert.deepEqual(f.controller.getSnapshot().items.map(memory => memory.memoryId), [voiceId]);
  const beforeDeletedOpen = f.downloads.length;
  await f.controller.openMemory(voiceId);
  assert.equal(f.downloads.length, beforeDeletedOpen, "recoverable deleted audio cannot request playback");
  await f.controller.reviewMemory("PENDING");
  state = f.controller.getSnapshot();
  assert.equal(state.detail.revision, 3);
  assert.equal(state.detail.deleteAfter, null);
  assert.equal(state.photo.phase, "ready");
  assert.notEqual(state.photo.url, audioPreview);
  assert.ok((await f.api.listMemories()).items.some(memory => memory.memoryId === voiceId));
  assert.equal((await f.api.listMemories({ reviewStatus: "DELETE" })).items.length, 0);

  const signingOut = f.controller.logout();
  state = f.controller.getSnapshot();
  assert.equal(state.session, null);
  assert.equal(state.detail, null);
  assert.equal(state.photo.url, null);
  assert.equal(state.items.length, 0);
  await signingOut;
  assert.equal(f.controller.getSnapshot().phase, "login");
  assert.equal(f.controller.getSnapshot().logoutUnconfirmed, false);
  await assert.rejects(f.api.getMemory(voiceId), { code: "AUTH_REQUIRED", status: 401 });
  await assert.rejects(f.api.getPlayback(voiceId), { code: "AUTH_REQUIRED", status: 401 });
  assert.equal(f.revoked.length, f.created.length);
  assert.equal(new Set(f.revoked).size, f.created.length, "each owned original preview is revoked exactly once");
  assert.ok(f.downloads.every(({ request }) => request.credentials === "omit" && request.redirect === "error"
    && request.cache === "no-store" && request.referrerPolicy === "no-referrer"));
  assert.ok(!JSON.stringify(f.controller.getSnapshot()).includes("https://playback.example.test/"));
});
