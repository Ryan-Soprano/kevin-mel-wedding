import test from "node:test";
import assert from "node:assert/strict";
import { createPhotoSubmission } from "./photoSubmission.js";
import { ApiError } from "../../../shared/api/apiClient.js";
import { normalizeMediaContribution } from "../../../shared/api/archiveApi.js";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const file = new File([new Uint8Array([1, 2, 3])], "private.png", { type: "image/png" });
const raw = { file, guestName: " Guest ", caption: " caption " };
const pending = { contributionId: id, completion: "PENDING", memories: [{ memoryId: id, clientItemId: id, uploadState: "PENDING" }] };
const done = { ...pending, completion: "COMPLETE", memories: [{ ...pending.memories[0], uploadState: "UPLOADED" }] };
const grant = { grantId: id };
const unknown = () => new ApiError("Unconfirmed", { code: "REQUEST_FAILED", unknownOutcome: true });

function fixture(overrides = {}) {
  const calls = []; let hashes = 0, ids = 0, receipt = pending;
  const api = {
    createMediaContribution: async (...args) => { calls.push(["create", ...args]); return receipt; },
    getReceipt: async (...args) => { calls.push(["receipt", ...args]); return receipt; },
    authorizeUpload: async (...args) => { calls.push(["grant", ...args]); return grant; },
    uploadMedia: async (...args) => { calls.push(["upload", ...args]); },
    finalizeUpload: async (...args) => { calls.push(["finalize", ...args]); receipt = done; return done; },
    ...overrides,
  };
  const submission = createPhotoSubmission({ api, randomUUID: () => { ids++; return id; }, digest: async () => { hashes++; return "1".repeat(64); } });
  return { submission, calls, api, get hashes() { return hashes; }, get ids() { return ids; }, set receipt(value) { receipt = value; } };
}

test("repeated taps share one original, checksum and intent; completion needs explicit start another", async () => {
  const f = fixture(); const first = f.submission.submit(raw);
  assert.equal(f.submission.submit(raw), first);
  assert.equal(await first, done);
  assert.deepEqual(f.calls.map(c => c[0]), ["create", "grant", "upload", "finalize"]);
  assert.equal(f.calls[2][2], file);
  assert.equal(f.hashes, 1); assert.equal(f.ids, 2);
  assert.equal(f.calls[0][1].guestName, "Guest"); assert.equal(f.calls[0][1].items[0].caption, "caption");
  await f.submission.submit(raw); assert.equal(f.calls.length, 4);
  f.submission.startAnother(); assert.equal(f.submission.pending, false);
});

test("lost intent response replays same frozen metadata/key without rehashing or rotating IDs", async () => {
  let attempts = 0; const bodies = [];
  const f = fixture({ createMediaContribution: async (...args) => { bodies.push(args); if (++attempts === 1) throw unknown(); return pending; } });
  await assert.rejects(f.submission.submit(raw), { unknownOutcome: true });
  assert.equal(f.submission.pending, true); assert.throws(() => f.submission.startAnother());
  assert.throws(() => f.submission.submit({ ...raw, caption: "changed" }), { code: "DRAFT_CHANGED" });
  assert.throws(() => f.submission.submit({ ...raw, file: new File([file], file.name, { type: file.type }) }), { code: "DRAFT_CHANGED" });
  await f.submission.submit(raw);
  assert.deepEqual(bodies[0], bodies[1]); assert.equal(f.hashes, 1); assert.equal(f.ids, 2);
});

test("lost PUT response checks receipt and finalizes existing grant before transferring again", async () => {
  const f = fixture({ uploadMedia: async () => { throw unknown(); } });
  await assert.rejects(f.submission.submit(raw));
  const recovered = await f.submission.submit(raw);
  assert.equal(recovered, done);
  assert.deepEqual(f.calls.map(c => c[0]), ["create", "grant", "receipt", "finalize"]);
  assert.equal(f.hashes, 1);
});

test("lost finalize response recovers committed receipt without a second upload", async () => {
  const f = fixture({ finalizeUpload: async () => { f.receipt = done; throw unknown(); } });
  await assert.rejects(f.submission.submit(raw)); assert.equal(f.submission.complete, false);
  assert.equal(await f.submission.submit(raw), done);
  assert.deepEqual(f.calls.map(c => c[0]), ["create", "grant", "upload", "receipt"]);
});

for (const code of ["UPLOAD_INCOMPLETE", "UPLOAD_GRANT_EXPIRED"]) {
  test(code + " renews only the grant for the retained intent and original", async () => {
    let checks = 0;
    const f = fixture({ uploadMedia: async () => { if (!checks) throw unknown(); },
      finalizeUpload: async () => { if (++checks === 1) throw new ApiError("Retry", { code, status: code === "UPLOAD_INCOMPLETE" ? 409 : 410 }); return done; } });
    await assert.rejects(f.submission.submit(raw));
    assert.equal(await f.submission.submit(raw), done);
    assert.equal(f.calls.filter(c => c[0] === "grant").length, 2);
    assert.equal(f.calls.filter(c => c[0] === "create").length, 1);
    assert.equal(f.hashes, 1); assert.equal(f.ids, 2);
  });
}

test("an incomplete finalize receipt never produces a saved state", async () => {
  const f = fixture({ finalizeUpload: async () => pending });
  await assert.rejects(f.submission.submit(raw), { code: "UPLOAD_INCOMPLETE", unknownOutcome: true });
  assert.equal(f.submission.complete, false); assert.equal(f.submission.pending, true);
});

test("known invalid bytes permit explicit replacement; unavailable bytes retain intent", async () => {
  const f = fixture({ finalizeUpload: async () => { throw new ApiError("Invalid", { code: "INVALID_MEDIA", status: 422 }); } });
  await assert.rejects(f.submission.submit(raw)); assert.equal(f.submission.failed, true);
  f.submission.startAnother(); assert.equal(f.submission.pending, false);
  const uncertain = fixture({ finalizeUpload: async () => { throw new ApiError("Unavailable", { code: "MEDIA_UNAVAILABLE", status: 503 }); } });
  await assert.rejects(uncertain.submission.submit(raw)); assert.equal(uncertain.submission.failed, false);
  assert.throws(() => uncertain.submission.startAnother());
});

test("validation happens before allocating IDs or sending network requests", async () => {
  const f = fixture();
  for (const value of [null, new File([], "empty.png", { type: "image/png" }), new File([file], "phone.heic", { type: "image/heic" })]) {
    assert.throws(() => f.submission.submit({ ...raw, file: value }), { code: "VALIDATION_FAILED" });
  }
  assert.throws(() => f.submission.submit({ ...raw, guestName: " ".repeat(101) }), { code: "VALIDATION_FAILED" });
  assert.equal(f.ids, 0); assert.equal(f.hashes, 0); assert.equal(f.calls.length, 0);
});

test("media normalization rejects controls, nonrepresentable strings and case-folded duplicate IDs", () => {
  const item = { clientItemId: id, originalFilename: "ok.png", declaredContentType: "image/png", byteSize: 1, checksumSha256: "0".repeat(64) };
  const payload = { memoryType: "PHOTO", items: [item] };
  for (const field of ["originalFilename", "caption"]) {
    for (const text of ["\u0000", "\ud800"]) assert.throws(() => normalizeMediaContribution({ ...payload, items: [{ ...item, [field]: text }] }));
  }
  assert.throws(() => normalizeMediaContribution({ ...payload, items: [{ ...item, originalFilename: "x\t.png" }] }));
  assert.throws(() => normalizeMediaContribution({ ...payload, guestName: "\ud800" }));
  assert.throws(() => normalizeMediaContribution({ ...payload, items: [item, { ...item, clientItemId: id.toUpperCase() }] }));
});

test("429 respects retry delay without automatic transfer or key rotation", async () => {
  let now = 0, calls = 0;
  const f = createPhotoSubmission({ now: () => now, randomUUID: () => id, digest: async () => "0".repeat(64),
    api: { createMediaContribution: async () => { calls++; throw new ApiError("Wait", { code: "RATE_LIMITED", status: 429, retryAfterSeconds: 10 }); } } });
  await assert.rejects(f.submit(raw)); assert.equal(f.retryAfterSeconds, 10);
  assert.throws(() => f.submit(raw), { status: 429 }); assert.equal(calls, 1);
  now = 10_000; await assert.rejects(f.submit(raw)); assert.equal(calls, 2);
});

test("503 finalizer delay retains original bytes and recovers with the existing grant after deliberate retry", async () => {
  let time = 0, attempts = 0;
  const f = fixture({ finalizeUpload: async (...args) => {
    f.calls.push(["finalize", ...args]);
    if (++attempts === 1) throw new ApiError("Busy", {
      code: "MEDIA_UNAVAILABLE", status: 503, retryAfterSeconds: 5, unknownOutcome: true,
    });
    f.receipt = done; return done;
  } });
  const submission = createPhotoSubmission({ api: f.api, now: () => time,
    randomUUID: () => id, digest: async () => "1".repeat(64) });
  await assert.rejects(submission.submit(raw), { status: 503, retryAfterSeconds: 5 });
  assert.equal(submission.complete, false); assert.equal(submission.pending, true);
  assert.throws(() => submission.startAnother());
  const before = f.calls.length;
  assert.throws(() => submission.submit(raw), { status: 429, retryAfterSeconds: 5 });
  assert.equal(f.calls.length, before);
  time = 5000; assert.equal(f.calls.length, before);
  assert.equal(await submission.submit(raw), done);
  assert.deepEqual(f.calls.slice(before).map(call => call[0]), ["receipt", "finalize"]);
  assert.equal(f.calls.filter(call => call[0] === "upload").length, 1);
  assert.equal(f.calls.filter(call => call[0] === "finalize")[1][3], grant.grantId);
});
