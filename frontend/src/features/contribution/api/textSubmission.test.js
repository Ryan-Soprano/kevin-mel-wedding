import test from "node:test";
import assert from "node:assert/strict";
import { createTextSubmission } from "./textSubmission.js";
import { createMockArchiveApi } from "../../../shared/api/mockArchiveApi.js";
import { createArchiveApi } from "../../../shared/api/archiveApi.js";
import { ApiError, createApiClient } from "../../../shared/api/apiClient.js";
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
  assert.deepEqual(calls[0][0], { guestName: "Guest", message: "hello" });
  assert.equal(calls[0][1].idempotencyKey, IDS.key);
  assert.equal(calls[0][1].signal.aborted, false);
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

test("a hanging request times out without an automatic retry and recovers with the same draft/key", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = [];
  let keys = 0;
  const submission = createTextSubmission({
    randomUUID: () => { keys++; return IDS.key; },
    api: { createTextContribution: (...args) => {
      calls.push(args);
      return calls.length === 1 ? new Promise(() => {}) : Promise.resolve(TEXT_RECEIPT);
    } },
  });
  const first = submission.submit(draft);
  const timedOut = assert.rejects(first, { code: "REQUEST_TIMEOUT", unknownOutcome: true });
  await Promise.resolve();
  context.mock.timers.tick(29_999);
  assert.equal(submission.submit(draft), first);
  assert.equal(calls[0][1].signal.aborted, false);
  context.mock.timers.tick(1);
  await timedOut;
  assert.equal(calls[0][1].signal.aborted, true);
  assert.equal(submission.pending, true);
  assert.equal(submission.receipt, null);
  assert.equal(calls.length, 1);
  assert.throws(() => submission.startAnother());
  assert.throws(() => submission.submit({ message: "Changed" }), { code: "DRAFT_CHANGED" });
  context.mock.timers.tick(30_000);
  assert.equal(calls.length, 1);

  assert.equal(await submission.submit(draft), TEXT_RECEIPT);
  assert.equal(keys, 1);
  assert.deepEqual(calls[1][0], calls[0][0]);
  assert.equal(calls[1][1].idempotencyKey, calls[0][1].idempotencyKey);
  assert.notEqual(calls[1][1].signal, calls[0][1].signal);
  assert.equal(submission.pending, false);
  context.mock.timers.tick(30_000);
  assert.equal(calls[1][1].signal.aborted, false, "successful request clears its abort timer");
});

test("timeout covers a stalled JSON body; late results cannot complete or unlock a later attempt", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = [];
  const requests = [];
  let finishFirstBody;
  let finishSecondBody;
  let startedFirstBody;
  let startedSecondBody;
  const firstBody = new Promise((resolve) => { finishFirstBody = resolve; });
  const secondBody = new Promise((resolve) => { finishSecondBody = resolve; });
  const firstBodyStarted = new Promise((resolve) => { startedFirstBody = resolve; });
  const secondBodyStarted = new Promise((resolve) => { startedSecondBody = resolve; });
  const transport = createArchiveApi({ client: createApiClient({ fetchImpl: async (_, options) => {
    calls.push(options);
    const attempt = calls.length;
    return {
      ok: true, status: 201, headers: new Headers({ "Content-Type": "application/json" }),
      json: () => {
        if (attempt === 1) { startedFirstBody(); return firstBody; }
        startedSecondBody();
        return secondBody;
      },
    };
  } }) });
  const api = { createTextContribution: (...args) => {
    const request = transport.createTextContribution(...args);
    requests.push(request);
    return request;
  } };
  const submission = createTextSubmission({ randomUUID: () => IDS.key, api });
  const first = submission.submit(draft);
  const timedOut = assert.rejects(first, { code: "REQUEST_TIMEOUT", unknownOutcome: true });
  await firstBodyStarted;
  context.mock.timers.tick(30_000);
  await timedOut;
  assert.equal(calls[0].signal.aborted, true);

  const second = submission.submit(draft);
  await secondBodyStarted;
  finishFirstBody(TEXT_RECEIPT);
  await requests[0];
  assert.equal(submission.receipt, null, "late original receipt cannot claim success");
  assert.equal(submission.submit(draft), second, "late original completion cannot release the active retry");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body, calls[0].body);
  assert.equal(calls[1].headers.get("Idempotency-Key"), calls[0].headers.get("Idempotency-Key"));
  finishSecondBody(TEXT_RECEIPT);
  assert.equal(await second, TEXT_RECEIPT);
  assert.equal(submission.pending, false);
  context.mock.timers.tick(30_000);
  assert.equal(calls[1].signal.aborted, false);
});

test("a rejected request clears its deadline rather than aborting later", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  const submission = createTextSubmission({
    randomUUID: () => IDS.key,
    api: { createTextContribution: async (_, options) => {
      signal = options.signal;
      throw new ApiError("Correct fields", { code: "VALIDATION_FAILED", status: 400 });
    } },
  });
  await assert.rejects(submission.submit(draft), { code: "VALIDATION_FAILED" });
  context.mock.timers.tick(30_000);
  assert.equal(signal.aborted, false);
  assert.equal(submission.pending, false);
});
