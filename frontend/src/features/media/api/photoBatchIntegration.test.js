import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { pid } from "node:process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { createPhotoBatchSubmission } from "./photoBatchSubmission.js";
import { createMockArchiveApi } from "../../../shared/api/mockArchiveApi.js";
import { createArchiveApi } from "../../../shared/api/archiveApi.js";
import { createApiClient } from "../../../shared/api/apiClient.js";
import { getPhotoBatchSafeError, getPhotoBatchSummary } from "../photoBatchDisplay.js";

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

test("real batch presentation preserves recovery controls until all photos are confirmed and then shows a clear guest/private success", async () => {
  // SSR checks real React markup from real coordinator snapshots. It does not
  // execute effects or claim browser focus, StrictMode or upload acceptance.
  const f = fixture("partialUpload");
  const partial = await f.submission.submit(f.raw);
  const originalFiles = f.photos.map(photo => photo.file);
  const server = await createServer({ configFile: false, logLevel: "silent", cacheDir: `node_modules/.vite/photo-batch-integration-test-${pid}`, root: fileURLToPath(new URL("../../../../", import.meta.url)),
    plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { default: PhotoBatchForm } = await server.ssrLoadModule("/src/features/media/components/PhotoBatchForm.jsx");
    const { default: PhotoBatchReview } = await server.ssrLoadModule("/src/features/media/components/PhotoBatchReview.jsx");
    const { default: PhotoBatchCompose } = await server.ssrLoadModule("/src/features/media/components/PhotoBatchCompose.jsx");
    const { default: PhotoBatchSuccess } = await server.ssrLoadModule("/src/features/media/components/PhotoBatchSuccess.jsx");
    const { default: PhotoBatchCard } = await server.ssrLoadModule("/src/features/media/components/PhotoBatchCard.jsx");
    const { default: PhotoBatchActions } = await server.ssrLoadModule("/src/features/media/components/PhotoBatchActions.jsx");
    const { default: PhotoPicker } = await server.ssrLoadModule("/src/features/media/components/PhotoPicker.jsx");
    const render = (Component, props) => renderToStaticMarkup(createElement(Component, props));
    const noop = () => {};
    const actions = Object.fromEntries(["review", "editPhotos", "sendPhotos", "retry", "resetBatch", "finish", "shareAnother", "toggleRetry",
      "updateSelection", "changeCaption", "changeName", "registerCaptionInput"].map(name => [name, noop]));
    const view = {
      prefix: "batch-check", photos: f.photos, guestName: "Test Guest", snapshot: partial,
      busy: false, error: getPhotoBatchSafeError(partial.error), fields: {}, selectedRetry: new Set(), batchNumber: 0,
      step: "compose", reviewData: { guestName: "Guest <visitor>", items: [{ caption: "First <caption>" }, { caption: null }, { caption: "" }] },
      retained: true, locked: true, savedCount: partial.savedCount, totalCount: partial.totalCount, globalWait: 0,
      byId: new Map(partial.items.map(item => [item.id, item])), retryCandidates: [partial.items[1]], selectedEligible: [],
      summary: getPhotoBatchSummary({ busy: false, retained: true, savedCount: partial.savedCount, totalCount: partial.totalCount }),
      complete: false, shellActions: false, actions,
    };
    let factoryCalls = 0, flowReports = 0;
    const initialProps = { createSubmission: () => { factoryCalls++; }, onFlowStateChange: () => { flowReports++; } };
    const picker = render(PhotoPicker, { photos: f.photos, idPrefix: "selected-photos" });
    assert.match(picker, /aria-label="Remove photo 1, test-0.png"/);
    assert.doesNotMatch(picker, /type="checkbox"|Select photos to remove|Remove selected photos/);
    assert.doesNotMatch(picker, /photo-card__filename/);
    const guest = render(PhotoBatchForm, initialProps);
    assert.match(guest, />Share photos</);
    assert.match(guest, /Your name \(optional\)/);
    assert.match(guest, /accept="image\/jpeg,image\/png,image\/webp" multiple=""/);
    assert.match(guest, />Review photos</);
    const privateInitial = render(PhotoBatchForm, { ...initialProps, privateArchive: true });
    assert.match(privateInitial, />Add photos</);
    assert.doesNotMatch(privateInitial, /Your name \(optional\)/);
    assert.equal(factoryCalls, 0, "server rendering does not create coordinators");
    assert.equal(flowReports, 0, "flow reporting remains effect-owned");

    const review = render(PhotoBatchReview, { view, privateArchive: false });
    assert.match(review, /Ready to send your photos\?/);
    assert.match(review, /From: Guest &lt;visitor&gt;/);
    assert.match(review, /First &lt;caption&gt;/);
    assert.doesNotMatch(review, /No caption provided/);
    assert.match(review, /alt="Photo 1"/);
    assert.doesNotMatch(review, /photo-card__filename|test-0\.png/);
    assert.equal((review.match(/class="photo-review-caption"/g) ?? []).length, 1, "only a nonempty caption needs extra review copy");
    assert.match(review, />Send photos</);
    assert.match(review, /Kevin and Melanie/);
    assert.match(review, /may choose to share (?:them|your photos)/);
    assert.match(review, /role="status" aria-live="polite" aria-atomic="true"/);
    const privateReview = render(PhotoBatchReview, { view, privateArchive: true });
    assert.match(privateReview, /Ready to save your photos privately\?/);
    assert.match(privateReview, />Save photos privately</);
    assert.doesNotMatch(privateReview, /From:|Guest &lt;visitor&gt;/);
    const sending = render(PhotoBatchReview, { view: { ...view, busy: true, globalWait: 7 }, privateArchive: false });
    assert.match(sending, /Preparing your original photos…/);
    assert.match(sending, /disabled="">Sending photos…/);
    assert.match(sending, /disabled="">Edit photos/);
    assert.doesNotMatch(sending, /Wait 7 seconds before sending/, "busy status wins over the wait label");
    const delayed = render(PhotoBatchReview, { view: { ...view, globalWait: 7 }, privateArchive: false });
    assert.match(delayed, /disabled="">Wait 7 seconds before sending/);

    const retained = render(PhotoBatchCompose, { view, privateArchive: false });
    assert.match(retained, /<input id="batch-check-name"[^>]*disabled=""[^>]*value="Test Guest"/);
    assert.match(retained, /<textarea[^>]*disabled=""/);
    assert.match(retained, /<input[^>]*type="file"[^>]*disabled=""/);
    assert.doesNotMatch(retained, /class="photo-card__remove"/, "retained originals cannot be removed during an uncertain result");
    assert.match(retained, /2 of 3 photos sent\./);
    assert.match(retained, />Sent</);
    assert.match(retained, />Needs retry</);
    assert.match(retained, /Select photo 2 to retry/);
    assert.doesNotMatch(retained, /Saved privately|You can close this page|Thanks for sharing/);
    assert.match(retained, /disabled="">Retry selected photos/);
    assert.doesNotMatch(retained, />Review photos<|Start a new batch/);
    const privateRetained = render(PhotoBatchCompose, { view, privateArchive: true });
    assert.match(privateRetained, /2 of 3 photos are confirmed saved/);
    assert.match(privateRetained, />Saved privately</);
    assert.doesNotMatch(privateRetained, /You can close this page/);
    const partialActions = render(PhotoBatchActions, { view: { ...view, selectedEligible: [partial.items[1]] }, privateArchive: false });
    assert.match(partialActions, /<button type="button">Retry selected photos<\/button>/);
    assert.match(partialActions, /Confirmed photos will not be uploaded again/);
    const busyActions = render(PhotoBatchActions, { view: { ...view, busy: true, selectedEligible: [partial.items[1]] }, privateArchive: false });
    assert.match(busyActions, /disabled="">Sending photos…/);
    assert.doesNotMatch(busyActions, /Back to our photos|Share another memory|Share another batch|You can close this page/);
    const busyCard = render(PhotoBatchCard, { photo: f.photos[1], index: 1, prefix: view.prefix, item: partial.items[1],
      busy: true, locked: true, selected: true, globalWait: 0, onCaptionRef: noop });
    assert.match(busyCard, /type="checkbox" disabled=""[^>]*checked=""/);

    const cardProps = {
      photo: f.photos[1], index: 1, prefix: view.prefix, item: partial.items[1], locked: true, busy: false,
      globalWait: 5, error: "Check this caption", selected: true, onCaptionChange: noop, onCaptionRef: noop, onToggleRetry: noop,
    };
    const waitingCard = render(PhotoBatchCard, { ...cardProps, item: { ...partial.items[1], retryAfterSeconds: 2.2 } });
    assert.match(waitingCard, /class="visually-hidden">Photo 2: test-1\.png<\/span>/);
    assert.doesNotMatch(waitingCard, /photo-card__filename/);
    assert.match(waitingCard, /aria-invalid="true"/);
    assert.match(waitingCard, /<details class="photo-caption" open="">/, "caption validation stays visible for error focus");
    assert.match(waitingCard, new RegExp(`aria-describedby="batch-check-filename-${f.photos[1].id} batch-check-caption-${f.photos[1].id}-error"`));
    assert.match(waitingCard, /Select photo 2 to retry \(wait 5 seconds\)/);
    assert.match(waitingCard, /type="checkbox" disabled=""[^>]*checked=""/);
    const itemDelay = render(PhotoBatchCard, { ...cardProps, globalWait: 0, item: { ...partial.items[1], retryAfterSeconds: 2.2 } });
    assert.match(itemDelay, /Select photo 2 to retry \(wait 3 seconds\)/);
    const unknown = render(PhotoBatchCard, { ...cardProps, item: { ...partial.items[1], error: { unknownOutcome: true } } });
    assert.match(unknown, />Not confirmed</);
    const known = render(PhotoBatchCard, cardProps);
    assert.match(known, />Needs retry</);
    const savedCard = render(PhotoBatchCard, { ...cardProps, item: partial.items[0] });
    assert.match(savedCard, />Sent</);
    assert.doesNotMatch(savedCard, /type="checkbox"|Select photo 2 to retry/);
    const privateSavedCard = render(PhotoBatchCard, { ...cardProps, item: partial.items[0], privateArchive: true });
    assert.match(privateSavedCard, />Saved privately</);
    const terminalCard = render(PhotoBatchCard, { ...cardProps, item: { ...partial.items[1], status: "rejected", terminal: true } });
    assert.match(terminalCard, />Photo rejected</);
    assert.doesNotMatch(terminalCard, /type="checkbox"/);

    const callsBeforeRecovery = f.calls.length;
    f.mock.setScenario("success");
    const recovered = await f.submission.retry([f.photos[1].id]);
    assert.equal(recovered.complete, true);
    assert.equal(f.calls.slice(callsBeforeRecovery).filter(call => call.method === "uploadMedia").length, 1,
      "completing the display's failed item does not resend its confirmed siblings");
    const finishedView = { ...view, complete: recovered.complete, savedCount: recovered.savedCount, totalCount: recovered.totalCount,
      byId: new Map(recovered.items.map(item => [item.id, item])), selectedEligible: [], retryCandidates: [], shellActions: true, snapshot: recovered };
    const success = render(PhotoBatchSuccess, { view: finishedView, privateArchive: false });
    assert.match(success, /<h2[^>]*tabindex="-1"[^>]*>Your 3 photos have been sent to Kevin and Melanie!<\/h2>/);
    assert.match(success, /Thanks for sharing\. You can close this page\./);
    assert.match(success, />Back to our photos</);
    assert.match(success, />Share another memory</);
    assert.doesNotMatch(success, /<form|<input|<textarea|<img|photo-card|photo-grid|photo-picker|Saved privately|saved privately|Retry selected|Keep this page open|sent as originals|Select photos/,
      "a fully recovered batch has a confirmation without another apparent upload task");
    const privateSuccess = render(PhotoBatchSuccess, { view: finishedView, privateArchive: true });
    assert.match(privateSuccess, /All your photos were saved privately\./);
    assert.match(privateSuccess, /Your original photos are saved in your private archive\./);
    assert.match(privateSuccess, />View added memory</);
    assert.doesNotMatch(privateSuccess, /sent to Kevin and Melanie|Thanks for sharing|<input|<textarea|<img|photo-card|Retry selected/);
    const standaloneSuccess = render(PhotoBatchSuccess, { view: { ...finishedView, shellActions: false }, privateArchive: false });
    assert.match(standaloneSuccess, />Share another batch</);
    assert.doesNotMatch(standaloneSuccess, />Back to our photos<|>Share another memory</);
    const single = fixture("success", 1);
    try {
      const confirmed = await single.submission.submit(single.raw);
      const singleSuccess = render(PhotoBatchSuccess, { view: { ...finishedView, photos: single.photos, snapshot: confirmed,
        complete: confirmed.complete, savedCount: confirmed.savedCount, totalCount: confirmed.totalCount }, privateArchive: false });
      assert.match(singleSuccess, /Your photo has been sent to Kevin and Melanie!/);
      assert.doesNotMatch(singleSuccess, /Your 1 photos|<input|<textarea|<img|photo-card/);
    } finally { single.submission.dispose(); }

    const uncertain = fixture("uncertainSubmission");
    try {
      await assert.rejects(uncertain.submission.submit(uncertain.raw), { code: "NETWORK_ERROR", unknownOutcome: true });
      const snapshot = uncertain.submission.snapshot;
      const pendingView = { ...view, photos: uncertain.photos, snapshot, complete: snapshot.complete,
        savedCount: snapshot.savedCount, totalCount: snapshot.totalCount,
        byId: new Map(snapshot.items.map(item => [item.id, item])), retryCandidates: snapshot.items,
        selectedRetry: new Set([snapshot.items[0].id]), selectedEligible: [snapshot.items[0]],
        summary: getPhotoBatchSummary({ busy: false, retained: true, savedCount: snapshot.savedCount, totalCount: snapshot.totalCount }),
        error: getPhotoBatchSafeError(snapshot.error) };
      const unconfirmed = render(PhotoBatchCompose, { view: pendingView, privateArchive: false });
      assert.match(unconfirmed, /0 of 3 photos sent\./);
      assert.match(unconfirmed, /Keep this page open/);
      assert.match(unconfirmed, /<input[^>]*type="file"[^>]*disabled=""/);
      assert.match(unconfirmed, /Select photo 1 to retry/);
      assert.match(unconfirmed, /<button type="button">Retry selected photos<\/button>/);
      assert.match(unconfirmed, /role="alert"/);
      assert.doesNotMatch(unconfirmed, /You can close this page|Thanks for sharing|Start a new batch|Back to our photos|Share another memory/);
    } finally { uncertain.submission.dispose(); }

    const guestFinished = render(PhotoBatchActions, { view: finishedView, privateArchive: false });
    assert.match(guestFinished, />Back to our photos</);
    assert.match(guestFinished, />Share another memory</);
    assert.doesNotMatch(guestFinished, /Retry selected|Share another batch|Start a new batch/);
    const privateFinished = render(PhotoBatchActions, { view: finishedView, privateArchive: true });
    assert.match(privateFinished, />View added memory</);
    const standaloneFinished = render(PhotoBatchActions, { view: { ...finishedView, shellActions: false }, privateArchive: false });
    assert.match(standaloneFinished, />Share another batch</);
    assert.doesNotMatch(standaloneFinished, />Back to our photos<|>Share another memory</);
    const rejectedActions = render(PhotoBatchActions, { view: { ...view, retryCandidates: [], snapshot: { ...partial, canStartAnother: true } }, privateArchive: false });
    assert.match(rejectedActions, />Start a new batch</);
    assert.match(rejectedActions, /abandons the rejected remainder/);
    assert.doesNotMatch(rejectedActions, /Retry selected photos/);
    assert.equal(getPhotoBatchSafeError({ status: 503, retryAfterSeconds: 4, message: "private transport diagnostic" }), "Please wait before retrying. Keep this page open; your original photos are still here.");
    assert.doesNotMatch(getPhotoBatchSafeError({ status: 500, message: "private transport diagnostic" }), /diagnostic/);
    assert.equal(getPhotoBatchSummary({ busy: true, activeItem: { status: "finalizing", fileName: "test-1.png" }, savedCount: 1, totalCount: 3 }), "Verifying original photo: test-1.png. 1 of 3 photos sent.");
    f.photos.forEach((photo, index) => assert.equal(photo.file, originalFiles[index], "rendering does not replace the input File references"));
  } finally { await server.close(); f.submission.dispose(); }
});

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

function protectedFixture(stage, status, code, seconds) {
  let time = 1000, failed = false, intent = null, nextGrant = 500, keyCount = 0;
  const calls = [], grants = new Map(), saved = [false, false, false], hashes = new Map();
  const id = value => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
  const photos = saved.map((_, index) => ({ id: id(index + 1),
    file: new File([`original ${index}`], `photo-${index}.png`, { type: "image/png" }), caption: `caption ${index}` }));
  const reply = (body, responseStatus = 200, headers = {}) => new Response(JSON.stringify(body), {
    status: responseStatus, headers: { "Content-Type": "application/json", ...headers },
  });
  const receipt = () => ({ contributionId: id(90), eventKey: "kevin-mel-wedding", createdAt: "2026-10-09T12:00:00Z",
    completion: saved.every(Boolean) ? "COMPLETE" : saved.some(Boolean) ? "PARTIAL" : "PENDING",
    memories: intent.items.map((item, index) => ({ memoryId: id(100 + index), clientItemId: item.clientItemId,
      memoryType: "PHOTO", reviewStatus: "PENDING", visibility: "COUPLE_ONLY", uploadState: saved[index] ? "UPLOADED" : "PENDING" })),
  });
  function blocked(operation, index = 1) {
    if (failed || operation !== stage || index !== 1) return null;
    failed = true;
    return reply({ error: { code, message: "Please wait, then retry the same photos.", fieldErrors: [] } },
      status, { "Retry-After": String(seconds) });
  }
  const api = createArchiveApi({ client: createApiClient({ fetchImpl: async (url, options) => {
    const operation = url === "/api/contributions" ? "create" : url.endsWith("/receipt") ? "receipt"
      : url.endsWith("/upload-grants") ? "grant" : "finalize";
    const index = operation === "create" || operation === "receipt" ? 1 : Number(url.split("/")[5].slice(-12)) - 100;
    calls.push({ operation, index, options });
    const failure = blocked(operation, index); if (failure) return failure;
    if (operation === "create") { intent = JSON.parse(options.body); return reply(receipt(), 201); }
    if (operation === "receipt") return reply(receipt());
    if (operation === "grant") {
      const grantId = id(nextGrant++);
      grants.set(grantId, { index, uploaded: false });
      return reply({ grantId, method: "PUT", uploadUrl: `https://storage.example/${grantId}`,
        expiresAt: "2099-01-01T00:00:00Z", headers: { "Content-Type": "image/png" } }, 201);
    }
    const grant = grants.get(JSON.parse(options.body).grantId);
    if (!grant.uploaded) return reply({ error: { code: "UPLOAD_INCOMPLETE", message: "Retry the upload.", fieldErrors: [] } }, 409);
    saved[index] = true; return reply(receipt());
  } }), uploadFetch: async (url, options) => {
    const grant = grants.get(new URL(url).pathname.slice(1));
    calls.push({ operation: "upload", index: grant.index, options });
    const failure = blocked("upload", grant.index); if (failure) return failure;
    grant.uploaded = true; return new Response(null, { status: 200 });
  } });
  const submission = createPhotoBatchSubmission({ api, now: () => time,
    randomUUID: () => { keyCount++; return id(900); }, digest: async file => {
      hashes.set(file, (hashes.get(file) ?? 0) + 1); return "1".repeat(64);
    } });
  return { submission, calls, photos, hashes, raw: { guestName: " Guest ", photos },
    advance: () => { time += seconds * 1000; }, get keyCount() { return keyCount; } };
}

for (const [label, stage, status, code, seconds] of [
  ["throttled creation", "create", 429, "RATE_LIMITED", 17],
  ["paused or capacity-limited creation", "create", 503, "MEDIA_UNAVAILABLE", 60],
  ["paused grants", "grant", 503, "MEDIA_UNAVAILABLE", 60],
  ["busy finalization", "finalize", 503, "MEDIA_UNAVAILABLE", 5],
  ["storage delay", "upload", 503, "UPLOAD_FAILED", 9],
]) {
  test(`${label} pauses the batch through the real adapter and deliberately recovers the same originals`, async () => {
    const f = protectedFixture(stage, status, code, seconds);
    let result;
    if (stage === "create") {
      await assert.rejects(f.submission.submit(f.raw), { status, code, retryAfterSeconds: seconds });
      result = f.submission.snapshot;
    } else result = await f.submission.submit(f.raw);
    assert.equal(result.complete, false); assert.equal(result.retained, true);
    assert.equal(result.savedCount, stage === "create" ? 0 : 1);
    assert.equal(result.items[2].status, "queued", "later siblings do not issue requests during a pause");
    assert.equal(result.retryAfterSeconds, seconds); assert.equal(result.error.code, code);
    assert.equal(result.canStartAnother, false); assert.ok(result.items.every(item => !item.retryEligible));
    assert.throws(() => f.submission.startAnother(), { code: "BATCH_UNCONFIRMED" });
    const before = f.calls.length;
    assert.throws(() => f.submission.retry(), { status: 429, retryAfterSeconds: seconds });
    assert.equal(f.calls.length, before); f.advance();
    assert.equal(f.calls.length, before, "delay expiry does not start a request");
    assert.throws(() => f.submission.submit({ ...f.raw, photos: [{ ...f.photos[0], caption: "changed" }, ...f.photos.slice(1)] }),
      { code: "DRAFT_CHANGED" });
    const recovered = await f.submission.retry();
    assert.equal(recovered.complete, true); assert.equal(recovered.savedCount, 3);
    assert.equal(f.keyCount, 1); assert.ok([...f.hashes.values()].every(count => count === 1));
    const requests = f.calls.filter(call => call.operation !== "upload");
    assert.ok(requests.every(call => call.options.headers.get("Idempotency-Key") === requests[0].options.headers.get("Idempotency-Key")));
    const creates = requests.filter(call => call.operation === "create");
    if (stage === "create") assert.equal(creates[1].options.body, creates[0].options.body);
    else assert.equal(creates.length, 1);
    const uploads = f.calls.filter(call => call.operation === "upload");
    assert.ok(uploads.every(call => call.options.body === f.photos[call.index].file));
    assert.equal(uploads.filter(call => call.index === 0).length, 1, "saved sibling is not transferred again");
    if (stage === "finalize") {
      assert.equal(uploads.filter(call => call.index === 1).length, 1, "busy finalization reuses the existing uploaded grant");
      const finalizations = requests.filter(call => call.operation === "finalize" && call.index === 1);
      assert.equal(finalizations[1].options.body, finalizations[0].options.body);
    }
  });
}
