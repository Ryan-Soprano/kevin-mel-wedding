import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { initialExport } from "../api/exportActions.js";

const id = number => "88888888-8888-4888-8888-" + String(number).padStart(12, "0");

const job = {
  exportId: id(1),
  state: "READY_WITH_WARNINGS",
  createdAt: "2026-10-10T12:00:00Z",
  capturedAt: "2026-10-10T12:00:01Z",
  expiresAt: "2026-10-10T12:30:00Z",
  hardExpiresAt: "2026-10-11T12:00:00Z",
  totalMemories: 2,
  totalOriginals: 1,
  totalOriginalBytes: 1024,
  originalPartCount: 1,
  indexPartNumber: 2,
  processedOriginalParts: 1,
  availableOriginals: 0,
  unavailableOriginals: 1,
  complete: false,
  indexNeedsRefresh: true,
  preparedPart: null,
  excludedCounts: {
    deletedOrPurgingMemories: 1,
    unfinishedOrUnavailableMemories: 2,
    deletedAlbums: 3,
    deletedTimelineEvents: 4,
    deletedTags: 5,
  },
};

const parts = [
  {
    partNumber: 1,
    kind: "ORIGINALS",
    state: "PROCESSED",
    availableOriginals: 0,
    unavailableOriginals: 1,
  },
  {
    partNumber: 2,
    kind: "INDEX",
    state: "UNPROCESSED",
    availableOriginals: 0,
    unavailableOriginals: 0,
  },
];

const issues = [{
  partNumber: 1,
  memoryId: id(5),
  assetId: id(6),
  code: "READ_FAILED",
}];

const preparedPart = {
  partNumber: 2,
  kind: "INDEX",
  byteSize: 1024,
  filename: "kevin-mel-archive-" + id(1) + "-part-2.zip",
};

const readyDownload = {
  phase: "ready",
  url: "blob:synthetic-export",
  filename: preparedPart.filename,
  receivedBytes: 1024,
  totalBytes: 1024,
};

const actions = Object.fromEntries([
  "inbox", "create", "check", "prepare", "cancel",
  "retry", "page", "download", "started",
].map(name => [name, () => {}]));

async function withExportView(check) {
  // Actual React SSR. Mounted focus/callbacks, production ZIP bytes, browser
  // saves and the network-free reader are separate browser/package checks.
  const server = await createServer({
    configFile: false,
    logLevel: "silent",
    root: fileURLToPath(new URL("../../../../", import.meta.url)),
    plugins: [react()],
    server: {
      middlewareMode: true,
      hmr: false,
      watch: null,
    },
    appType: "custom",
    optimizeDeps: {
      noDiscovery: true,
      include: [],
    },
  });

  try {
    const { default: ExportArchive } = await server.ssrLoadModule(
      "/src/features/export/components/ExportArchive.jsx",
    );
    const render = (state = {}, options = {}) => renderToStaticMarkup(
      createElement(ExportArchive, {
        state: { ...initialExport(), ...state },
        busy: false,
        locked: false,
        actions,
        ...options,
      }),
    );
    await check(render);
  } finally {
    await server.close();
  }
}

function prepareDisabled(markup, number) {
  const button = markup.match(new RegExp(
    '<button[^>]*aria-label="Prepare ZIP part ' + number + '"[^>]*>',
  ));
  assert.ok(button, "Part " + number + " has a prepare control");
  return button[0].includes('disabled=""');
}

test("actual export view gives explicit bounded parts, honest missing/excluded/expiry/save guidance and safe recovery controls", async () => {
  await withExportView(render => {
    const empty = render();
    assert.match(empty, /Prepare archive export/);
    assert.match(empty, /same private folder/);
    assert.match(empty, /index.html/);
    assert.match(empty, /cannot be revoked/);
    assert.doesNotMatch(empty, /<img|<audio|\/playback/);
    assert.match(empty, /aria-label="How to save your archive"/);

    for (const step of ["Prepare", "Download", "Keep private"]) {
      assert.match(empty, new RegExp("<h2>" + step + "</h2>"));
    }

    const warnings = render({ job, parts, issues });
    assert.match(warnings, /This export is incomplete/);
    assert.match(warnings, /2 unfinished or unavailable memories/);
    assert.match(warnings, /5 deleted tags/);
    assert.match(warnings, /Original could not be read/);
    assert.match(warnings, /Prepare ZIP part 1/);
    assert.match(warnings, /Final index and offline reader/);
    assert.match(warnings, /Only one prepared ZIP/);
    assert.match(warnings, /Check export progress/);
    assert.match(warnings, /App restart/);
    assert.match(warnings, /30 minutes/);
    assert.match(warnings, /Created <time dateTime="2026-10-10T12:00:00Z">Oct 10, 2026, 8:00 AM EDT<\/time> · Eastern/);
    assert.match(warnings, /Archive captured <time dateTime="2026-10-10T12:00:01Z">Oct 10, 2026, 8:00 AM EDT<\/time> · Eastern/);
    assert.match(warnings, /by <time dateTime="2026-10-11T12:00:00Z">Oct 11, 2026, 8:00 AM EDT<\/time> \(Eastern\)/);
    assert.match(warnings, /Current inactivity deadline: <time dateTime="2026-10-10T12:30:00Z">Oct 10, 2026, 8:30 AM EDT<\/time> · Eastern/);
    assert.doesNotMatch(warnings, /Chicago|CDT|CST/);

    const ready = render({
      job: { ...job, preparedPart },
      download: readyDownload,
    });
    assert.match(ready, /Save verified ZIP part/);
    assert.match(ready, /Size and SHA-256 verified/);
    assert.match(ready, /confirm it saved/);
    assert.doesNotMatch(ready, /saved successfully/);

    const complete = render({
      job: {
        ...job,
        unavailableOriginals: 0,
        complete: true,
        indexNeedsRefresh: false,
      },
    });
    assert.match(complete, /does not confirm browser saves/);

    const recovery = render({
      mutation: { phase: "uncertain", error: "Unconfirmed", canRetry: true },
    }, { locked: true });
    assert.match(recovery, /Check unconfirmed export action/);
    assert.match(recovery, /Retry this same export action/);
    assert.match(recovery, /disabled=""[^>]*>Back to inbox/);
    assert.doesNotMatch(recovery, /Prepare archive export/);

    const expired = render({ job: { ...job, state: "EXPIRED" }, unavailable: true });
    assert.match(expired, /Start a new export/);
    assert.doesNotMatch(expired, /Load and verify ZIP part|Prepare this part/);
  });
});

test("terminal jobs retain summaries and issue paging while active controls obey busy and lock gates", async () => {
  await withExportView(render => {
    for (const state of ["FAILED", "STALE", "CANCELLED", "EXPIRED"]) {
      const terminal = render({
        job: { ...job, state, preparedPart },
        parts,
        issues,
        issueCursors: [null, "previous"],
        issuesNextCursor: "next",
      });
      assert.match(terminal, /Start a new export/);
      assert.match(terminal, /completed memories/);
      assert.match(terminal, /Original-file warnings/);
      assert.match(terminal, /Previous export warnings/);
      assert.match(terminal, /Page 2/);
      assert.doesNotMatch(terminal, /Load and verify ZIP part|Prepare this part/);
      assert.doesNotMatch(terminal, /Check export progress|Cancel export…/);
      assert.doesNotMatch(terminal, /Current inactivity deadline|Only one prepared ZIP/);
    }

    for (const options of [
      { busy: true, locked: false },
      { busy: false, locked: true },
    ]) {
      const disabled = render({ job, parts, issues }, options);
      assert.match(disabled, /disabled=""[^>]*>Back to inbox/);
      assert.match(disabled, /disabled=""[^>]*>Check export progress/);
      assert.match(disabled, /disabled=""[^>]*>Cancel export…/);
      assert.equal(prepareDisabled(disabled, 1), true);
      assert.equal(prepareDisabled(disabled, 2), true);
      assert.match(disabled, /disabled=""[^>]*>Previous ZIP parts/);
      assert.match(disabled, /disabled=""[^>]*>Next export warnings/);
    }

    const unavailable = render({ job, unavailable: true });
    assert.match(unavailable, /Start a new export/);
    assert.match(unavailable, /Check export progress/);

    const uncaptured = render({ job: { ...job, capturedAt: null }, parts });
    assert.doesNotMatch(uncaptured, /Prepare ZIP part/);

    for (const state of ["CAPTURING", "PREPARING", "READY", "READY_WITH_WARNINGS"]) {
      const active = render({ job: { ...job, state }, parts });
      const cannotPrepare = state === "CAPTURING" || state === "PREPARING";
      assert.equal(prepareDisabled(active, 1), cannotPrepare);
      assert.equal(prepareDisabled(active, 2), cannotPrepare);
    }

    const unfinished = render({ job: { ...job, processedOriginalParts: 0 }, parts });
    assert.equal(prepareDisabled(unfinished, 1), false);
    assert.equal(prepareDisabled(unfinished, 2), true);

    const labels = render({
      job,
      parts: [
        { ...parts[0], state: "CACHED" },
        { ...parts[1], kind: "ORIGINALS", state: "UNPROCESSED" },
      ],
    });
    assert.match(labels, /Ready to download · 0 included · 1 unavailable/);
    assert.match(labels, /Not prepared yet · 0 included · 0 unavailable/);
    assert.match(render({ job, parts }), /Previously processed/);
  });
});

test("recovery phases preserve deliberate controls, feedback precedence and retry-after zero", async () => {
  await withExportView(render => {
    for (const phase of ["saving", "loading"]) {
      const checking = render({
        job,
        mutation: { phase, error: null, canRetry: true },
      }, { locked: true });
      assert.match(checking, /role="status">Checking this export action…/);
      assert.doesNotMatch(checking, /Refresh session and export status|Check unconfirmed export action/);
      assert.doesNotMatch(checking, /Retry this same export action/);
    }

    const csrf = render({
      mutation: { phase: "csrf", error: "Refresh needed", canRetry: true },
    }, { locked: true });
    assert.match(csrf, /Refresh session and export status/);
    assert.match(csrf, /Retry this same export action/);
    assert.doesNotMatch(csrf, /disabled=""[^>]*>Refresh session and export status/);

    const busy = render({
      mutation: { phase: "uncertain", error: "Unconfirmed", canRetry: true },
    }, { busy: true, locked: true });
    assert.match(busy, /disabled=""[^>]*>Check unconfirmed export action/);
    assert.match(busy, /disabled=""[^>]*>Retry this same export action/);

    const noRetry = render({
      mutation: { phase: "uncertain", error: null, canRetry: false },
    }, { locked: true });
    assert.match(noRetry, /Check unconfirmed export action/);
    assert.doesNotMatch(noRetry, /Retry this same export action/);

    const notice = render({ notice: "Export notice", retryAfterSeconds: 0 });
    assert.match(notice, /class="inbox-review-notice" role="status"[^>]*>Export notice/);
    assert.match(notice, /Wait at least 0 seconds/);

    const error = render({
      error: "Read failed",
      notice: "Notice",
      mutation: { phase: "idle", error: "Mutation failed", canRetry: false },
    });
    assert.match(error, /class="form-error" role="alert"[^>]*>Read failed/);
    assert.doesNotMatch(error, />Mutation failed<|>Notice</);

    // Visibility/role use truthiness; message precedence remains nullish.
    const emptyError = render({ error: "", notice: "Notice" });
    assert.match(emptyError, /class="inbox-review-notice" role="status"[^>]*><\/p>/);
    assert.doesNotMatch(emptyError, />Notice</);

    const emptyOuterError = render({
      error: "",
      mutation: { phase: "idle", error: "Mutation failed", canRetry: false },
    });
    assert.match(emptyOuterError, /class="form-error" role="alert"[^>]*><\/p>/);
  });
});

test("prepared download progress and verified native save links retain their distinct gates", async () => {
  await withExportView(render => {
    const downloading = render({
      job: { ...job, preparedPart },
      download: {
        phase: "loading",
        url: null,
        filename: preparedPart.filename,
        receivedBytes: 512,
        totalBytes: 1024,
      },
    }, { busy: true });
    assert.match(downloading, /Loading 0.00 MiB of 0.00 MiB/);
    assert.match(downloading, /<progress value="512" max="1024" aria-label="ZIP part bytes received"/);
    assert.match(downloading, /disabled=""[^>]*>Load and verify ZIP part/);
    assert.doesNotMatch(downloading, /Save verified ZIP part/);

    const ready = render({
      job: { ...job, preparedPart },
      download: readyDownload,
    }, { busy: true, locked: true });
    assert.match(ready, /disabled=""[^>]*>Load and verify ZIP part/);
    assert.match(ready, /href="blob:synthetic-export" download="kevin-mel-archive-[^"]+">Save verified ZIP part/);
    assert.match(ready, /confirm it saved/);
    assert.doesNotMatch(ready, /<progress/);
  });
});
