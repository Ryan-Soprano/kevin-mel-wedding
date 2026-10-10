import { normalizeTimelineFilters } from "../timeline/timelineFields.js";
import { normalizeAlbumName } from "../albums/albumName.js";
import { ApiError } from "../../shared/api/apiClient.js";

export function normalizeLibraryQuery(value = "") {
  // Album text has the same raw UTF16/storable bounds, but blank search is valid.
  if (typeof value !== "string" || value.length > 200) throw new TypeError("Search text must be 200 characters or fewer.");
  try { normalizeAlbumName(value || " "); } catch (error) {
    if (value.trim() || /\0|[\ud800-\udfff]/u.test(value)) throw new TypeError("Search text contains invalid characters.", { cause: error });
  }
  return value.trim();
}
export function normalizeTagName(value) {
  try { return normalizeAlbumName(value); } catch {
    throw new ApiError("Give the tag a name of 1–200 characters, without invalid text.", { status: 400, code: "VALIDATION_FAILED" });
  }
}
export function normalizeLibraryFilters({ q = "", memoryType = "ALL", reviewStatus = "ALL", tagId = null, ...dates } = {}) {
  const normalized = normalizeTimelineFilters(dates);
  if (!["ALL", "TEXT", "PHOTO", "AUDIO"].includes(memoryType) || !["ALL", "PENDING", "KEEP", "ARCHIVED"].includes(reviewStatus)
    || (tagId !== null && (typeof tagId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(tagId)))) throw new TypeError("Choose valid library filters.");
  return { q: normalizeLibraryQuery(q), memoryType, reviewStatus, ...normalized, tagId };
}
