import { ApiError } from "../../../shared/api/apiClient.js";
import { normalizeLibraryFilters, normalizeLibraryQuery } from "../libraryFilters.js";

const EMPTY = Object.freeze([]);
export const initialLibrary = () => Object.freeze({ view: "search", filters: Object.freeze(normalizeLibraryFilters()), tagName: null,
  items: EMPTY, nextCursor: null, cursors: Object.freeze([null]), tagChoices: EMPTY, tagQuery: "", tagNextCursor: null,
  tagCursors: Object.freeze([null]), draftFilters: null, error: null, formResetVersion: 0 });
/** Read-only applied search and page context, kept only while the page is visible. */
export function createLibraryActions({ api, getState, publish, start, bounded, run, assertCurrent, authFailure, freeze, canNavigate, openMemory }) {
  let returning = false, hiddenLibrary = false;
  const state = () => getState().library;
  const set = patch => publish({ library: freeze({ ...state(), ...patch }) });
  const base = patch => ({ phase: "library", detail: null, items: EMPTY, nextCursor: null, libraryReturn: false, notice: null, library: freeze({ ...state(), error: null, ...patch }) });
  function failure(error) {
    if (!authFailure(error)) set({ error: error?.status === 412 ? "These live results changed. Load the first page using the same filters."
      : error?.status === 404 ? "The selected tag is unavailable. Clear the tag filter or reset the search."
        : "Your library could not be loaded. Try again." });
  }
  async function read(op, filters = state().filters, cursor = null, cursors = [null], tagName = state().tagName) {
    if (filters.tagId) {
      const tag = await bounded(op, signal => api.getTag(filters.tagId, { signal }));
      if (tag.deletedAt !== null) throw new ApiError("Tag unavailable.", { status: 404 }); tagName = tag.name;
    } else tagName = null;
    const page = await bounded(op, signal => api.listLibraryMemories({ ...filters, ...(cursor ? { cursor } : {}), signal })); assertCurrent(op);
    set({ view: "search", filters, tagName, items: page.items, nextCursor: page.nextCursor, cursors, tagChoices: EMPTY, draftFilters: null, error: null });
  }
  const actions = {
    clear() { returning = false; hiddenLibrary = false; },
    clearNavigation() { returning = false; hiddenLibrary = false; return { libraryReturn: false }; },
    memoryContext(value) { returning = value; publish({ libraryReturn: value }); }, hasReturn: () => returning,
    hasPending: () => hiddenLibrary,
    suspend() { hiddenLibrary = returning || getState().phase === "library" || hiddenLibrary; returning = false; return { library: initialLibrary(), libraryReturn: false }; },
    async resume(op) { publish({ phase: "library" }); await read(op, normalizeLibraryFilters()); hiddenLibrary = false; },
    loadLibrary(filters = state().filters, cursor = null, cursors = [null], tagName = state().tagName) {
      if (!canNavigate()) return Promise.resolve(getState()); returning = false;
      const normalized = normalizeLibraryFilters(filters), op = start(base({ view: "search", filters: normalized, tagName, items: EMPTY, nextCursor: null, cursors, tagChoices: EMPTY, formResetVersion: state().formResetVersion + 1 }));
      return run(op, () => read(op, normalized, cursor, cursors, tagName), failure);
    },
    returnToLibrary() { return actions.loadLibrary(state().filters, state().cursors.at(-1), state().cursors); },
    openLibraryMemory(memoryId) { if (!canNavigate()) return Promise.resolve(getState()); return openMemory(memoryId, { libraryReturn: true }); },
    chooseLibraryTag(filters = state().filters, q = "", cursor = null, cursors = [null]) {
      if (!canNavigate()) return Promise.resolve(getState()); const normalized = normalizeLibraryFilters(filters), query = normalizeLibraryQuery(q);
      const op = start(base({ view: "chooseTag", draftFilters: normalized, tagQuery: query, tagChoices: EMPTY, tagNextCursor: null, tagCursors: cursors }));
      return run(op, async () => { const page = await bounded(op, signal => api.listTags({ q: query, ...(cursor ? { cursor } : {}), signal }));
        assertCurrent(op); set({ tagChoices: page.items, tagNextCursor: page.nextCursor, error: null }); }, failure);
    },
    selectLibraryTag(tag) { if (!canNavigate()) return Promise.resolve(getState()); return actions.loadLibrary({ ...state().draftFilters, tagId: tag.tagId }, null, [null], tag.name); },
    libraryPage(next) {
      if (!canNavigate() || getState().busy || state().error) return Promise.resolve(getState());
      const choosing = state().view === "chooseTag", current = choosing ? state().tagCursors : state().cursors, nextCursor = choosing ? state().tagNextCursor : state().nextCursor;
      const cursors = next ? [...current, nextCursor] : current.slice(0, -1); if ((next && !nextCursor) || !cursors.length) return Promise.resolve(getState());
      return choosing ? actions.chooseLibraryTag(state().draftFilters, state().tagQuery, cursors.at(-1), cursors)
        : actions.loadLibrary(state().filters, cursors.at(-1), cursors);
    },
  }; return actions;
}
