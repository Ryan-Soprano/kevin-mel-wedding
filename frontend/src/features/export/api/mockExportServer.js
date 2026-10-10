/** Synthetic job/attempt state through the real JSON and binary adapter.
 * ZIP bytes are a tiny valid empty ZIP fixture, not production archive output. */
export function createMockExportServer({ getSession, getScenario, getMemories, nextId, now, reply, failure }) {
  const jobs = new Map(), lost = new Set(); let cachedId = null;
  const zip = new Uint8Array([80, 75, 5, 6, ...Array(18).fill(0)]);
  const hash = async () => [...new Uint8Array(await crypto.subtle.digest("SHA-256", zip))].map(n => n.toString(16).padStart(2, "0")).join("");
  const reject = (code, status) => failure(code, "Check the export before continuing.", status);
  const status = entry => structuredClone(entry.status);
  function result(entry, code = 200, kind = null) {
    if (kind && getScenario() === "uncertainSubmission" && !lost.has(kind)) { lost.add(kind); throw new TypeError("Synthetic lost committed export response."); }
    return reply(status(entry), code);
  }
  async function finish(entry) {
    const job = entry.status;
    if (job.state === "CAPTURING") { job.state = "READY"; job.capturedAt = new Date(now()).toISOString(); job.indexPartNumber = job.originalPartCount + 1;
      job.excludedCounts = { deletedOrPurgingMemories: 0, unfinishedOrUnavailableMemories: 0, deletedAlbums: 0, deletedTimelineEvents: 0, deletedTags: 0 }; }
    if (job.state === "PREPARING") {
      const attempt = entry.attempts.get(job.lastAttempt.attemptId), number = attempt.partNumber, index = number === job.indexPartNumber;
      entry.processed.add(number); job.processedOriginalParts = [...entry.processed].filter(n => n !== job.indexPartNumber).length;
      job.availableOriginals = job.processedOriginalParts ? job.totalOriginals : 0;
      job.preparedPart = { partNumber: number, kind: index ? "INDEX" : "ORIGINALS", filename: "kevin-mel-archive-" + job.exportId + "-part-" + number + ".zip", byteSize: zip.length,
        sha256: await hash(), generation: nextId(), attemptId: attempt.attemptId };
      job.indexNeedsRefresh = !index; job.complete = index && job.processedOriginalParts === job.originalPartCount; job.state = "READY";
      attempt.state = "SUCCEEDED"; job.lastAttempt = { ...attempt }; cachedId = job.exportId;
    }
  }
  const page = (rows, url) => { const size = Number(url.searchParams.get("limit") ?? 20), raw = url.searchParams.get("cursor"), offset = raw === null ? 0 : Number(raw);
    if (!Number.isSafeInteger(size) || size < 1 || size > 50 || !Number.isSafeInteger(offset) || offset < 0 || (raw !== null && String(offset) !== raw) || offset > rows.length) return null;
    return { items: rows.slice(offset, offset + size), nextCursor: offset + size < rows.length ? String(offset + size) : null }; };
  return { async handle(url, method, headers, body) {
    if (!url.pathname.startsWith("/api/exports")) return null;
    if (!getSession().authenticated || getScenario() === "unauthenticated") return reject("AUTH_REQUIRED", 401);
    if (getScenario() === "forbidden") return reject("ARCHIVE_UNAVAILABLE", 403);
    if (method !== "GET" && headers.get("X-CSRF-Token") !== getSession().csrfToken) return reject("CSRF_INVALID", 403);
    if (body !== null) return reject("VALIDATION_FAILED", 400);
    if (url.pathname === "/api/exports/current" && method === "GET") {
      const active = [...jobs.values()].find(entry => !["FAILED", "STALE", "CANCELLED", "EXPIRED"].includes(entry.status.state) && now() < Date.parse(entry.status.expiresAt));
      if (!active) return reject("EXPORT_UNAVAILABLE", 404); await finish(active); return result(active);
    }
    const route = url.pathname.match(/^\/api\/exports\/([^/]+)(?:\/(parts|issues|attempts)(?:\/([^/]+)(?:\/(prepare|download))?)?)?$/); if (!route) return reject("NOT_FOUND", 404);
    const exportId = route[1]; let entry = jobs.get(exportId);
    if (!route[2] && method === "PUT") {
      if (headers.get("If-None-Match") !== "*") return reject("PRECONDITION_REQUIRED", 428); if (entry) return reject("EXPORT_CONFLICT", 412);
      const active = getMemories().filter(m => m.reviewStatus !== "DELETE" && (m.memoryType === "TEXT" || m.media?.uploadState === "UPLOADED")), originals = active.filter(m => m.memoryType !== "TEXT");
      const createdAt = new Date(now()).toISOString(); entry = { attempts: new Map(), processed: new Set(), status: { exportId, state: "CAPTURING", createdAt, capturedAt: null,
        expiresAt: new Date(now() + 1800000).toISOString(), hardExpiresAt: new Date(now() + 86400000).toISOString(), totalMemories: active.length, totalOriginals: originals.length,
        totalOriginalBytes: originals.reduce((sum, m) => sum + m.media.byteSize, 0), originalPartCount: originals.length ? 1 : 0, indexPartNumber: null, processedOriginalParts: 0,
        availableOriginals: 0, unavailableOriginals: 0, complete: false, indexNeedsRefresh: false, preparedPart: null, lastAttempt: null, errorCode: null, excludedCounts: {}, pollAfterSeconds: 2 } };
      jobs.set(exportId, entry); return result(entry, 202, "create");
    }
    if (!entry) return reject("EXPORT_UNAVAILABLE", 404);
    if (now() >= Date.parse(entry.status.expiresAt) && !["EXPIRED", "CANCELLED"].includes(entry.status.state)) { entry.status.state = "EXPIRED"; entry.status.preparedPart = null; entry.status.complete = false; }
    if (route[2] === "attempts" && method === "GET") { const attempt = entry.attempts.get(route[3]); return attempt ? reply(attempt) : reject("NOT_FOUND", 404); }
    if (!route[2] && method === "GET") { await finish(entry); return result(entry); }
    if (method === "DELETE" || route[4] === "prepare") {
      const attemptId = headers.get("Idempotency-Key"), kind = method === "DELETE" ? "CANCEL" : "PREPARE", partNumber = kind === "CANCEL" ? null : Number(route[3]);
      if (!attemptId) return reject("VALIDATION_FAILED", 400); const previous = entry.attempts.get(attemptId);
      if (previous) return previous.kind === kind && previous.partNumber === partNumber ? result(entry) : reject("IDEMPOTENCY_CONFLICT", 409);
      if (kind === "PREPARE" && (["CANCELLED", "EXPIRED", "FAILED", "STALE"].includes(entry.status.state))) return reject("EXPORT_UNAVAILABLE", 410);
      if (kind === "PREPARE" && (!Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > entry.status.indexPartNumber)) return reject("VALIDATION_FAILED", 400);
      const attempt = { attemptId, kind, partNumber, state: kind === "CANCEL" ? "SUCCEEDED" : "RUNNING" }; entry.attempts.set(attemptId, attempt); entry.status.lastAttempt = attempt;
      entry.status.preparedPart = null; entry.status.complete = false; entry.status.state = kind === "CANCEL" ? "CANCELLED" : "PREPARING";
      return result(entry, kind === "CANCEL" ? 200 : 202, kind.toLowerCase());
    }
    if (route[2] === "parts" && !route[3] && method === "GET") {
      const rows = Array.from({ length: entry.status.indexPartNumber ?? 0 }, (_, index) => ({ partNumber: index + 1, kind: index + 1 === entry.status.indexPartNumber ? "INDEX" : "ORIGINALS",
        state: entry.status.preparedPart?.partNumber === index + 1 && cachedId === exportId ? "CACHED" : entry.processed.has(index + 1) ? "PROCESSED" : "UNPROCESSED", availableOriginals: index + 1 === 1 && entry.processed.has(1) ? entry.status.totalOriginals : 0, unavailableOriginals: 0 }));
      const result = page(rows, url); return result ? reply({ exportId, ...result }) : reject("INVALID_CURSOR", 400);
    }
    if (route[2] === "issues" && method === "GET") return reply({ exportId, items: [], nextCursor: null });
    if (route[4] === "download" && method === "GET") {
      const part = entry.status.preparedPart;
      if (cachedId !== exportId || !part || part.partNumber !== Number(route[3]) || part.generation !== url.searchParams.get("generation")) return reject("EXPORT_PART_UNAVAILABLE", 409);
      return new Response(zip, { headers: { "Content-Type": "application/zip", "Content-Length": String(zip.length), "X-Archive-SHA256": part.sha256, "Content-Disposition": 'attachment; filename="' + part.filename + '"' } });
    }
    return reject("NOT_FOUND", 404);
  } };
}
