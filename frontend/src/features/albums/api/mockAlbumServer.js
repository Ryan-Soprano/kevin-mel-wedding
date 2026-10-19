import { normalizeAlbumName } from "../albumName.js";

/** Synthetic private album server, exercised through the real JSON adapter. */
export function createMockAlbumServer({
  getSession,
  getScenario,
  getMemories,
  nextId,
  now,
  reply,
  failure,
}) {
  const albums = new Map();
  const lost = new Set();
  const timestamp = () => new Date(now()).toISOString();
  const detail = (entry) => ({
    ...entry.album,
    memberCount: entry.members.length,
  });
  function changed(entry) {
    entry.album.revision = nextId();
    entry.album.updatedAt = new Date(
      Math.max(now(), Date.parse(entry.album.updatedAt)),
    ).toISOString();
  }
  const conflict = () =>
    failure("ALBUM_CONFLICT", "This album changed. Reload it.", 412);
  const conditional = (headers, entry) =>
    !headers.get("If-Match")
      ? failure(
          "PRECONDITION_REQUIRED",
          "Reload before changing this album.",
          428,
        )
      : !/^"[0-9a-f-]{36}"$/.test(headers.get("If-Match"))
        ? failure("VALIDATION_FAILED", "Supply a valid revision.", 400)
        : headers.get("If-Match") !== '"' + entry.album.revision + '"'
          ? conflict()
          : null;
  function result(entry, status = 200, kind = null) {
    if (kind && getScenario() === "uncertainSubmission" && !lost.has(kind)) {
      lost.add(kind);
      throw new TypeError("Synthetic discarded committed album response.");
    }
    return reply(detail(entry), status, {
      ETag: '"' + entry.album.revision + '"',
    });
  }
  function nameBody(body) {
    if (!body || Object.keys(body).length !== 1 || !Object.hasOwn(body, "name"))
      throw new Error("Invalid name body.");
    return normalizeAlbumName(body.name);
  }
  return {
    detachMemory(memoryId) {
      for (const entry of albums.values()) {
        const index = entry.members.indexOf(memoryId);
        if (index >= 0) {
          entry.members.splice(index, 1);
          changed(entry);
        }
      }
    },
    handle(url, method, headers, body) {
      if (!url.pathname.startsWith("/api/albums")) return null;
      if (!getSession().authenticated || getScenario() === "unauthenticated")
        return failure("AUTH_REQUIRED", "Sign in again.", 401);
      if (getScenario() === "forbidden")
        return failure(
          "ARCHIVE_UNAVAILABLE",
          "Archive access unavailable.",
          403,
        );
      if (
        method !== "GET" &&
        headers.get("X-CSRF-Token") !== getSession().csrfToken
      )
        return failure("CSRF_INVALID", "Refresh your session.", 403);
      const limit = Number(url.searchParams.get("limit") ?? 20);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50)
        return failure("VALIDATION_FAILED", "Use a bounded page.", 400);
      if (url.pathname === "/api/albums" && method === "GET") {
        // Synthetic offsets do not model production keyset pagination during concurrent list edits.
        const cursor = url.searchParams.get("cursor") ?? "albums:0";
        if (!/^albums:\d+$/.test(cursor))
          return failure("VALIDATION_FAILED", "Reload the list.", 400);
        const offset = Number(cursor.split(":")[1]);
        const entries = [...albums.values()]
          .filter((entry) => entry.album.deletedAt === null)
          .sort(
            (a, b) =>
              b.album.createdAt.localeCompare(a.album.createdAt) ||
              b.album.albumId.localeCompare(a.album.albumId),
          );
        return reply({
          items: entries.slice(offset, offset + limit).map(detail),
          nextCursor:
            offset + limit < entries.length
              ? "albums:" + (offset + limit)
              : null,
        });
      }
      const route = url.pathname.match(
        /^\/api\/albums\/([^/]+)(?:\/members(?:\/([^/]+)(?:\/(move))?)?)?$/,
      );
      if (!route)
        return failure("NOT_FOUND", "That route is unavailable.", 404);
      const albumId = route[1],
        memoryId = route[2];
      let entry = albums.get(albumId);
      if (!url.pathname.includes("/members") && method === "PUT") {
        if (!headers.get("If-None-Match"))
          return failure(
            "PRECONDITION_REQUIRED",
            "Use a new album identity.",
            428,
          );
        if (headers.get("If-None-Match") !== "*")
          return failure("VALIDATION_FAILED", "Use a create condition.", 400);
        if (entry) return conflict();
        let name;
        try {
          name = nameBody(body);
        } catch {
          return failure("VALIDATION_FAILED", "Check the album name.", 400);
        }
        const createdAt = timestamp();
        entry = {
          album: {
            albumId,
            name,
            visibility: "COUPLE_ONLY",
            revision: nextId(),
            createdAt,
            updatedAt: createdAt,
            deletedAt: null,
          },
          members: [],
        };
        albums.set(albumId, entry);
        return result(entry, 201, "create");
      }
      if (!entry)
        return failure("NOT_FOUND", "That album is unavailable.", 404);
      if (!url.pathname.includes("/members") && method === "GET")
        return result(entry);
      if (url.pathname.endsWith("/members") && method === "GET") {
        const cursor = url.searchParams.get("cursor");
        const parts = cursor?.split(":");
        if (cursor && !/^members:[0-9a-f-]{36}:\d+$/.test(cursor))
          return failure("VALIDATION_FAILED", "Reload this album.", 400);
        if (cursor && parts[1] !== entry.album.revision) return conflict();
        const offset = cursor ? Number(parts[2]) : 0;
        return reply(
          {
            album: detail(entry),
            items: entry.members
              .slice(offset, offset + limit)
              .map((id, index) => ({
                memory: getMemories().find((memory) => memory.memoryId === id),
                canMoveEarlier: offset + index > 0,
                canMoveLater: offset + index < entry.members.length - 1,
              })),
            nextCursor:
              offset + limit < entry.members.length
                ? `members:${entry.album.revision}:${offset + limit}`
                : null,
          },
          200,
          { ETag: '"' + entry.album.revision + '"' },
        );
      }
      const rejected = conditional(headers, entry);
      if (rejected) return rejected;
      if (!url.pathname.includes("/members") && method === "DELETE") {
        if (entry.album.deletedAt === null) {
          changed(entry);
          entry.album.name = null;
          entry.album.deletedAt = entry.album.updatedAt;
          entry.members = [];
        }
        return result(entry, 200, "delete");
      }
      if (entry.album.deletedAt !== null)
        return failure("NOT_FOUND", "That album was deleted.", 404);
      if (!url.pathname.includes("/members") && method === "PATCH") {
        let name;
        try {
          name = nameBody(body);
        } catch {
          return failure("VALIDATION_FAILED", "Check the name.", 400);
        }
        if (name !== entry.album.name) {
          entry.album.name = name;
          changed(entry);
        }
        return result(entry, 200, "rename");
      }
      const memory = getMemories().find(
        (item) =>
          item.memoryId === memoryId &&
          item.reviewStatus !== "DELETE" &&
          (item.memoryType === "TEXT" ||
            item.media?.uploadState === "UPLOADED"),
      );
      if (!memory)
        return failure("NOT_FOUND", "That memory is unavailable.", 404);
      const index = entry.members.indexOf(memoryId);
      if (!route[3] && ["PUT", "DELETE"].includes(method)) {
        if (body !== null)
          return failure("VALIDATION_FAILED", "This action has no body.", 400);
        if (method === "PUT" && index < 0) {
          entry.members.push(memoryId);
          changed(entry);
        }
        if (method === "DELETE" && index >= 0) {
          entry.members.splice(index, 1);
          changed(entry);
        }
        return result(entry, 200, method === "PUT" ? "add" : "remove");
      }
      if (route[3] === "move" && method === "POST") {
        if (
          !body ||
          Object.keys(body).length !== 1 ||
          !["EARLIER", "LATER"].includes(body.direction)
        )
          return failure("VALIDATION_FAILED", "Choose a direction.", 400);
        if (index < 0)
          return failure("NOT_FOUND", "That member is unavailable.", 404);
        const adjacent = index + (body.direction === "EARLIER" ? -1 : 1);
        if (adjacent >= 0 && adjacent < entry.members.length) {
          [entry.members[index], entry.members[adjacent]] = [
            entry.members[adjacent],
            entry.members[index],
          ];
          changed(entry);
        }
        return result(entry, 200, "move");
      }
      return failure("NOT_FOUND", "That route is unavailable.", 404);
    },
  };
}
