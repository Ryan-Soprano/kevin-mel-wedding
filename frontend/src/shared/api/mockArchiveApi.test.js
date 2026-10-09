import test from "node:test";
import assert from "node:assert/strict";
import { createMockArchiveApi } from "./mockArchiveApi.js";
import { AUDIO_REQUEST, IDS, PHOTO_REQUEST, SCENARIOS, TEXT_REQUEST } from "./v1/fixtures.js";

const options = { idempotencyKey: IDS.key };
async function signIn(api) {
  const anonymous = await api.getSession();
  return api.login({ username: "synthetic", password: "synthetic" }, { csrfToken: anonymous.csrfToken });
}
async function transfer(api, receipt, index = 0) {
  const memory = receipt.memories[index];
  const grant = await api.authorizeUpload(receipt.contributionId, memory.memoryId, options);
  await api.uploadMedia(grant, new Blob(["synthetic bytes"]));
  return { grant, memory };
}
async function finalize(api, receipt, transfer) {
  return api.finalizeUpload(receipt.contributionId, transfer.memory.memoryId, transfer.grant.grantId, options);
}

test("mock and real adapters expose the same feature methods", () => {
  const api = createMockArchiveApi();
  for (const method of ["createTextContribution", "createMediaContribution", "getReceipt",
    "authorizeUpload", "uploadMedia", "finalizeUpload", "getSession", "login", "logout",
    "listMemories", "getMemory", "reviewMemory", "getPlayback"]) assert.equal(typeof api[method], "function");
  assert.throws(() => api.setScenario("unknown"), TypeError);
  assert.equal(SCENARIOS.length, 14);
});

test("same normalized content/key returns original IDs; changed payload conflicts", async () => {
  const api = createMockArchiveApi();
  const original = await api.createTextContribution(TEXT_REQUEST, options);
  const replay = await api.createTextContribution({ ...TEXT_REQUEST, message: " " + TEXT_REQUEST.message + " " }, options);
  assert.deepEqual(replay, original);
  assert.equal(original.completion, "COMPLETE");
  assert.equal(original.memories[0].reviewStatus, "PENDING");
  assert.equal(original.memories[0].visibility, "COUPLE_ONLY");
  await assert.rejects(api.createTextContribution({ message: "Changed" }, options), { code: "IDEMPOTENCY_CONFLICT", status: 409 });
  assert.deepEqual(await api.getReceipt(original.contributionId, options), original);
});

test("lost response after commit is recovered with the same key, not a second submission", async () => {
  const api = createMockArchiveApi({ scenario: "uncertainSubmission" });
  await assert.rejects(api.createTextContribution(TEXT_REQUEST, options), { code: "NETWORK_ERROR", unknownOutcome: true });
  const recovered = await api.createTextContribution(TEXT_REQUEST, options);
  assert.equal(recovered.completion, "COMPLETE");
  await signIn(api);
  const page = await api.listMemories();
  assert.equal(page.items.filter((item) => item.contributionId === recovered.contributionId).length, 1);
});

for (const [scenario, code, status] of [
  ["validation", "VALIDATION_FAILED", 400],
  ["rateLimited", "RATE_LIMITED", 429],
  ["unavailable", "SERVICE_UNAVAILABLE", 503],
  ["networkError", "NETWORK_ERROR", 0],
]) {
  test("scenario " + scenario + " yields the expected safe error", async () => {
    const api = createMockArchiveApi({ scenario });
    await assert.rejects(api.createTextContribution(TEXT_REQUEST, options), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.status, status);
      if (scenario === "rateLimited") assert.equal(error.retryAfterSeconds, 30);
      return true;
    });
  });
}

test("slow scenario supports cancellation without declaring a rolled-back mutation", async () => {
  const api = createMockArchiveApi({ scenario: "slow" });
  const controller = new AbortController();
  const pending = api.createTextContribution(TEXT_REQUEST, { ...options, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { code: "REQUEST_ABORTED", unknownOutcome: true });
});

test("transfer alone is not saved; only successful finalize updates the receipt", async () => {
  const api = createMockArchiveApi();
  const receipt = await api.createMediaContribution(PHOTO_REQUEST, options);
  const transferred = await transfer(api, receipt);
  assert.equal((await api.getReceipt(receipt.contributionId, options)).completion, "PENDING");
  const partial = await finalize(api, receipt, transferred);
  assert.equal(partial.completion, "PARTIAL");
  assert.equal(partial.memories[0].uploadState, "UPLOADED");
  assert.deepEqual(await finalize(api, receipt, transferred), partial);
  await assert.rejects(api.authorizeUpload(receipt.contributionId, transferred.memory.memoryId, options), { code: "ALREADY_COMPLETE" });
});

test("partial batches retry only the failed transfer and retain original IDs", async () => {
  const api = createMockArchiveApi({ scenario: "partialUpload" });
  const receipt = await api.createMediaContribution(PHOTO_REQUEST, options);
  await finalize(api, receipt, await transfer(api, receipt));
  await assert.rejects(transfer(api, receipt, 1), { code: "UPLOAD_FAILED" });
  const partial = await api.getReceipt(receipt.contributionId, options);
  assert.equal(partial.completion, "PARTIAL");
  assert.equal(partial.memories[0].uploadState, "UPLOADED");
  assert.equal(partial.memories[1].uploadState, "PENDING");
  const complete = await finalize(api, receipt, await transfer(api, receipt, 1));
  assert.equal(complete.completion, "COMPLETE");
  assert.deepEqual(complete.memories.map((m) => m.memoryId), receipt.memories.map((m) => m.memoryId));
  await signIn(api);
  const stored = await api.getMemory(complete.memories[1].memoryId);
  assert.equal(stored.media.originalFilename, PHOTO_REQUEST.items[1].originalFilename);
  assert.equal(stored.media.detectedContentType, "image/png");
});

test("saved items replay expired grants without accepting foreign ownership or expired unfinished siblings", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const api = createMockArchiveApi();
  const receipt = await api.createMediaContribution(PHOTO_REQUEST, options);
  const firstTransfer = await transfer(api, receipt);
  const partial = await finalize(api, receipt, firstTransfer);
  const secondTransfer = await transfer(api, receipt, 1);
  now += 300000;

  assert.deepEqual(await finalize(api, receipt, firstTransfer), partial);
  await assert.rejects(api.finalizeUpload(receipt.contributionId,
    firstTransfer.memory.memoryId, secondTransfer.grant.grantId, options), {
    code: "NOT_FOUND", status: 404,
  });
  await assert.rejects(api.finalizeUpload(receipt.contributionId,
    firstTransfer.memory.memoryId, firstTransfer.grant.grantId,
    { idempotencyKey: IDS.clientItem }), { code: "NOT_FOUND", status: 404 });
  await assert.rejects(finalize(api, receipt, secondTransfer), {
    code: "UPLOAD_GRANT_EXPIRED", status: 410,
  });

  // Replaying a confirmed original must not inspect or reject temporary bytes again.
  api.setScenario("invalidMedia");
  assert.deepEqual(await finalize(api, receipt, firstTransfer), partial);
  assert.deepEqual(await api.getReceipt(receipt.contributionId, options), partial);
  api.setScenario("success");
  await signIn(api);
  const page = await api.listMemories();
  assert.equal(page.items.filter((item) => item.contributionId === receipt.contributionId).length, 1);
});

test("expired grants renew against the same item; premature finalization fails", async () => {
  const api = createMockArchiveApi({ scenario: "expiredGrant" });
  const receipt = await api.createMediaContribution(AUDIO_REQUEST, options);
  const memory = receipt.memories[0];
  const grant = await api.authorizeUpload(receipt.contributionId, memory.memoryId, options);
  await assert.rejects(api.uploadMedia(grant, new Blob()), { code: "UPLOAD_GRANT_EXPIRED", status: 410 });
  await assert.rejects(api.finalizeUpload(receipt.contributionId, memory.memoryId, grant.grantId, options), { code: "UPLOAD_GRANT_EXPIRED" });
  api.setScenario("success");
  const renewed = await api.authorizeUpload(receipt.contributionId, memory.memoryId, options);
  await assert.rejects(api.finalizeUpload(receipt.contributionId, memory.memoryId, renewed.grantId, options), { code: "UPLOAD_INCOMPLETE" });
  await api.uploadMedia(renewed, new Blob());
  const complete = await api.finalizeUpload(receipt.contributionId, memory.memoryId, renewed.grantId, options);
  assert.equal(complete.memories[0].memoryId, memory.memoryId);
  await signIn(api);
  assert.equal((await api.getMemory(memory.memoryId)).media.durationSeconds, 12);
});

test("wrong submission capability cannot inspect receipts or authorize uploads", async () => {
  const api = createMockArchiveApi();
  const receipt = await api.createMediaContribution(PHOTO_REQUEST, options);
  const wrongKey = { idempotencyKey: IDS.clientItem };
  await assert.rejects(api.getReceipt(receipt.contributionId, wrongKey), { code: "NOT_FOUND" });
  await assert.rejects(api.authorizeUpload(receipt.contributionId, receipt.memories[0].memoryId, wrongKey), { code: "NOT_FOUND" });
});

test("failed verification never marks transferred bytes as saved", async () => {
  const api = createMockArchiveApi({ scenario: "invalidMedia" });
  const receipt = await api.createMediaContribution(PHOTO_REQUEST, options);
  await assert.rejects(finalize(api, receipt, await transfer(api, receipt)), { code: "INVALID_MEDIA", status: 422 });
  const failed = await api.getReceipt(receipt.contributionId, options);
  assert.equal(failed.completion, "PENDING");
  assert.equal(failed.memories[0].uploadState, "FAILED");
});

test("session rotation, authorization, logout, and CSRF are enforced by the mock", async () => {
  const api = createMockArchiveApi();
  await assert.rejects(api.listMemories(), { code: "AUTH_REQUIRED", status: 401 });
  const anonymous = await api.getSession();
  await assert.rejects(api.login({ username: "x", password: "x" }, { csrfToken: "wrong-but-long-token" }), { code: "CSRF_INVALID" });
  const session = await signIn(api);
  assert.notEqual(session.csrfToken, anonymous.csrfToken);
  api.setScenario("forbidden");
  await assert.rejects(api.listMemories(), { code: "ARCHIVE_UNAVAILABLE", status: 403 });
  api.setScenario("success");
  await api.logout({ csrfToken: session.csrfToken });
  await assert.rejects(api.listMemories(), { code: "AUTH_REQUIRED" });
});

test("every successful login and logout rotates tokens without reviving stale sessions", async () => {
  const api = createMockArchiveApi();
  const credentials = { username: "synthetic", password: "synthetic" };
  const seenTokens = new Set();
  let anonymous = await api.getSession();
  seenTokens.add(anonymous.csrfToken);

  for (let cycle = 0; cycle < 3; cycle++) {
    const session = await api.login(credentials, { csrfToken: anonymous.csrfToken });
    assert.equal(seenTokens.has(session.csrfToken), false);
    for (const csrfToken of seenTokens) {
      await assert.rejects(api.logout({ csrfToken }), { code: "CSRF_INVALID", status: 403 });
      await assert.rejects(api.reviewMemory(IDS.text, { reviewStatus: "KEEP", revision: 1 }, { csrfToken }), {
        code: "CSRF_INVALID", status: 403,
      });
    }
    seenTokens.add(session.csrfToken);
    await api.logout({ csrfToken: session.csrfToken });
    anonymous = await api.getSession();
    assert.equal(anonymous.authenticated, false);
    assert.equal(seenTokens.has(anonymous.csrfToken), false);
    for (const csrfToken of seenTokens) {
      await assert.rejects(api.login(credentials, { csrfToken }), { code: "CSRF_INVALID", status: 403 });
    }
    seenTokens.add(anonymous.csrfToken);
  }
});

test("repeated login rotates tokens; rejected credentials leave the current session unchanged", async () => {
  const api = createMockArchiveApi();
  const first = await signIn(api);
  const second = await signIn(api);
  assert.notEqual(second.csrfToken, first.csrfToken);
  await assert.rejects(api.logout({ csrfToken: first.csrfToken }), { code: "CSRF_INVALID" });
  api.setScenario("unauthenticated");
  await assert.rejects(signIn(api), { code: "INVALID_CREDENTIALS" });
  assert.deepEqual(await api.getSession(), second);
  api.setScenario("success");
  await api.logout({ csrfToken: second.csrfToken });
});

test("invalid login and empty inbox have deterministic fixtures", async () => {
  const api = createMockArchiveApi({ scenario: "unauthenticated" });
  await assert.rejects(signIn(api), { code: "INVALID_CREDENTIALS", status: 401 });
  api.setScenario("empty");
  await signIn(api);
  assert.deepEqual(await api.listMemories(), { items: [], nextCursor: null });
});

test("cursor pages, stale-review conflicts, private KEEP, and recoverable DELETE", async () => {
  const api = createMockArchiveApi();
  await api.createTextContribution(TEXT_REQUEST, options);
  const session = await signIn(api);
  const page = await api.listMemories({ limit: 1 });
  assert.equal(page.items.length, 1);
  assert.ok(page.nextCursor);
  const next = await api.listMemories({ limit: 1, cursor: page.nextCursor });
  assert.notEqual(next.items[0].memoryId, page.items[0].memoryId);
  assert.equal(next.nextCursor, null);
  const csrf = { csrfToken: session.csrfToken };
  const kept = await api.reviewMemory(IDS.text, { reviewStatus: "KEEP", revision: 1 }, csrf);
  assert.equal(kept.visibility, "COUPLE_ONLY");
  await assert.rejects(api.reviewMemory(IDS.text, { reviewStatus: "ARCHIVED", revision: 1 }, csrf), { code: "REVIEW_CONFLICT", status: 412 });
  const deleted = await api.reviewMemory(IDS.text, { reviewStatus: "DELETE", revision: kept.revision }, csrf);
  assert.equal(Date.parse(deleted.deleteAfter) - Date.parse(deleted.updatedAt), 30 * 86400000);
  const restored = await api.reviewMemory(IDS.text, { reviewStatus: "KEEP", revision: deleted.revision }, csrf);
  assert.equal(restored.deleteAfter, null);
  assert.equal(restored.visibility, "COUPLE_ONLY");
  await assert.rejects(api.reviewMemory(IDS.text, { reviewStatus: "PENDING", revision: restored.revision }, { csrfToken: "wrong-but-long-token" }), { code: "CSRF_INVALID" });
});

test("playback failure does not remove the stored memory", async () => {
  const api = createMockArchiveApi();
  const receipt = await api.createMediaContribution(AUDIO_REQUEST, options);
  await finalize(api, receipt, await transfer(api, receipt));
  await signIn(api);
  const memoryId = receipt.memories[0].memoryId;
  assert.ok((await api.getPlayback(memoryId)).url.startsWith("https:"));
  api.setScenario("playbackUnavailable");
  await assert.rejects(api.getPlayback(memoryId), { code: "MEDIA_UNAVAILABLE", status: 503 });
  assert.equal((await api.getMemory(memoryId)).media.uploadState, "UPLOADED");
});

test("UUID case is canonical across text creation and receipt retries", async () => {
  const api = createMockArchiveApi();
  const key = "abcdefab-cdef-4abc-8abc-abcdefabcdef";
  const original = await api.createTextContribution(TEXT_REQUEST, { idempotencyKey: key.toUpperCase() });
  assert.deepEqual(await api.createTextContribution(TEXT_REQUEST, { idempotencyKey: key }), original);
  assert.deepEqual(await api.getReceipt(original.contributionId, { idempotencyKey: key.toUpperCase() }), original);
});
