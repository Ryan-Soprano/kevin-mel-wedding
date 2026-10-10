import { contractMismatch } from "../../../shared/api/apiClient.js";
import { instantKey, compareInstants } from "../../timeline/timelineFields.js";
import { fetchExportPart, MAX_EXPORT_DOWNLOAD_BYTES } from "./exportDownload.js";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const validId = value => typeof value === "string" && UUID.test(value);
const id = value => { if (!validId(value)) throw new TypeError("Use a canonical UUID v4."); return value; };
const count = value => Number.isSafeInteger(value) && value >= 0;
const partNumber = value => { if (!Number.isSafeInteger(value) || value < 1 || value > 10001) throw new TypeError("Use a valid export part number."); return value; };
const cursorValid = value => value === null || (typeof value === "string" && value.length > 0 && value.length <= 4096);
const fail = () => { throw contractMismatch(); };
export function decodeExportAttempt(value, expectedId = null) {
  if (!validId(value?.attemptId) || (expectedId !== null && value.attemptId !== expectedId) || !["PREPARE", "CANCEL"].includes(value.kind)
    || !["RUNNING", "SUCCEEDED", "FAILED"].includes(value.state) || (value.kind === "CANCEL" ? value.partNumber !== null : !Number.isSafeInteger(value.partNumber) || value.partNumber < 1 || value.partNumber > 10001)) fail(); return value;
}
export function decodeExportStatus(value, expectedId) {
  const exclusions = value?.excludedCounts, exclusionKeys = ["deletedOrPurgingMemories", "unfinishedOrUnavailableMemories", "deletedAlbums", "deletedTimelineEvents", "deletedTags"];
  if (!validId(value?.exportId) || value.exportId !== expectedId || !["CAPTURING", "READY", "PREPARING", "READY_WITH_WARNINGS", "FAILED", "STALE", "CANCELLED", "EXPIRED"].includes(value.state)
    || !instantKey(value.createdAt) || !instantKey(value.expiresAt) || !instantKey(value.hardExpiresAt) || compareInstants(value.expiresAt, value.createdAt) < 0
    || compareInstants(value.hardExpiresAt, value.expiresAt) < 0 || (value.capturedAt !== null && (!instantKey(value.capturedAt) || compareInstants(value.capturedAt, value.createdAt) < 0))
    || !["totalMemories", "totalOriginals", "totalOriginalBytes", "originalPartCount", "processedOriginalParts", "availableOriginals", "unavailableOriginals"].every(key => count(value[key]))
    || value.originalPartCount > 10000 || value.processedOriginalParts > value.originalPartCount || value.availableOriginals + value.unavailableOriginals > value.totalOriginals
    || typeof value.complete !== "boolean" || typeof value.indexNeedsRefresh !== "boolean" || !Number.isSafeInteger(value.pollAfterSeconds) || value.pollAfterSeconds < 1 || value.pollAfterSeconds > 60
    || (value.errorCode !== null && (typeof value.errorCode !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(value.errorCode)))
    || (value.indexPartNumber !== null && value.indexPartNumber !== value.originalPartCount + 1)
    || !exclusions || typeof exclusions !== "object" || Array.isArray(exclusions) || ![0, 5].includes(Object.keys(exclusions).length)
    || Object.keys(exclusions).some(key => !exclusionKeys.includes(key) || !count(exclusions[key]))) fail();
  if (value.lastAttempt !== null) decodeExportAttempt(value.lastAttempt);
  if (value.preparedPart !== null) {
    const part = value.preparedPart;
    if (!part || !Number.isSafeInteger(part.partNumber) || part.partNumber < 1 || part.partNumber > value.originalPartCount + 1 || !["ORIGINALS", "INDEX"].includes(part.kind)
      || (part.kind === "INDEX") !== (part.partNumber === value.indexPartNumber) || !validId(part.generation) || !validId(part.attemptId)
      || !Number.isSafeInteger(part.byteSize) || part.byteSize < 1 || part.byteSize > MAX_EXPORT_DOWNLOAD_BYTES || typeof part.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(part.sha256)
      || part.filename !== "kevin-mel-archive-" + expectedId + "-part-" + part.partNumber + ".zip") fail();
  }
  if (value.complete && (value.processedOriginalParts !== value.originalPartCount || value.unavailableOriginals || value.indexNeedsRefresh || value.preparedPart?.kind === "ORIGINALS")) fail();
  return value;
}
export function createExportApi({ client, csrf, exportFetch }) {
  const route = exportId => "/api/exports/" + id(exportId);
  const status = exportId => value => decodeExportStatus(value, exportId);
  const pageParams = ({ limit = 20, cursor } = {}) => { if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || (cursor !== undefined && !cursorValid(cursor))) throw new TypeError("Use a bounded export page."); const params = new URLSearchParams({ limit: String(limit) }); if (cursor) params.set("cursor", cursor); return params; };
  return {
    getCurrentExport({ signal } = {}) { return client.request("/api/exports/current", { signal, decode: value => { if (!validId(value?.exportId)) fail(); return decodeExportStatus(value, value.exportId); } }); },
    createExport(exportId, { csrfToken, signal } = {}) { return client.request(route(exportId), { method: "PUT", headers: { ...csrf(csrfToken), "If-None-Match": "*" }, statuses: [202], signal, decode: status(exportId) }); },
    getExport(exportId, { signal } = {}) { return client.request(route(exportId), { signal, decode: status(exportId) }); },
    getExportAttempt(exportId, attemptId, { signal } = {}) { return client.request(route(exportId) + "/attempts/" + id(attemptId), { signal, decode: value => decodeExportAttempt(value, attemptId) }); },
    prepareExportPart(exportId, number, { attemptId, csrfToken, signal } = {}) { return client.request(route(exportId) + "/parts/" + partNumber(number) + "/prepare", { method: "POST", headers: { ...csrf(csrfToken), "Idempotency-Key": id(attemptId) }, statuses: [200, 202], signal, decode: status(exportId) }); },
    cancelExport(exportId, { attemptId, csrfToken, signal } = {}) { return client.request(route(exportId), { method: "DELETE", headers: { ...csrf(csrfToken), "Idempotency-Key": id(attemptId) }, signal, decode: status(exportId) }); },
    listExportParts(exportId, { signal, ...page } = {}) { return client.request(route(exportId) + "/parts?" + pageParams(page), { signal, decode(value) {
      if (value?.exportId !== exportId || !Array.isArray(value.items) || value.items.length > (page.limit ?? 20) || !cursorValid(value.nextCursor)) fail();
      let previous = 0; for (const row of value.items) { if (!row || !Number.isSafeInteger(row.partNumber) || row.partNumber <= previous || row.partNumber > 10001 || !["ORIGINALS", "INDEX"].includes(row.kind) || !["UNPROCESSED", "PROCESSED", "CACHED"].includes(row.state) || !count(row.availableOriginals) || !count(row.unavailableOriginals)) fail(); previous = row.partNumber; } return value;
    } }); },
    listExportIssues(exportId, { signal, ...page } = {}) { return client.request(route(exportId) + "/issues?" + pageParams(page), { signal, decode(value) {
      if (value?.exportId !== exportId || !Array.isArray(value.items) || value.items.length > (page.limit ?? 20) || !cursorValid(value.nextCursor)) fail();
      for (const row of value.items) if (!row || !Number.isSafeInteger(row.partNumber) || row.partNumber < 1 || row.partNumber > 10000 || typeof row.memoryId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(row.memoryId) || typeof row.assetId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(row.assetId) || !["MISSING", "INTEGRITY_MISMATCH", "READ_FAILED"].includes(row.code)) fail(); return value;
    } }); },
    downloadExportPart(exportId, part, options = {}) { return fetchExportPart(route(exportId) + "/parts/" + partNumber(part.partNumber) + "/download?generation=" + id(part.generation), part, { ...options, fetchImpl: exportFetch }); },
  };
}
