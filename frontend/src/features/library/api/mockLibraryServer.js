import { normalizeLibraryFilters, normalizeLibraryQuery, normalizeTagName } from "../libraryFilters.js";
import { compareSaved } from "./libraryApi.js";

/** Synthetic private catalogue/search fixtures through the actual JSON adapter. */
export function createMockLibraryServer({ getSession, getScenario, getMemories, nextId, now, reply, failure }) {
  const tags = new Map(), lost = new Set();
  const eligible = memory => memory.reviewStatus !== "DELETE" && (memory.memoryType === "TEXT" || memory.media?.uploadState === "UPLOADED");
  const detail = entry => ({ ...entry.tag, memberCount: entry.members.length });
  const changed = entry => { entry.tag.revision = nextId(); entry.tag.updatedAt = new Date(now()).toISOString(); };
  const error = (code, status) => failure(code, "Reload current state before continuing.", status);
  const conflict = () => error("TAG_CONFLICT", 412);
  const condition = (headers, entry) => !headers.get("If-Match") ? error("PRECONDITION_REQUIRED", 428)
    : !/^"[0-9a-f-]{36}"$/.test(headers.get("If-Match")) ? error("VALIDATION_FAILED", 400)
      : headers.get("If-Match") !== '"' + entry.tag.revision + '"' ? conflict() : null;
  function result(entry, status = 200, kind = null) {
    if (kind && getScenario() === "uncertainSubmission" && !lost.has(kind)) { lost.add(kind); throw new TypeError("Synthetic discarded committed tag response."); }
    return reply(detail(entry), status, { ETag: '"' + entry.tag.revision + '"' });
  }
  async function page(rows, cursor, context, limit, field, code, revision = null) {
    const scope = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(context)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    let offset = 0;
    if (cursor) {
      let parsed; try { parsed = JSON.parse(decodeURIComponent(cursor)); } catch { return { error: error("INVALID_CURSOR", 400) }; }
      if (!Array.isArray(parsed) || parsed.length !== 3 || typeof parsed[0] !== "string" || typeof parsed[1] !== "string"
        || (parsed[2] !== null && typeof parsed[2] !== "string") || parsed[0] !== scope) return { error: error("INVALID_CURSOR", 400) };
      if (parsed[2] !== revision) return { error: error(code, 412) };
      offset = rows.findIndex(row => row[field] === parsed[1]) + 1; if (!offset) return { error: error(code, 412) };
    }
    const items = rows.slice(offset, offset + limit);
    return { items, nextCursor: offset + limit < rows.length ? encodeURIComponent(JSON.stringify([scope, items.at(-1)[field], revision])) : null };
  }
  const tagName = body => { if (!body || Object.keys(body).length !== 1 || !Object.hasOwn(body, "name")) throw new Error("Invalid fields."); return normalizeTagName(body.name); };
  return {
    detachMemory(memoryId) { for (const entry of tags.values()) { const index = entry.members.indexOf(memoryId); if (index >= 0) { entry.members.splice(index, 1); changed(entry); } } },
    async handle(url, method, headers, body) {
      if (!url.pathname.startsWith("/api/library/memories") && !url.pathname.startsWith("/api/tags")) return null;
      if (!getSession().authenticated || getScenario() === "unauthenticated") return error("AUTH_REQUIRED", 401);
      if (getScenario() === "forbidden") return error("ARCHIVE_UNAVAILABLE", 403);
      if (method !== "GET" && headers.get("X-CSRF-Token") !== getSession().csrfToken) return error("CSRF_INVALID", 403);
      const limit = Number(url.searchParams.get("limit") ?? 20), cursor = url.searchParams.get("cursor");
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) return error("VALIDATION_FAILED", 400);
      if (url.pathname === "/api/library/memories" && method === "GET") {
        let filters; try { filters = normalizeLibraryFilters({ q: url.searchParams.get("q") ?? "", memoryType: url.searchParams.get("memoryType") ?? "ALL",
          reviewStatus: url.searchParams.get("reviewStatus") ?? "ALL", datePrecision: url.searchParams.get("datePrecision") ?? "ALL", tagId: url.searchParams.get("tagId"),
          fromYear: url.searchParams.has("fromYear") ? Number(url.searchParams.get("fromYear")) : null, toYear: url.searchParams.has("toYear") ? Number(url.searchParams.get("toYear")) : null }); } catch { return error("VALIDATION_FAILED", 400); }
        const selected = filters.tagId ? tags.get(filters.tagId) : null; if (filters.tagId && (!selected || selected.tag.deletedAt !== null)) return error("NOT_FOUND", 404);
        const rows = getMemories().filter(memory => eligible(memory)
          && (filters.memoryType === "ALL" || memory.memoryType === filters.memoryType) && (filters.reviewStatus === "ALL" || memory.reviewStatus === filters.reviewStatus)
          && (filters.datePrecision === "ALL" || memory.datePrecision === filters.datePrecision)
          && (filters.fromYear === null || (memory.memoryDate !== null && Number(memory.memoryDate.slice(0, 4)) >= filters.fromYear))
          && (filters.toYear === null || (memory.memoryDate !== null && Number(memory.memoryDate.slice(0, 4)) <= filters.toYear))
          && (!selected || selected.members.includes(memory.memoryId))
          && (!filters.q || [memory.title, memory.description, memory.textContent, memory.caption, memory.guestName, memory.media?.originalFilename]
            .some(value => typeof value === "string" && value.toLowerCase().includes(filters.q.toLowerCase())))).sort(compareSaved);
        const paged = await page(rows, cursor, "library:" + JSON.stringify(filters), limit, "memoryId", "LIBRARY_CONFLICT"); return paged.error ?? reply(paged);
      }
      const attached = url.pathname.match(/^\/api\/library\/memories\/([^/]+)\/tags$/);
      if (attached && method === "GET") {
        const memoryId = attached[1].toLowerCase(); if (!getMemories().some(memory => memory.memoryId.toLowerCase() === memoryId && eligible(memory))) return error("NOT_FOUND", 404);
        const rows = [...tags.values()].filter(entry => entry.tag.deletedAt === null && entry.members.includes(memoryId)).map(detail).sort((a, b) => compareSaved(a, b, "tagId"));
        const paged = await page(rows, cursor, "attached:" + memoryId, limit, "tagId", "TAG_CONFLICT"); return paged.error ?? reply({ memoryId, ...paged });
      }
      if (url.pathname === "/api/tags" && method === "GET") {
        let q; try { q = normalizeLibraryQuery(url.searchParams.get("q") ?? ""); } catch { return error("VALIDATION_FAILED", 400); }
        const rows = [...tags.values()].map(detail).filter(tag => tag.deletedAt === null && tag.name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => compareSaved(a, b, "tagId"));
        const paged = await page(rows, cursor, "tags:" + q, limit, "tagId", "TAG_CONFLICT"); return paged.error ?? reply(paged);
      }
      const route = url.pathname.match(/^\/api\/tags\/([^/]+)(?:\/members(?:\/([^/]+))?)?$/); if (!route) return error("NOT_FOUND", 404);
      const tagId = route[1], memberId = route[2]?.toLowerCase(), isMembers = url.pathname.includes("/members"); let entry = tags.get(tagId);
      if (!isMembers && method === "PUT") {
        if (!headers.get("If-None-Match")) return error("PRECONDITION_REQUIRED", 428); if (headers.get("If-None-Match") !== "*") return error("VALIDATION_FAILED", 400); if (entry) return conflict();
        let name; try { name = tagName(body); } catch { return error("VALIDATION_FAILED", 400); }
        const createdAt = new Date(now()).toISOString(); entry = { tag: { tagId, name, visibility: "COUPLE_ONLY", revision: nextId(), createdAt, updatedAt: createdAt, deletedAt: null }, members: [] };
        tags.set(tagId, entry); return result(entry, 201, "create");
      }
      if (!entry) return error("NOT_FOUND", 404); if (!isMembers && method === "GET") return result(entry);
      if (isMembers && !memberId && method === "GET") {
        const rows = entry.members.map(value => getMemories().find(memory => memory.memoryId === value)).sort(compareSaved);
        const paged = await page(rows, cursor, "members:" + tagId, limit, "memoryId", "TAG_CONFLICT", entry.tag.revision);
        return paged.error ?? reply({ tag: detail(entry), items: paged.items.map(memory => ({ memory })), nextCursor: paged.nextCursor }, 200, { ETag: '"' + entry.tag.revision + '"' });
      }
      const rejected = condition(headers, entry); if (rejected) return rejected;
      if (!isMembers && method === "DELETE") { if (entry.tag.deletedAt === null) { changed(entry); entry.tag.name = null; entry.tag.deletedAt = entry.tag.updatedAt; entry.members = []; } return result(entry, 200, "delete"); }
      if (entry.tag.deletedAt !== null) return error("NOT_FOUND", 404);
      if (!isMembers && method === "PATCH") { let name; try { name = tagName(body); } catch { return error("VALIDATION_FAILED", 400); } if (name !== entry.tag.name) { entry.tag.name = name; changed(entry); } return result(entry, 200, "rename"); }
      if (isMembers && memberId && ["PUT", "DELETE"].includes(method)) {
        if (body !== null) return error("VALIDATION_FAILED", 400); if (!getMemories().some(memory => memory.memoryId.toLowerCase() === memberId && eligible(memory))) return error("NOT_FOUND", 404);
        const index = entry.members.indexOf(memberId); if (method === "PUT" && index < 0) { entry.members.push(memberId); changed(entry); }
        if (method === "DELETE" && index >= 0) { entry.members.splice(index, 1); changed(entry); } return result(entry, 200, method === "PUT" ? "attach" : "remove");
      }
      return error("NOT_FOUND", 404);
    },
  };
}
