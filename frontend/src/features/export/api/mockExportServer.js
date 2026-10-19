const INACTIVITY_MS = 30 * 60_000;
const HARD_LIFETIME_MS = 24 * 60 * 60_000;
const ACTIVE_STATES = new Set(["CAPTURING", "READY", "PREPARING", "READY_WITH_WARNINGS"]);

/** Synthetic job/attempt state through the real JSON and binary adapter.
 * ZIP bytes are a tiny valid empty ZIP fixture, not production archive output. */
export function createMockExportServer({
  getSession,
  getScenario,
  getMemories,
  nextId,
  now,
  reply,
  failure,
}) {
  const jobs = new Map();
  const lost = new Set();
  let cachedId = null;
  const zip = new Uint8Array([80, 75, 5, 6, ...Array(18).fill(0)]);
  const hash = async () => [...new Uint8Array(await crypto.subtle.digest("SHA-256", zip))]
    .map(value => value.toString(16).padStart(2, "0")).join("");
  const reject = (code, status, headers = {}) => failure(
    code,
    "Check the export before continuing.",
    status,
    headers,
  );
  const busy = () => reject("EXPORT_BUSY", 409, { "Retry-After": "2" });
  const active = entry => ACTIVE_STATES.has(entry.status.state);
  const status = entry => structuredClone(entry.status);

  function result(entry, code = 200, kind = null) {
    if (kind && getScenario() === "uncertainSubmission" && !lost.has(kind)) {
      lost.add(kind);
      throw new TypeError("Synthetic lost committed export response.");
    }
    return reply(status(entry), code);
  }

  function clearCache() {
    const cached = jobs.get(cachedId);
    if (cached) {
      cached.status.preparedPart = null;
    }
    cachedId = null;
  }

  function end(entry, state) {
    Object.assign(entry.status, {
      state,
      capturedAt: null,
      totalMemories: 0,
      totalOriginals: 0,
      totalOriginalBytes: 0,
      excludedCounts: {},
      originalPartCount: 0,
      indexPartNumber: null,
      processedOriginalParts: 0,
      availableOriginals: 0,
      unavailableOriginals: 0,
      complete: false,
      indexNeedsRefresh: false,
      preparedPart: null,
    });
    entry.processed.clear();
    for (const attempt of entry.attempts.values()) {
      if (attempt.state === "RUNNING") {
        attempt.state = "FAILED";
      }
    }
    if (cachedId === entry.status.exportId) {
      clearCache();
    }
  }

  function sweep() {
    for (const [exportId, entry] of jobs) {
      if (active(entry) && now() >= Date.parse(entry.status.expiresAt)) {
        end(entry, "EXPIRED");
      }
      if (!active(entry) && now() >= Date.parse(entry.status.hardExpiresAt)) {
        jobs.delete(exportId);
      }
    }
  }

  function touch(entry) {
    if (active(entry)) {
      entry.status.expiresAt = new Date(Math.min(
        now() + INACTIVITY_MS,
        Date.parse(entry.status.hardExpiresAt),
      )).toISOString();
    }
  }

  async function finish(entry) {
    const job = entry.status;
    if (job.state === "CAPTURING") {
      job.state = "READY";
      job.capturedAt = new Date(now()).toISOString();
      job.indexPartNumber = job.originalPartCount + 1;
      job.indexNeedsRefresh = true;
      job.excludedCounts = {
        deletedOrPurgingMemories: 0,
        unfinishedOrUnavailableMemories: 0,
        deletedAlbums: 0,
        deletedTimelineEvents: 0,
        deletedTags: 0,
      };
    }
    if (job.state !== "PREPARING") {
      return;
    }
    const attempt = entry.attempts.get(job.lastAttempt.attemptId);
    const number = attempt.partNumber;
    const index = number === job.indexPartNumber;
    const sha256 = await hash();
    sweep();
    // Cancellation, expiry or another completed read can retire this work
    // while the digest is pending. Only its current owner may publish a part.
    if (
      job.state !== "PREPARING" || attempt.state !== "RUNNING"
      || job.lastAttempt.attemptId !== attempt.attemptId
    ) {
      return;
    }
    entry.processed.add(number);
    job.processedOriginalParts = [...entry.processed]
      .filter(part => part !== job.indexPartNumber).length;
    job.availableOriginals = job.processedOriginalParts ? job.totalOriginals : 0;
    job.preparedPart = {
      partNumber: number,
      kind: index ? "INDEX" : "ORIGINALS",
      filename: "kevin-mel-archive-" + job.exportId + "-part-" + number + ".zip",
      byteSize: zip.length,
      sha256,
      generation: nextId(),
      attemptId: attempt.attemptId,
    };
    job.indexNeedsRefresh = !index;
    job.complete = index && job.processedOriginalParts === job.originalPartCount;
    job.state = "READY";
    attempt.state = "SUCCEEDED";
    job.lastAttempt = attempt;
    cachedId = job.exportId;
  }

  function pageSize(url) {
    const raw = url.searchParams.get("limit");
    if (raw === null) {
      return 20;
    }
    if (!/^[0-9]{1,2}$/.test(raw)) {
      return null;
    }
    const size = Number(raw);
    return size >= 1 && size <= 50 ? size : null;
  }

  function cursor(exportId, kind, offset) {
    return btoa("1|" + exportId + "|" + kind + "|" + offset)
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function page(rows, url, exportId, kind, size) {
    const raw = url.searchParams.get("cursor");
    let offset = 0;
    if (raw !== null) {
      try {
        if (raw.length > 128 || !/^[A-Za-z0-9_-]+$/.test(raw)) {
          return null;
        }
        const fields = atob(raw.replace(/-/g, "+").replace(/_/g, "/")).split("|");
        if (
          fields.length !== 4 || fields[0] !== "1" || fields[1] !== exportId
          || fields[2] !== kind || !/^[1-9][0-9]{0,5}$/.test(fields[3])
        ) {
          return null;
        }
        offset = Number(fields[3]);
        if (offset > rows.length || cursor(exportId, kind, offset) !== raw) {
          return null;
        }
      } catch {
        return null;
      }
    }
    return {
      items: rows.slice(offset, offset + size),
      nextCursor: offset + size < rows.length
        ? cursor(exportId, kind, offset + size)
        : null,
    };
  }

  return {
    async handle(url, method, headers, body) {
      if (!url.pathname.startsWith("/api/exports")) {
        return null;
      }
      if (!getSession().authenticated || getScenario() === "unauthenticated") {
        return reject("AUTH_REQUIRED", 401);
      }
      if (getScenario() === "forbidden") {
        return reject("ARCHIVE_UNAVAILABLE", 403);
      }
      if (method !== "GET" && headers.get("X-CSRF-Token") !== getSession().csrfToken) {
        return reject("CSRF_INVALID", 403);
      }
      if (body !== null) {
        return reject("VALIDATION_FAILED", 400);
      }
      sweep();
      if (url.pathname === "/api/exports/current" && method === "GET") {
        const current = [...jobs.values()].find(active);
        if (!current) {
          return reject("EXPORT_NOT_FOUND", 404);
        }
        touch(current);
        await finish(current);
        return result(current);
      }
      const route = url.pathname.match(
        /^\/api\/exports\/([^/]+)(?:\/(parts|issues|attempts)(?:\/([^/]+)(?:\/(prepare|download))?)?)?$/,
      );
      if (!route) {
        return reject("NOT_FOUND", 404);
      }
      const exportId = route[1];
      const paged = method === "GET" && !route[3]
        && ["parts", "issues"].includes(route[2]);
      const size = paged ? pageSize(url) : null;
      if (paged && size === null) {
        return reject("VALIDATION_FAILED", 400);
      }
      let entry = jobs.get(exportId);
      if (!route[2] && method === "PUT") {
        if (!headers.has("If-None-Match")) {
          return reject("PRECONDITION_REQUIRED", 428);
        }
        if (headers.get("If-None-Match") !== "*") {
          return reject("VALIDATION_FAILED", 400);
        }
        if (entry) {
          return reject("EXPORT_EXISTS", 412);
        }
        const memories = getMemories().filter(memory => memory.reviewStatus !== "DELETE"
          && (memory.memoryType === "TEXT" || memory.media?.uploadState === "UPLOADED"));
        const originals = memories.filter(memory => memory.memoryType !== "TEXT");
        const created = now();
        const createdAt = new Date(created).toISOString();
        entry = {
          attempts: new Map(),
          processed: new Set(),
          status: {
            exportId,
            state: "CAPTURING",
            createdAt,
            capturedAt: null,
            expiresAt: new Date(created + INACTIVITY_MS).toISOString(),
            hardExpiresAt: new Date(created + HARD_LIFETIME_MS).toISOString(),
            totalMemories: memories.length,
            totalOriginals: originals.length,
            totalOriginalBytes: originals.reduce((sum, memory) => sum + memory.media.byteSize, 0),
            originalPartCount: originals.length ? 1 : 0,
            indexPartNumber: null,
            processedOriginalParts: 0,
            availableOriginals: 0,
            unavailableOriginals: 0,
            complete: false,
            indexNeedsRefresh: false,
            preparedPart: null,
            lastAttempt: null,
            errorCode: null,
            excludedCounts: {},
            pollAfterSeconds: 2,
          },
        };
        jobs.set(exportId, entry);
        return result(entry, 202, "create");
      }
      if (!entry) {
        return reject("EXPORT_NOT_FOUND", 404);
      }
      if (route[2] === "attempts" && method === "GET") {
        touch(entry);
        const attempt = entry.attempts.get(route[3]);
        return attempt ? reply(attempt) : reject("EXPORT_NOT_FOUND", 404);
      }
      if (!route[2] && method === "GET") {
        touch(entry);
        await finish(entry);
        return result(entry);
      }
      if (method === "DELETE" || route[4] === "prepare") {
        const attemptId = headers.get("Idempotency-Key");
        const kind = method === "DELETE" ? "CANCEL" : "PREPARE";
        const number = kind === "CANCEL" ? null : Number(route[3]);
        if (!attemptId) {
          return reject("VALIDATION_FAILED", 400);
        }
        if (kind === "PREPARE") {
          touch(entry);
        }
        const previous = entry.attempts.get(attemptId);
        if (previous) {
          if (previous.kind !== kind || previous.partNumber !== number) {
            return reject("IDEMPOTENCY_CONFLICT", 409);
          }
          return result(entry, previous.state === "RUNNING" ? 202 : 200);
        }
        if (kind === "PREPARE") {
          if (!active(entry)) {
            return reject("EXPORT_UNAVAILABLE", 410);
          }
          if ([...jobs.values()].some(job => ["CAPTURING", "PREPARING"].includes(job.status.state))) {
            return busy();
          }
          if (!Number.isSafeInteger(number) || number < 1 || number > entry.status.indexPartNumber) {
            return reject("VALIDATION_FAILED", 400);
          }
          if (
            number === entry.status.indexPartNumber
            && entry.status.processedOriginalParts !== entry.status.originalPartCount
          ) {
            return reject("EXPORT_PARTS_PENDING", 409);
          }
          clearCache();
        }
        const attempt = {
          attemptId,
          kind,
          partNumber: number,
          state: kind === "CANCEL" ? "SUCCEEDED" : "RUNNING",
        };
        entry.attempts.set(attemptId, attempt);
        entry.status.lastAttempt = attempt;
        if (kind === "CANCEL") {
          if (active(entry)) {
            end(entry, "CANCELLED");
          }
        } else {
          entry.status.preparedPart = null;
          entry.status.complete = false;
          entry.status.indexNeedsRefresh = true;
          entry.status.state = "PREPARING";
        }
        return result(entry, kind === "CANCEL" ? 200 : 202, kind.toLowerCase());
      }
      if (paged) {
        touch(entry);
        const rows = route[2] === "issues" ? [] : Array.from(
          { length: entry.status.indexPartNumber ?? 0 },
          (_, index) => ({
            partNumber: index + 1,
            kind: index + 1 === entry.status.indexPartNumber ? "INDEX" : "ORIGINALS",
            state: entry.status.preparedPart?.partNumber === index + 1 && cachedId === exportId
              ? "CACHED"
              : entry.processed.has(index + 1) ? "PROCESSED" : "UNPROCESSED",
            availableOriginals: index === 0 && entry.processed.has(1)
              ? entry.status.totalOriginals
              : 0,
            unavailableOriginals: 0,
          }),
        );
        const result = page(rows, url, exportId, route[2].toUpperCase(), size);
        return result ? reply({ exportId, ...result }) : reject("INVALID_CURSOR", 400);
      }
      if (route[4] === "download" && method === "GET") {
        touch(entry);
        if (!active(entry)) {
          return reject("EXPORT_UNAVAILABLE", 410);
        }
        if ([...jobs.values()].some(job => ["CAPTURING", "PREPARING"].includes(job.status.state))) {
          return busy();
        }
        const part = entry.status.preparedPart;
        if (
          cachedId !== exportId || !part || part.partNumber !== Number(route[3])
          || part.generation !== url.searchParams.get("generation")
        ) {
          return reject("EXPORT_PART_UNAVAILABLE", 409);
        }
        return new Response(zip, {
          headers: {
            "Content-Type": "application/zip",
            "Content-Length": String(zip.length),
            "X-Archive-SHA256": part.sha256,
            "Content-Disposition": 'attachment; filename="' + part.filename + '"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      return reject("NOT_FOUND", 404);
    },
  };
}
