import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { attachInboxPrivacyLifecycle } from "../api/inboxPrivacyLifecycle.js";
import { attachInboxHistory } from "../api/inboxHistory.js";
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
  reviewStatus: "PENDING", items: [], nextCursor: null, detail: null, requestedMemoryId: null,
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
  const navigationOwner = useRef(null);
  const inboxFocus = useRef(null);
  const cancelInboxFocus = useCallback(() => { inboxFocus.current = null; }, []);
  const beforeAction = useCallback(() => {
    cancelInboxFocus();
    navigationOwner.current?.cancelRestore();
  }, [cancelInboxFocus]);
  const requestInbox = useCallback((status, cursor = null) => {
    beforeAction();
    const owner = controller.current;
    if (!owner) return;
    inboxFocus.current = owner;
    return owner.loadInbox(status, cursor);
  }, [beforeAction]);
  const intentionalDialog = useRef(false);
  const setDialogState = useCallback(value => { intentionalDialog.current = value; }, []);
  const actions = useInboxActions(controller, beforeAction, requestInbox);
  const audioPlayback = useRef(null);
  const setAudioPlayback = useCallback((element, expectedUrl) => {
    if (audioPlayback.current !== element) stopAudioPlayback(audioPlayback.current);
    audioPlayback.current = element;
    if (!element) return;
    const next = controller.current?.getSnapshot();
    if (next?.phase !== "detail" || !next.session?.authenticated || next.detail?.memoryType !== "AUDIO"
      || next.detail.reviewStatus === "DELETE" || isInboxLocked(next) || next.photo.phase !== "ready" || next.photo.url !== expectedUrl) {
      stopAudioPlayback(element);
      return;
    }
    // StrictMode detaches and reattaches the same DOM node without rewriting
    // unchanged props. Restore only the source this current owner verified.
    if (element.getAttribute("src") !== expectedUrl) element.setAttribute("src", expectedUrl);
  }, []);
  const clearPlayback = useCallback(() => stopAudioPlayback(audioPlayback.current), []);
  const pausePlayback = useCallback(() => {
    cancelInboxFocus();
    try { audioPlayback.current?.pause(); } catch { /* A window switch must preserve the loaded audio source. */ }
  }, [cancelInboxFocus]);
  const heading = useRef(null);
  const deleteButton = useRef(null);
  const cancelDelete = useRef(null);
  const restoreDeleteFocus = useRef(false);
  const reviewFeedback = useRef(null);
  const [snapshot, setSnapshot] = useState(INITIAL);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pages, setPages] = useState([null]);
  const pagesRef = useRef([null]);
  const updatePages = useCallback(next => { pagesRef.current = next; setPages(next); }, []);
  const creationRef = useRef(null);
  const [creationState, setCreationFlow] = useState(null);
  const [navigationNotice, setNavigationNotice] = useState(null);
  const setCreationState = useCallback(next => {
    creationRef.current = next;
    setCreationFlow(next);
    if (!next?.busy && !next?.pending) setNavigationNotice(null);
  }, []);
  const [deleteConfirmation, setDeleteConfirmation] = useState(null);

  useEffect(() => {
    const current = factory.current();
    controller.current = current;
    const navigation = attachInboxHistory({
      controller: current,
      getInboxPages: () => pagesRef.current,
      setInboxPages: updatePages,
      isCreationBlocked: () => Boolean(creationRef.current?.busy || creationRef.current?.pending),
      hasCreationDraft: () => Boolean(creationRef.current?.hasDraft && !creationRef.current?.complete),
      onBlocked: () => setNavigationNotice("Finish or confirm the current save before leaving this screen."),
      onNavigate: cancelInboxFocus,
    });
    navigationOwner.current = navigation;
    let pageVersion = current.getSnapshot().pageResetVersion;
    const unsubscribe = current.subscribe(next => {
      if (controller.current !== current) return;
      if (audioPlayback.current && (next.photo.phase !== "ready" || next.photo.url !== audioPlayback.current.getAttribute("src"))) {
        clearPlayback();
      }
      if (next.pageResetVersion !== pageVersion) {
        pageVersion = next.pageResetVersion;
        updatePages([null]);
      }
      if (next.phase !== "detail" || !next.detail) setDeleteConfirmation(null);
      setNavigationNotice(null);
      navigation.sync(next);
      setSnapshot(next);
    });
    const detachLifecycle = attachInboxPrivacyLifecycle({
      controller: current,
      flush: flushSync,
      isIntentionalDialog: () => intentionalDialog.current,
      onDialogEnd: () => { intentionalDialog.current = false; },
      onPause: pausePlayback,
      onHide: () => {
        cancelInboxFocus();
        intentionalDialog.current = false;
        clearPlayback();
        setUsername("");
        setPassword("");
        setDeleteConfirmation(null);
        updatePages([null]);
      },
    });
    if (document.visibilityState === "hidden") current.suspend();
    else void current.loadSession();
    return () => {
      cancelInboxFocus();
      clearPlayback();
      navigation.dispose();
      if (navigationOwner.current === navigation) navigationOwner.current = null;
      detachLifecycle();
      if (controller.current === current) controller.current = null;
      unsubscribe();
      current.dispose();
    };
  }, [cancelInboxFocus, clearPlayback, pausePlayback, updatePages]);

  useEffect(() => {
    heading.current?.focus();
  }, [snapshot.phase, snapshot.detail?.memoryId, snapshot.albums?.view, snapshot.albums?.album?.albumId,
    snapshot.timeline?.view, snapshot.timeline?.event?.eventId, snapshot.library?.view,
    snapshot.tags?.view, snapshot.tags?.tag?.tagId]);

  useEffect(() => {
    const owner = inboxFocus.current;
    if (!owner || snapshot.busy || snapshot !== owner.getSnapshot()) return;
    inboxFocus.current = null;
    if (controller.current === owner && snapshot.phase === "inbox" && snapshot.session?.authenticated) heading.current?.focus();
  }, [snapshot]);

  const reviewLocked = isInboxLocked(snapshot) || (snapshot.phase === "create"
    && Boolean(creationState?.busy || creationState?.pending));
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
    beforeAction();
    setPassword("");
    updatePages([null]);
    void controller.current?.login(credentials);
  }

  function logout() {
    if (reviewLocked) return;
    beforeAction();
    setPassword("");
    setUsername("");
    updatePages([null]);
    void controller.current?.logout();
  }

  function retryAccess() {
    if (snapshot.logoutUnconfirmed) {
      logout();
      return;
    }
    beforeAction();
    updatePages([null]);
    void controller.current?.loadSession();
  }

  function filter(status) {
    if (reviewLocked) return;
    void requestInbox(status);
  }

  function nextPage() {
    if (snapshot.busy || reviewLocked || snapshot.error || !snapshot.nextCursor) return;
    updatePages([...pagesRef.current, snapshot.nextCursor]);
    void requestInbox(snapshot.reviewStatus, snapshot.nextCursor);
  }

  function previousPage() {
    if (snapshot.busy || reviewLocked || snapshot.error || pages.length < 2) return;
    const previous = pages.slice(0, -1);
    updatePages(previous);
    void requestInbox(snapshot.reviewStatus, previous.at(-1));
  }

  function changeReview(status, visibility) {
    if (snapshot.busy || reviewLocked) return;
    beforeAction();
    setDeleteConfirmation(null);
    void controller.current?.reviewMemory(status, visibility);
  }

  function beginDelete() {
    setDeleteConfirmation({ memoryId: detail.memoryId, revision: detail.revision });
  }

  function cancelConfirmation() {
    restoreDeleteFocus.current = true;
    setDeleteConfirmation(null);
  }

  return {
    heading, audioPlayback: setAudioPlayback, deleteButton, cancelDelete, reviewFeedback,
    view: {
      snapshot, actions, reviewLocked, setDialogState, setCreationState, navigationNotice,
      logout, retryAccess, pages, filter, nextPage, previousPage,
      loginForm: { username, password, setUsername, setPassword, onSubmit: login },
      reviewControls: { confirmingDelete, change: changeReview, beginDelete, cancel: cancelConfirmation },
    },
  };
}
