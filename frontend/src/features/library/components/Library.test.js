import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { initialLibrary } from "../api/libraryActions.js";
import { initialTags } from "../api/tagActions.js";
import {
  getLibraryFeedback,
  getLibraryFilterErrors,
  getLibraryQueryError,
} from "../libraryDisplay.js";
import { getTagsFeedback } from "../tagDisplay.js";
import {
  MEMORY_DETAIL,
  MEDIA_DETAIL,
} from "../../../shared/api/v1/fixtures.js";

const TAG = {
  tagId: "55555555-5555-4555-8555-555555555555",
  name: "Our <tag>",
  memberCount: 25,
  revision: "66666666-6666-4666-8666-666666666666",
  createdAt: "2026-10-10T12:00:00Z",
  updatedAt: "2026-10-10T12:00:00Z",
  deletedAt: null
};

const actions = Object.fromEntries([
  "inbox", "list", "open", "beginCreate", "create", "rename", "delete",
  "select", "add", "remove", "openMemory", "page", "reload", "retry",
  "tags", "choose", "selectTag", "attached", "change",
].map(key => [key, () => {}]));
test("actual Library/Tags views expose literal filters, partial dates, bounded pages, private attribution and recovery without original preloads", async () => {
  // Actual React SSR verifies UI contracts and escaping. Root's packaged Chrome
  // fixture separately checks responsive layout, focus and authenticated flows.
  const server = await createServer({
    configFile: false,
    logLevel: "silent",
    root: fileURLToPath(new URL("../../../../", import.meta.url)),
    plugins: [react()],
    server: {
      middlewareMode: true,
      hmr: false,
      watch: null
    },
    appType: "custom",
    optimizeDeps: {
      noDiscovery: true,
      include: []
    }
  });
  try {
    const {
      default: Library
    } = await server.ssrLoadModule("/src/features/library/components/Library.jsx");
    const {
      default: Tags
    } = await server.ssrLoadModule("/src/features/library/components/Tags.jsx");
    const {
      default: MemoryTags
    } = await server.ssrLoadModule("/src/features/library/components/MemoryTags.jsx");
    const render = (Component, state, locked = false) => renderToStaticMarkup(
      createElement(Component, {
        state,
        busy: false,
        locked,
        actions,
      }),
    );
    const empty = render(Library, initialLibrary());
    assert.match(empty, /No matching memories/);
    assert.match(empty, /Reset library search/);
    assert.match(empty, /Literal words or characters/);
    assert.match(empty, /each memory’s sharing choice/);
    assert.match(empty, /role="status"[^>]*>[\s\S]*No matching memories/);
    for (const label of [
      "Search text",
      "Memory type",
      "Review status",
      "Memory date precision",
      "Memory date from year (inclusive)",
      "Memory date to year (inclusive)",
    ]) {
      assert.equal(empty.includes(label), true);
    }
    const memory = {
      ...MEMORY_DETAIL,
      title: "<Private title>",
      guestName: "Synthetic Guest",
      memoryDate: "2024-03",
      datePrecision: "MONTH"
    };
    const results = render(Library, {
      ...initialLibrary(),
      items: [
        memory,
        {
          ...MEDIA_DETAIL,
          source: "COUPLE",
          guestName: null,
          title: null,
        },
      ],
      nextCursor: "opaque-next",
      cursors: [null, "opaque-current"]
    });
    assert.match(results, /&lt;Private title&gt;/);
    assert.match(results, /Guest contribution · From Synthetic Guest/);
    assert.match(results, /Couple memory/);
    assert.match(results, /Memory date: March 2024/);
    assert.doesNotMatch(results, /March 1, 2024/);
    assert.match(results, /Saved on:/);
    assert.match(results, /Page 2/);
    assert.match(results, /Next library page/);
    assert.doesNotMatch(results, /<img|<audio|<video|\/playback/);
    assert.match(results, /Oct 24, 2026, 2:30 PM EDT<\/time> · Eastern/);
    assert.doesNotMatch(results, /Chicago|CDT|CST/);
    const chooser = render(Library, {
      ...initialLibrary(),
      view: "chooseTag",
      tagChoices: [TAG],
      draftFilters: initialLibrary().filters
    });
    assert.match(chooser, /Choose one tag/);
    assert.match(chooser, /Use this tag/);
    assert.match(chooser, /applies the other fields/);
    assert.match(chooser, /Our &lt;tag&gt;/);
    assert.match(chooser, /Created Oct 10, 2026, 8:00 AM EDT/);
    const failure = render(Library, {
      ...initialLibrary(),
      filters: {
        ...initialLibrary().filters,
        q: "Applied search"
      },
      error: "These live results changed."
    });
    assert.match(failure, /value="Applied search"/);
    assert.match(failure, /Load library first page/);
    const tagEmpty = render(Tags, initialTags());
    assert.match(tagEmpty, /Create a tag/);
    assert.match(tagEmpty, /Tag names may repeat/);
    assert.match(tagEmpty, /Search tag names/);
    assert.match(tagEmpty, /Tagging does not change who can see a memory/);
    assert.doesNotMatch(tagEmpty, /Nothing here is published/);
    const tagDetail = render(Tags, {
      ...initialTags(),
      view: "detail",
      tag: TAG,
      members: [{
        memory
      }],
      nextCursor: "opaque-next",
      cursors: [null, "opaque-current"]
    });
    assert.match(tagDetail, /Save tag name/);
    assert.match(tagDetail, /Remove from tag/);
    assert.match(tagDetail, /Next tag page/);
    assert.match(tagDetail, /Tagged memories · Page 2<\/h2>/);
    assert.match(tagDetail, /Guest contribution/);
    assert.doesNotMatch(tagDetail, /<img|<audio|<video/);
    assert.match(tagDetail, /Saved on: Oct 24, 2026, 2:30 PM EDT · Eastern/);
    assert.doesNotMatch(tagDetail, /Chicago|CDT|CST/);
    const tombstone = render(Tags, {
      ...initialTags(),
      view: "detail",
      tag: {
        ...TAG,
        name: null,
        memberCount: 0,
        deletedAt: TAG.updatedAt
      }
    });
    assert.match(tombstone, /Deleted tag/);
    assert.match(tombstone, /original files remain/);
    assert.doesNotMatch(tombstone, /Save tag name|Add memories/);
    const attached = render(MemoryTags, {
      ...initialTags(),
      view: "memory",
      memoryId: memory.memoryId,
      items: [TAG],
      nextCursor: "opaque-next"
    });
    assert.match(attached, /Memory tags/);
    assert.match(attached, /Remove tag/);
    assert.match(attached, /Next memory tags page/);
    assert.match(attached, /Attached memory tags · Page 1<\/h4>/);
    assert.match(attached, /original content, files, memory date or saved time/);
    const picker = render(MemoryTags, {
      ...initialTags(),
      view: "attach",
      memoryId: memory.memoryId,
      items: [TAG]
    });
    assert.match(picker, /Search available tags/);
    assert.match(picker, /Attach tag/);
    assert.match(picker, /Back to attached tags/);
    assert.match(picker, /Available memory tags · Page 1<\/h4>/);
    const locked = render(MemoryTags, {
      ...initialTags(),
      mutation: {
        phase: "uncertain",
        canRetry: true,
        needsName: false,
        error: "Unknown outcome"
      }
    }, true);
    assert.doesNotMatch(locked, /Original tag name/);
    assert.match(locked, /Reload current tag/);
    assert.match(locked, /Retry this same tag change/);
    assert.match(locked, /disabled=""[^>]*>Add tags/);
  } finally {
    await server.close();
  }
});

async function withLibraryView(check) {
  const server = await createServer({
    configFile: false,
    logLevel: "silent",
    root: fileURLToPath(new URL("../../../../", import.meta.url)),
    plugins: [react()],
    server: {
      middlewareMode: true,
      hmr: false,
      watch: null,
    },
    appType: "custom",
    optimizeDeps: {
      noDiscovery: true,
      include: [],
    },
  });

  try {
    const { default: Library } = await server.ssrLoadModule(
      "/src/features/library/components/Library.jsx",
    );
    const render = (state = {}, options = {}) => renderToStaticMarkup(
      createElement(Library, {
        state: { ...initialLibrary(), ...state },
        busy: false,
        locked: false,
        actions,
        ...options,
      }),
    );
    await check(render, server);
  } finally {
    await server.close();
  }
}

test("Library loading, errors and locks preserve result visibility and deliberate recovery gates", async () => {
  await withLibraryView(render => {
    const state = {
      items: [{
        ...MEMORY_DETAIL,
        title: "Retained result",
      }],
      nextCursor: "next-results",
      cursors: [null, "current-results"],
    };
    const loading = render(state, { busy: true });
    assert.match(loading, /role="status">Loading library…/);
    assert.doesNotMatch(loading, /Retained result|No matching memories/);
    assert.match(loading, /disabled=""[^>]*>Apply library filters/);
    assert.match(loading, /disabled=""[^>]*>Manage tags/);

    const locked = render(state, { locked: true });
    assert.match(locked, /Retained result/);
    assert.match(locked, /disabled=""[^>]*>Open memory/);
    assert.match(locked, /disabled=""[^>]*>Reset library search/);
    assert.match(locked, /disabled=""[^>]*>Next library page/);

    const failed = render({ ...state, error: "Current page unavailable" });
    assert.match(failed, /role="alert">Current page unavailable/);
    assert.match(failed, /Retained result/);
    assert.match(failed, /Load library first page/);
    assert.match(failed, /disabled=""[^>]*>Previous library page/);
    assert.match(failed, /disabled=""[^>]*>Next library page/);

    const failedEmpty = render({ error: "Current page unavailable" });
    assert.match(failedEmpty, /class="inbox-list library-results"><\/ul>/);
    assert.doesNotMatch(failedEmpty, /No matching memories/);
    assert.match(render({ error: "" }), /No matching memories/);
  });
});

test("Library tag selection keeps its own search, page context and disabled states", async () => {
  await withLibraryView(render => {
    const state = {
      view: "chooseTag",
      tagChoices: [TAG],
      tagQuery: "Applied tag query",
      cursors: [null, "results-page"],
      tagCursors: [null, "tag-page-two", "tag-page-three"],
      tagNextCursor: "tag-next",
      draftFilters: { ...initialLibrary().filters, q: "Unsaved filter draft" },
    };
    const chooser = render(state);
    assert.match(chooser, /value="Applied tag query"/);
    assert.match(chooser, /Page 3/);
    assert.match(chooser, /25 tagged memories/);
    assert.match(chooser, /Cancel tag filter selection/);
    assert.doesNotMatch(chooser, /Search private memories|Find a memory/);
    assert.doesNotMatch(chooser, /disabled=""[^>]*>Next library page/);

    const busy = render(state, { busy: true });
    assert.match(busy, /role="status">Loading tags…/);
    assert.doesNotMatch(busy, /Use this tag|No matching tags/);
    assert.match(busy, /disabled=""[^>]*>Cancel tag filter selection/);

    const locked = render(state, { locked: true });
    assert.match(locked, /Our &lt;tag&gt;/);
    assert.match(locked, /disabled=""[^>]*>Use this tag/);
    assert.match(locked, /disabled=""[^>]*>Search filter tags/);

    const failed = render({ ...state, error: "Tags unavailable" });
    assert.match(failed, /Our &lt;tag&gt;/);
    assert.match(failed, /Load library first page/);
    assert.match(failed, /disabled=""[^>]*>Next library page/);

    const empty = render({ ...state, tagChoices: [] });
    assert.match(empty, /No matching tags/);
    assert.match(empty, /Change this tag search or manage tags/);
  });
});

test("Library preserves applied field values, nullish attribution and original excerpts without preloads", async () => {
  await withLibraryView(render => {
    const text = "a".repeat(180) + "EXCERPT-END";
    const state = {
      filters: {
        q: "<literal_%>",
        memoryType: "PHOTO",
        reviewStatus: "KEEP",
        datePrecision: "YEAR",
        fromYear: 1,
        toYear: 9999,
        tagId: TAG.tagId,
      },
      tagName: "",
      items: [
        {
          ...MEMORY_DETAIL,
          title: "",
          guestName: "",
          textContent: text,
        },
        {
          ...MEDIA_DETAIL,
          title: null,
          source: "COUPLE",
          caption: "",
          media: {
            ...MEDIA_DETAIL.media,
            originalFilename: "not-the-caption.jpg",
          },
        },
        {
          ...MEMORY_DETAIL,
          title: null,
          guestName: null,
          memoryDate: null,
          datePrecision: "UNKNOWN",
        },
      ],
    };
    const markup = render(state);
    assert.match(markup, /id="library-query"[^>]*value="&lt;literal_%&gt;"/);
    assert.match(markup, /value="PHOTO" selected=""/);
    assert.match(markup, /value="KEEP" selected=""/);
    assert.match(markup, /value="YEAR" selected=""/);
    assert.match(markup, /id="library-from-year"[^>]*value="1"/);
    assert.match(markup, /id="library-to-year"[^>]*value="9999"/);
    assert.match(markup, /Tag filter: <strong><\/strong>/);
    assert.match(markup, /Clear tag filter/);
    assert.match(markup, /<h3><\/h3>/);
    assert.match(markup, /Guest contribution · From <\/p>/);
    assert.match(markup, /From Name not provided/);
    assert.match(markup, /Memory date: Date unknown/);
    assert.match(markup, /<p class="inbox-excerpt"><\/p>/);
    assert.match(markup, new RegExp("a".repeat(180) + "<"));
    assert.doesNotMatch(markup, /EXCERPT-END|not-the-caption.jpg/);
    assert.doesNotMatch(markup, /<img|<audio|<video|\/playback/);
    assert.match(render({ ...state, tagName: null }), /Tag filter: <strong>All tags<\/strong>/);
  });
});

test("Library local filter errors match the existing query and date constraints without masking server feedback", () => {
  const valid = {
    q: "  literal_%\\'😀  ",
    type: "ALL",
    status: "ALL",
    precision: "ALL",
    fromYear: "",
    toYear: "",
  };
  assert.deepEqual(getLibraryFilterErrors(valid), {});
  assert.deepEqual(
    getLibraryFilterErrors({ ...valid, fromYear: "1", toYear: "9999" }),
    {},
  );
  for (const query of ["", "   ", "😀".repeat(100)]) {
    assert.equal(getLibraryQueryError(query), null);
  }
  for (const query of [null, "x".repeat(201), "bad\0query", "\ud800"]) {
    const message = getLibraryQueryError(query);
    assert.equal(typeof message, "string");
    assert.equal(getLibraryFilterErrors({ ...valid, q: query }).q, message);
  }
  for (const fromYear of ["0", "10000", "12x", "-1"]) {
    assert.deepEqual(
      getLibraryFilterErrors({ ...valid, fromYear }),
      { fromYear: "Use a year between 1 and 9999." },
    );
  }
  assert.deepEqual(
    getLibraryFilterErrors({ ...valid, fromYear: "2025", toYear: "2024" }),
    {
      toYear: "The ending year must be the same as or later than the starting year.",
    },
  );
  assert.deepEqual(
    getLibraryFilterErrors({ ...valid, precision: "UNKNOWN", toYear: "2024" }),
    {
      datePrecision:
        "Unknown dates cannot have a year range. Clear the years or choose another precision.",
    },
  );
  assert.deepEqual(
    Object.keys(getLibraryFilterErrors({
      ...valid,
      q: "\0",
      type: "VIDEO",
      status: "DELETE",
    })),
    ["q", "memoryType", "reviewStatus"],
  );
  assert.equal(
    getLibraryFeedback("Old local validation", { error: "Current read failed" }),
    "Current read failed",
  );
  assert.equal(getLibraryFeedback("Local validation", { error: null }), "Local validation");
});

test("Library field views associate each local error with its own editable control and name read destinations", async () => {
  await withLibraryView(async (render, server) => {
    const { default: LibraryFilters } = await server.ssrLoadModule(
      "/src/features/library/components/LibraryFilters.jsx",
    );
    const { default: LibraryTagChooser } = await server.ssrLoadModule(
      "/src/features/library/components/LibraryTagChooser.jsx",
    );
    const view = {
      state: initialLibrary(),
      disabled: false,
      busy: false,
      actions,
      q: "bad query",
      type: "ALL",
      status: "ALL",
      precision: "ALL",
      fromYear: "0",
      toYear: "0",
      tagQuery: "bad tag query",
      setQ() {},
      setType() {},
      setStatus() {},
      setPrecision() {},
      setFromYear() {},
      setToYear() {},
      setTagQuery() {},
      registerField() {},
      handlers: {},
      fieldErrors: {
        q: "Fix search text",
        memoryType: "Fix memory type",
        reviewStatus: "Fix review status",
        datePrecision: "Fix date precision",
        fromYear: "Fix starting year",
        toYear: "Fix ending year",
        tagQuery: "Fix tag search",
      },
    };
    const filters = renderToStaticMarkup(createElement(LibraryFilters, { view }));
    for (const [id, message] of [
      ["library-query", "Fix search text"],
      ["library-type", "Fix memory type"],
      ["library-review", "Fix review status"],
      ["library-precision", "Fix date precision"],
      ["library-from-year", "Fix starting year"],
      ["library-to-year", "Fix ending year"],
    ]) {
      assert.match(
        filters,
        new RegExp(`id="${id}"[^>]*aria-invalid="true"[^>]*aria-describedby="${id}-error"`),
      );
      assert.match(
        filters,
        new RegExp(`id="${id}-error"[^>]*role="alert">${message}</p>`),
      );
    }
    const chooser = renderToStaticMarkup(createElement(LibraryTagChooser, { view }));
    assert.match(chooser, /aria-label="Search library filter tags"/);
    assert.match(
      chooser,
      /id="library-tag-query"[^>]*aria-invalid="true"[^>]*aria-describedby="library-tag-query-error"/,
    );
    assert.match(
      chooser,
      /id="library-tag-query-error"[^>]*role="alert">Fix tag search<\/p>/,
    );
    assert.match(
      render({ cursors: [null, "page-two"] }),
      /<h2 tabindex="-1" class="visually-hidden">Library memories · Page 2<\/h2>/,
    );
    assert.match(
      render({ view: "chooseTag", tagCursors: [null, "tag-page"], error: "Unavailable" }),
      /Library filter tags · Page 2 could not be loaded<\/h2>/,
    );
  });
});

async function withTagsView(check) {
  const server = await createServer({
    configFile: false,
    logLevel: "silent",
    root: fileURLToPath(new URL("../../../../", import.meta.url)),
    plugins: [react()],
    server: {
      middlewareMode: true,
      hmr: false,
      watch: null,
    },
    appType: "custom",
    optimizeDeps: {
      noDiscovery: true,
      include: [],
    },
  });

  try {
    const { default: Tags } = await server.ssrLoadModule(
      "/src/features/library/components/Tags.jsx",
    );
    const render = (patch = {}, props = {}) => renderToStaticMarkup(
      createElement(Tags, {
        state: { ...initialTags(), ...patch },
        busy: false,
        locked: false,
        actions,
        ...props,
      }),
    );
    await check(render, server);
  } finally {
    await server.close();
  }
}

test("Tags list preserves search, counts, page gates and cached error results", async () => {
  await withTagsView(render => {
    const state = {
      q: "<literal_%>",
      items: [TAG, { ...TAG, tagId: "other-tag", memberCount: 1 }],
      cursors: [null, "current-page"],
      nextCursor: "next-page",
    };
    const list = render(state);
    assert.match(list, /Tags · Page 2<\/h2>/);
    assert.match(list, /value="&lt;literal_%&gt;"/);
    assert.match(list, /25 memories · Couple only/);
    assert.match(list, /1 memory · Couple only/);
    assert.match(list, /aria-label="Open tag Our &lt;tag&gt;"/);
    assert.match(list, /Page 2/);
    assert.doesNotMatch(list, /disabled=""[^>]*>Next tag page/);

    const busy = render(state, { busy: true });
    assert.match(busy, /role="status">Loading tags…/);
    assert.doesNotMatch(busy, /Open tag|No tags yet/);
    assert.match(busy, /disabled=""[^>]*>Create a tag/);

    const locked = render(state, { locked: true });
    assert.match(locked, /Our &lt;tag&gt;/);
    assert.match(locked, /disabled=""[^>]*aria-label="Open tag/);
    assert.match(locked, /disabled=""[^>]*>Search tags/);

    const failed = render({ ...state, error: "Tags unavailable" });
    assert.match(failed, /role="alert">Tags unavailable/);
    assert.match(failed, /Our &lt;tag&gt;/);
    assert.match(failed, /Reload tag first page/);
    assert.match(failed, /disabled=""[^>]*>Previous tag page/);
    assert.match(failed, /disabled=""[^>]*>Next tag page/);
    assert.doesNotMatch(render({ error: "Tags unavailable" }), /No tags yet/);
  });
});

test("Tags detail retains members during loading and preserves tag-only deletion boundaries", async () => {
  await withTagsView(render => {
    const state = {
      view: "detail",
      tag: TAG,
      members: [{ memory: { ...MEMORY_DETAIL, title: "Retained member" } }],
    };
    const busy = render(state, { busy: true });
    assert.match(busy, /Retained member/);
    assert.doesNotMatch(busy, /Loading tag memories…|This tag is empty/);
    assert.match(busy, /disabled=""[^>]*>Save tag name/);
    assert.match(busy, /disabled=""[^>]*aria-label="Remove Retained member from tag"/);
    assert.match(render({ ...state, members: [] }, { busy: true }), /Loading tag memories…/);
    assert.match(render({ ...state, members: [] }), /This tag is empty/);
    assert.doesNotMatch(render({ ...state, members: [] }, { locked: true }), /This tag is empty/);
    assert.doesNotMatch(render({ ...state, members: [], error: "Read failed" }), /This tag is empty/);

    const deleted = render({
      ...state,
      tag: { ...TAG, deletedAt: TAG.updatedAt, name: null, memberCount: 0 },
    });
    assert.match(deleted, /Deleted tag/);
    assert.match(deleted, /memories and original files remain/);
    assert.doesNotMatch(deleted, /Save tag name|Add memories|Tagged memories|Next tag page/);
    assert.doesNotMatch(deleted, /Retained member/);

    const create = render({ view: "create" });
    assert.match(create, /aria-label="Create a private tag"/);
    assert.match(create, /id="tag-name"[^>]*maxLength="200"/);
    assert.doesNotMatch(create, /Previous tag page|Next tag page/);
  });
});

test("Tags selector keeps status filters, literal summaries and Eastern saved times without preloads", async () => {
  await withTagsView(render => {
    const note = {
      ...MEMORY_DETAIL,
      title: "<Private title>",
      textContent: "a".repeat(180) + "EXCERPT-END",
      memoryDate: "2024-03",
    };
    const photo = {
      ...MEDIA_DETAIL,
      source: "COUPLE",
      title: null,
      caption: "",
      memoryDate: null,
      media: { ...MEDIA_DETAIL.media, originalFilename: "not-the-caption.jpg" },
    };
    const state = {
      view: "select",
      tag: TAG,
      selectorStatus: "ARCHIVED",
      candidates: [note, photo],
    };
    const selector = render(state);
    assert.match(selector, /Available archived memories · Page 1<\/h2>/);
    assert.match(selector, /Add memories to Our &lt;tag&gt;/);
    assert.match(selector, /aria-pressed="true">Archived/);
    assert.match(selector, /aria-label="Add &lt;Private title&gt; to tag"/);
    assert.match(selector, /Memory date: 2024-03/);
    assert.match(selector, /Saved on: Oct 24, 2026, 2:30 PM EDT · Eastern/);
    assert.match(selector, /Couple memory/);
    assert.match(selector, /<p class="inbox-excerpt"><\/p>/);
    assert.match(selector, new RegExp("a".repeat(180) + "<"));
    assert.doesNotMatch(selector, /EXCERPT-END|not-the-caption.jpg/);
    assert.doesNotMatch(selector, /<img|<audio|<video|\/playback|Chicago|CDT|CST/);

    const busy = render(state, { busy: true });
    assert.match(busy, /Loading available memories…/);
    assert.doesNotMatch(busy, /Add to tag|No completed/);
    assert.match(busy, /disabled=""[^>]*>Back to tag/);
    assert.match(render({ ...state, candidates: [] }), /No completed archived memories on this page/);
    assert.doesNotMatch(render({ ...state, candidates: [], error: "Read failed" }), /No completed/);
    assert.match(render(state, { locked: true }), /disabled=""[^>]*aria-label="Add/);
  });
});

test("Tags recovery keeps deliberate retry gates and feedback precedence", async () => {
  await withTagsView(render => {
    for (const [phase, label] of [
      ["saving", "Saving tag change…"],
      ["loading", "Checking the current tag…"],
    ]) {
      const pending = render({ mutation: { phase } }, { locked: true });
      assert.match(pending, new RegExp(label));
      assert.doesNotMatch(pending, /Reload current tag|Retry this same tag change/);
    }

    for (const phase of ["uncertain", "conflict", "csrf"]) {
      const state = {
        mutation: { phase, canRetry: true, needsName: true, error: "Unknown outcome" },
      };
      const recovery = render(state, { locked: true });
      const reload = phase === "csrf" ? "Refresh session and current tag" : "Reload current tag";
      assert.match(recovery, new RegExp(reload));
      assert.match(recovery, /Original tag name/);
      assert.match(recovery, /Retry this same tag change/);
      assert.doesNotMatch(recovery, /disabled=""[^>]*>Retry this same tag change/);
      assert.match(render(state, { locked: true, busy: true }), /disabled=""[^>]*>Retry this same tag change/);
      assert.doesNotMatch(render({ mutation: { phase, canRetry: false } }, { locked: true }), /Original tag name|Retry this same tag change/);
    }

    const feedback = render({
      error: "Read failed",
      mutation: { phase: "uncertain", error: "Mutation failed" },
      notice: "Change saved",
    });
    assert.match(feedback, /role="alert">Read failed/);
    assert.doesNotMatch(feedback, /Mutation failed|Change saved/);
    assert.match(render({ notice: "Change saved" }), /role="status">Change saved/);
    assert.match(render({ error: "", notice: "Notice" }), /role="status"><\/p>/);
    assert.equal(
      getTagsFeedback("Old local validation", {
        ...initialTags(),
        error: "Current read failed",
        mutation: { phase: "uncertain", error: "Current mutation failed" },
      }).text,
      "Current read failed",
    );
    assert.equal(
      getTagsFeedback("Old local validation", {
        ...initialTags(),
        mutation: { phase: "uncertain", error: "Current mutation failed" },
      }).text,
      "Current mutation failed",
    );
  });
});

test("Tag field views associate independent name, query and recovery errors with the correct controls", async () => {
  await withTagsView(async (_render, server) => {
    const { default: TagNameForm } = await server.ssrLoadModule(
      "/src/features/library/components/TagNameForm.jsx",
    );
    const { default: TagList } = await server.ssrLoadModule(
      "/src/features/library/components/TagList.jsx",
    );
    const { TagMutationRecovery } = await server.ssrLoadModule(
      "/src/features/library/components/TagsRecovery.jsx",
    );
    const view = {
      state: {
        ...initialTags(),
        mutation: {
          phase: "uncertain",
          canRetry: true,
          needsName: true,
        },
      },
      actions,
      handlers: {},
      name: " ",
      q: "bad query",
      originalName: " ",
      setName() {},
      setQ() {},
      setOriginalName() {},
      disabled: false,
      busy: false,
      locked: true,
      fieldErrors: {
        name: "Fix tag name",
        query: "Fix tag query",
        retryName: "Re-enter original tag name",
      },
    };
    for (const [Component, props, id, message] of [
      [TagNameForm, { mode: "create" }, "tag-name", "Fix tag name"],
      [TagNameForm, { mode: "rename" }, "tag-name", "Fix tag name"],
      [TagList, {}, "tag-query", "Fix tag query"],
      [TagMutationRecovery, {}, "tag-original-name", "Re-enter original tag name"],
    ]) {
      const markup = renderToStaticMarkup(createElement(Component, { view, ...props }));
      assert.match(
        markup,
        new RegExp(`id="${id}"[^>]*aria-invalid="true"[^>]*aria-describedby="${id}-error"`),
      );
      assert.match(
        markup,
        new RegExp(`id="${id}-error"[^>]*role="alert">${message}</p>`),
      );
    }
    const recovery = renderToStaticMarkup(createElement(TagMutationRecovery, { view }));
    assert.doesNotMatch(
      recovery,
      /disabled=""[^>]*>Retry this same tag change/,
    );
    const busy = renderToStaticMarkup(createElement(TagMutationRecovery, {
      view: { ...view, busy: true },
    }));
    assert.match(busy, /disabled=""[^>]*>Retry this same tag change/);
  });
});
