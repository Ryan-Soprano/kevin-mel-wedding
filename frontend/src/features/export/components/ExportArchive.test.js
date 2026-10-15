import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { initialExport } from "../api/exportActions.js";
const id = n => "88888888-8888-4888-8888-" + String(n).padStart(12, "0");
const job = { exportId: id(1), state: "READY_WITH_WARNINGS", createdAt: "2026-10-10T12:00:00Z", capturedAt: "2026-10-10T12:00:01Z", expiresAt: "2026-10-10T12:30:00Z", hardExpiresAt: "2026-10-11T12:00:00Z",
  totalMemories: 2, totalOriginals: 1, totalOriginalBytes: 1024, originalPartCount: 1, indexPartNumber: 2, processedOriginalParts: 1, availableOriginals: 0, unavailableOriginals: 1,
  complete: false, indexNeedsRefresh: true, preparedPart: null, excludedCounts: { deletedOrPurgingMemories: 1, unfinishedOrUnavailableMemories: 2, deletedAlbums: 3, deletedTimelineEvents: 4, deletedTags: 5 } };
const actions = Object.fromEntries(["inbox", "create", "check", "prepare", "cancel", "retry", "page", "download", "started"].map(name => [name, () => {}]));
test("actual export view gives explicit bounded parts, honest missing/excluded/expiry/save guidance and safe recovery controls", async () => {
  // Actual React SSR: layout, native browser save, production ZIP bytes and
  // network-free offline reader acceptance are separate packaged checks.
  const server = await createServer({ configFile: false, logLevel: "silent", root: fileURLToPath(new URL("../../../../", import.meta.url)), plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { default: ExportArchive } = await server.ssrLoadModule("/src/features/export/components/ExportArchive.jsx");
    const render = (state, locked = false) => renderToStaticMarkup(createElement(ExportArchive, { state: { ...initialExport(), ...state }, busy: false, locked, actions }));
    const empty = render({}); assert.match(empty, /Prepare archive export/); assert.match(empty, /same private folder/); assert.match(empty, /index.html/); assert.match(empty, /cannot be revoked/); assert.doesNotMatch(empty, /<img|<audio|\/playback/);
    assert.match(empty, /aria-label="How to save your archive"/); for (const step of ["Prepare", "Download", "Keep private"]) assert.match(empty, new RegExp(`<h2>${step}</h2>`));
    const parts = [{ partNumber: 1, kind: "ORIGINALS", state: "PROCESSED", availableOriginals: 0, unavailableOriginals: 1 }, { partNumber: 2, kind: "INDEX", state: "UNPROCESSED", availableOriginals: 0, unavailableOriginals: 0 }];
    const warnings = render({ job, parts, issues: [{ partNumber: 1, memoryId: id(5), assetId: id(6), code: "READ_FAILED" }] }); assert.match(warnings, /This export is incomplete/); assert.match(warnings, /2 unfinished or unavailable memories/); assert.match(warnings, /5 deleted tags/); assert.match(warnings, /Original could not be read/);
    assert.match(warnings, /Prepare ZIP part 1/); assert.match(warnings, /Final index and offline reader/); assert.match(warnings, /Only one prepared ZIP/); assert.match(warnings, /Check export progress/); assert.match(warnings, /App restart/); assert.match(warnings, /30 minutes/);
    assert.match(warnings, /Created <time dateTime="2026-10-10T12:00:00Z">Oct 10, 2026, 8:00 AM EDT<\/time> · Eastern/);
    assert.match(warnings, /Archive captured <time dateTime="2026-10-10T12:00:01Z">Oct 10, 2026, 8:00 AM EDT<\/time> · Eastern/);
    assert.match(warnings, /by <time dateTime="2026-10-11T12:00:00Z">Oct 11, 2026, 8:00 AM EDT<\/time> \(Eastern\)/);
    assert.match(warnings, /Current inactivity deadline: <time dateTime="2026-10-10T12:30:00Z">Oct 10, 2026, 8:30 AM EDT<\/time> · Eastern/);
    assert.doesNotMatch(warnings, /Chicago|CDT|CST/);
    const part = { partNumber: 2, kind: "INDEX", byteSize: 1024, filename: "kevin-mel-archive-" + id(1) + "-part-2.zip" };
    const ready = render({ job: { ...job, preparedPart: part }, download: { phase: "ready", url: "blob:synthetic-export", filename: part.filename, receivedBytes: 1024, totalBytes: 1024 } }); assert.match(ready, /Save verified ZIP part/); assert.match(ready, /Size and SHA-256 verified/); assert.match(ready, /confirm it saved/); assert.doesNotMatch(ready, /saved successfully/);
    const complete = render({ job: { ...job, unavailableOriginals: 0, complete: true, indexNeedsRefresh: false } }); assert.match(complete, /does not confirm browser saves/);
    const recovery = render({ mutation: { phase: "uncertain", error: "Unconfirmed", canRetry: true } }, true); assert.match(recovery, /Check unconfirmed export action/); assert.match(recovery, /Retry this same export action/); assert.match(recovery, /disabled=""[^>]*>Back to inbox/); assert.doesNotMatch(recovery, /Prepare archive export/);
    const expired = render({ job: { ...job, state: "EXPIRED" }, unavailable: true }); assert.match(expired, /Start a new export/); assert.doesNotMatch(expired, /Load and verify ZIP part|Prepare this part/);
  } finally { await server.close(); }
});
