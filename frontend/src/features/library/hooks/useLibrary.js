import {
  useEffect,
  useRef,
  useState,
} from "react";
import {
  normalizeLibraryFilters,
  normalizeLibraryQuery,
} from "../libraryFilters.js";

export function useLibrary({ state, busy, locked, actions }) {
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
  const [error, setError] = useState(null);
  const feedback = useRef(null);
  const disabled = busy || locked;
  const choosing = state.view === "chooseTag";

  useEffect(() => {
    if (error || state.error) {
      feedback.current?.focus();
    }
  }, [error, state.error]);

  function filters() {
    const invalidYear = [fromYear, toYear].some(
      (value) => value && !/^\d{1,4}$/.test(value),
    );
    if (invalidYear) {
      throw new TypeError("Use years between 1 and 9999.");
    }
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

  function apply(event) {
    event.preventDefault();
    try {
      setError(null);
      void actions.list(filters());
    } catch (failure) {
      setError(failure.message);
    }
  }

  function choose() {
    try {
      setError(null);
      void actions.choose(filters());
    } catch (failure) {
      setError(failure.message);
    }
  }

  function searchTags(event) {
    event.preventDefault();
    try {
      setError(null);
      void actions.choose(
        state.draftFilters,
        normalizeLibraryQuery(tagQuery),
      );
    } catch (failure) {
      setError(failure.message);
    }
  }

  function clearTag() {
    try {
      setError(null);
      void actions.list({
        ...filters(),
        tagId: null,
      });
    } catch (failure) {
      setError(failure.message);
    }
  }

  function resetSearch() {
    return actions.list(normalizeLibraryFilters());
  }

  function cancelTagSelection() {
    return actions.list(
      state.filters,
      state.cursors.at(-1),
      state.cursors,
    );
  }

  function reloadFirstPage() {
    if (choosing) {
      return actions.choose(state.draftFilters, state.tagQuery);
    }
    return actions.list(state.filters);
  }

  function previousPage() {
    return actions.page(false);
  }

  function nextPage() {
    return actions.page(true);
  }

  return {
    feedback,
    view: {
      state,
      busy,
      disabled,
      choosing,
      actions,
      q,
      setQ,
      type,
      setType,
      status,
      setStatus,
      precision,
      setPrecision,
      fromYear,
      setFromYear,
      toYear,
      setToYear,
      tagQuery,
      setTagQuery,
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
