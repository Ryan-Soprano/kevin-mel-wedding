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
    const locked = render(MemoryTags, {
      ...initialTags(),
      mutation: {
        phase: "uncertain",
        canRetry: true,
        needsName: true,
        error: "Unknown outcome"
      }
    }, true);
    assert.match(locked, /Original tag name/);
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
    await check(render);
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
