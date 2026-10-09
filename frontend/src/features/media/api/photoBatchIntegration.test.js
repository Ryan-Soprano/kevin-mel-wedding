import test from "node:test";
import assert from "node:assert/strict";
import { createPhotoBatchSubmission } from "./photoBatchSubmission.js";
import { createMockArchiveApi } from "../../../shared/api/mockArchiveApi.js";
import { createArchiveApi } from "../../../shared/api/archiveApi.js";
import { createApiClient } from "../../../shared/api/apiClient.js";

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
