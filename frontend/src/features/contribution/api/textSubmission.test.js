import test from "node:test";
import assert from "node:assert/strict";
import { createTextSubmission } from "./textSubmission.js";
import { createMockArchiveApi } from "../../../shared/api/mockArchiveApi.js";
import { ApiError } from "../../../shared/api/apiClient.js";
import { IDS, TEXT_RECEIPT } from "../../../shared/api/v1/fixtures.js";

const draft = { guestName: " Guest ", message: " hello " };

test("repeat taps share one request/key and a saved message requires explicit start-another", async () => {
  const calls = [];
  let keys = 0;
  const submission = createTextSubmission({
    randomUUID: () => { keys++; return IDS.key; },
    api: { createTextContribution: async (...args) => { calls.push(args); return TEXT_RECEIPT; } },
  });
  const first = submission.submit(draft);
  assert.equal(submission.submit(draft), first);
  assert.equal(submission.pending, true);
  assert.equal(submission.receipt, null);
  await first;
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [{ guestName: "Guest", message: "hello" }, { idempotencyKey: IDS.key }]);
  await submission.submit(draft);
  assert.equal(calls.length, 1);
  assert.equal(keys, 1);
  submission.startAnother();
  await submission.submit({ message: "Another" });
  assert.equal(keys, 2);
});

test("lost committed response retains draft/key and recovers only on deliberate retry", async () => {
  let keys = 0;
  const submission = createTextSubmission({
    randomUUID: () => { keys++; return IDS.key; },
    api: createMockArchiveApi({ scenario: "uncertainSubmission" }),
  });
  await assert.rejects(submission.submit(draft), { unknownOutcome: true });
  assert.equal(submission.pending, true);
  assert.equal(submission.receipt, null);
  assert.equal(keys, 1);
  assert.throws(() => submission.startAnother());
  assert.throws(() => submission.submit({ message: "Edited" }), { code: "DRAFT_CHANGED" });
  const recovered = await submission.submit(draft);
  assert.equal(recovered.completion, "COMPLETE");
  assert.equal(keys, 1);
  assert.equal(submission.pending, false);
});

for (const failure of [
  new ApiError("Unavailable", { code: "SERVICE_UNAVAILABLE", status: 503, unknownOutcome: true }),
  new ApiError("Mismatch", { code: "CONTRACT_MISMATCH", unknownOutcome: true }),
  new ApiError("Conflict", { code: "IDEMPOTENCY_CONFLICT", status: 409 }),
  new ApiError("Cancelled", { code: "REQUEST_ABORTED", unknownOutcome: true }),
]) {
  test(failure.code + " cannot clear, rotate or automatically retry the submission", async () => {
    let calls = 0;
    let keys = 0;
    const submission = createTextSubmission({
      randomUUID: () => { keys++; return IDS.key; },
      api: { createTextContribution: async () => { calls++; throw failure; } },
    });
    await assert.rejects(submission.submit(draft));
    assert.equal(calls, 1);
    assert.equal(keys, 1);
    assert.equal(submission.pending, true);
    assert.equal(submission.receipt, null);
    await assert.rejects(submission.submit(draft));
    assert.equal(calls, 2);
    assert.equal(keys, 1);
  });
}

test("raw validation happens before trimming or key generation; known rejection allows correction", async () => {
  let calls = 0;
  let keys = 0;
  const submission = createTextSubmission({
    randomUUID: () => { keys++; return IDS.key; },
    api: { createTextContribution: async () => {
      calls++;
      if (calls === 1) throw new ApiError("Correct fields", { code: "VALIDATION_FAILED", status: 400 });
      return TEXT_RECEIPT;
    } },
  });
  assert.throws(() => submission.submit({ message: " ".repeat(5000) + "x" }), { code: "VALIDATION_FAILED" });
  assert.equal(keys, 0);
  await assert.rejects(submission.submit(draft));
  assert.equal(submission.pending, false);
  await submission.submit({ message: "Corrected" });
  assert.equal(keys, 2);
});

test("a server retry delay blocks requests without rotating the key or scheduling a retry", async () => {
  let now = 1000;
  let calls = 0;
  const submission = createTextSubmission({
    now: () => now, randomUUID: () => IDS.key,
    api: { createTextContribution: async () => {
      calls++;
      if (calls === 1) throw new ApiError("Wait", { code: "RATE_LIMITED", status: 429, retryAfterSeconds: 30 });
      return TEXT_RECEIPT;
    } },
  });
  await assert.rejects(submission.submit(draft));
  assert.equal(submission.retryAfterSeconds, 30);
  assert.throws(() => submission.submit(draft), { code: "RATE_LIMITED" });
  assert.equal(calls, 1);
  now += 30_000;
  assert.equal(calls, 1);
  await submission.submit(draft);
  assert.equal(calls, 2);
});
