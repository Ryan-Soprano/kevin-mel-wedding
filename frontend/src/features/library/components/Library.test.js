import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { initialLibrary } from "../api/libraryActions.js";
import { initialTags } from "../api/tagActions.js";
import { MEMORY_DETAIL, MEDIA_DETAIL } from "../../../shared/api/v1/fixtures.js";

const TAG = { tagId: "55555555-5555-4555-8555-555555555555", name: "Our <tag>", memberCount: 25, revision: "66666666-6666-4666-8666-666666666666", createdAt: "2026-10-10T12:00:00Z", updatedAt: "2026-10-10T12:00:00Z", deletedAt: null };
const actions = Object.fromEntries(["inbox", "list", "open", "beginCreate", "create", "rename", "delete", "select", "add", "remove", "openMemory", "page", "reload", "retry", "tags", "choose", "selectTag", "attached", "change"].map(key => [key, () => {}]));
test("actual Library/Tags views expose literal filters, partial dates, bounded pages, private attribution and recovery without original preloads", async () => {
  // Actual React SSR verifies UI contracts and escaping. Root's packaged Chrome
  // fixture separately checks responsive layout, focus and authenticated flows.
  const server = await createServer({ configFile: false, logLevel: "silent", root: fileURLToPath(new URL("../../../../", import.meta.url)), plugins: [react()],
    server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { default: Library } = await server.ssrLoadModule("/src/features/library/components/Library.jsx");
    const { default: Tags } = await server.ssrLoadModule("/src/features/library/components/Tags.jsx");
    const { default: MemoryTags } = await server.ssrLoadModule("/src/features/library/components/MemoryTags.jsx");
    const render = (Component, state, locked = false) => renderToStaticMarkup(createElement(Component, { state, busy: false, locked, actions }));
    const empty = render(Library, initialLibrary()); assert.match(empty, /No matching memories/); assert.match(empty, /Reset library search/); assert.match(empty, /Literal words or characters/);
    for (const label of ["Search text", "Memory type", "Review status", "Memory date precision", "Memory date from year (inclusive)", "Memory date to year (inclusive)"]) assert.equal(empty.includes(label), true);
    const memory = { ...MEMORY_DETAIL, title: "<Private title>", guestName: "Synthetic Guest", memoryDate: "2024-03", datePrecision: "MONTH" };
    const results = render(Library, { ...initialLibrary(), items: [memory, { ...MEDIA_DETAIL, source: "COUPLE", guestName: null, title: null }], nextCursor: "opaque-next", cursors: [null, "opaque-current"] });
    assert.match(results, /&lt;Private title&gt;/); assert.match(results, /Guest contribution · From Synthetic Guest/); assert.match(results, /Couple memory/); assert.match(results, /Memory date: March 2024/); assert.doesNotMatch(results, /March 1, 2024/);
    assert.match(results, /Saved on:/); assert.match(results, /Page 2/); assert.match(results, /Next library page/); assert.doesNotMatch(results, /<img|<audio|<video|\/playback/);
    const chooser = render(Library, { ...initialLibrary(), view: "chooseTag", tagChoices: [TAG], draftFilters: initialLibrary().filters }); assert.match(chooser, /Choose one tag/); assert.match(chooser, /Use this tag/); assert.match(chooser, /applies the other fields/); assert.match(chooser, /Our &lt;tag&gt;/);
    const failure = render(Library, { ...initialLibrary(), filters: { ...initialLibrary().filters, q: "Applied search" }, error: "These live results changed." }); assert.match(failure, /value="Applied search"/); assert.match(failure, /Load library first page/);
    const tagEmpty = render(Tags, initialTags()); assert.match(tagEmpty, /Create a tag/); assert.match(tagEmpty, /Tag names may repeat/); assert.match(tagEmpty, /Search tag names/);
    const tagDetail = render(Tags, { ...initialTags(), view: "detail", tag: TAG, members: [{ memory }], nextCursor: "opaque-next", cursors: [null, "opaque-current"] }); assert.match(tagDetail, /Save tag name/); assert.match(tagDetail, /Remove from tag/); assert.match(tagDetail, /Next tag page/); assert.match(tagDetail, /Guest contribution/); assert.doesNotMatch(tagDetail, /<img|<audio|<video/);
    const tombstone = render(Tags, { ...initialTags(), view: "detail", tag: { ...TAG, name: null, memberCount: 0, deletedAt: TAG.updatedAt } }); assert.match(tombstone, /Deleted tag/); assert.match(tombstone, /original files remain/); assert.doesNotMatch(tombstone, /Save tag name|Add memories/);
    const attached = render(MemoryTags, { ...initialTags(), view: "memory", memoryId: memory.memoryId, items: [TAG], nextCursor: "opaque-next" }); assert.match(attached, /Memory tags/); assert.match(attached, /Remove tag/); assert.match(attached, /Next memory tags page/); assert.match(attached, /original content, files, memory date or saved time/);
    const picker = render(MemoryTags, { ...initialTags(), view: "attach", memoryId: memory.memoryId, items: [TAG] }); assert.match(picker, /Search available tags/); assert.match(picker, /Attach tag/); assert.match(picker, /Back to attached tags/);
    const locked = render(MemoryTags, { ...initialTags(), mutation: { phase: "uncertain", canRetry: true, needsName: true, error: "Unknown outcome" } }, true); assert.match(locked, /Original tag name/); assert.match(locked, /Reload current tag/); assert.match(locked, /Retry this same tag change/); assert.match(locked, /disabled=""[^>]*>Add tags/);
  } finally { await server.close(); }
});
