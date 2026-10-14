import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { attachInboxPrivacyLifecycle } from "../api/inboxPrivacyLifecycle.js";
import { stopAudioPlayback } from "../audioPlayback.js";
import { isInboxLocked } from "../inboxDisplay.js";
import { initialAlbums } from "../../albums/api/albumActions.js";
import { initialTimeline } from "../../timeline/api/timelineActions.js";
import { initialLibrary } from "../../library/api/libraryActions.js";
import { initialTags } from "../../library/api/tagActions.js";
import { initialExport } from "../../export/api/exportActions.js";
import { useInboxActions } from "./useInboxActions.js";

const INITIAL = {
  phase: "checking", session: null, busy: true, error: null,
  reviewStatus: "PENDING", items: [], nextCursor: null, detail: null,
  photo: { phase: "idle", url: null, error: null },
  review: { phase: "idle", targetStatus: null, error: null, canRetry: false },
  metadata: { phase: "idle", error: null, canRetry: false },
  notice: null, pageResetVersion: 0, logoutUnconfirmed: false,
  albums: initialAlbums(), albumReturnId: null,
  timeline: initialTimeline(), timelineReturnId: null,
  library: initialLibrary(), libraryReturn: false, tags: initialTags(), tagReturnId: null,
  export: initialExport(),
};

export function useInboxController(createController) {
  const factory = useRef(createController);
  const controller = useRef(null);
  const intentionalDialog = useRef(false);
  const setDialogState = useCallback(value => { intentionalDialog.current = value; }, []);
  const actions = useInboxActions(controller);
  const audioPlayback = useRef(null);
  const clearPlayback = useCallback(() => stopAudioPlayback(audioPlayback.current), []);
  const heading = useRef(null);
  const deleteButton = useRef(null);
  const cancelDelete = useRef(null);
  const restoreDeleteFocus = useRef(false);
  const reviewFeedback = useRef(null);
  const [snapshot, setSnapshot] = useState(INITIAL);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pages, setPages] = useState([null]);
  const [deleteConfirmation, setDeleteConfirmation] = useState(null);

  useEffect(() => {
    const current = factory.current();
    controller.current = current;
    let pageVersion = current.getSnapshot().pageResetVersion;
    const unsubscribe = current.subscribe(next => {
      if (controller.current !== current) return;
      if (audioPlayback.current && (next.photo.phase !== "ready" || next.photo.url !== audioPlayback.current.getAttribute("src"))) {
        clearPlayback();
      }
      if (next.pageResetVersion !== pageVersion) {
        pageVersion = next.pageResetVersion;
        setPages([null]);
      }
      if (next.phase !== "detail" || !next.detail) setDeleteConfirmation(null);
      setSnapshot(next);
    });
    const detachLifecycle = attachInboxPrivacyLifecycle({
      controller: current,
      flush: flushSync,
      isIntentionalDialog: () => intentionalDialog.current,
      onDialogEnd: () => { intentionalDialog.current = false; },
      onHide: () => {
        intentionalDialog.current = false;
        clearPlayback();
        setUsername("");
        setPassword("");
        setDeleteConfirmation(null);
        setPages([null]);
      },
    });
    if (document.visibilityState === "hidden") current.suspend();
    else void current.loadSession();
    return () => {
      clearPlayback();
      detachLifecycle();
      if (controller.current === current) controller.current = null;
      unsubscribe();
      current.dispose();
    };
  }, [clearPlayback]);

  useEffect(() => {
    heading.current?.focus();
  }, [snapshot.phase, snapshot.detail?.memoryId, snapshot.albums?.view, snapshot.albums?.album?.albumId,
    snapshot.timeline?.view, snapshot.timeline?.event?.eventId, snapshot.library?.view,
    snapshot.tags?.view, snapshot.tags?.tag?.tagId]);

  const reviewLocked = isInboxLocked(snapshot);
  const detail = snapshot.detail;
  const confirmingDelete = !reviewLocked && deleteConfirmation !== null
    && detail?.memoryId === deleteConfirmation.memoryId && detail?.revision === deleteConfirmation.revision;

  useEffect(() => {
    if (confirmingDelete) cancelDelete.current?.focus();
    else if (restoreDeleteFocus.current && !reviewLocked) {
      restoreDeleteFocus.current = false;
      deleteButton.current?.focus();
    }
  }, [confirmingDelete, reviewLocked]);

  useEffect(() => {
    if (snapshot.review.error || snapshot.notice) reviewFeedback.current?.focus();
  }, [snapshot.review.error, snapshot.notice]);

  useEffect(() => {
    if (!reviewLocked) return;
    const preventLeaving = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventLeaving);
    return () => window.removeEventListener("beforeunload", preventLeaving);
  }, [reviewLocked]);

  function login(event) {
    event.preventDefault();
    if (snapshot.busy) return;
    const credentials = { username, password };
    setPassword("");
    setPages([null]);
    void controller.current?.login(credentials);
  }

  function logout() {
    if (reviewLocked) return;
    setPassword("");
    setUsername("");
    setPages([null]);
    void controller.current?.logout();
  }

  function retryAccess() {
    if (snapshot.logoutUnconfirmed) {
      logout();
      return;
    }
    setPages([null]);
    void controller.current?.loadSession();
  }

  function filter(status) {
    if (reviewLocked) return;
    setPages([null]);
    void controller.current?.loadInbox(status);
  }

  function nextPage() {
    if (snapshot.busy || reviewLocked || snapshot.error || !snapshot.nextCursor) return;
    setPages(current => [...current, snapshot.nextCursor]);
    void controller.current?.loadInbox(snapshot.reviewStatus, snapshot.nextCursor);
  }

  function previousPage() {
    if (snapshot.busy || reviewLocked || snapshot.error || pages.length < 2) return;
    const previous = pages.slice(0, -1);
    setPages(previous);
    void controller.current?.loadInbox(snapshot.reviewStatus, previous.at(-1));
  }

  function changeReview(status) {
    if (snapshot.busy || reviewLocked) return;
    setDeleteConfirmation(null);
    void controller.current?.reviewMemory(status);
  }

  function beginDelete() {
    setDeleteConfirmation({ memoryId: detail.memoryId, revision: detail.revision });
  }

  function cancelConfirmation() {
    restoreDeleteFocus.current = true;
    setDeleteConfirmation(null);
  }

  return {
    heading, audioPlayback, deleteButton, cancelDelete, reviewFeedback,
    view: {
      snapshot, actions, reviewLocked, setDialogState,
      logout, retryAccess, pages, filter, nextPage, previousPage,
      loginForm: { username, password, setUsername, setPassword, onSubmit: login },
      reviewControls: { confirmingDelete, change: changeReview, beginDelete, cancel: cancelConfirmation },
    },
  };
}
