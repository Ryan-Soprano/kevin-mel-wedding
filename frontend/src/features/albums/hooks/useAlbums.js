import { useEffect, useRef, useState } from "react";
import { normalizeAlbumName } from "../albumName.js";

export function useAlbums({ state, busy, locked, actions }) {
  const [name, setName] = useState(state.album?.name ?? "");
  const [originalName, setOriginalName] = useState("");
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const feedback = useRef(null);
  const cancelDelete = useRef(null);
  const disabled = busy || locked;

  useEffect(() => {
    if (state.mutation.error || state.notice || state.error) feedback.current?.focus();
  }, [state.mutation.error, state.notice, state.error]);

  useEffect(() => {
    if (confirmDelete) cancelDelete.current?.focus();
  }, [confirmDelete]);

  function submitName(event) {
    event.preventDefault();
    try {
      const normalized = normalizeAlbumName(name);
      setError(null);
      if (state.view === "create") void actions.create(normalized);
      else void actions.rename(normalized);
    } catch (failure) { setError(failure.message); }
  }

  function retry() {
    try {
      setError(null);
      let normalized;
      if (state.mutation.needsName) normalized = normalizeAlbumName(originalName);
      void actions.retry(normalized);
    } catch (failure) { setError(failure.message); }
  }

  function beginDelete() { setConfirmDelete(true); }
  function cancelDeletion() { setConfirmDelete(false); }
  function confirmDeletion() {
    setConfirmDelete(false);
    void actions.delete();
  }

  function reloadFirstPage() {
    if (state.view === "list") return actions.list();
    if (state.requestedId) return actions.open(state.requestedId);
    return actions.list();
  }

  return {
    feedback, cancelDelete,
    view: {
      state, busy, locked, actions, disabled, name, setName, originalName, setOriginalName, error, confirmDelete,
      handlers: { submitName, retry, beginDelete, cancelDeletion, confirmDeletion, reloadFirstPage },
    },
  };
}
