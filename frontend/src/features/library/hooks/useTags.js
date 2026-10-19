import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  normalizeLibraryQuery,
  normalizeTagName,
} from "../libraryFilters.js";

export function useTags({ state, busy, locked, actions, readFocus }) {
  const [name, setName] = useState(state.tag?.name ?? "");
  const [q, setQ] = useState(state.q);
  const [originalName, setOriginalName] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const nameInput = useRef(null);
  const queryInput = useRef(null);
  const retryNameInput = useRef(null);
  const validationFocus = useRef(null);
  const feedback = useRef(null);
  const cancelDelete = useRef(null);
  const deleteTrigger = useRef(null);
  const restoreDeleteFocus = useRef(false);
  const disabled = busy || locked;
  const cancelLocalFocus = useCallback(() => {
    validationFocus.current = null;
    restoreDeleteFocus.current = false;
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

  const { canFocusFeedback } = readFocus;
  useEffect(() => {
    if (canFocusFeedback() && (state.mutation.error || state.notice || state.error)) {
      feedback.current?.focus();
    }
  }, [state.mutation.error, state.notice, state.error, canFocusFeedback]);

  useEffect(() => {
    const field = validationFocus.current;
    if (!field || busy) {
      return;
    }
    validationFocus.current = null;
    const target = {
      name: nameInput.current,
      query: queryInput.current,
      retryName: retryNameInput.current,
    }[field];
    if (target?.isConnected && !target.disabled) {
      target.focus();
    }
  }, [fieldErrors, busy]);

  useEffect(() => {
    if (confirmDelete) {
      cancelDelete.current?.focus();
    } else if (restoreDeleteFocus.current && !disabled) {
      restoreDeleteFocus.current = false;
      deleteTrigger.current?.focus();
    }
  }, [confirmDelete, disabled]);

  function cancelPendingFocus() {
    cancelLocalFocus();
    readFocus.cancel();
  }

  function invoke(method, ...args) {
    cancelLocalFocus();
    readFocus.activate();
    return actions[method](...args);
  }

  function requestRead(method, context, ...args) {
    cancelLocalFocus();
    readFocus.begin(context);
    return actions[method](...args);
  }

  function clearError(field) {
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function changeField(field, value, update) {
    cancelPendingFocus();
    update(value);
    clearError(field);
  }

  function showValidation(field, failure) {
    validationFocus.current = field;
    setFieldErrors((current) => ({ ...current, [field]: failure.message }));
  }

  function submitName(event) {
    event.preventDefault();
    if (disabled) {
      return;
    }
    cancelPendingFocus();
    try {
      const normalized = normalizeTagName(name);
      clearError("name");
      void invoke(state.view === "create" ? "create" : "rename", normalized);
    } catch (failure) {
      showValidation("name", failure);
    }
  }

  function search(event) {
    event.preventDefault();
    if (disabled) {
      return;
    }
    cancelPendingFocus();
    try {
      const normalized = normalizeLibraryQuery(q);
      clearError("query");
      void requestRead("list", "list", normalized);
    } catch (failure) {
      showValidation("query", failure);
    }
  }

  function retry() {
    if (busy) {
      return;
    }
    cancelPendingFocus();
    try {
      const normalized = state.mutation.needsName
        ? normalizeTagName(originalName)
        : undefined;
      clearError("retryName");
      void invoke("retry", normalized);
    } catch (failure) {
      showValidation("retryName", failure);
    }
  }

  function listAll() {
    return requestRead("list", "list", "");
  }

  function reloadMutation() {
    return invoke("reload", state.mutation.phase === "csrf");
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
      return requestRead("list", "list");
    }
    if (state.requestedId) {
      return requestRead("open", `detail:${state.requestedId}`, state.requestedId);
    }
    return requestRead("list", "list");
  }

  return {
    feedback,
    cancelDelete,
    deleteTrigger,
    pageStatus: readFocus.target,
    view: {
      state,
      busy,
      locked,
      actions: {
        ...actions,
        inbox: () => invoke("inbox"),
        open: id => invoke("open", id),
        beginCreate: () => invoke("beginCreate"),
        select: status => requestRead("select", `select:${state.tag.tagId}`, status),
        add: id => invoke("add", id),
        remove: id => invoke("remove", id),
        openMemory: id => invoke("openMemory", id),
      },
      disabled,
      name,
      setName: value => changeField("name", value, setName),
      q,
      setQ: value => changeField("query", value, setQ),
      originalName,
      setOriginalName: value => changeField("retryName", value, setOriginalName),
      fieldErrors,
      fields: { name: nameInput, query: queryInput, retryName: retryNameInput },
      error: null,
      confirmDelete,
      handlers: {
        submitName,
        search,
        retry,
        listAll,
        reloadMutation,
        beginDelete,
        cancelDeletion,
        confirmDeletion,
        reloadFirstPage,
        previousPage: () => requestRead("page", undefined, false),
        nextPage: () => requestRead("page", undefined, true),
      },
    },
  };
}
