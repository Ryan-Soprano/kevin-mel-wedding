import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { createTextSubmission } from "./textSubmission.js";
import { createMockArchiveApi } from "../../../shared/api/mockArchiveApi.js";
import { createArchiveApi } from "../../../shared/api/archiveApi.js";
import { ApiError, createApiClient } from "../../../shared/api/apiClient.js";
import { IDS, TEXT_RECEIPT } from "../../../shared/api/v1/fixtures.js";
import { getContributionSubmitError } from "../contributionDisplay.js";

const draft = { guestName: " Guest ", message: " hello " };

test("direct note form exposes send, private copy, validation descriptions, pending locks and cooldown label precedence", async () => {
  // SSR verifies real React presentation without executing lifecycle/focus/timer
  // effects; separate mounted checks cover those interaction guarantees.
  const server = await createServer({ configFile: false, logLevel: "silent", cacheDir: "node_modules/.vite/contribution-presentation-test", root: fileURLToPath(new URL("../../../../", import.meta.url)),
    plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { default: ContributionForm } = await server.ssrLoadModule("/src/features/contribution/components/ContributionForm.jsx");
    const { default: ContributionCompose } = await server.ssrLoadModule("/src/features/contribution/components/ContributionCompose.jsx");
    const { default: ContributionResult } = await server.ssrLoadModule("/src/features/contribution/components/ContributionResult.jsx");
    const render = (Component, props) => renderToStaticMarkup(createElement(Component, props));
    const noop = () => {};
    const actions = Object.fromEntries(["send", "finish", "shareAnother", "changeGuestName", "changeMessage"].map(name => [name, noop]));
    const view = {
      guestName: "Guest <visitor>", message: "First <note>\nSecond line", step: "compose",
      fieldErrors: {}, error: "", isSubmitting: false, pending: false, retryAfter: 0, busy: false, hasShellActions: false, actions,
    };
    let factoryCalls = 0, flowReports = 0;
    const initialProps = { createSubmission: () => { factoryCalls++; }, onFlowStateChange: () => { flowReports++; } };
    const initial = render(ContributionForm, initialProps);
    assert.match(initial, /class="contribution-flow"/);
    assert.match(initial, /Your name \(optional\)/);
    assert.match(initial, />Send note</);
    assert.doesNotMatch(initial, /<h2|Review note|Ready to send/);
    const privateInitial = render(ContributionForm, { ...initialProps, privateArchive: true });
    assert.match(privateInitial, /Add a written memory to your private archive/);
    assert.match(privateInitial, />Save note privately</);
    assert.doesNotMatch(privateInitial, /Your name \(optional\)|id="guestName"/);
    assert.equal(factoryCalls, 0, "coordinators remain effect-owned during server rendering");
    assert.equal(flowReports, 0, "flow callbacks remain effect-owned");

    const validationView = { ...view, message: "x".repeat(5000), fieldErrors: { guestName: "Check <name>", message: "Check <message>" }, error: "Check <form>" };
    const compose = render(ContributionCompose, { view: validationView, privateArchive: false });
    assert.match(compose, /maxLength="100" aria-invalid="true" aria-describedby="guestName-error"/);
    assert.match(compose, /maxLength="5000" required="" aria-invalid="true" aria-describedby="message-count message-error"/);
    assert.match(compose, new RegExp(`<p id="message-count">${validationView.message.length.toLocaleString()} / 5,000 characters<`));
    assert.match(compose, /Check &lt;name&gt;/);
    assert.match(compose, /Check &lt;message&gt;/);
    assert.match(compose, /Check &lt;form&gt;/);
    const emptyCompose = render(ContributionCompose, { view, privateArchive: false });
    assert.match(emptyCompose, /aria-invalid="false"/);
    assert.match(emptyCompose, /aria-describedby="message-count"/);
    assert.match(emptyCompose, /value="Guest &lt;visitor&gt;"/);
    assert.match(emptyCompose, /First &lt;note&gt;\nSecond line/);
    assert.doesNotMatch(emptyCompose, /aria-describedby="guestName-error"/);
    const pendingCompose = render(ContributionCompose, { view: { ...view, pending: true, isSubmitting: true, busy: true }, privateArchive: false });
    assert.equal((pendingCompose.match(/disabled=""/g) ?? []).length, 3, "sending freezes both fields and the send button");
    assert.match(pendingCompose, /role="status" aria-live="polite"/);

    const pending = render(ContributionCompose, { view: { ...view, pending: true }, privateArchive: false });
    assert.match(pending, /Trying again checks this same submission/);
    assert.match(pending, />Try again</);
    assert.doesNotMatch(pending, />Edit note</);
    assert.equal((pending.match(/disabled=""/g) ?? []).length, 2, "unknown outcome freezes the draft while enabling same-note retry");
    const waiting = render(ContributionCompose, { view: { ...view, pending: true, retryAfter: 17, busy: true }, privateArchive: false });
    assert.match(waiting, /aria-busy="false"/);
    assert.match(waiting, /disabled="">Please wait before trying again/);
    assert.doesNotMatch(waiting, />Try again<|>Edit note</);
    const submitting = render(ContributionCompose, { view: { ...view, pending: true, retryAfter: 17, isSubmitting: true, busy: true }, privateArchive: true });
    assert.match(submitting, /aria-busy="true"/);
    assert.match(submitting, /Sending your note…/);
    assert.match(submitting, /disabled="">Saving…/);
    assert.doesNotMatch(submitting, /Please wait before trying again|>Try again</);
    const editableWait = render(ContributionCompose, { view: { ...view, retryAfter: 17, busy: true }, privateArchive: false });
    assert.match(editableWait, /disabled="">Please wait before trying again/);
    assert.equal((editableWait.match(/disabled=""/g) ?? []).length, 1, "cooldown freezes only sending when no submission is pending");

    const successView = { ...view, step: "success" };
    const success = render(ContributionResult, { view: successView, privateArchive: false });
    assert.match(success, /Thank you — your note was saved for Kevin and Melanie/);
    assert.match(success, />Done</);
    assert.match(success, />Write another note</);
    const shellSuccess = render(ContributionResult, { view: { ...successView, hasShellActions: true }, privateArchive: false });
    assert.match(shellSuccess, />Share another memory</);
    assert.doesNotMatch(shellSuccess, /Write another note/);
    const privateSuccess = render(ContributionResult, { view: successView, privateArchive: true });
    assert.match(privateSuccess, /Your note is saved in your private archive/);
    assert.match(privateSuccess, /New memories start in Kept/);
    assert.match(privateSuccess, />View added memory</);
    const done = render(ContributionResult, { view: { ...successView, step: "done" }, privateArchive: false });
    assert.match(done, /You’re all set/);
    assert.match(done, /You can close this page/);
    assert.doesNotMatch(done, /<button/);

    const unknownError = getContributionSubmitError(new ApiError("Raw transport diagnostic", { code: "NETWORK_ERROR", unknownOutcome: true }));
    assert.match(unknownError, /try again to check the same note/);
    assert.doesNotMatch(unknownError, /diagnostic/);
    assert.equal(getContributionSubmitError(new ApiError("Known <rejection>", { code: "INVALID_CREDENTIALS" })), "Known <rejection>");
    assert.equal(getContributionSubmitError(new Error("Raw transport diagnostic")), "We could not confirm whether your note was saved. Keep this page open and try again.");
  } finally { await server.close(); }
});

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

for (const [status, code, seconds] of [[429, "RATE_LIMITED", 17], [503, "SERVICE_UNAVAILABLE", 60]]) {
  test(`HTTP ${status} Retry-After retains the note and key through real-adapter deliberate recovery`, async () => {
    let time = 1000, keys = 0;
    const calls = [];
    const api = createArchiveApi({ client: createApiClient({ fetchImpl: async (_, options) => {
      calls.push(options);
      return new Response(JSON.stringify(calls.length === 1
        ? { error: { code, message: "Please wait before retrying.", fieldErrors: [] } } : TEXT_RECEIPT), {
        status: calls.length === 1 ? status : 201,
        headers: { "Content-Type": "application/json", ...(calls.length === 1 ? { "Retry-After": String(seconds) } : {}) },
      });
    } }) });
    const submission = createTextSubmission({ api, now: () => time,
      randomUUID: () => { keys++; return IDS.key; } });
    await assert.rejects(submission.submit(draft), { status, code, retryAfterSeconds: seconds });
    assert.equal(submission.pending, true); assert.equal(submission.receipt, null);
    assert.throws(() => submission.startAnother());
    assert.throws(() => submission.submit(draft), { status: 429, retryAfterSeconds: seconds });
    assert.equal(calls.length, 1); assert.equal(keys, 1);
    time += seconds * 1000;
    assert.equal(calls.length, 1, "expiry does not schedule a request");
    assert.throws(() => submission.submit({ message: "changed" }), { code: "DRAFT_CHANGED" });
    const receipt = await submission.submit(draft);
    assert.equal(receipt.completion, "COMPLETE"); assert.equal(submission.pending, false);
    assert.equal(calls.length, 2); assert.equal(keys, 1);
    assert.equal(calls[1].body, calls[0].body);
    assert.equal(calls[1].headers.get("Idempotency-Key"), calls[0].headers.get("Idempotency-Key"));
  });
}
