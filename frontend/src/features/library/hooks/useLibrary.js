import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  normalizeLibraryFilters,
  normalizeLibraryQuery,
} from "../libraryFilters.js";
import {
  getLibraryFilterErrors,
  getLibraryQueryError,
} from "../libraryDisplay.js";

export function useLibrary({ state, busy, locked, actions, readFocus }) {
  const [q, setQ] = useState(state.filters.q);
  const [type, setType] = useState(state.filters.memoryType);
  const [status, setStatus] = useState(state.filters.reviewStatus);
  const [precision, setPrecision] = useState(state.filters.datePrecision);
  const [fromYear, setFromYear] = useState(
    state.filters.fromYear?.toString() ?? "",
  );
  const [toYear, setToYear] = useState(
    state.filters.toYear?.toString() ?? "",
  );
  const [tagQuery, setTagQuery] = useState(state.tagQuery);
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState(null);
  const fields = useRef({});
  const validationFocus = useRef(null);
  const feedback = useRef(null);
  const disabled = busy || locked;
  const choosing = state.view === "chooseTag";
  const cancelLocalFocus = useCallback(() => {
    validationFocus.current = null;
  }, []);
  const registerField = useCallback((field, element) => {
    fields.current[field] = element;
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
    if (canFocusFeedback() && state.error) {
      feedback.current?.focus();
    }
  }, [state.error, canFocusFeedback]);

  useEffect(() => {
    if (!validationFocus.current || busy) {
      return;
    }
    const target = fields.current[validationFocus.current] ?? feedback.current;
    validationFocus.current = null;
    if (target?.isConnected && !target.disabled) {
      target.focus();
    }
  }, [fieldErrors, error, busy]);

  function cancelPendingFocus() {
    cancelLocalFocus();
    readFocus.cancel();
  }

  function invoke(method, ...args) {
    cancelLocalFocus();
    readFocus.activate();
    return actions[method](...args);
  }

  function request(method, context, ...args) {
    cancelLocalFocus();
    readFocus.begin(context);
    return actions[method](...args);
  }

  function clearValidation(changedFields) {
    setFieldErrors((current) => {
      if (!changedFields) {
        return {};
      }
      const next = { ...current };
      for (const field of changedFields) {
        delete next[field];
      }
      return next;
    });
    setError(null);
  }

  function showValidation(errors, message) {
    readFocus.cancel();
    validationFocus.current = Object.keys(errors)[0] ?? "feedback";
    setFieldErrors(errors);
    setError(message ?? null);
  }

  function changeField(field, value) {
    cancelPendingFocus();
    const setters = {
      q: setQ,
      memoryType: setType,
      reviewStatus: setStatus,
      datePrecision: setPrecision,
      fromYear: setFromYear,
      toYear: setToYear,
      tagQuery: setTagQuery,
    };
    setters[field](value);
    // Range and UNKNOWN errors depend on all three date-filter controls.
    const changedFields = ["datePrecision", "fromYear", "toYear"].includes(field)
      ? ["datePrecision", "fromYear", "toYear"]
      : [field];
    clearValidation(changedFields);
  }

  function filters() {
    return normalizeLibraryFilters({
      q,
      memoryType: type,
      reviewStatus: status,
      datePrecision: precision,
      fromYear: fromYear ? Number(fromYear) : null,
      toYear: toYear ? Number(toYear) : null,
      tagId: state.filters.tagId,
    });
  }

  function withFilters(method, context, transform = value => value) {
    if (disabled) {
      return;
    }
    cancelPendingFocus();
    const errors = getLibraryFilterErrors({
      q,
      type,
      status,
      precision,
      fromYear,
      toYear,
    });
    if (Object.keys(errors).length) {
      showValidation(errors);
      return;
    }
    try {
      const normalized = transform(filters());
      clearValidation();
      void request(method, context, normalized);
    } catch (failure) {
      showValidation({}, failure.message);
    }
  }

  function apply(event) {
    event.preventDefault();
    withFilters("list", "search");
  }

  function choose() {
    withFilters("choose", "chooseTag");
  }

  function searchTags(event) {
    event.preventDefault();
    if (disabled) {
      return;
    }
    cancelPendingFocus();
    const queryError = getLibraryQueryError(tagQuery);
    if (queryError) {
      showValidation({ tagQuery: queryError });
      return;
    }
    try {
      clearValidation();
      void request(
        "choose",
        "chooseTag",
        state.draftFilters,
        normalizeLibraryQuery(tagQuery),
      );
    } catch (failure) {
      showValidation({}, failure.message);
    }
  }

  function clearTag() {
    withFilters("list", "search", value => ({ ...value, tagId: null }));
  }

  function resetSearch() {
    clearValidation();
    return request("list", "search", normalizeLibraryFilters());
  }

  function cancelTagSelection() {
    clearValidation();
    return request(
      "list",
      "search",
      state.filters,
      state.cursors.at(-1),
      state.cursors,
    );
  }

  function reloadFirstPage() {
    clearValidation();
    if (choosing) {
      return request("choose", "chooseTag", state.draftFilters, state.tagQuery);
    }
    return request("list", "search", state.filters);
  }

  function previousPage() {
    return request("page", state.view, false);
  }

  function nextPage() {
    return request("page", state.view, true);
  }

  return {
    feedback,
    pageStatus: readFocus.target,
    view: {
      state,
      busy,
      disabled,
      choosing,
      actions: {
        ...actions,
        inbox: () => invoke("inbox"),
        tags: () => invoke("tags"),
        open: id => invoke("open", id),
        selectTag: tag => request("selectTag", "search", tag),
      },
      q,
      setQ: value => changeField("q", value),
      type,
      setType: value => changeField("memoryType", value),
      status,
      setStatus: value => changeField("reviewStatus", value),
      precision,
      setPrecision: value => changeField("datePrecision", value),
      fromYear,
      setFromYear: value => changeField("fromYear", value),
      toYear,
      setToYear: value => changeField("toYear", value),
      tagQuery,
      setTagQuery: value => changeField("tagQuery", value),
      fieldErrors,
      registerField,
      error,
      handlers: {
        apply,
        choose,
        searchTags,
        clearTag,
        resetSearch,
        cancelTagSelection,
        reloadFirstPage,
        previousPage,
        nextPage,
      },
    },
  };
}
