import test from "node:test";
import assert from "node:assert/strict";
import * as archive from "./archiveApi.js";
import { IDS, MEMORY_DETAIL, PHOTO_REQUEST, TEXT_RECEIPT, TEXT_REQUEST, UPLOAD_GRANT } from "./v1/fixtures.js";

test("archive facade retains its named exports and complete ordered method surface", () => {
  assert.deepEqual(Object.keys(archive), ["createArchiveApi", "decodeReceipt", "normalizeMediaContribution", "normalizeTextContribution"]);
  const methods = `listAlbums getAlbum createAlbum renameAlbum deleteAlbum listAlbumMembers addAlbumMember removeAlbumMember moveAlbumMember
    listTimelineEvents getTimelineEvent createTimelineEvent updateTimelineEvent deleteTimelineEvent listTimelineMemories linkTimelineMemory unlinkTimelineMemory
    listLibraryMemories listTags getTag createTag renameTag deleteTag listTagMembers listMemoryTags attachTag removeTag
    getCurrentExport createExport getExport getExportAttempt prepareExportPart cancelExport listExportParts listExportIssues downloadExportPart
    listPublicMemories getSharedMemory getSharedPlayback createShareLink
    createCoupleTextContribution createCoupleMediaContribution getCoupleReceipt authorizeCoupleUpload finalizeCoupleUpload
    createTextContribution createMediaContribution getReceipt authorizeUpload reportUploadFailure uploadMedia finalizeUpload
    getSession login changePassword logout listMemories getMemory updateMemoryMetadata reviewMemory getPlayback`.split(/\s+/);
  const api = archive.createArchiveApi();
  assert.deepEqual(Object.keys(api), methods);
  assert.ok(Object.values(api).every(method => typeof method === "function"));
});

test("facade instances retain their captured upload and export fetches independently of later global changes", async () => {
  const bytes = new Uint8Array([80, 75, 3, 4]);
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const part = { partNumber: 1, generation: IDS.grant, byteSize: bytes.length, sha256, filename: "synthetic-archive.zip" };
  const calls = [];
  const transport = name => async (url, options) => {
    calls.push({ name, url, options });
    return options.method === "PUT" ? new Response(null, { status: 200 }) : new Response(bytes, { headers: {
      "Content-Type": "application/zip", "Content-Length": String(bytes.length), "X-Archive-SHA256": sha256,
      "Content-Disposition": 'attachment; filename="' + part.filename + '"',
    } });
  };
  const originalFetch = globalThis.fetch;
  const client = { request() { throw new Error("Binary transfers do not use the JSON client."); } };
  const signal = new AbortController().signal;
  const file = new Blob(["synthetic original"]);
  const grant = { ...UPLOAD_GRANT, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  try {
    globalThis.fetch = transport("first");
    const first = archive.createArchiveApi({ client });
    globalThis.fetch = transport("second");
    const second = archive.createArchiveApi({ client });
    globalThis.fetch = () => { throw new Error("A later global fetch must not replace captured transports."); };
    for (const api of [first, second]) {
      assert.deepEqual(await api.uploadMedia(grant, file, { signal }), { transferred: true });
      const blob = await api.downloadExportPart(IDS.contribution, part, { signal });
      assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
    }
    assert.deepEqual(calls.map(call => call.name), ["first", "first", "second", "second"]);
    for (const call of calls) {
      assert.equal(call.options.signal, signal);
      assert.equal(call.options.redirect, "error");
      if (call.options.method === "PUT") {
        assert.equal(call.url, grant.uploadUrl); assert.equal(call.options.body, file);
        assert.equal(call.options.credentials, "omit"); assert.equal(call.options.headers, grant.headers);
      } else {
        assert.equal(call.url, `/api/exports/${IDS.contribution}/parts/1/download?generation=${IDS.grant}`);
        assert.equal(call.options.credentials, "same-origin"); assert.equal(call.options.referrerPolicy, "no-referrer");
      }
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("facade preserves legacy UUID casing while normalizing v4 retry keys and submitted item IDs", () => {
  const legacyId = "AAAAAAAA-BBBB-1CCC-8DDD-EEEEEEEEEEEE";
  const retryKey = "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE";
  const api = archive.createArchiveApi({ client: { request: (path, options) => ({ path, options }) } });
  const receipt = api.getReceipt(legacyId, { idempotencyKey: retryKey });
  assert.equal(receipt.path, `/api/contributions/${legacyId}/receipt`);
  assert.equal(receipt.options.headers["Idempotency-Key"], retryKey.toLowerCase());
  const currentReceipt = { ...TEXT_RECEIPT, contributionId: legacyId };
  assert.equal(receipt.options.decode(currentReceipt), currentReceipt);
  const canonicalReceipt = {
    ...currentReceipt,
    contributionId: legacyId.toLowerCase(),
  };
  assert.equal(receipt.options.decode(canonicalReceipt), canonicalReceipt);
  assert.throws(() => receipt.options.decode(TEXT_RECEIPT), {
    code: "CONTRACT_MISMATCH",
  });
  const memory = api.getMemory(legacyId);
  assert.equal(memory.path, `/api/memories/${legacyId}`);
  const currentMemory = { ...MEMORY_DETAIL, memoryId: legacyId };
  assert.equal(memory.options.decode(currentMemory), currentMemory);
  const canonicalMemory = {
    ...currentMemory,
    memoryId: legacyId.toLowerCase(),
  };
  assert.equal(memory.options.decode(canonicalMemory), canonicalMemory);
  assert.throws(() => memory.options.decode(MEMORY_DETAIL), {
    code: "CONTRACT_MISMATCH",
  });
  const photo = { ...PHOTO_REQUEST.items[0], clientItemId: legacyId };
  const payload = { ...PHOTO_REQUEST, items: [photo] };
  assert.equal(archive.normalizeMediaContribution(payload).items[0].clientItemId, legacyId.toLowerCase());
  assert.throws(() => archive.normalizeMediaContribution({ ...payload, items: [photo, { ...photo, clientItemId: legacyId.toLowerCase() }] }), {
    code: "VALIDATION_FAILED",
  });
});

test("facade validates competing invalid inputs in their existing order before transport", () => {
  let calls = 0;
  const api = archive.createArchiveApi({ client: { request() { calls++; } } });
  assert.throws(() => api.createTextContribution({ message: "" }, { idempotencyKey: "bad" }), { code: "VALIDATION_FAILED" });
  assert.throws(() => api.createCoupleTextContribution({ ...TEXT_REQUEST, guestName: "Example Guest" }, {
    csrfToken: "bad", idempotencyKey: "bad",
  }), { name: "TypeError", message: "Private memories do not have a guest name." });
  assert.throws(() => api.createCoupleTextContribution(TEXT_REQUEST, { csrfToken: "bad", idempotencyKey: "bad" }), {
    name: "TypeError", message: "Use the CSRF token returned by getSession().",
  });
  assert.throws(() => api.finalizeCoupleUpload(IDS.contribution, IDS.photo, "bad", { csrfToken: "bad", idempotencyKey: "bad" }), {
    name: "TypeError", message: "A valid UUID is required.",
  });
  assert.throws(() => api.updateMemoryMetadata("bad", {}, { revision: 0, csrfToken: "bad" }), {
    name: "TypeError", message: "Supply the latest memory revision.",
  });
  assert.equal(calls, 0);
});
