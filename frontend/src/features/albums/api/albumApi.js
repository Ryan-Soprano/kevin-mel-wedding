import { contractMismatch } from "../../../shared/api/apiClient.js";
import { normalizeAlbumName } from "../albumName.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MEMORY_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value) => typeof value === "string" && UUID.test(value);
const time = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d\d-\d\dT/.test(value) &&
  /Z$/.test(value) &&
  Number.isFinite(Date.parse(value));
const id = (value) => {
  if (!isUuid(value)) throw new TypeError("Use a canonical UUID v4.");
  return value;
};
const memoryIdPath = (value) => {
  if (typeof value !== "string" || !MEMORY_UUID.test(value))
    throw new TypeError("Use a valid memory UUID.");
  return value;
};
const cursorValid = (value) =>
  value === null ||
  (typeof value === "string" && value.length > 0 && value.length <= 4096);

export function decodeAlbum(value) {
  let name;
  try {
    name = value?.deletedAt === null ? normalizeAlbumName(value.name) : null;
  } catch {
    throw contractMismatch();
  }
  if (
    !isUuid(value?.albumId) ||
    !isUuid(value.revision) ||
    value.visibility !== "COUPLE_ONLY" ||
    value.name !== name ||
    !Number.isSafeInteger(value.memberCount) ||
    value.memberCount < 0 ||
    !time(value.createdAt) ||
    !time(value.updatedAt) ||
    Date.parse(value.updatedAt) < Date.parse(value.createdAt) ||
    (value.deletedAt !== null &&
      (!time(value.deletedAt) ||
        value.memberCount !== 0 ||
        Date.parse(value.deletedAt) < Date.parse(value.createdAt) ||
        Date.parse(value.deletedAt) > Date.parse(value.updatedAt)))
  )
    throw contractMismatch();
  return value;
}

/** Private, conditional album writes; transport never retries mutations. */
export function createAlbumApi({ client, decodeMemory, csrf }) {
  const albumRequest = (path, options, expectedId, validate = () => true) =>
    client.request(path, {
      ...options,
      decode(value, response) {
        const album = decodeAlbum(value);
        if (
          album.albumId !== expectedId ||
          response.headers.get("ETag") !== '"' + album.revision + '"' ||
          !validate(album)
        )
          throw contractMismatch();
        return album;
      },
    });
  const pageParams = ({ limit = 20, cursor } = {}) => {
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      (cursor !== undefined && !cursorValid(cursor))
    )
      throw new TypeError("Use a limit of 1–50 and an opaque cursor.");
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return params;
  };
  const conditional = ({ revision, csrfToken, signal } = {}) => ({
    headers: { ...csrf(csrfToken), "If-Match": '"' + id(revision) + '"' },
    signal,
  });
  return {
    listAlbums({ signal, ...page } = {}) {
      return client.request("/api/albums?" + pageParams(page), {
        signal,
        decode(value) {
          if (
            !Array.isArray(value?.items) ||
            value.items.length > (page.limit ?? 20) ||
            !cursorValid(value.nextCursor) ||
            new Set(value.items.map((album) => album?.albumId)).size !==
              value.items.length
          )
            throw contractMismatch();
          value.items.forEach((album) => {
            if (decodeAlbum(album).deletedAt !== null) throw contractMismatch();
          });
          return value;
        },
      });
    },
    getAlbum(albumId, { signal } = {}) {
      return albumRequest("/api/albums/" + id(albumId), { signal }, albumId);
    },
    createAlbum(albumId, name, { csrfToken, signal } = {}) {
      const body = { name: normalizeAlbumName(name) };
      return albumRequest(
        "/api/albums/" + id(albumId),
        {
          method: "PUT",
          body,
          statuses: [201],
          headers: { ...csrf(csrfToken), "If-None-Match": "*" },
          signal,
        },
        albumId,
        (album) =>
          album.name === body.name &&
          album.deletedAt === null &&
          album.memberCount === 0,
      );
    },
    renameAlbum(albumId, name, options) {
      const body = { name: normalizeAlbumName(name) };
      return albumRequest(
        "/api/albums/" + id(albumId),
        { method: "PATCH", body, ...conditional(options) },
        albumId,
        (album) => album.name === body.name && album.deletedAt === null,
      );
    },
    deleteAlbum(albumId, options) {
      return albumRequest(
        "/api/albums/" + id(albumId),
        { method: "DELETE", ...conditional(options) },
        albumId,
        (album) => album.deletedAt !== null,
      );
    },
    listAlbumMembers(albumId, { signal, ...page } = {}) {
      return client.request(
        "/api/albums/" + id(albumId) + "/members?" + pageParams(page),
        {
          signal,
          decode(value, response) {
            const album = decodeAlbum(value?.album);
            if (
              album.albumId !== albumId ||
              response.headers.get("ETag") !== '"' + album.revision + '"' ||
              !Array.isArray(value.items) ||
              value.items.length > (page.limit ?? 20) ||
              !cursorValid(value.nextCursor) ||
              value.items.length > album.memberCount ||
              (album.deletedAt !== null &&
                (value.items.length || value.nextCursor !== null))
            )
              throw contractMismatch();
            const seen = new Set();
            for (const item of value.items) {
              const memory = decodeMemory(item?.memory);
              if (
                memory.reviewStatus === "DELETE" ||
                seen.has(memory.memoryId) ||
                typeof item.canMoveEarlier !== "boolean" ||
                typeof item.canMoveLater !== "boolean"
              )
                throw contractMismatch();
              seen.add(memory.memoryId);
            }
            return value;
          },
        },
      );
    },
    addAlbumMember(albumId, memoryId, options) {
      return albumRequest(
        "/api/albums/" + id(albumId) + "/members/" + memoryIdPath(memoryId),
        { method: "PUT", ...conditional(options) },
        albumId,
        (album) => album.deletedAt === null,
      );
    },
    removeAlbumMember(albumId, memoryId, options) {
      return albumRequest(
        "/api/albums/" + id(albumId) + "/members/" + memoryIdPath(memoryId),
        { method: "DELETE", ...conditional(options) },
        albumId,
        (album) => album.deletedAt === null,
      );
    },
    moveAlbumMember(albumId, memoryId, direction, options) {
      if (!["EARLIER", "LATER"].includes(direction))
        throw new TypeError("Choose EARLIER or LATER.");
      return albumRequest(
        "/api/albums/" +
          id(albumId) +
          "/members/" +
          memoryIdPath(memoryId) +
          "/move",
        { method: "POST", body: { direction }, ...conditional(options) },
        albumId,
        (album) => album.deletedAt === null,
      );
    },
  };
}
