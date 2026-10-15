import {
  useEffect,
  useRef,
  useState,
} from "react";
import {
  normalizeLibraryQuery,
  normalizeTagName,
} from "../libraryFilters.js";

export function useTags({ state, busy, locked, actions }) {
  const [name, setName] = useState(state.tag?.name ?? "");
  const [q, setQ] = useState(state.q);
  const [originalName, setOriginalName] = useState("");
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const feedback = useRef(null);
  const cancelDelete = useRef(null);
  const deleteTrigger = useRef(null);
  const restoreDeleteFocus = useRef(false);
  const disabled = busy || locked;

  useEffect(() => {
    if (error || state.mutation.error || state.notice || state.error) {
      feedback.current?.focus();
    }
  }, [error, state.mutation.error, state.notice, state.error]);

  useEffect(() => {
    if (confirmDelete) {
      cancelDelete.current?.focus();
    } else if (restoreDeleteFocus.current && !disabled) {
      restoreDeleteFocus.current = false;
      deleteTrigger.current?.focus();
    }
  }, [confirmDelete, disabled]);

  function submitName(event) {
    event.preventDefault();
    try {
      const normalized = normalizeTagName(name);
      setError(null);
      if (state.view === "create") {
        void actions.create(normalized);
      } else {
        void actions.rename(normalized);
      }
    } catch (failure) {
      setError(failure.message);
    }
  }

  function search(event) {
    event.preventDefault();
    try {
      setError(null);
      void actions.list(normalizeLibraryQuery(q));
    } catch (failure) {
      setError(failure.message);
    }
  }

  function retry() {
    try {
      setError(null);
      let normalized;
      if (state.mutation.needsName) {
        normalized = normalizeTagName(originalName);
      }
      void actions.retry(normalized);
    } catch (failure) {
      setError(failure.message);
    }
  }

  function listAll() {
    return actions.list("");
  }

  function reloadMutation() {
    return actions.reload(state.mutation.phase === "csrf");
  }

  function beginDelete() {
    setConfirmDelete(true);
  }

  function cancelDeletion() {
    restoreDeleteFocus.current = true;
    setConfirmDelete(false);
  }

  function confirmDeletion() {
    setConfirmDelete(false);
    void actions.delete();
  }

  function reloadFirstPage() {
    if (state.view === "list") {
      return actions.list();
    }
    if (state.requestedId) {
      return actions.open(state.requestedId);
    }
    return actions.list();
  }

  function previousPage() {
    return actions.page(false);
  }

  function nextPage() {
    return actions.page(true);
  }

  return {
    feedback,
    cancelDelete,
    deleteTrigger,
    view: {
      state,
      busy,
      locked,
      actions,
      disabled,
      name,
      setName,
      q,
      setQ,
      originalName,
      setOriginalName,
      error,
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
        previousPage,
        nextPage,
      },
    },
  };
}
