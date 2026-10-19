import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  emptyEventFields,
  EVENT_FIELDS,
  normalizeEventFields,
  normalizeTimelineFilters,
} from "../timelineFields.js";
import {
  getTimelineFilterErrors,
  getTimelineYear,
  initialTimelineFields,
} from "../timelineDisplay.js";

/** Read focus survives editor/filter resets, but never leaving this screen. */
export function useTimelinePagingFocus({ state, busy, locked }) {
  const target = useRef(null);
  const intent = useRef(null);
  const feedbackAllowed = useRef(true);
  const cancel = useCallback(() => {
    intent.current = null;
    feedbackAllowed.current = false;
  }, []);

  useEffect(() => {
    feedbackAllowed.current = true;
    const hidden = () => {
      if (document.visibilityState === "hidden") {
        cancel();
      }
    };
    const focusElsewhere = (event) => {
      const next = event.target;
      if (
        intent.current && next !== target.current
        && (next?.tabIndex >= 0 || next?.isContentEditable)
      ) {
        cancel();
      }
    };
    window.addEventListener("blur", cancel);
    window.addEventListener("pagehide", cancel);
    window.addEventListener("popstate", cancel);
    document.addEventListener("visibilitychange", hidden);
    document.addEventListener("focusin", focusElsewhere);
    return () => {
      cancel();
      window.removeEventListener("blur", cancel);
      window.removeEventListener("pagehide", cancel);
      window.removeEventListener("popstate", cancel);
      document.removeEventListener("visibilitychange", hidden);
      document.removeEventListener("focusin", focusElsewhere);
    };
  }, [cancel]);

  useEffect(() => {
    const pending = intent.current;
    if (!pending || busy || state === pending.before) {
      return;
    }
    intent.current = null;
    const eventId = state.event?.eventId ?? state.requestedId ?? null;
    if (
      !locked && state.view === pending.view && eventId === pending.eventId
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
      eventId: state.event?.eventId ?? state.requestedId ?? null,
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

export function useTimeline({ state, busy, locked, actions, pagingFocus }) {
  const [fields, setFields] = useState(() => initialTimelineFields(state));
  const [retryFields, setRetryFields] = useState(emptyEventFields);
  const [fromYear, setFromYear] = useState(state.filters.fromYear?.toString() ?? "");
  const [toYear, setToYear] = useState(state.filters.toYear?.toString() ?? "");
  const [precision, setPrecision] = useState(state.filters.datePrecision);
  const [fieldErrors, setFieldErrors] = useState({
    editor: {},
    retry: {},
    filters: {},
  });
  const [formError, setFormError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputs = useRef({ editor: {}, retry: {}, filters: {} });
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
  const registerEditorField = useCallback((field, element) => {
    inputs.current.editor[field] = element;
  }, []);
  const registerRetryField = useCallback((field, element) => {
    inputs.current.retry[field] = element;
  }, []);
  const registerFilterField = useCallback((field, element) => {
    inputs.current.filters[field] = element;
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
    if (canFocusFeedback() && (state.error || state.mutation.error || state.notice)) {
      feedback.current?.focus();
    }
  }, [state.error, state.mutation.error, state.notice, canFocusFeedback]);

  useEffect(() => {
    const pending = validationFocus.current;
    if (!pending || busy) {
      return;
    }
    validationFocus.current = null;
    const group = inputs.current[pending.scope];
    const target = group[pending.field]
      ?? (pending.field === "eventDate" ? group.datePrecision : null)
      ?? feedback.current;
    if (target?.isConnected && !target.disabled) {
      target.focus();
    }
  }, [fieldErrors, formError, busy]);

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

  function clearValidation(scope, changedFields) {
    setFieldErrors((current) => {
      const next = { ...current[scope] };
      for (const field of changedFields ?? Object.keys(next)) {
        delete next[field];
      }
      return { ...current, [scope]: next };
    });
    setFormError((current) => current?.scope === scope
      ? null
      : current);
  }

  function showValidation(scope, errors, message) {
    const first = Object.keys(errors)[0] ?? null;
    validationFocus.current = { scope, field: first };
    setFieldErrors((current) => ({ ...current, [scope]: errors }));
    setFormError(first ? null : { scope, message });
  }

  function showEventValidation(scope, failure) {
    const errors = {};
    for (const item of failure.fieldErrors ?? []) {
      if (EVENT_FIELDS.includes(item.field) && !errors[item.field]) {
        errors[item.field] = item.message;
      }
    }
    showValidation(scope, errors, failure.message);
  }

  function changeEventField(scope, field, value) {
    cancelPendingFocus();
    const update = scope === "retry" ? setRetryFields : setFields;
    update((previous) => ({
      ...previous,
      [field]: value,
      ...(field === "datePrecision" ? { eventDate: null } : {}),
    }));
    const changedFields = field === "datePrecision"
      ? [field, "eventDate"]
      : [field];
    clearValidation(scope, changedFields);
  }

  function changeFilter(field, value) {
    cancelPendingFocus();
    if (field === "fromYear") {
      setFromYear(value);
    } else if (field === "toYear") {
      setToYear(value);
    } else {
      setPrecision(value);
    }
    // Range and UNKNOWN validation depend on more than one filter control.
    clearValidation("filters");
  }

  function save(event) {
    event.preventDefault();
    if (disabled) {
      return;
    }
    cancelPendingFocus();
    try {
      const normalized = normalizeEventFields(fields);
      clearValidation("editor");
      void invoke(state.view === "create" ? "create" : "edit", normalized);
    } catch (failure) {
      showEventValidation("editor", failure);
    }
  }

  function retry() {
    if (busy) {
      return;
    }
    cancelPendingFocus();
    try {
      let normalized;
      if (state.mutation.needsFields) {
        normalized = normalizeEventFields(retryFields);
      }
      clearValidation("retry");
      void invoke("retry", normalized);
    } catch (failure) {
      showEventValidation("retry", failure);
    }
  }

  function filter(event) {
    event.preventDefault();
    if (disabled) {
      return;
    }
    cancelPendingFocus();
    const errors = getTimelineFilterErrors({ fromYear, toYear, precision });
    if (Object.keys(errors).length) {
      showValidation("filters", errors);
      return;
    }
    const filters = normalizeTimelineFilters({
      fromYear: getTimelineYear(fromYear),
      toYear: getTimelineYear(toYear),
      datePrecision: precision,
    });
    clearValidation("filters");
    void requestPage("list", filters);
  }

  function clearFilters() {
    setFromYear("");
    setToYear("");
    setPrecision("ALL");
    clearValidation("filters");
    void requestPage("list", normalizeTimelineFilters());
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
        list: filters => invoke("list", filters),
        open: id => invoke("open", id),
        beginCreate: () => invoke("beginCreate"),
        create: value => invoke("create", value),
        edit: value => invoke("edit", value),
        delete: () => invoke("delete"),
        select: status => requestPage("select", status),
        link: id => invoke("link", id),
        unlink: id => invoke("unlink", id),
        openMemory: id => invoke("openMemory", id),
        page: next => requestPage("page", next),
        reload: refreshSession => invoke("reload", refreshSession),
        retry: value => invoke("retry", value),
      },
      disabled,
      fields,
      retryFields,
      fieldErrors,
      registerEditorField,
      registerRetryField,
      registerFilterField,
      fromYear,
      setFromYear: value => changeFilter("fromYear", value),
      toYear,
      setToYear: value => changeFilter("toYear", value),
      precision,
      setPrecision: value => changeFilter("datePrecision", value),
      error: formError?.message ?? null,
      confirmDelete,
      handlers: {
        changeFields: (field, value) => changeEventField("editor", field, value),
        changeRetryFields: (field, value) => changeEventField("retry", field, value),
        save,
        retry,
        filter,
        clearFilters,
        beginDelete,
        cancelDeletion,
        confirmDeletion,
        reloadFirstPage,
      },
    },
  };
}
