import { useEffect, useRef, useState } from "react";
import { emptyEventFields, normalizeEventFields, normalizeTimelineFilters } from "../timelineFields.js";
import { getTimelineYear, initialTimelineFields } from "../timelineDisplay.js";

export function useTimeline({ state, busy, locked, actions }) {
  const [fields, setFields] = useState(initialTimelineFields(state));
  const [retryFields, setRetryFields] = useState(emptyEventFields());
  const [fromYear, setFromYear] = useState(state.filters.fromYear?.toString() ?? "");
  const [toYear, setToYear] = useState(state.filters.toYear?.toString() ?? "");
  const [precision, setPrecision] = useState(state.filters.datePrecision);
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const feedback = useRef(null);
  const cancelDelete = useRef(null);
  const deleteTrigger = useRef(null);
  const restoreDeleteFocus = useRef(false);
  const disabled = busy || locked;

  useEffect(() => {
    if (error || state.error || state.mutation.error || state.notice) feedback.current?.focus();
  }, [error, state.error, state.mutation.error, state.notice]);

  useEffect(() => {
    if (confirmDelete) cancelDelete.current?.focus();
    else if (restoreDeleteFocus.current && !disabled) {
      restoreDeleteFocus.current = false;
      deleteTrigger.current?.focus();
    }
  }, [confirmDelete, disabled]);

  function save(event) {
    event.preventDefault();
    try {
      setError(null);
      const normalized = normalizeEventFields(fields);
      if (state.view === "create") void actions.create(normalized);
      else void actions.edit(normalized);
    } catch (failure) { setError(failure.message); }
  }

  function retry() {
    try {
      setError(null);
      let normalized;
      if (state.mutation.needsFields) normalized = normalizeEventFields(retryFields);
      void actions.retry(normalized);
    } catch (failure) { setError(failure.message); }
  }

  function filter(event) {
    event.preventDefault();
    try {
      if ([fromYear, toYear].some(value => value && !/^\d{1,4}$/.test(value))) throw new TypeError("Use a year between 1 and 9999.");
      const filters = normalizeTimelineFilters({ fromYear: getTimelineYear(fromYear), toYear: getTimelineYear(toYear), datePrecision: precision });
      setError(null);
      void actions.list(filters);
    } catch (failure) { setError(failure.message); }
  }

  function clearFilters() {
    setFromYear("");
    setToYear("");
    setPrecision("ALL");
    setError(null);
    void actions.list(normalizeTimelineFilters());
  }

  function beginDelete() { setConfirmDelete(true); }

  function cancelDeletion() {
    restoreDeleteFocus.current = true;
    setConfirmDelete(false);
  }

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
    feedback, cancelDelete, deleteTrigger,
    view: {
      state, busy, locked, actions, disabled, fields, setFields, retryFields, setRetryFields,
      fromYear, setFromYear, toYear, setToYear, precision, setPrecision, error, confirmDelete,
      handlers: { save, retry, filter, clearFilters, beginDelete, cancelDeletion, confirmDeletion, reloadFirstPage },
    },
  };
}
