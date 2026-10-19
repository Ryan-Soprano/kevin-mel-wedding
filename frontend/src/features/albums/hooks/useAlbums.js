import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { normalizeAlbumName } from "../albumName.js";

/** Read focus survives the editor's identity/revision reset, but never the screen. */
export function useAlbumPagingFocus({ state, busy, locked }) {
  const target = useRef(null);
  const intent = useRef(null);
  const feedbackAllowed = useRef(true);
  const cancel = useCallback(() => {
    intent.current = null;
    feedbackAllowed.current = false;
  }, []);

  useEffect(() => {
    // StrictMode rehearses disposal before setting up this same owner again.
    feedbackAllowed.current = true;
    const hidden = () => {
      if (document.visibilityState === "hidden") {
        cancel();
      }
    };
    window.addEventListener("blur", cancel);
    window.addEventListener("pagehide", cancel);
    window.addEventListener("popstate", cancel);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      cancel();
      window.removeEventListener("blur", cancel);
      window.removeEventListener("pagehide", cancel);
      window.removeEventListener("popstate", cancel);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [cancel]);

  useEffect(() => {
    const pending = intent.current;
    if (!pending || busy || state === pending.before) {
      return;
    }
    intent.current = null;
    const albumId = state.album?.albumId ?? state.requestedId ?? null;
    if (
      !locked && state.view === pending.view && albumId === pending.albumId
      && target.current?.isConnected
    ) {
      target.current.focus();
    }
  }, [state, busy, locked]);

  function activate() {
    cancel();
    feedbackAllowed.current = true;
  }

  function begin(view) {
    activate();
    intent.current = {
      before: state,
      view,
      albumId: state.album?.albumId ?? state.requestedId ?? null,
    };
  }

  const canFocusFeedback = useCallback(
    () => feedbackAllowed.current && !intent.current,
    [],
  );

  return {
    target,
    cancel,
    activate,
    begin,
    canFocusFeedback,
  };
}

export function useAlbums({ state, busy, locked, actions, pagingFocus }) {
  const [name, setName] = useState(state.album?.name ?? "");
  const [originalName, setOriginalName] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const nameInput = useRef(null);
  const originalNameInput = useRef(null);
  const validationFocus = useRef(null);
  const feedback = useRef(null);
  const cancelDelete = useRef(null);
  const deleteTrigger = useRef(null);
  const restoreDeleteFocus = useRef(false);
  const disabled = busy || locked;
  const cancelLocalFocus = useCallback(() => {
    restoreDeleteFocus.current = false;
    validationFocus.current = null;
  }, []);

  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") {
        cancelLocalFocus();
      }
    };
    window.addEventListener("blur", cancelLocalFocus);
    window.addEventListener("pagehide", cancelLocalFocus);
    window.addEventListener("popstate", cancelLocalFocus);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      cancelLocalFocus();
      window.removeEventListener("blur", cancelLocalFocus);
      window.removeEventListener("pagehide", cancelLocalFocus);
      window.removeEventListener("popstate", cancelLocalFocus);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [cancelLocalFocus]);

  const { canFocusFeedback } = pagingFocus;
  useEffect(() => {
    if (!canFocusFeedback()) {
      return;
    }
    if (state.mutation.error || state.notice || state.error) {
      feedback.current?.focus();
    }
  }, [state.mutation.error, state.notice, state.error, canFocusFeedback]);

  useEffect(() => {
    if (confirmDelete) {
      cancelDelete.current?.focus();
    }
  }, [confirmDelete]);

  useEffect(() => {
    if (!confirmDelete && restoreDeleteFocus.current && !disabled) {
      restoreDeleteFocus.current = false;
      deleteTrigger.current?.focus();
    }
  }, [confirmDelete, disabled]);

  useEffect(() => {
    const field = validationFocus.current;
    if (!field || busy) {
      return;
    }
    validationFocus.current = null;
    const target = field === "name"
      ? nameInput.current
      : originalNameInput.current;
    if (target?.isConnected && !target.disabled) {
      target.focus();
    }
  }, [fieldErrors, busy]);

  function cancelPendingFocus() {
    cancelLocalFocus();
    pagingFocus.cancel();
  }

  function invoke(method, ...args) {
    cancelLocalFocus();
    pagingFocus.activate();
    return actions[method](...args);
  }

  function requestPage(method, ...args) {
    cancelLocalFocus();
    pagingFocus.begin(method === "select" ? "select" : state.view);
    return actions[method](...args);
  }

  function changeName(value) {
    cancelPendingFocus();
    setName(value);
    setFieldErrors((current) => current.name
      ? { ...current, name: null }
      : current);
  }

  function changeOriginalName(value) {
    cancelPendingFocus();
    setOriginalName(value);
    setFieldErrors((current) => current.originalName
      ? { ...current, originalName: null }
      : current);
  }

  function submitName(event) {
    event.preventDefault();
    if (disabled) {
      return;
    }
    cancelPendingFocus();
    try {
      const normalized = normalizeAlbumName(name);
      setFieldErrors((current) => ({ ...current, name: null }));
      if (state.view === "create") {
        void invoke("create", normalized);
      } else {
        void invoke("rename", normalized);
      }
    } catch (failure) {
      validationFocus.current = "name";
      setFieldErrors((current) => ({ ...current, name: failure.message }));
    }
  }

  function retry() {
    if (busy) {
      return;
    }
    cancelPendingFocus();
    try {
      let normalized;
      if (state.mutation.needsName) {
        normalized = normalizeAlbumName(originalName);
      }
      setFieldErrors((current) => ({ ...current, originalName: null }));
      void invoke("retry", normalized);
    } catch (failure) {
      validationFocus.current = "originalName";
      setFieldErrors((current) => ({
        ...current,
        originalName: failure.message,
      }));
    }
  }

  function beginDelete() {
    cancelPendingFocus();
    setConfirmDelete(true);
  }

  function cancelDeletion() {
    cancelPendingFocus();
    restoreDeleteFocus.current = true;
    setConfirmDelete(false);
  }

  function confirmDeletion() {
    setConfirmDelete(false);
    void invoke("delete");
  }

  function reloadFirstPage() {
    if (state.view === "list") {
      return requestPage("list");
    }
    if (state.requestedId) {
      return requestPage("open", state.requestedId);
    }
    return requestPage("list");
  }

  return {
    feedback,
    cancelDelete,
    deleteTrigger,
    pageStatus: pagingFocus.target,
    view: {
      state,
      busy,
      locked,
      actions: {
        ...actions,
        inbox: () => invoke("inbox"),
        list: () => invoke("list"),
        open: id => invoke("open", id),
        beginCreate: () => invoke("beginCreate"),
        create: value => invoke("create", value),
        rename: value => invoke("rename", value),
        delete: () => invoke("delete"),
        add: id => invoke("add", id),
        remove: id => invoke("remove", id),
        move: (id, direction) => invoke("move", id, direction),
        select: status => requestPage("select", status),
        openMemory: id => invoke("openMemory", id),
        page: next => requestPage("page", next),
        reload: refreshSession => invoke("reload", refreshSession),
        retry: value => invoke("retry", value),
      },
      disabled,
      name,
      setName: changeName,
      originalName,
      setOriginalName: changeOriginalName,
      fieldErrors,
      nameInput,
      originalNameInput,
      confirmDelete,
      handlers: {
        submitName,
        retry,
        beginDelete,
        cancelDeletion,
        confirmDeletion,
        reloadFirstPage,
      },
    },
  };
}
