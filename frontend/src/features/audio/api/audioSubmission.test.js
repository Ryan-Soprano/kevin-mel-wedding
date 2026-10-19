import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers";
import { createAudioSubmission } from "./audioSubmission.js";
import { createArchiveApi } from "../../../shared/api/archiveApi.js";
import { ApiError, createApiClient } from "../../../shared/api/apiClient.js";
import {
  IDS,
  AUDIO_REQUEST,
  PHOTO_RECEIPT,
  UPLOAD_GRANT,
} from "../../../shared/api/v1/fixtures.js";

const file = new File(["synthetic original audio"], "message.webm", {
  type: "audio/webm",
});
const raw = {
  file,
  durationSeconds: 2.5,
  guestName: " Guest ",
  caption: " Voice caption ",
};
const pending = {
  ...PHOTO_RECEIPT,
  memories: [{ ...PHOTO_RECEIPT.memories[0], memoryType: "AUDIO" }],
};
const done = {
  ...pending,
  completion: "COMPLETE",
  memories: [{ ...pending.memories[0], uploadState: "UPLOADED" }],
};
const grant = { ...UPLOAD_GRANT, headers: { "Content-Type": "audio/webm" } };
const unknown = () =>
  new ApiError("Unconfirmed", { code: "NETWORK_ERROR", unknownOutcome: true });
const turn = () => new Promise((resolve) => setImmediate(resolve));

function fixture(overrides = {}) {
  const calls = [];
  let current = pending,
    hashes = 0,
    ids = 0;
  const api = {
    createMediaContribution: async (...args) => {
      calls.push(["create", ...args]);
      return current;
    },
    getReceipt: async (...args) => {
      calls.push(["receipt", ...args]);
      return current;
    },
    authorizeUpload: async (...args) => {
      calls.push(["grant", ...args]);
      return grant;
    },
    uploadMedia: async (...args) => {
      calls.push(["upload", ...args]);
    },
    finalizeUpload: async (...args) => {
      calls.push(["finalize", ...args]);
      current = done;
      return done;
    },
    ...overrides.api,
  };
  const { api: unused, ...options } = overrides;
  void unused;
  const submission = createAudioSubmission({
    api,
    randomUUID: () => (++ids === 1 ? IDS.clientItem : IDS.key),
    digest: async () => {
      hashes++;
      return "a".repeat(64);
    },
    ...options,
  });
  return {
    api,
    submission,
    calls,
    set receipt(value) {
      current = value;
    },
    get hashes() {
      return hashes;
    },
    get ids() {
      return ids;
    },
  };
}

test("repeated save taps share one original and immutable metadata; only a verified receipt completes it", async () => {
  const f = fixture();
  const first = f.submission.submit(raw);
  assert.equal(f.submission.submit(raw), first);
  assert.equal(await first, f.submission.receipt);
  assert.equal(f.submission.complete, true);
  assert.deepEqual(
    f.calls.map((call) => call[0]),
    ["create", "grant", "upload", "finalize"],
  );
  assert.equal(f.calls[2][2], file);
  assert.equal(f.hashes, 1);
  assert.equal(f.ids, 2);
  assert.equal(f.calls[0][1].items[0].durationSeconds, 2.5);
  assert.equal(f.calls[0][1].guestName, "Guest");
  assert.equal(f.calls[0][1].items[0].caption, "Voice caption");
  await f.submission.submit(raw);
  assert.equal(f.calls.length, 4);
  f.submission.startAnother();
  assert.equal(f.submission.retained, false);
});

test("lost create response reuses key, IDs, duration, checksum and metadata and refuses draft replacement", async () => {
  let attempts = 0;
  const bodies = [];
  const f = fixture({
    api: {
      createMediaContribution: async (...args) => {
        bodies.push(args);
        if (++attempts === 1) throw unknown();
        return pending;
      },
    },
  });
  await assert.rejects(f.submission.submit(raw), { unknownOutcome: true });
  assert.equal(f.submission.pending, true);
  assert.throws(() => f.submission.startAnother());
  for (const changed of [
    { ...raw, durationSeconds: 3 },
    { ...raw, caption: "new" },
    { ...raw, guestName: "new" },
    { ...raw, file: new File([file], file.name, { type: file.type }) },
  ]) {
    assert.throws(() => f.submission.submit(changed), {
      code: "DRAFT_CHANGED",
    });
  }
  await f.submission.submit(raw);
  assert.deepEqual(bodies[0][0], bodies[1][0]);
  assert.equal(bodies[0][1].idempotencyKey, bodies[1][1].idempotencyKey);
  assert.equal(f.hashes, 1);
  assert.equal(f.ids, 2);
});

test("lost PUT response checks receipt then existing grant before transferring again", async () => {
  const f = fixture({
    api: {
      uploadMedia: async (...args) => {
        f.calls.push(["upload", ...args]);
        throw unknown();
      },
    },
  });
  await assert.rejects(f.submission.submit(raw));
  await f.submission.submit(raw);
  assert.deepEqual(
    f.calls.map((call) => call[0]),
    ["create", "grant", "upload", "receipt", "finalize"],
  );
  assert.equal(f.calls.filter((call) => call[0] === "upload").length, 1);
});

test("lost finalize response recovers committed receipt without another PUT", async () => {
  const f = fixture({
    api: {
      finalizeUpload: async () => {
        f.receipt = done;
        throw unknown();
      },
    },
  });
  await assert.rejects(f.submission.submit(raw));
  assert.equal(f.submission.complete, false);
  await f.submission.submit(raw);
  assert.equal(f.submission.complete, true);
  assert.deepEqual(
    f.calls.map((call) => call[0]),
    ["create", "grant", "upload", "receipt"],
  );
});

for (const code of ["UPLOAD_INCOMPLETE", "UPLOAD_GRANT_EXPIRED"]) {
  test(
    code +
      " renews a grant for the same intent and exact original after deliberate retry",
    async () => {
      let checks = 0,
        puts = 0;
      const f = fixture({
        api: {
          uploadMedia: async (...args) => {
            f.calls.push(["upload", ...args]);
            if (++puts === 1) throw unknown();
          },
          finalizeUpload: async (...args) => {
            f.calls.push(["finalize", ...args]);
            if (++checks === 1)
              throw new ApiError("renew", { code, status: 409 });
            return done;
          },
        },
      });
      await assert.rejects(f.submission.submit(raw));
      await f.submission.submit(raw);
      assert.equal(f.calls.filter((call) => call[0] === "create").length, 1);
      assert.equal(f.calls.filter((call) => call[0] === "grant").length, 2);
      assert.ok(
        f.calls
          .filter((call) => call[0] === "upload")
          .every((call) => call[2] === file),
      );
      assert.equal(f.hashes, 1);
      assert.equal(f.ids, 2);
    },
  );
}

test("known invalid original permits explicit replacement while uncertain invalid response retains its grant", async () => {
  for (const unknownOutcome of [false, true]) {
    const f = fixture({
      api: {
        finalizeUpload: async () => {
          throw new ApiError("invalid", {
            code: "INVALID_MEDIA",
            status: 422,
            unknownOutcome,
          });
        },
      },
    });
    await assert.rejects(f.submission.submit(raw));
    assert.equal(f.submission.failed, !unknownOutcome);
    if (unknownOutcome) assert.throws(() => f.submission.startAnother());
    else {
      f.submission.startAnother();
      assert.equal(f.submission.retained, false);
    }
  }
});

test("incomplete, wrong-type, wrong-client and wrong-memory receipt responses cannot produce saved state", async () => {
  for (const receipt of [
    pending,
    { ...done, memories: [{ ...done.memories[0], memoryType: "PHOTO" }] },
    {
      ...done,
      memories: [{ ...done.memories[0], clientItemId: IDS.secondClientItem }],
    },
    { ...done, memories: [{ ...done.memories[0], memoryId: IDS.secondPhoto }] },
  ]) {
    const f = fixture({ api: { finalizeUpload: async () => receipt } });
    await assert.rejects(f.submission.submit(raw));
    assert.equal(f.submission.complete, false);
    assert.equal(f.submission.pending, true);
    assert.throws(() => f.submission.startAnother());
  }
});

test("an upload grant with a different Content-Type cannot transfer the retained original", async () => {
  const f = fixture({
    api: {
      authorizeUpload: async () => ({
        ...grant,
        headers: { "Content-Type": "video/webm" },
      }),
    },
  });
  await assert.rejects(f.submission.submit(raw), { code: "CONTRACT_MISMATCH" });
  assert.equal(
    f.calls.some((call) => call[0] === "upload"),
    false,
  );
  assert.equal(f.submission.pending, true);
});

test("server gate/capacity and shared-network delays retain clip and identity without automatic requests", async () => {
  for (const status of [429, 503]) {
    let time = 0,
      attempts = 0;
    const requests = [];
    const f = fixture({
      now: () => time,
      api: {
        createMediaContribution: async (...args) => {
          requests.push(args);
          if (++attempts === 1)
            throw new ApiError("wait", {
              code: status === 429 ? "RATE_LIMITED" : "MEDIA_UNAVAILABLE",
              status,
              retryAfterSeconds: 60,
            });
          return pending;
        },
      },
    });
    await assert.rejects(f.submission.submit(raw));
    assert.equal(f.submission.retryAfterSeconds, 60);
    assert.throws(() => f.submission.submit(raw), { status: 429 });
    assert.equal(attempts, 1);
    time = 60000;
    assert.equal(attempts, 1);
    await f.submission.submit(raw);
    assert.deepEqual(requests[0][0], requests[1][0]);
    assert.equal(requests[0][1].idempotencyKey, requests[1][1].idempotencyKey);
  }
});

test("timeout marks an unknown mutation, aborts transport, and reconciles its late receipt on retry", async () => {
  const timers = new Map();
  let timerId = 0,
    signal;
  const f = fixture({
    setTimeoutImpl: (callback) => {
      const id = ++timerId;
      timers.set(id, callback);
      return id;
    },
    clearTimeoutImpl: (id) => timers.delete(id),
    api: {
      createMediaContribution: async (_body, options) => {
        signal = options.signal;
        return new Promise(() => {});
      },
    },
  });
  const request = f.submission.submit(raw);
  await turn();
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  await assert.rejects(request, {
    code: "REQUEST_TIMED_OUT",
    unknownOutcome: true,
  });
  assert.equal(signal.aborted, true);
  assert.equal(f.submission.pending, true);
  f.api.createMediaContribution = async () => done;
  await f.submission.submit(raw);
  assert.equal(f.submission.complete, true);
  assert.equal(f.hashes, 1);
  assert.equal(f.ids, 2);
});

test("invalid metadata is rejected before hashing, IDs or network and disposal cancels pending confirmation", async () => {
  const f = fixture();
  for (const invalid of [
    { ...raw, durationSeconds: 0 },
    { ...raw, durationSeconds: 120.01 },
    { ...raw, file: new File([file], "video.mp4", { type: "video/mp4" }) },
    { ...raw, caption: "x".repeat(501) },
  ]) {
    assert.throws(() => f.submission.submit(invalid), {
      code: "VALIDATION_FAILED",
    });
  }
  assert.equal(f.hashes, 0);
  assert.equal(f.ids, 0);
  assert.equal(f.calls.length, 0);
  let signal;
  f.api.createMediaContribution = async (_body, options) => {
    signal = options.signal;
    return new Promise(() => {});
  };
  const request = f.submission.submit(raw);
  await turn();
  f.submission.dispose();
  await assert.rejects(request, { code: "REQUEST_ABORTED" });
  assert.equal(signal.aborted, true);
  assert.equal(f.submission.retained, false);
  assert.throws(() => f.submission.submit(raw), { code: "REQUEST_ABORTED" });
});

test("real transport keeps canonical Content-Type/original bytes and recovers a lost final response from its receipt", async () => {
  const requests = [],
    uploads = [];
  let committed = false;
  const api = createArchiveApi({
    client: createApiClient({
      fetchImpl: async (path, options) => {
        requests.push([path, options]);
        let body = pending,
          status = 200;
        if (path === "/api/contributions") {
          body = pending;
          status = 201;
        }
        if (path.endsWith("/upload-grants")) {
          body = grant;
          status = 201;
        }
        if (path.endsWith("/finalize")) {
          committed = true;
          throw new TypeError("lost response");
        }
        if (path.endsWith("/receipt")) body = committed ? done : pending;
        return new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      },
    }),
    uploadFetch: async (_url, options) => {
      uploads.push(options);
      return new Response(null, { status: 200 });
    },
  });
  let ids = 0;
  const submission = createAudioSubmission({
    api,
    digest: async () => "c".repeat(64),
    randomUUID: () => (++ids === 1 ? IDS.clientItem : IDS.key),
  });
  await assert.rejects(submission.submit(raw), { unknownOutcome: true });
  await submission.submit(raw);
  assert.equal(submission.complete, true);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].body, file);
  assert.equal(uploads[0].headers["Content-Type"], "audio/webm");
  assert.equal(uploads[0].credentials, "omit");
  const body = JSON.parse(requests[0][1].body);
  assert.equal(body.items[0].durationSeconds, raw.durationSeconds);
  assert.equal(
    body.items[0].checksumSha256,
    AUDIO_REQUEST.items[0].checksumSha256,
  );
  assert.ok(
    requests.every(
      ([, options]) => options.headers.get("Idempotency-Key") === IDS.key,
    ),
  );
  assert.equal(
    requests.filter(([path]) => path === "/api/contributions").length,
    1,
  );
});
