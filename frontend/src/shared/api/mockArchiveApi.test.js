import test from "node:test";
import assert from "node:assert/strict";
import { createMockArchiveApi } from "./mockArchiveApi.js";
import { AUDIO_REQUEST, CREATED_AT, IDS, PHOTO_REQUEST, SCENARIOS, TEXT_REQUEST } from "./v1/fixtures.js";

const options = { idempotencyKey: IDS.key };
const DAY = 86400000;
const REVIEW_TIME = Date.parse(CREATED_AT) + DAY;
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

test("unfinished items reuse unexpired grants and renew at the exact server deadline", async (t) => {
  const localTime = Date.now();
  t.mock.method(Date, "now", () => localTime);
  let serverTime = localTime;
  const api = createMockArchiveApi({ now: () => serverTime });
  const receipt = await api.createMediaContribution(PHOTO_REQUEST, options);
  const memoryId = receipt.memories[0].memoryId;
  const grant = await api.authorizeUpload(receipt.contributionId, memoryId, options);
  assert.equal(grant.expiresAt, new Date(serverTime + 300000).toISOString());
  await api.uploadMedia(grant, new Blob(["synthetic bytes"]));

  serverTime += 299999;
  assert.deepEqual(await api.authorizeUpload(receipt.contributionId, memoryId, options), grant);
  const partial = await api.finalizeUpload(receipt.contributionId, memoryId, grant.grantId, options);
  assert.equal(partial.memories[0].uploadState, "UPLOADED");
  assert.equal(partial.memories[1].uploadState, "PENDING");

  const pendingMemoryId = receipt.memories[1].memoryId;
  const pendingGrant = await api.authorizeUpload(receipt.contributionId, pendingMemoryId, options);
  serverTime = Date.parse(pendingGrant.expiresAt);
  await assert.rejects(api.uploadMedia(pendingGrant, new Blob(["synthetic bytes"])), {
    code: "UPLOAD_GRANT_EXPIRED",
    status: 403,
  });
  await assert.rejects(api.finalizeUpload(receipt.contributionId, pendingMemoryId, pendingGrant.grantId, options), {
    code: "UPLOAD_GRANT_EXPIRED",
    status: 410,
  });

  const renewed = await api.authorizeUpload(receipt.contributionId, pendingMemoryId, options);
  assert.notEqual(renewed.grantId, pendingGrant.grantId);
  assert.equal(renewed.expiresAt, new Date(serverTime + 300000).toISOString());
  serverTime -= 1;
  assert.deepEqual(await api.authorizeUpload(receipt.contributionId, pendingMemoryId, options), renewed);
  serverTime += 1;
  await assert.rejects(api.finalizeUpload(receipt.contributionId, pendingMemoryId, renewed.grantId, options), {
    code: "UPLOAD_INCOMPLETE",
    status: 409,
  });
  await api.uploadMedia(renewed, new Blob(["synthetic bytes"]));
  const complete = await api.finalizeUpload(receipt.contributionId, pendingMemoryId, renewed.grantId, options);
  assert.equal(complete.completion, "COMPLETE");
  assert.deepEqual(complete.memories[0], partial.memories[0]);
  assert.equal(complete.memories[1].memoryId, pendingMemoryId);
  assert.equal(complete.memories[1].uploadState, "UPLOADED");
  assert.deepEqual(await api.getReceipt(receipt.contributionId, options), complete);
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
  const api = createMockArchiveApi({ now: () => REVIEW_TIME });
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
  const restored = await api.reviewMemory(IDS.text, { reviewStatus: "PENDING", revision: deleted.revision }, csrf);
  assert.equal(restored.deleteAfter, null);
  assert.equal(restored.visibility, "COUPLE_ONLY");
  assert.equal(restored.reviewStatus, "PENDING");
  assert.equal((await api.listMemories()).items.some((item) => item.memoryId === IDS.text), true);
  await assert.rejects(api.reviewMemory(IDS.text, { reviewStatus: "PENDING", revision: restored.revision }, { csrfToken: "wrong-but-long-token" }), { code: "CSRF_INVALID" });
});

test("same-state reviews preserve the whole memory, and stale same-state requests still conflict", async () => {
  let now = REVIEW_TIME;
  const api = createMockArchiveApi({ now: () => now });
  const session = await signIn(api);
  const csrf = { csrfToken: session.csrfToken };
  let current = await api.getMemory(IDS.text);

  for (const reviewStatus of ["PENDING", "KEEP", "ARCHIVED", "DELETE", "PENDING"]) {
    if (current.reviewStatus !== reviewStatus) {
      const previous = current;
      current = await api.reviewMemory(IDS.text, { reviewStatus, revision: current.revision }, csrf);
      assert.equal(current.revision, previous.revision + 1);
      assert.equal(current.updatedAt, new Date(now).toISOString());
      await assert.rejects(api.reviewMemory(IDS.text, { reviewStatus, revision: previous.revision }, csrf), {
        code: "REVIEW_CONFLICT", status: 412,
      });
    }
    now += DAY;
    assert.deepEqual(await api.reviewMemory(IDS.text, { reviewStatus, revision: current.revision }, csrf), current);
    assert.deepEqual(await api.getMemory(IDS.text), current);
  }
});

test("first DELETE uses server time and repeated DELETE cannot extend its recovery deadline", async () => {
  // Fixture timestamps are in the future; deletion must use server time even when
  // updatedAt is clamped to preserve the fixture's creation ordering.
  let now = Date.parse(CREATED_AT) - DAY;
  const api = createMockArchiveApi({ now: () => now });
  const session = await signIn(api);
  const csrf = { csrfToken: session.csrfToken };
  const deleted = await api.reviewMemory(IDS.text, { reviewStatus: "DELETE", revision: 1 }, csrf);
  assert.equal(deleted.deleteAfter, new Date(now + 30 * DAY).toISOString());
  assert.equal(deleted.updatedAt, CREATED_AT);
  now += 2 * DAY;
  assert.deepEqual(await api.reviewMemory(IDS.text, { reviewStatus: "DELETE", revision: deleted.revision }, csrf), deleted);
  await assert.rejects(api.reviewMemory(IDS.text, { reviewStatus: "DELETE", revision: 1 }, csrf), {
    code: "REVIEW_CONFLICT", status: 412,
  });
  assert.deepEqual((await api.listMemories({ reviewStatus: "DELETE" })).items, [deleted]);
});

test("metadata and review changes preserve updatedAt on clock rollback without extending deletion recovery", async () => {
  let now = REVIEW_TIME;
  const api = createMockArchiveApi({ now: () => now });
  const session = await signIn(api);
  const csrf = { csrfToken: session.csrfToken };
  const metadata = {
    title: "First title",
    description: null,
    memoryDate: null,
    datePrecision: "UNKNOWN",
  };
  const edited = await api.updateMemoryMetadata(IDS.text, metadata, {
    ...csrf,
    revision: 1,
  });

  now -= 3600000;
  const kept = await api.reviewMemory(IDS.text, {
    reviewStatus: "KEEP",
    revision: edited.revision,
  }, csrf);
  assert.equal(kept.updatedAt, edited.updatedAt);
  assert.equal(kept.revision, edited.revision + 1);

  now -= 3600000;
  const renamed = await api.updateMemoryMetadata(IDS.text, {
    ...metadata,
    title: "Second title",
  }, { ...csrf, revision: kept.revision });
  assert.equal(renamed.updatedAt, kept.updatedAt);
  assert.equal(renamed.revision, kept.revision + 1);

  const deleted = await api.reviewMemory(IDS.text, {
    reviewStatus: "DELETE",
    revision: renamed.revision,
  }, csrf);
  assert.equal(deleted.updatedAt, renamed.updatedAt);
  assert.equal(deleted.deleteAfter, new Date(now + 30 * DAY).toISOString());
  now -= 3600000;
  assert.deepEqual(await api.reviewMemory(IDS.text, {
    reviewStatus: "DELETE",
    revision: deleted.revision,
  }, csrf), deleted);
  assert.deepEqual(await api.getMemory(IDS.text), deleted);
});

test("audience changes update memory and receipt together while preserving originals and private review states", async () => {
  const api = createMockArchiveApi({ now: () => REVIEW_TIME });
  const receipt = await api.createTextContribution(TEXT_REQUEST, options);
  const session = await signIn(api);
  const csrf = { csrfToken: session.csrfToken };
  const memoryId = receipt.memories[0].memoryId;
  const original = await api.getMemory(memoryId);
  let current = original;

  for (const [reviewStatus, visibility] of [
    ["KEEP", "PUBLIC"],
    ["KEEP", "FRIENDS_FAMILY"],
    ["ARCHIVED", "COUPLE_ONLY"],
    ["KEEP", "COUPLE_ONLY"],
  ]) {
    const previous = current;
    current = await api.reviewMemory(memoryId, {
      reviewStatus,
      visibility,
      revision: previous.revision,
    }, csrf);
    assert.deepEqual(current, {
      ...original,
      reviewStatus,
      visibility,
      revision: previous.revision + 1,
      updatedAt: new Date(REVIEW_TIME).toISOString(),
    });
    assert.deepEqual((await api.getReceipt(receipt.contributionId, options)).memories, [{
      ...receipt.memories[0],
      reviewStatus,
      visibility,
    }]);
    assert.deepEqual(await api.reviewMemory(memoryId, {
      reviewStatus,
      revision: current.revision,
    }, csrf), current);
    assert.deepEqual(await api.getMemory(memoryId), current);
  }
});

test("deleted text and photos remain recoverable before expiry and disappear at the exact deadline", async () => {
  let now = REVIEW_TIME;
  const api = createMockArchiveApi({ now: () => now });
  const receipt = await api.createMediaContribution(PHOTO_REQUEST, options);
  await finalize(api, receipt, await transfer(api, receipt));
  await finalize(api, receipt, await transfer(api, receipt, 1));
  const session = await signIn(api);
  const csrf = { csrfToken: session.csrfToken };
  const firstPhotoId = receipt.memories[0].memoryId;
  const secondPhotoId = receipt.memories[1].memoryId;
  const deletedText = await api.reviewMemory(IDS.text, { reviewStatus: "DELETE", revision: 1 }, csrf);
  const deletedPhoto = await api.reviewMemory(firstPhotoId, { reviewStatus: "DELETE", revision: 1 }, csrf);
  now += DAY;
  const laterPhoto = await api.reviewMemory(secondPhotoId, { reviewStatus: "DELETE", revision: 1 }, csrf);

  now = Date.parse(deletedText.deleteAfter) - 1;
  const beforeExpiry = await api.listMemories({ reviewStatus: "DELETE", limit: 1 });
  assert.equal(beforeExpiry.items.length, 1);
  assert.ok(beforeExpiry.nextCursor);
  assert.deepEqual(await api.getMemory(IDS.text), deletedText);
  assert.deepEqual(await api.getMemory(firstPhotoId), deletedPhoto);

  now += 1;
  assert.deepEqual(await api.listMemories({ reviewStatus: "DELETE", limit: 1 }), {
    items: [laterPhoto], nextCursor: null,
  });
  for (const memory of [deletedText, deletedPhoto]) {
    await assert.rejects(api.getMemory(memory.memoryId), { code: "NOT_FOUND", status: 404 });
    await assert.rejects(api.reviewMemory(memory.memoryId, {
      reviewStatus: "PENDING", revision: memory.revision,
    }, csrf), { code: "NOT_FOUND", status: 404 });
    await assert.rejects(api.getPlayback(memory.memoryId), { code: "NOT_FOUND", status: 404 });
  }
  now = Date.parse(laterPhoto.deleteAfter);
  assert.deepEqual(await api.listMemories({ reviewStatus: "DELETE" }), { items: [], nextCursor: null });
  await assert.rejects(api.getMemory(secondPhotoId), { code: "NOT_FOUND", status: 404 });
});

test("DELETE prevents photo playback throughout recovery, and restoring to inbox enables it again", async () => {
  let now = REVIEW_TIME;
  const api = createMockArchiveApi({ now: () => now });
  const receipt = await api.createMediaContribution(PHOTO_REQUEST, options);
  await finalize(api, receipt, await transfer(api, receipt));
  const memoryId = receipt.memories[0].memoryId;
  const session = await signIn(api);
  const csrf = { csrfToken: session.csrfToken };
  assert.ok((await api.getPlayback(memoryId)).url.startsWith("https:"));
  const deleted = await api.reviewMemory(memoryId, { reviewStatus: "DELETE", revision: 1 }, csrf);
  await assert.rejects(api.getPlayback(memoryId), { code: "NOT_FOUND", status: 404 });
  api.setScenario("playbackUnavailable");
  await assert.rejects(api.getPlayback(memoryId), { code: "NOT_FOUND", status: 404 });
  api.setScenario("success");
  now += DAY;
  const restored = await api.reviewMemory(memoryId, { reviewStatus: "PENDING", revision: deleted.revision }, csrf);
  assert.equal(restored.deleteAfter, null);
  assert.equal(restored.visibility, "COUPLE_ONLY");
  assert.ok((await api.getPlayback(memoryId)).url.startsWith("https:"));
  assert.equal((await api.listMemories()).items.some((item) => item.memoryId === memoryId), true);
  const deletedAgain = await api.reviewMemory(memoryId, { reviewStatus: "DELETE", revision: restored.revision }, csrf);
  assert.equal(deletedAgain.deleteAfter, new Date(now + 30 * DAY).toISOString());
});

test("concurrent review requests at one revision commit exactly one change", async () => {
  const api = createMockArchiveApi({ now: () => REVIEW_TIME });
  const session = await signIn(api);
  const csrf = { csrfToken: session.csrfToken };
  const results = await Promise.allSettled(["KEEP", "ARCHIVED"].map((reviewStatus) =>
    api.reviewMemory(IDS.text, { reviewStatus, revision: 1 }, csrf)));
  const succeeded = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(succeeded.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, "REVIEW_CONFLICT");
  assert.equal(rejected[0].reason.status, 412);
  assert.equal(succeeded[0].value.revision, 2);
  assert.deepEqual(await api.getMemory(IDS.text), succeeded[0].value);
});

test("lost review responses reconcile from detail and list without replaying a stale mutation", async () => {
  let now = REVIEW_TIME;
  const api = createMockArchiveApi({ now: () => now });
  const session = await signIn(api);
  const csrf = { csrfToken: session.csrfToken };
  api.setScenario("uncertainSubmission");
  await assert.rejects(api.reviewMemory(IDS.text, { reviewStatus: "DELETE", revision: 1 }, csrf), {
    code: "NETWORK_ERROR", unknownOutcome: true,
  });
  const committed = await api.getMemory(IDS.text);
  assert.equal(committed.reviewStatus, "DELETE");
  assert.equal(committed.revision, 2);
  assert.equal(committed.deleteAfter, new Date(now + 30 * DAY).toISOString());
  assert.deepEqual((await api.listMemories({ reviewStatus: "DELETE" })).items, [committed]);
  now += DAY;
  await assert.rejects(api.reviewMemory(IDS.text, { reviewStatus: "DELETE", revision: 1 }, csrf), {
    code: "REVIEW_CONFLICT", status: 412,
  });
  assert.deepEqual(await api.reviewMemory(IDS.text, { reviewStatus: "DELETE", revision: committed.revision }, csrf), committed);
  const restored = await api.reviewMemory(IDS.text, { reviewStatus: "PENDING", revision: committed.revision }, csrf);
  assert.equal(restored.revision, 3);
});

test("same-state no-ops require the current session's CSRF token", async () => {
  const api = createMockArchiveApi({ now: () => REVIEW_TIME });
  const first = await signIn(api);
  const second = await signIn(api);
  const original = await api.getMemory(IDS.text);
  await assert.rejects(api.reviewMemory(IDS.text, { reviewStatus: "PENDING", revision: 1 }, {
    csrfToken: first.csrfToken,
  }), { code: "CSRF_INVALID", status: 403 });
  assert.deepEqual(await api.reviewMemory(IDS.text, { reviewStatus: "PENDING", revision: 1 }, {
    csrfToken: second.csrfToken,
  }), original);
});

test("inbox lists include text and finalized photos/audio while unfinished media remains private", async () => {
  const api = createMockArchiveApi();
  const photos = await api.createMediaContribution(PHOTO_REQUEST, options);
  const audio = await api.createMediaContribution(AUDIO_REQUEST, { idempotencyKey: IDS.secondClientItem });
  const audioOptions = { idempotencyKey: IDS.secondClientItem };
  const audioMemory = audio.memories[0];
  const audioGrant = await api.authorizeUpload(audio.contributionId, audioMemory.memoryId, audioOptions);
  await api.uploadMedia(audioGrant, new Blob());
  await api.finalizeUpload(audio.contributionId, audioMemory.memoryId, audioGrant.grantId, audioOptions);
  await signIn(api);
  assert.deepEqual((await api.listMemories()).items.map((item) => item.memoryType).sort(), ["AUDIO", "TEXT"]);
  assert.equal((await api.getMemory(audioMemory.memoryId)).memoryType, "AUDIO");
  assert.ok((await api.getPlayback(audioMemory.memoryId)).url.startsWith("https:"));
  await finalize(api, photos, await transfer(api, photos));
  const page = await api.listMemories();
  assert.deepEqual(page.items.map((item) => item.memoryType).sort(), ["AUDIO", "PHOTO", "TEXT"]);
  assert.equal(page.items.some((item) => item.memoryId === photos.memories[1].memoryId), false);
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
