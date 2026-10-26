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
import { rememberInboxPages } from "../inboxPagination.js";

const INITIAL = {
  phase: "checking", session: null, busy: true, error: null,
  reviewStatus: "PENDING", items: [], nextCursor: null, detail: null, requestedMemoryId: null, detailNavigation: null,
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
  const inboxLocation = useRef(null);
  const inboxReturn = useRef(null);
  const cancelInboxFocus = useCallback(() => { inboxFocus.current = null; }, []);
  const beforeAction = useCallback(() => {
    cancelInboxFocus();
    inboxReturn.current = null;
    navigationOwner.current?.cancelRestore();
  }, [cancelInboxFocus]);
  const requestInbox = useCallback((status, cursor = null, options) => {
    beforeAction();
    const owner = controller.current;
    if (!owner) return;
    inboxFocus.current = owner;
    return owner.loadInbox(status, cursor, options);
  }, [beforeAction]);
  const intentionalDialog = useRef(false);
  const setDialogState = useCallback(value => { intentionalDialog.current = value; }, []);
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
  const [pageCursors, setPageCursors] = useState([null]);
  const pageCursorsRef = useRef([null]);
  const rememberPages = useCallback((selected, nextCursor) => {
    const next = rememberInboxPages(pageCursorsRef.current, selected, nextCursor);
    pageCursorsRef.current = next;
    setPageCursors(next);
  }, []);
  const updatePages = useCallback(next => {
    pagesRef.current = next;
    setPages(next);
    rememberPages(next);
  }, [rememberPages]);
  const resetPages = useCallback((preserveReturn = false) => {
    pagesRef.current = [null];
    pageCursorsRef.current = [null];
    setPages(pagesRef.current);
    setPageCursors(pageCursorsRef.current);
    inboxLocation.current = null;
    if (!preserveReturn) inboxReturn.current = null;
  }, []);
  const restoreInboxLocation = useCallback(() => {
    const current = controller.current?.getSnapshot();
    const source = inboxLocation.current;
    if (!source || current?.phase !== "detail" || !current.detailNavigation) return;
    const navigation = current.detailNavigation;
    updatePages(navigation.inboxPages);
    inboxReturn.current = { owner: controller.current, memoryId: current.detail?.memoryId ?? source.memoryId, source };
  }, [updatePages]);
  const actions = useInboxActions(controller, beforeAction, requestInbox, restoreInboxLocation);
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
      onNavigate: route => {
        cancelInboxFocus();
        inboxReturn.current = null;
        const snapshot = current.getSnapshot();
        const source = inboxLocation.current;
        if (route?.phase === "inbox" && snapshot.phase === "detail" && source) {
          inboxReturn.current = { owner: current, memoryId: snapshot.detail?.memoryId ?? source.memoryId, source };
        }
      },
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
        resetPages(next.phase === "inbox" && inboxReturn.current?.owner === current);
      }
      if (!next.session?.authenticated || next.session.passwordChangeRequired) resetPages();
      else if (next.phase === "inbox" && !next.busy && !next.error) rememberPages(pagesRef.current, next.nextCursor);
      else if (next.phase === "detail" && next.detailNavigation?.inboxPages) {
        updatePages(next.detailNavigation.inboxPages);
        // History can restore a detail without the card's click handler. Keep
        // its card as the return destination even after the parent page resets.
        if (next.detail && !inboxLocation.current) inboxLocation.current = {
          memoryId: next.detail.memoryId, scrollY: 0, pages: next.detailNavigation.inboxPages,
        };
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
        resetPages();
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
  }, [cancelInboxFocus, clearPlayback, pausePlayback, rememberPages, resetPages, updatePages]);

  useEffect(() => {
    if (!inboxReturn.current) heading.current?.focus();
  }, [snapshot.phase, snapshot.detail?.memoryId, snapshot.albums?.view, snapshot.albums?.album?.albumId,
    snapshot.timeline?.view, snapshot.timeline?.event?.eventId, snapshot.library?.view,
    snapshot.tags?.view, snapshot.tags?.tag?.tagId]);

  useEffect(() => {
    const destination = inboxReturn.current;
    if (!destination || snapshot.busy) return;
    if (controller.current !== destination.owner || snapshot !== destination.owner.getSnapshot()) return;
    inboxReturn.current = null;
    if (snapshot.phase !== "inbox" || !snapshot.session?.authenticated || snapshot.error) return;
    const card = document.getElementById(`inbox-memory-${destination.memoryId}`);
    window.scrollTo({ top: destination.source.scrollY, behavior: "auto" });
    if (card) {
      const bounds = card.getBoundingClientRect();
      if (destination.memoryId !== destination.source.memoryId || bounds.top < 0 || bounds.bottom > window.innerHeight) {
        card.scrollIntoView({ block: "center", behavior: "auto" });
      }
      card.querySelector("button")?.focus({ preventScroll: true });
    }
  }, [snapshot]);

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
    resetPages();
    void controller.current?.login(credentials);
  }

  function logout() {
    if (reviewLocked) return;
    beforeAction();
    setPassword("");
    setUsername("");
    resetPages();
    void controller.current?.logout();
  }

  function changePassword(credentials) {
    beforeAction();
    resetPages();
    return controller.current?.changePassword(credentials);
  }

  function retryAccess() {
    if (snapshot.logoutUnconfirmed) {
      logout();
      return;
    }
    beforeAction();
    resetPages();
    void controller.current?.loadSession();
  }

  function filter(status) {
    if (reviewLocked) return;
    void requestInbox(status);
  }

  function nextPage() {
    goToPage(pages.length + 1);
  }

  function previousPage() {
    goToPage(pages.length - 1);
  }

  function goToPage(number) {
    if (snapshot.busy || reviewLocked || !Number.isInteger(number) || number < 1
      || number > pageCursorsRef.current.length || (number === pages.length && !snapshot.error)) return;
    const selected = pageCursorsRef.current.slice(0, number);
    inboxLocation.current = null;
    updatePages(selected);
    void requestInbox(snapshot.reviewStatus, selected.at(-1), { preservePageHistory: true });
  }

  function openMemory(id) {
    inboxLocation.current = { memoryId: id, scrollY: window.scrollY, pages: [...pagesRef.current] };
    return actions.navigation.openMemory(id, { inboxCursors: pagesRef.current });
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
      logout, changePassword, retryAccess, pages, pageCursors, filter, nextPage, previousPage, goToPage, openMemory,
      loginForm: { username, password, setUsername, setPassword, onSubmit: login },
      reviewControls: { confirmingDelete, change: changeReview, beginDelete, cancel: cancelConfirmation },
    },
  };
}
