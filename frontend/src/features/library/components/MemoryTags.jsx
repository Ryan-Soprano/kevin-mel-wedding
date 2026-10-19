import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { normalizeLibraryQuery } from "../libraryFilters.js";
import { useLibraryReadFocus } from "../hooks/useLibraryReadFocus.js";
import { getTagsFeedback } from "../tagDisplay.js";
import "../library.css";

function TagRecovery({ state, busy, actions }) {
  function retry() {
    if (busy) {
      return;
    }
    void actions.retry(undefined);
  }

  return (
    <div className="tag-recovery">
      <p>Keep this page open while the tag change is pending or unconfirmed. Other changes, navigation and sign-out are paused.</p>
      {["saving", "loading"].includes(state.mutation.phase) && <p role="status">Checking the tag change…</p>}
      {["uncertain", "conflict", "csrf"].includes(state.mutation.phase) && (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              return actions.reload(state.mutation.phase === "csrf");
            }}
          >
            {state.mutation.phase === "csrf" ? "Refresh session and current tag" : "Reload current tag"}
          </button>
          {state.mutation.canRetry && (
            <button className="button-secondary" type="button" disabled={busy} onClick={retry}>
              Retry this same tag change
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default function MemoryTags({ state, busy, locked, actions, editorKey }) {
  const context = `${state.view}:${state.memoryId ?? ""}`;
  const readFocus = useLibraryReadFocus({ state, busy, locked, context });
  return (
    <MemoryTagsEditor
      key={editorKey}
      state={state}
      busy={busy}
      locked={locked}
      actions={actions}
      readFocus={readFocus}
    />
  );
}

function MemoryTagsEditor({ state, busy, locked, actions, readFocus }) {
  const [q, setQ] = useState(state.q);
  const [validation, setValidation] = useState({});
  const input = useRef(null);
  const feedback = useRef(null);
  const validationFocus = useRef(false);
  const disabled = busy || locked;
  const choosing = state.view === "attach";
  const notice = getTagsFeedback(null, state);
  const cancelValidationFocus = useCallback(() => {
    validationFocus.current = false;
  }, []);

  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") {
        cancelValidationFocus();
      }
    };
    window.addEventListener("blur", cancelValidationFocus);
    window.addEventListener("pagehide", cancelValidationFocus);
    window.addEventListener("popstate", cancelValidationFocus);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      cancelValidationFocus();
      window.removeEventListener("blur", cancelValidationFocus);
      window.removeEventListener("pagehide", cancelValidationFocus);
      window.removeEventListener("popstate", cancelValidationFocus);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [cancelValidationFocus]);

  const { canFocusFeedback, target: pageStatus } = readFocus;
  useEffect(() => {
    const target = feedback.current;
    if (
      canFocusFeedback() && (state.error || state.mutation.error || state.notice)
      && target?.isConnected && target.getClientRects().length > 0
    ) {
      target.focus();
    }
  }, [state.error, state.mutation.error, state.notice, canFocusFeedback]);

  useEffect(() => {
    if (validationFocus.current && !busy) {
      validationFocus.current = false;
      if (input.current?.isConnected && input.current.getClientRects().length > 0) {
        input.current.focus();
      }
    }
  }, [validation, busy]);

  function invoke(method, ...args) {
    cancelValidationFocus();
    readFocus.activate();
    return actions[method](...args);
  }

  function requestRead(method, view, ...args) {
    cancelValidationFocus();
    readFocus.begin(view ? `${view}:${state.memoryId ?? ""}` : undefined);
    return actions[method](...args);
  }

  function search(event) {
    event.preventDefault();
    if (disabled) {
      return;
    }
    cancelValidationFocus();
    readFocus.cancel();
    try {
      const normalized = normalizeLibraryQuery(q);
      setValidation({});
      void requestRead("choose", "attach", normalized);
    } catch (failure) {
      validationFocus.current = true;
      setValidation({ query: failure.message });
    }
  }

  return (
    <section className="memory-tags" aria-label="Tags attached to this memory" aria-busy={busy}>
      <h3>Memory tags</h3>
      <h4 ref={pageStatus} tabIndex={-1} className="visually-hidden">
        {choosing ? "Available memory tags" : "Attached memory tags"} · Page {state.cursors.length}{state.error ? " could not be loaded" : ""}
      </h4>
      <p>Private labels organize this memory without changing its original content, files, memory date or saved time.</p>
      {notice.visible && (
        <p ref={feedback} tabIndex={-1} className={notice.className} role={notice.role}>
          {notice.text}
        </p>
      )}
      {state.mutation.phase !== "idle" && (
        <TagRecovery state={state} busy={busy} actions={{
          reload: refreshSession => invoke("reload", refreshSession),
          retry: () => invoke("retry", undefined),
        }} />
      )}
      {choosing ? (
        <>
          <h4>Add an existing tag</h4>
          <button className="button-secondary" type="button" disabled={disabled} onClick={() => requestRead("attached", "memory")}>
            Back to attached tags
          </button>
          <form className="memory-tag-search" onSubmit={search}>
            <label htmlFor="memory-tag-query">Search available tags</label>
            <input
              id="memory-tag-query"
              ref={input}
              type="search"
              maxLength={200}
              value={q}
              disabled={disabled}
              onChange={(event) => {
                cancelValidationFocus();
                readFocus.cancel();
                setQ(event.target.value);
                setValidation({});
              }}
              aria-invalid={Boolean(validation.query)}
              aria-describedby={validation.query ? "memory-tag-query-error" : undefined}
            />
            {validation.query && <p id="memory-tag-query-error" className="form-error" role="alert">{validation.query}</p>}
            <button type="submit" disabled={disabled}>Search available tags</button>
          </form>
        </>
      ) : (
        <button type="button" disabled={disabled} onClick={() => requestRead("choose", "attach")}>Add tags</button>
      )}
      {busy ? (
        <p role="status">Loading memory tags…</p>
      ) : !state.error && !state.items.length ? (
        <p role="status">{choosing ? "No matching tags. Create tags from Manage tags in your Library." : "No attached tags on this page."}</p>
      ) : (
        <ul className="inbox-list memory-tag-list">
          {state.items.map(tag => (
            <li key={tag.tagId} className="inbox-card">
              <h4>{tag.name}</h4>
              <p>{tag.memberCount} tagged memories</p>
              <button className={choosing ? undefined : "button-secondary"} type="button" disabled={disabled} onClick={() => invoke("change", tag.tagId, !choosing)}>
                {choosing ? "Attach tag" : "Remove tag"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {state.error && (
        <button type="button" disabled={disabled} onClick={() => choosing ? requestRead("choose", "attach", state.q) : requestRead("attached", "memory")}>
          Reload tags first page
        </button>
      )}
      <div className="inbox-pagination memory-tag-pagination">
        <button className="button-secondary" type="button" disabled={disabled || Boolean(state.error) || state.cursors.length < 2} onClick={() => requestRead("page", null, false)}>
          Previous memory tags page
        </button>
        <span>Page {state.cursors.length}</span>
        <button className="button-secondary" type="button" disabled={disabled || Boolean(state.error) || !state.nextCursor} onClick={() => requestRead("page", null, true)}>
          Next memory tags page
        </button>
      </div>
    </section>
  );
}
