import test from "node:test";
import assert from "node:assert/strict";
import { createPhotoBatchSubmission } from "./photoBatchSubmission.js";
import { createMockArchiveApi } from "../../../shared/api/mockArchiveApi.js";

// Exercises the real JSON transport/decoders against an isolated synthetic server.
// The mock does not inspect image content or prove R2/provider readiness.
function fixture(scenario = "success", count = 3) {
  const mock = createMockArchiveApi({ scenario });
  const calls = [];
  const api = Object.fromEntries([
    "createMediaContribution", "getReceipt", "authorizeUpload", "uploadMedia", "finalizeUpload",
  ].map((method) => [method, async (...args) => {
    calls.push({ method, args });
    return mock[method](...args);
  }]));
  const photos = Array.from({ length: count }, (_, index) => ({
    id: crypto.randomUUID(),
    file: new File([`synthetic photo ${index}`], `test-${index}.png`, { type: "image/png" }),
    caption: index === 0 ? " first caption " : "",
  }));
  const submission = createPhotoBatchSubmission({ api });
  return { mock, calls, photos, submission, raw: { guestName: " Test Guest ", photos } };
}

test("real adapter submits five grouped photos, preserves captions and confirms only finalized originals", async () => {
  const f = fixture("success", 5);
  const changes = [];
  const first = f.submission.submit(f.raw, (state) => changes.push(state));
  assert.equal(f.submission.submit(f.raw), first);
  const result = await first;
  assert.equal(result.complete, true);
  assert.equal(result.savedCount, 5);
  assert.equal(result.receipt.completion, "COMPLETE");
  assert.equal(f.calls.filter((call) => call.method === "createMediaContribution").length, 1);
  assert.equal(f.calls.filter((call) => call.method === "uploadMedia").length, 5);
  const request = f.calls.find((call) => call.method === "createMediaContribution").args[0];
  assert.equal(request.guestName, "Test Guest");
  assert.equal(request.items[0].caption, "first caption");
  assert.deepEqual(request.items.map((item) => item.clientItemId), f.photos.map((photo) => photo.id));
  for (let index = 0; index < 5; index++) {
    const transfer = f.calls.filter((call) => call.method === "uploadMedia")[index];
    assert.equal(transfer.args[1], f.photos[index].file);
  }
  assert.ok(changes.some((state) => state.items.some((item) => item.status === "uploading")));
  assert.ok(changes.some((state) => state.items.some((item) => item.status === "finalizing")));
  assert.ok(changes.filter((state) => state.complete).every((state) => state.savedCount === 5));
  assert.ok(!JSON.stringify(result).includes("uploadUrl"));
});

test("partial storage failure retains successful siblings and retries only the selected unsaved photo", async () => {
  const f = fixture("partialUpload");
  const partial = await f.submission.submit(f.raw);
  assert.equal(partial.savedCount, 2);
  assert.equal(partial.receipt.completion, "PARTIAL");
  assert.deepEqual(partial.items.map((item) => item.status), ["saved", "failed", "saved"]);
  assert.equal(partial.canStartAnother, false);
  const ids = partial.items.map((item) => item.memoryId);
  const callsBefore = f.calls.length;
  f.mock.setScenario("success");
  const recovered = await f.submission.retry([f.photos[1].id]);
  assert.equal(recovered.complete, true);
  assert.deepEqual(recovered.items.map((item) => item.memoryId), ids);
  const subsequent = f.calls.slice(callsBefore);
  assert.equal(subsequent.filter((call) => call.method === "createMediaContribution").length, 0);
  assert.equal(subsequent.filter((call) => call.method === "uploadMedia").length, 1);
  assert.ok(subsequent.filter((call) => ["authorizeUpload", "finalizeUpload"].includes(call.method))
    .every((call) => call.args[1] === ids[1]));
});

test("lost committed creation response replays one identical group and key through the JSON transport", async () => {
  const f = fixture("uncertainSubmission");
  await assert.rejects(f.submission.submit(f.raw), { code: "NETWORK_ERROR", unknownOutcome: true });
  assert.equal(f.submission.pending, true);
  assert.equal(f.submission.canStartAnother, false);
  f.mock.setScenario("success");
  const result = await f.submission.retry();
  assert.equal(result.savedCount, 3);
  const creates = f.calls.filter((call) => call.method === "createMediaContribution");
  assert.equal(creates.length, 2);
  assert.deepEqual(creates[0].args[0], creates[1].args[0]);
  assert.equal(creates[0].args[1].idempotencyKey, creates[1].args[1].idempotencyKey);
});

test("verified rejection permits manual original-byte recovery without changing the group", async () => {
  const f = fixture("invalidMedia");
  const rejected = await f.submission.submit(f.raw);
  assert.equal(rejected.savedCount, 0);
  assert.equal(rejected.canStartAnother, true);
  assert.ok(rejected.items.every((item) => item.knownRejected && item.retryEligible));
  f.mock.setScenario("success");
  const oneSaved = await f.submission.retry([f.photos[1].id]);
  assert.equal(oneSaved.savedCount, 1);
  assert.equal(oneSaved.receipt.completion, "PARTIAL");
  assert.equal(oneSaved.contributionId, rejected.contributionId);
  const done = await f.submission.retry([f.photos[0].id, f.photos[2].id]);
  assert.equal(done.complete, true);
  assert.equal(f.calls.filter((call) => call.method === "createMediaContribution").length, 1);
});

test("expired links renew grants for the retained group and never transfer with an expired permission", async () => {
  const f = fixture("expiredGrant", 2);
  const pending = await f.submission.submit(f.raw);
  assert.equal(pending.savedCount, 0);
  assert.equal(pending.canStartAnother, false);
  f.mock.setScenario("success");
  const recovered = await f.submission.retry([f.photos[1].id]);
  assert.equal(recovered.savedCount, 1);
  assert.equal(recovered.items[0].status, "failed");
  assert.equal(recovered.contributionId, pending.contributionId);
  assert.equal(f.calls.filter((call) => call.method === "createMediaContribution").length, 1);
  assert.equal(f.calls.filter((call) => call.method === "authorizeUpload").length, 3);
});

test("server outage during recovery leaves confirmed siblings intact and does not resend bytes", async () => {
  const f = fixture("partialUpload");
  const partial = await f.submission.submit(f.raw);
  const transfers = f.calls.filter((call) => call.method === "uploadMedia").length;
  f.mock.setScenario("unavailable");
  await assert.rejects(f.submission.retry(), { code: "SERVICE_UNAVAILABLE" });
  assert.equal(f.submission.snapshot.savedCount, partial.savedCount);
  assert.equal(f.submission.canStartAnother, false);
  assert.equal(f.calls.filter((call) => call.method === "uploadMedia").length, transfers);
});

test("an explicit new batch after completion uses new group identity while old confirmation stays valid", async () => {
  const f = fixture("success", 1);
  const first = await f.submission.submit(f.raw);
  assert.equal(f.submission.startAnother().retained, false);
  const second = await f.submission.submit({
    ...f.raw, photos: [{ ...f.photos[0], id: crypto.randomUUID(), caption: "another caption" }],
  });
  assert.notEqual(second.contributionId, first.contributionId);
  assert.equal(first.complete, true);
  assert.equal(first.items[0].status, "saved");
  const creates = f.calls.filter((call) => call.method === "createMediaContribution");
  assert.notEqual(creates[0].args[1].idempotencyKey, creates[1].args[1].idempotencyKey);
});
