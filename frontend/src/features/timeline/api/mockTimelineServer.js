import { compareCanonical, compareEvents, compareInstants, eventFields, normalizeEventFields, normalizeTimelineFilters } from "../timelineFields.js";

/** Synthetic authenticated server through the same JSON/ETag adapter as production. */
export function createMockTimelineServer({ getSession, getScenario, getMemories, nextId, now, reply, failure }) {
  const events = new Map(), lost = new Set(); let listRevision = nextId();
  let latestActionTime = null;
  function actionTimestamp() {
    const current = now();
    latestActionTime = latestActionTime === null
      ? current
      : Math.max(latestActionTime, current);
    return new Date(latestActionTime).toISOString();
  }
  const detail = entry => ({ ...entry.event, memberCount: entry.members.length });
  const conflict = () => failure("TIMELINE_CONFLICT", "Timeline changed. Reload current state.", 412);
  const invalidCursor = () => failure("INVALID_CURSOR", "Reload the first page.", 400);
  const changed = (entry) => {
    entry.event.revision = nextId();
    entry.event.updatedAt = actionTimestamp();
    listRevision = nextId();
  };
  const conditional = (headers, entry) => !headers.get("If-Match") ? failure("PRECONDITION_REQUIRED", "Reload the event.", 428)
    : !/^"[0-9a-f-]{36}"$/.test(headers.get("If-Match")) ? failure("VALIDATION_FAILED", "Use a valid revision.", 400)
      : headers.get("If-Match") !== '"' + entry.event.revision + '"' ? conflict() : null;
  const result = (entry, status = 200, kind = null) => {
    if (kind && getScenario() === "uncertainSubmission" && !lost.has(kind)) {
      lost.add(kind); throw new TypeError("Synthetic discarded committed timeline response.");
    }
    return reply(detail(entry), status, { ETag: '"' + entry.event.revision + '"' });
  };
  function page(rows, cursor, revision, scope, limit, identity) {
    let offset = 0;
    if (cursor) {
      let parsed; try { parsed = JSON.parse(decodeURIComponent(cursor)); } catch { return { error: invalidCursor() }; }
      if (!Array.isArray(parsed) || parsed.length !== 3 || typeof parsed[0] !== "string" || typeof parsed[1] !== "string" || typeof parsed[2] !== "string") return { error: invalidCursor() };
      if (parsed[1] !== scope) {
        return { error: invalidCursor() };
      }
      if (parsed[0] !== revision) {
        return { error: conflict() };
      }
      offset = rows.findIndex(row => identity(row) === parsed[2]) + 1;
      if (!offset) return { error: invalidCursor() };
    }
    const items = rows.slice(offset, offset + limit);
    return { items, nextCursor: offset + limit < rows.length ? encodeURIComponent(JSON.stringify([revision, scope, identity(items.at(-1))])) : null };
  }
  return {
    detachMemory(memoryId) {
      for (const entry of events.values()) {
        const index = entry.members.indexOf(memoryId); if (index >= 0) { entry.members.splice(index, 1); changed(entry); }
      }
    },
    handle(url, method, headers, body) {
      if (!url.pathname.startsWith("/api/timeline/events")) return null;
      if (!getSession().authenticated || getScenario() === "unauthenticated") return failure("AUTH_REQUIRED", "Sign in again.", 401);
      if (getScenario() === "forbidden") return failure("ARCHIVE_UNAVAILABLE", "Archive access unavailable.", 403);
      if (method !== "GET" && headers.get("X-CSRF-Token") !== getSession().csrfToken) return failure("CSRF_INVALID", "Refresh your session.", 403);
      const limit = Number(url.searchParams.get("limit") ?? 20), cursor = url.searchParams.get("cursor");
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) return failure("VALIDATION_FAILED", "Use a bounded page.", 400);
      if (url.pathname === "/api/timeline/events" && method === "GET") {
        let filters; try { filters = normalizeTimelineFilters({ datePrecision: url.searchParams.get("datePrecision") ?? "ALL",
          fromYear: url.searchParams.has("fromYear") ? Number(url.searchParams.get("fromYear")) : null,
          toYear: url.searchParams.has("toYear") ? Number(url.searchParams.get("toYear")) : null }); } catch { return failure("VALIDATION_FAILED", "Check the timeline filters.", 400); }
        const rows = [...events.values()].map(detail).filter(event => event.deletedAt === null
          && (filters.datePrecision === "ALL" || event.datePrecision === filters.datePrecision)
          && (filters.fromYear === null || (event.eventDate !== null && Number(event.eventDate.slice(0, 4)) >= filters.fromYear))
          && (filters.toYear === null || (event.eventDate !== null && Number(event.eventDate.slice(0, 4)) <= filters.toYear))).sort(compareEvents);
        const paged = page(rows, cursor, listRevision, JSON.stringify(filters), limit, row => row.eventId);
        return paged.error ?? reply({ revision: listRevision, ...paged }, 200, { ETag: '"' + listRevision + '"' });
      }
      const route = url.pathname.match(/^\/api\/timeline\/events\/([^/]+)(?:\/memories(?:\/([^/]+))?)?$/);
      if (!route) return failure("NOT_FOUND", "This route is unavailable.", 404);
      const eventId = route[1], memoryId = route[2], isMembers = url.pathname.includes("/memories"); let entry = events.get(eventId);
      if (!isMembers && method === "PUT") {
        if (!headers.get("If-None-Match")) return failure("PRECONDITION_REQUIRED", "Use a new event identity.", 428);
        if (headers.get("If-None-Match") !== "*") return failure("VALIDATION_FAILED", "Use a create condition.", 400);
        if (entry) return conflict();
        let fields; try { fields = normalizeEventFields(body); } catch { return failure("VALIDATION_FAILED", "Check the event fields.", 400); }
        const createdAt = actionTimestamp();
        entry = {
          event: {
            eventId,
            ...fields,
            visibility: "COUPLE_ONLY",
            revision: nextId(),
            createdAt,
            updatedAt: createdAt,
            deletedAt: null,
          },
          members: [],
        };
        events.set(eventId, entry); listRevision = nextId(); return result(entry, 201, "create");
      }
      if (!entry) return failure("NOT_FOUND", "This event is unavailable.", 404);
      if (!isMembers && method === "GET") return result(entry);
      if (isMembers && !memoryId && method === "GET") {
        const rows = entry.members.map(id => getMemories().find(memory => memory.memoryId === id))
          .sort((a, b) => compareInstants(a.createdAt, b.createdAt) || compareCanonical(a.memoryId.toLowerCase(), b.memoryId.toLowerCase()));
        const paged = page(rows, cursor, entry.event.revision, eventId, limit, memory => memory.memoryId);
        return paged.error ?? reply({ event: detail(entry), items: paged.items.map(memory => ({ memory })), nextCursor: paged.nextCursor }, 200, { ETag: '"' + entry.event.revision + '"' });
      }
      const rejected = conditional(headers, entry); if (rejected) return rejected;
      if (!isMembers && method === "DELETE") {
        if (entry.event.deletedAt === null) { changed(entry); Object.assign(entry.event, { title: null, description: null, eventDate: null, datePrecision: "UNKNOWN", deletedAt: entry.event.updatedAt }); entry.members = []; }
        return result(entry, 200, "delete");
      }
      if (entry.event.deletedAt !== null) return failure("NOT_FOUND", "This event was deleted.", 404);
      if (!isMembers && method === "PATCH") {
        let fields; try { fields = normalizeEventFields(body); } catch { return failure("VALIDATION_FAILED", "Check event fields.", 400); }
        if (Object.keys(fields).some(field => fields[field] !== eventFields(entry.event)[field])) { Object.assign(entry.event, fields); changed(entry); }
        return result(entry, 200, "edit");
      }
      if (isMembers && memoryId && ["PUT", "DELETE"].includes(method)) {
        if (body !== null) return failure("VALIDATION_FAILED", "This action has no body.", 400);
        const memory = getMemories().find(memory => memory.memoryId === memoryId && memory.reviewStatus !== "DELETE"
          && (memory.memoryType === "TEXT" || memory.media?.uploadState === "UPLOADED"));
        if (!memory) return failure("NOT_FOUND", "This memory is unavailable.", 404);
        const index = entry.members.indexOf(memoryId);
        if (method === "PUT" && index < 0) { entry.members.push(memoryId); changed(entry); }
        if (method === "DELETE" && index >= 0) { entry.members.splice(index, 1); changed(entry); }
        return result(entry, 200, method === "PUT" ? "link" : "unlink");
      }
      return failure("NOT_FOUND", "This route is unavailable.", 404);
    },
  };
}
