import { ApiError, contractMismatch } from "../../../shared/api/apiClient.js";
import { normalizeMemoryMetadata, metadataOf, sameMetadata } from "../memoryMetadata.js";
import { EMPTY_ITEMS, idleReview, idleMetadata, frozenCopy, sessionCopy } from "./inboxState.js";

const REVIEW_STATES = new Set(["PENDING", "KEEP", "ARCHIVED", "DELETE"]);

/** Memory writes share the host's session, cancellation generation and write fence. */
export function createMemoryMutationActions({ api, getState, publish, start, bounded, run, assertCurrent,
  isCurrent, authFailure, apiTimeoutMs, isDisposed, isSuspended, otherLocked, markInboxDirty,
  clearMemoryTags, refreshMemoryTags, photo, detailContext }) {
  let reviewIntent = null, reviewInFlight = null, reviewUncertain = false;
  let metadataIntent = null, metadataInFlight = null, metadataUncertain = false, metadataHiddenId = null;

  function unavailableReview() {
    reviewIntent = null;
    reviewUncertain = false;
    metadataIntent = null; metadataUncertain = false; metadataHiddenId = null;
    markInboxDirty();
    publish({ items: EMPTY_ITEMS, nextCursor: null, pageResetVersion: getState().pageResetVersion + 1,
      detail: null, review: idleReview(), metadata: idleMetadata(), error: "This memory is unavailable. Return to the inbox and reload it." });
  }

  function reviewState(phase, error = null, canRetry = false) {
    return Object.freeze({ phase, targetStatus: reviewIntent?.targetStatus ?? null,
      targetVisibility: reviewIntent?.targetVisibility ?? null, error, canRetry });
  }

  async function acceptCurrentReview(op, memory, notice) {
    assertCurrent(op);
    reviewIntent = null;
    reviewUncertain = false;
    markInboxDirty();
    publish({ items: EMPTY_ITEMS, nextCursor: null, pageResetVersion: getState().pageResetVersion + 1,
      detail: frozenCopy(memory), review: idleReview(), notice, error: null });
    assertCurrent(op);
    clearMemoryTags();
    if (memory.reviewStatus !== "DELETE") await refreshMemoryTags(op, memory);
    if (!isCurrent(op) || op.controller.signal.aborted || !getState().detail) return;
    if (["PHOTO", "AUDIO"].includes(memory.memoryType) && memory.reviewStatus !== "DELETE") await photo(op, memory);
  }

  function reviewFailure(failure) {
    if (failure?.status === 403 && failure.code === "CSRF_INVALID") {
      publish({ review: reviewState("csrf", "Refresh your session, then reconsider this change. No automatic retry will be made.") });
    } else if (authFailure(failure)) {
      // Authentication failures also clear the frozen review intent and owned previews.
    } else if ([412, 428].includes(failure?.status)) {
      publish({ review: reviewState("conflict", "This memory changed or its revision could not be checked. Reload its current state before choosing an action.") });
    } else if (failure?.status === 404) {
      unavailableReview();
    } else if (failure?.unknownOutcome || !failure?.status || failure.status >= 500) {
      reviewUncertain = true;
      publish({ review: reviewState("uncertain", "We could not confirm whether this change was saved. Reload the current state before doing anything else.") });
    } else if (reviewUncertain) {
      // A rejected retry cannot establish what happened to the first timed-out request.
      publish({ review: reviewState("uncertain", "This retry was not accepted, but the earlier request is still unconfirmed. Reload the current state before doing anything else.") });
    } else {
      reviewIntent = null;
      publish({ review: idleReview(), error: failure?.status === 429
        ? "Please wait before choosing this action again. The change was not accepted."
        : "The change was not accepted. Your memory is still here; reload it before trying again." });
    }
  }

  function rememberReviewRun(op, task, onFailure = reviewFailure) {
    const completion = run(op, task, onFailure).finally(() => {
      if (reviewInFlight === completion) reviewInFlight = null;
    });
    reviewInFlight = completion;
    return completion;
  }

  function sendReview() {
    const intent = reviewIntent;
    const token = getState().session?.csrfToken;
    const op = start({ phase: "detail", review: reviewState("saving"), notice: null });
    return rememberReviewRun(op, async () => {
      const memory = await bounded(op, signal => api.reviewMemory(intent.memoryId, {
        reviewStatus: intent.targetStatus, revision: intent.expectedRevision,
        ...(intent.explicitVisibility ? { visibility: intent.targetVisibility } : {}),
      }, { csrfToken: token, signal }), apiTimeoutMs, true);
      if (memory.memoryId !== intent.memoryId || memory.reviewStatus !== intent.targetStatus
        || memory.visibility !== intent.targetVisibility
        || memory.revision !== intent.expectedRevision + (intent.fromStatus === intent.targetStatus
          && intent.fromVisibility === intent.targetVisibility ? 0 : 1)) throw contractMismatch();
      await acceptCurrentReview(op, memory, {
        PENDING: "Restored to your pending inbox. This memory stays private.",
        KEEP: { COUPLE_ONLY: "Kept privately. Shared access has been removed.",
          FRIENDS_FAMILY: "Shared with friends and family. Create a private link below to send to them.",
          PUBLIC: "Shared with the public. This memory is now visible on the guest site." }[memory.visibility],
        ARCHIVED: "Archived privately. You can restore it to your inbox.",
        DELETE: "Moved to Recently deleted. You can restore it during its 30-day recovery window.",
      }[memory.reviewStatus]);
    });
  }

  async function reconcileReview(op, memory, notice) {
    const intent = reviewIntent;
    if (memory.memoryId !== intent.memoryId || memory.revision < intent.expectedRevision) throw contractMismatch();
    if (reviewUncertain && memory.revision === intent.expectedRevision) {
      // A read can precede a late commit, including after a known rejection of a retry.
      if (memory.reviewStatus !== intent.fromStatus || memory.visibility !== intent.fromVisibility) throw contractMismatch();
      publish({ detail: frozenCopy(memory), review: reviewState("uncertain",
        "The current read still shows the earlier revision. The first request may still finish. Retry only this same change, or reload again.", true) });
    } else await acceptCurrentReview(op, memory, notice);
  }

  const metadataState = (phase, error = null, canRetry = false) => Object.freeze({ phase, error, canRetry });
  const originalContext = memory => JSON.stringify([memory.contributionId, memory.memoryType, memory.source,
    memory.guestName, memory.textContent, memory.caption, memory.createdAt, memory.media === null ? null
      : [memory.media.originalFilename, memory.media.detectedContentType, memory.media.byteSize,
        memory.media.checksumSha256, memory.media.durationSeconds, memory.media.uploadState]]);
  async function acceptMetadata(op, memory, notice) {
    assertCurrent(op);
    metadataIntent = null; metadataUncertain = false;
    markInboxDirty();
    publish({ items: EMPTY_ITEMS, nextCursor: null, pageResetVersion: getState().pageResetVersion + 1,
      detail: frozenCopy(memory), metadata: idleMetadata(), notice, error: null });
    assertCurrent(op);
    if (["PHOTO", "AUDIO"].includes(memory.memoryType) && memory.reviewStatus !== "DELETE") await photo(op, memory);
  }
  function metadataFailure(failure) {
    if (failure?.status === 403 && failure.code === "CSRF_INVALID") {
      publish({ metadata: metadataState("csrf", "Refresh your session and this memory before reconsidering the edit.") });
    } else if (authFailure(failure)) {
      // Access loss clears the editor, frozen draft and original previews.
    } else if ([412, 428].includes(failure?.status)) {
      publish({ metadata: metadataState("conflict", "This memory changed. Reload its current state before editing again. Your edit has not overwritten it.") });
    } else if (failure?.status === 404) unavailableReview();
    else if (metadataUncertain || failure?.unknownOutcome || !failure?.status || failure.status >= 500) {
      metadataUncertain = true;
      publish({ metadata: metadataState("uncertain", "We could not confirm this metadata edit. Reload the current state before choosing another action.") });
    } else {
      metadataIntent = null;
      publish({ metadata: idleMetadata(), error: failure?.status === 429
        ? "Please wait before saving metadata again. This request was not accepted."
        : "The metadata edit was not accepted. Check the fields and try again." });
    }
  }
  function metadataRun(op, task, onFailure = metadataFailure) {
    const completion = run(op, task, onFailure).finally(() => { if (metadataInFlight === completion) metadataInFlight = null; });
    metadataInFlight = completion;
    return completion;
  }
  function sendMetadata() {
    const intent = metadataIntent, token = getState().session?.csrfToken;
    const op = start({ phase: "detail", metadata: metadataState("saving"), notice: null });
    return metadataRun(op, async () => {
      const memory = await bounded(op, signal => api.updateMemoryMetadata(intent.memoryId, intent.target, {
        revision: intent.expectedRevision, csrfToken: token, signal,
      }), apiTimeoutMs, true);
      if (memory.memoryId !== intent.memoryId || originalContext(memory) !== intent.original
        || memory.reviewStatus !== intent.fromStatus || memory.deleteAfter !== intent.deleteAfter
        || !sameMetadata(memory, intent.target)
        || memory.revision !== intent.expectedRevision + (sameMetadata(intent.before, intent.target) ? 0 : 1)) throw contractMismatch();
      await acceptMetadata(op, memory, "Memory details saved. Your original content is preserved.");
    });
  }
  async function reconcileMetadata(op, memory) {
    const intent = metadataIntent;
    if (memory.memoryId !== intent.memoryId || memory.revision < intent.expectedRevision
      || originalContext(memory) !== intent.original) throw contractMismatch();
    if (metadataUncertain && memory.revision === intent.expectedRevision) {
      if (!sameMetadata(memory, intent.before) || memory.reviewStatus !== intent.fromStatus
        || memory.deleteAfter !== intent.deleteAfter) throw contractMismatch();
      publish({ detail: frozenCopy(memory), metadata: metadataState("uncertain",
        "The current read still shows the earlier revision. The first request may still finish. Retry only this same edit, or reload again.", true) });
    } else await acceptMetadata(op, memory,
      "Current memory details loaded. Review them before editing again; this does not identify who changed them.");
  }

  const actions = {
    locked: () => Boolean(reviewIntent || metadataIntent),
    hasReview: () => Boolean(reviewIntent),
    hasHiddenMetadata: () => Boolean(metadataHiddenId),
    clear() {
      reviewIntent = null;
      reviewUncertain = false;
      metadataIntent = null; metadataUncertain = false; metadataHiddenId = null;
    },
    dispose() {
      reviewIntent = null;
      reviewInFlight = null;
      reviewUncertain = false;
      metadataIntent = null; metadataInFlight = null; metadataUncertain = false; metadataHiddenId = null;
    },
    unavailableReview,
    suspend() {
      if (reviewIntent && reviewInFlight) reviewUncertain = true;
      if (metadataIntent) metadataHiddenId = metadataIntent.memoryId;
      metadataIntent = null; metadataUncertain = false; metadataInFlight = null;
      reviewInFlight = null;
    },
    suspendedState: () => ({ review: reviewIntent ? reviewState("uncertain") : idleReview(), metadata: idleMetadata() }),
    async resumeReview(op) {
      const memory = await bounded(op, signal => api.getMemory(reviewIntent.memoryId, { signal }));
      publish(detailContext());
      await reconcileReview(op, memory, "Current state reloaded after checking access. Review it before choosing another action; this does not identify who changed it.");
    },
    async resumeMetadata(op) {
      const memory = await bounded(op, signal => api.getMemory(metadataHiddenId, { signal }));
      metadataHiddenId = null;
      publish(detailContext());
      await acceptMetadata(op, memory, "Current memory loaded after checking access. The hidden edit was cleared; inspect the saved details before making a new edit.");
    },
    createShareLink() {
      if (isDisposed() || isSuspended() || getState().busy || reviewIntent || metadataIntent || otherLocked() || getState().phase !== "detail" || getState().detail?.visibility !== "FRIENDS_FAMILY"
        || getState().detail.reviewStatus !== "KEEP" || !getState().session?.authenticated) return Promise.resolve(getState());
      const memory = getState().detail, csrfToken = getState().session.csrfToken;
      const op = start({ phase: "detail", detail: memory, notice: null });
      return run(op, async () => {
        const result = await bounded(op, signal => api.createShareLink(memory.memoryId, { revision: memory.revision, csrfToken, signal }), apiTimeoutMs, true);
        if (result.memoryId !== memory.memoryId || result.revision !== memory.revision + 1) throw contractMismatch();
        publish({ detail: frozenCopy({ ...memory, revision: result.revision }), shareLink: frozenCopy(result),
          items: EMPTY_ITEMS, nextCursor: null, pageResetVersion: getState().pageResetVersion + 1 });
        markInboxDirty();
        if (["PHOTO", "AUDIO"].includes(memory.memoryType)) await photo(op, memory);
      }, failure => {
        if (!authFailure(failure)) publish({ shareLink: Object.freeze({ url: null,
          error: "The private link could not be confirmed. Reload this memory before creating a new link." }) });
      });
    },
    reviewMemory(targetStatus, visibility) {
      if (!REVIEW_STATES.has(targetStatus)) throw new TypeError("Choose a supported private review state.");
      if (visibility !== undefined && (!["COUPLE_ONLY", "FRIENDS_FAMILY", "PUBLIC"].includes(visibility)
        || (targetStatus !== "KEEP" && visibility !== "COUPLE_ONLY"))) throw new TypeError("Choose a supported memory audience.");
      if (reviewInFlight) return reviewInFlight;
      if (isDisposed() || reviewIntent || metadataIntent || otherLocked() || getState().busy || getState().phase !== "detail"
        || !getState().detail || !getState().session?.authenticated) return Promise.resolve(getState());
      reviewIntent = Object.freeze({ memoryId: getState().detail.memoryId, fromStatus: getState().detail.reviewStatus,
        fromVisibility: getState().detail.visibility, targetStatus,
        targetVisibility: targetStatus === "KEEP" ? (visibility ?? getState().detail.visibility) : "COUPLE_ONLY",
        explicitVisibility: visibility !== undefined, expectedRevision: getState().detail.revision });
      reviewUncertain = false;
      return sendReview();
    },
    retryReview() {
      if (reviewInFlight) return reviewInFlight;
      if (isDisposed() || !reviewIntent || getState().busy || getState().review.phase !== "uncertain"
        || !getState().review.canRetry || !getState().session?.authenticated) return Promise.resolve(getState());
      return sendReview();
    },
    reloadReview() {
      if (reviewInFlight) return reviewInFlight;
      if (isDisposed() || isSuspended() || !reviewIntent || getState().busy || !["uncertain", "conflict"].includes(getState().review.phase)) return Promise.resolve(getState());
      const intent = reviewIntent;
      const previousPhase = getState().review.phase;
      const op = start({ phase: "detail", review: reviewState("loading"), notice: null });
      return rememberReviewRun(op, async () => {
        const memory = await bounded(op, signal => api.getMemory(intent.memoryId, { signal }));
        await reconcileReview(op, memory, "Current state reloaded. Review it before choosing another action; this does not identify who changed it.");
      }, failure => {
        if (authFailure(failure)) return;
        if (failure?.status === 404) {
          unavailableReview();
        } else publish({ review: reviewState(previousPhase, "The current state could not be loaded. Please try reloading it again.") });
      });
    },
    refreshReviewSession() {
      if (reviewInFlight) return reviewInFlight;
      if (isDisposed() || isSuspended() || !reviewIntent || getState().busy || getState().review.phase !== "csrf") return Promise.resolve(getState());
      const intent = reviewIntent;
      const op = start({ phase: "detail", review: reviewState("refreshing"), notice: null });
      return rememberReviewRun(op, async () => {
        const session = sessionCopy(await bounded(op, signal => api.getSession({ signal })));
        if (!session.authenticated) throw new ApiError("Sign in again.", { status: 401 });
        publish({ session });
        const memory = await bounded(op, signal => api.getMemory(intent.memoryId, { signal }));
        await reconcileReview(op, memory, "Session and memory refreshed. Choose the action again if you still want it.");
      }, failure => {
        if (authFailure(failure)) return;
        if (failure?.status === 404) {
          unavailableReview();
        } else publish({ review: reviewState("csrf", "The session and current memory could not be refreshed. Try refreshing again.") });
      });
    },
    saveMetadata(raw) {
      if (metadataInFlight) return metadataInFlight;
      if (isDisposed() || isSuspended() || reviewIntent || metadataIntent || otherLocked() || getState().busy || getState().phase !== "detail"
        || !getState().detail || getState().detail.reviewStatus === "DELETE" || !getState().session?.authenticated) return Promise.resolve(getState());
      const target = frozenCopy(normalizeMemoryMetadata(raw));
      metadataIntent = Object.freeze({ memoryId: getState().detail.memoryId, target, before: frozenCopy(metadataOf(getState().detail)),
        expectedRevision: getState().detail.revision, fromStatus: getState().detail.reviewStatus,
        deleteAfter: getState().detail.deleteAfter, original: originalContext(getState().detail) });
      metadataUncertain = false;
      return sendMetadata();
    },
    retryMetadata() {
      if (metadataInFlight) return metadataInFlight;
      if (isDisposed() || isSuspended() || !metadataIntent || getState().busy || getState().metadata.phase !== "uncertain"
        || !getState().metadata.canRetry || !getState().session?.authenticated) return Promise.resolve(getState());
      return sendMetadata();
    },
    reloadMetadata({ refreshSession = false } = {}) {
      if (metadataInFlight) return metadataInFlight;
      if (isDisposed() || isSuspended() || !metadataIntent || getState().busy
        || !["uncertain", "conflict", "csrf"].includes(getState().metadata.phase)) return Promise.resolve(getState());
      const intent = metadataIntent, previousPhase = getState().metadata.phase;
      const op = start({ phase: "detail", metadata: metadataState(refreshSession ? "refreshing" : "loading"), notice: null });
      return metadataRun(op, async () => {
        if (refreshSession) {
          const session = sessionCopy(await bounded(op, signal => api.getSession({ signal })));
          if (!session.authenticated) throw new ApiError("Sign in again.", { status: 401 });
          publish({ session });
        }
        await reconcileMetadata(op, await bounded(op, signal => api.getMemory(intent.memoryId, { signal })));
      }, failure => {
        if (authFailure(failure)) return;
        if (failure?.status === 404) unavailableReview();
        else publish({ metadata: metadataState(previousPhase, "The current memory could not be loaded. Try again.") });
      });
    },
  };
  return actions;
}
