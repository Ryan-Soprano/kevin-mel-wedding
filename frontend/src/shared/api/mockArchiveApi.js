import { createApiClient } from "./apiClient.js";
import { createArchiveApi } from "./archiveApi.js";
import { normalizeMemoryMetadata, sameMetadata } from "../../features/inbox/memoryMetadata.js";
import { createMockAlbumServer } from "../../features/albums/api/mockAlbumServer.js";
import {
  ANONYMOUS_SESSION, COUPLE_SESSION, CREATED_AT, IDS, INBOX_PAGE,
  MEDIA_DETAIL, MEMORY_DETAIL, PLAYBACK, SCENARIOS, UPLOAD_GRANT, VALIDATION_ERROR,
} from "./v1/fixtures.js";

const clone = (value) => structuredClone(value);
const canonical = (value) => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
    : item);
const reply = (payload, status = 200, headers = {}) => new Response(
  status === 204 ? null : JSON.stringify(payload),
  { status, headers: { "Content-Type": "application/json", "X-Request-ID": IDS.request, ...headers } },
);
const failure = (code, message, status, headers = {}) => reply({
  error: { code, message, requestId: IDS.request, fieldErrors: [] },
}, status, headers);

function wait(ms, signal) {
  if (signal?.aborted) return Promise.reject(new DOMException("Cancelled", "AbortError"));
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** An isolated in-memory server used through the real adapter and JSON transport. */
export function createMockArchiveApi({ scenario = "success", delayMs = 0, now = () => Date.now() } = {}) {
  if (!SCENARIOS.includes(scenario)) throw new TypeError("Unknown mock scenario.");
  const contributions = new Map();
  const grants = new Map();
  const memories = clone(INBOX_PAGE.items);
  let session = clone(ANONYMOUS_SESSION);
  let sessionVersion = 0;
  let next = 1;
  let lostResponse = false;
  let lostReviewResponse = false;
  let lostMetadataResponse = false;
  let failedTransfer = false;
  const nextId = () => "00000000-0000-4000-8000-" + String(next++).padStart(12, "0");
  const albumServer = createMockAlbumServer({ getSession: () => session, getScenario: () => scenario,
    getMemories: () => memories, nextId, now, reply, failure });

  function rotateSession(fixture) {
    // Deterministic preview tokens model rotation, not production token security.
    session = { ...clone(fixture), csrfToken: "synthetic-csrf-session-" + ++sessionVersion };
  }

  function refreshReceipt(entry) {
    const count = entry.receipt.memories.filter((memory) =>
      memory.memoryType === "TEXT" || memory.uploadState === "UPLOADED").length;
    entry.receipt.completion = count === entry.receipt.memories.length
      ? "COMPLETE" : count > 0 ? "PARTIAL" : "PENDING";
    return entry.receipt;
  }

  function owned(contributionId, headers, privateContribution = false) {
    const entry = contributions.get((privateContribution ? "couple:" : "guest:") + headers.get("Idempotency-Key"));
    return entry?.receipt.contributionId === contributionId ? entry : null;
  }

  async function mockFetch(path, options = {}) {
    await wait(scenario === "slow" ? Math.max(delayMs, 100) : delayMs, options.signal);
    if (scenario === "networkError") throw new TypeError("Synthetic offline state.");
    const url = new URL(path, "https://archive.example.test");
    const method = options.method ?? "GET";
    const headers = new Headers(options.headers);
    const body = options.body ? JSON.parse(options.body) : null;
    if (scenario === "unavailable") return failure("SERVICE_UNAVAILABLE", "Please try again later.", 503);
    if (scenario === "rateLimited") return failure("RATE_LIMITED", "Please wait before retrying.", 429, { "Retry-After": "30" });

    if (url.pathname === "/api/session") {
      if (method === "GET") return reply(session);
      if (headers.get("X-CSRF-Token") !== session.csrfToken) {
        return failure("CSRF_INVALID", "Refresh your session and try again.", 403);
      }
      if (method === "POST") {
        if (scenario === "unauthenticated" || !body?.username || !body?.password) {
          return failure("INVALID_CREDENTIALS", "The sign-in details were not accepted.", 401);
        }
        rotateSession(COUPLE_SESSION);
        return reply(session);
      }
      if (method === "DELETE") {
        rotateSession(ANONYMOUS_SESSION);
        return reply(null, 204);
      }
    }

    const albumReply = albumServer.handle(url, method, headers, body);
    if (albumReply !== null) return albumReply;
    const privateContribution = url.pathname === "/api/memories/contributions" || url.pathname.startsWith("/api/memories/contributions/");
    const contributionPath = privateContribution ? url.pathname.replace("/api/memories/contributions", "/api/contributions") : url.pathname;
    if (privateContribution) {
      if (!session.authenticated || scenario === "unauthenticated") return failure("AUTH_REQUIRED", "Sign in again.", 401);
      if (scenario === "forbidden") return failure("ARCHIVE_UNAVAILABLE", "Archive access is unavailable.", 403);
      if (method !== "GET" && headers.get("X-CSRF-Token") !== session.csrfToken) return failure("CSRF_INVALID", "Refresh your session.", 403);
      if (method === "POST" && contributionPath === "/api/contributions" && body.guestName !== null) return failure("VALIDATION_FAILED", "Private memories cannot have a guest name.", 400);
    }
    if (contributionPath === "/api/contributions" && method === "POST") {
      if (scenario === "validation") return reply(VALIDATION_ERROR, 400);
      const key = headers.get("Idempotency-Key");
      if (!key) return failure("VALIDATION_FAILED", "An idempotency key is required.", 400);
      const fingerprint = canonical(body);
      const scopedKey = (privateContribution ? "couple:" : "guest:") + key;
      const existing = contributions.get(scopedKey);
      if (existing) {
        return existing.fingerprint === fingerprint ? reply(refreshReceipt(existing))
          : failure("IDEMPOTENCY_CONFLICT", "This retry key was already used for different content.", 409);
      }
      const receipt = {
        contributionId: nextId(), eventKey: "kevin-mel-wedding", createdAt: CREATED_AT,
        completion: body.memoryType ? "PENDING" : "COMPLETE",
        memories: (body.items ?? [null]).map((item) => ({
          memoryId: nextId(), clientItemId: item?.clientItemId ?? null,
          memoryType: body.memoryType ?? "TEXT", uploadState: item ? "PENDING" : null,
          reviewStatus: privateContribution ? "KEEP" : "PENDING", visibility: "COUPLE_ONLY",
        })),
      };
      const entry = { receipt, fingerprint, payload: clone(body), source: privateContribution ? "COUPLE" : "GUEST" };
      contributions.set(scopedKey, entry);
      if (!body.memoryType) memories.push({
        ...clone(MEMORY_DETAIL), contributionId: receipt.contributionId,
        memoryId: receipt.memories[0].memoryId, guestName: body.guestName,
        textContent: body.message, source: entry.source, reviewStatus: receipt.memories[0].reviewStatus,
      });
      if (scenario === "uncertainSubmission" && !lostResponse) {
        lostResponse = true;
        throw new TypeError("Synthetic lost response after commit.");
      }
      return reply(receipt, 201);
    }

    const receiptPath = contributionPath.match(/^\/api\/contributions\/([^/]+)\/receipt$/);
    if (receiptPath && method === "GET") {
      const entry = owned(receiptPath[1], headers, privateContribution);
      return entry ? reply(refreshReceipt(entry))
        : failure("NOT_FOUND", "That receipt is unavailable.", 404);
    }

    const mediaPath = contributionPath.match(/^\/api\/contributions\/([^/]+)\/memories\/([^/]+)\/(upload-grants|finalize)$/);
    if (mediaPath && method === "POST") {
      const entry = owned(mediaPath[1], headers, privateContribution);
      const memory = entry?.receipt.memories.find((item) => item.memoryId === mediaPath[2]);
      if (!memory || memory.memoryType === "TEXT") return failure("NOT_FOUND", "That upload is unavailable.", 404);
      if (mediaPath[3] === "upload-grants") {
        if (memory.uploadState === "UPLOADED") return failure("ALREADY_COMPLETE", "This item is already saved.", 409);
        const grant = { ...clone(UPLOAD_GRANT), grantId: nextId() };
        grant.uploadUrl = "https://uploads.example.test/" + grant.grantId;
        grant.expiresAt = scenario === "expiredGrant" ? "2000-01-01T00:00:00.000Z"
          : new Date(Date.now() + 300000).toISOString();
        grant.headers["Content-Type"] = entry.payload.items.find((item) =>
          item.clientItemId === memory.clientItemId).declaredContentType;
        grants.set(grant.grantId, { entry, memory, grant, uploaded: false });
        return reply(grant, 201);
      }
      const transfer = grants.get(body?.grantId);
      if (!transfer || transfer.memory !== memory) return failure("NOT_FOUND", "That upload grant is unavailable.", 404);
      // The backend replays a saved item after validating this grant's ownership,
      // even if its temporary transfer permission has since expired.
      if (memory.uploadState === "UPLOADED") return reply(refreshReceipt(entry));
      if (Date.parse(transfer.grant.expiresAt) <= Date.now()) {
        return failure("UPLOAD_GRANT_EXPIRED", "Request a new upload link for this item.", 410);
      }
      if (!transfer.uploaded) return failure("UPLOAD_INCOMPLETE", "The file transfer is not complete.", 409);
      if (scenario === "invalidMedia") {
        memory.uploadState = "FAILED";
        return failure("INVALID_MEDIA", "The file did not pass content verification.", 422);
      }
      if (memory.uploadState !== "UPLOADED") {
        const item = entry.payload.items.find((item) => item.clientItemId === memory.clientItemId);
        memory.uploadState = "UPLOADED";
        memories.push({
          ...clone(MEDIA_DETAIL), memoryId: memory.memoryId,
          contributionId: entry.receipt.contributionId, memoryType: memory.memoryType,
          guestName: entry.payload.guestName, caption: item.caption, source: entry.source, reviewStatus: memory.reviewStatus,
          media: {
            originalFilename: item.originalFilename, detectedContentType: item.declaredContentType,
            byteSize: item.byteSize, checksumSha256: item.checksumSha256,
            durationSeconds: item.durationSeconds ?? null, uploadState: "UPLOADED",
          },
        });
      }
      return reply(refreshReceipt(entry));
    }

    if (url.pathname.startsWith("/api/memories")) {
      if (!session.authenticated || scenario === "unauthenticated") {
        return failure("AUTH_REQUIRED", "Please sign in again.", 401);
      }
      if (scenario === "forbidden") return failure("ARCHIVE_UNAVAILABLE", "Archive access is unavailable.", 403);
      const serverTime = now();
      const available = (item) => item.reviewStatus !== "DELETE" || Date.parse(item.deleteAfter) > serverTime;
      if (url.pathname === "/api/memories" && method === "GET") {
        const filtered = scenario === "empty" ? [] : memories.filter((item) =>
          available(item) && (item.memoryType === "TEXT"
            || (["PHOTO", "AUDIO"].includes(item.memoryType) && item.media?.uploadState === "UPLOADED"))
          && item.reviewStatus === (url.searchParams.get("reviewStatus") ?? "PENDING"))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.memoryId.localeCompare(a.memoryId));
        const offset = Number((url.searchParams.get("cursor") ?? "offset:0").split(":")[1]);
        const limit = Number(url.searchParams.get("limit") ?? 20);
        if (!Number.isSafeInteger(offset) || offset < 0) return failure("INVALID_CURSOR", "Reload the list.", 400);
        return reply({
          items: filtered.slice(offset, offset + limit),
          nextCursor: offset + limit < filtered.length ? "offset:" + (offset + limit) : null,
        });
      }
      const detailPath = url.pathname.match(/^\/api\/memories\/([^/]+)(?:\/(review|playback|metadata))?$/);
      const memory = memories.find((item) => item.memoryId === detailPath?.[1]);
      if (!memory || !available(memory)) return failure("NOT_FOUND", "That memory is unavailable.", 404);
      if (!detailPath[2] && method === "GET") return reply(memory, 200, { ETag: '"' + memory.revision + '"' });
      if (detailPath[2] === "playback" && method === "GET") {
        if (memory.memoryType === "TEXT" || memory.reviewStatus === "DELETE") {
          return failure("NOT_FOUND", "This memory has no available media.", 404);
        }
        if (scenario === "playbackUnavailable") return failure("MEDIA_UNAVAILABLE", "The original is temporarily unavailable.", 503);
        return reply(PLAYBACK);
      }
      if (detailPath[2] === "metadata" && method === "PATCH") {
        if (headers.get("X-CSRF-Token") !== session.csrfToken) return failure("CSRF_INVALID", "Refresh your session.", 403);
        if (memory.reviewStatus === "DELETE") return failure("NOT_FOUND", "That memory cannot be edited.", 404);
        if (!headers.get("If-Match")) return failure("PRECONDITION_REQUIRED", "Reload before editing.", 428);
        if (headers.get("If-Match") !== '"' + memory.revision + '"') return failure("METADATA_CONFLICT", "This memory changed.", 412);
        let metadata;
        try { metadata = normalizeMemoryMetadata(body); } catch { return failure("VALIDATION_FAILED", "Check the metadata fields.", 400); }
        if (!sameMetadata(memory, metadata)) {
          Object.assign(memory, metadata); memory.revision++;
          memory.updatedAt = new Date(Math.max(serverTime, Date.parse(memory.createdAt))).toISOString();
          if (scenario === "uncertainSubmission" && !lostMetadataResponse) {
            lostMetadataResponse = true; throw new TypeError("Synthetic lost response after metadata commit.");
          }
        }
        return reply(memory, 200, { ETag: '"' + memory.revision + '"' });
      }
      if (detailPath[2] === "review" && method === "PATCH") {
        if (headers.get("X-CSRF-Token") !== session.csrfToken) return failure("CSRF_INVALID", "Refresh your session.", 403);
        if (!headers.get("If-Match")) return failure("PRECONDITION_REQUIRED", "Reload this memory before editing.", 428);
        if (headers.get("If-Match") !== '"' + memory.revision + '"') {
          return failure("REVIEW_CONFLICT", "This memory changed. Reload it before trying again.", 412);
        }
        if (!["PENDING", "KEEP", "ARCHIVED", "DELETE"].includes(body?.reviewStatus)) {
          return failure("VALIDATION_FAILED", "Choose a valid review state.", 400);
        }
        if (memory.reviewStatus === body.reviewStatus) return reply(memory, 200, { ETag: '"' + memory.revision + '"' });
        const deleting = body.reviewStatus === "DELETE";
        memory.reviewStatus = body.reviewStatus;
        if (deleting) albumServer.detachMemory(memory.memoryId);
        for (const entry of contributions.values()) {
          const receiptMemory = entry.receipt.memories.find(item => item.memoryId === memory.memoryId);
          if (receiptMemory) receiptMemory.reviewStatus = memory.reviewStatus;
        }
        memory.revision += 1;
        memory.updatedAt = new Date(serverTime).toISOString();
        // Fixtures describe a future wedding; keep the mock clock ordered.
        if (Date.parse(memory.updatedAt) < Date.parse(memory.createdAt)) memory.updatedAt = memory.createdAt;
        memory.deleteAfter = deleting
          ? new Date(serverTime + 30 * 86400000).toISOString() : null;
        if (scenario === "uncertainSubmission" && !lostReviewResponse) {
          lostReviewResponse = true;
          throw new TypeError("Synthetic lost response after review commit.");
        }
        return reply(memory, 200, { ETag: '"' + memory.revision + '"' });
      }
    }
    return failure("NOT_FOUND", "That endpoint is unavailable.", 404);
  }

  async function uploadFetch(url, options) {
    await wait(delayMs, options.signal);
    const grant = grants.get(new URL(url).pathname.slice(1));
    if (!grant) return reply(null, 404);
    if (Date.parse(grant.grant.expiresAt) <= Date.now()) return reply(null, 403);
    if (scenario === "partialUpload" && grant.entry.receipt.memories.indexOf(grant.memory) === 1 && !failedTransfer) {
      failedTransfer = true;
      // A direct storage PUT cannot mutate the application's receipt.
      return reply(null, 503);
    }
    grant.uploaded = true;
    return reply(null, 200);
  }

  const api = createArchiveApi({ client: createApiClient({ fetchImpl: mockFetch }), uploadFetch });
  return Object.assign(api, {
    setScenario(value) {
      if (!SCENARIOS.includes(value)) throw new TypeError("Unknown mock scenario.");
      scenario = value;
    },
  });
}
