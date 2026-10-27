import test from "node:test";
import assert from "node:assert/strict";
import * as inbox from "./inboxController.js";

test("inbox facade preserves its named export and ordered public methods", () => {
  assert.deepEqual(Object.keys(inbox), ["createInboxController"]);
  const methods = `loadExport createExport checkExport prepareExportPart cancelExport retryExportAction exportPage
    downloadExportPart exportDownloadStarted loadLibrary openLibraryMemory libraryPage chooseLibraryTag selectLibraryTag
    loadTags openTag beginTagCreation createTag renameTag deleteTag addTagMember removeTagMember showTagSelector
    openTagMemory tagPage reloadTagMutation retryTagMutation loadMemoryTags chooseMemoryTag changeMemoryTag memoryTagPage
    loadTimeline openTimelineEvent beginTimelineCreation createTimelineEvent updateTimelineEvent deleteTimelineEvent
    linkTimelineMemory unlinkTimelineMemory showTimelineSelector openTimelineMemory timelinePage reloadTimelineMutation retryTimelineMutation
    loadAlbums openAlbum beginAlbumCreation createAlbum renameAlbum deleteAlbum addAlbumMember removeAlbumMember moveAlbumMember
    showAlbumSelector openAlbumMemory albumPage reloadAlbumMutation retryAlbumMutation getSnapshot subscribe beginCreation
    getCreationApi creationComplete suspend resume recheckSession loadSession login changePassword logout loadInbox openMemory previousMemory nextMemory backToInbox
    retryPhoto retryMedia createShareLink reviewMemory retryReview reloadReview refreshReviewSession saveMetadata retryMetadata reloadMetadata dispose`.split(/\s+/);
  const controller = inbox.createInboxController({ api: {} });
  try {
    assert.deepEqual(Object.keys(controller), methods);
    assert.ok(Object.values(controller).every(method => typeof method === "function"));
    assert.equal(Object.isFrozen(controller), true);
  } finally { controller.dispose(); }
});

test("inbox lifecycle retains its public snapshot shape and stable snapshots after suspension and disposal", async () => {
  const controller = inbox.createInboxController({ api: {} });
  const snapshots = [];
  const unsubscribe = controller.subscribe(snapshot => snapshots.push(snapshot));
  try {
    const initial = controller.getSnapshot();
    assert.deepEqual(Object.keys(initial), `phase session busy error loginRetryAfterSeconds reviewStatus items nextCursor totalCount detail requestedMemoryId detailNavigation photo review shareLink
      metadata albums albumReturnId timeline timelineReturnId library libraryReturn tags tagReturnId export notice
      pageResetVersion logoutUnconfirmed passwordChange`.split(/\s+/));
    assert.deepEqual(initial.photo, { phase: "idle", url: null, error: null });
    assert.deepEqual(initial.review, { phase: "idle", targetStatus: null, error: null, canRetry: false });
    assert.deepEqual(initial.metadata, { phase: "idle", error: null, canRetry: false });
    assert.deepEqual(initial.shareLink, { url: null, error: null });
    assert.equal(initial.phase, "checking");
    assert.equal(initial.session, null);
    assert.equal(initial.detail, null);
    assert.equal(initial.requestedMemoryId, null);
    assert.equal(initial.totalCount, null);
    assert.deepEqual(initial.items, []);
    assert.equal(initial.busy, false);
    assert.equal(initial.loginRetryAfterSeconds, 0);
    assert.equal(initial.pageResetVersion, 0);
    assert.equal(controller.getSnapshot(), initial);

    const suspended = controller.suspend();
    assert.deepEqual(suspended, { ...initial, pageResetVersion: 1 });
    assert.equal(controller.getSnapshot(), suspended);
    assert.equal(controller.suspend(), suspended);
    assert.deepEqual(snapshots, [suspended]);
    for (const snapshot of [initial, suspended]) {
      assert.equal(Object.isFrozen(snapshot), true);
      for (const field of ["items", "photo", "review", "shareLink", "metadata"]) {
        assert.equal(Object.isFrozen(snapshot[field]), true);
      }
    }

    controller.dispose();
    const disposed = controller.getSnapshot();
    assert.deepEqual(disposed, suspended);
    assert.equal(controller.getSnapshot(), disposed);
    assert.equal(controller.suspend(), disposed);
    assert.equal(await controller.resume(), disposed);
    assert.equal(await controller.recheckSession(), disposed);
    controller.dispose();
    assert.equal(controller.getSnapshot(), disposed);
    assert.deepEqual(snapshots, [suspended]);
    assert.throws(() => controller.subscribe(null), TypeError);
  } finally { unsubscribe(); controller.dispose(); }
});
