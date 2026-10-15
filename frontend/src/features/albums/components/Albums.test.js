import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { initialAlbums } from "../api/albumActions.js";
import { MEMORY_DETAIL, MEDIA_DETAIL } from "../../../shared/api/v1/fixtures.js";

test("real album views provide empty/create/tombstone recovery and accessible paginated controls without original preloads", async () => {
  // Real React SSR through installed tooling: no DOM, physical browser,
  // assistive technology, original playback or provider acceptance claim.
  const server = await createServer({ configFile: false, logLevel: "silent", root: fileURLToPath(new URL("../../../../", import.meta.url)),
    plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  const actions = Object.fromEntries(["inbox", "list", "open", "beginCreate", "create", "rename", "delete", "add", "remove", "move", "select", "openMemory", "page", "reload", "retry"].map(name => [name, () => {}]));
  try {
    const { default: Albums } = await server.ssrLoadModule("/src/features/albums/components/Albums.jsx");
    const render = (state, extra = {}) => renderToStaticMarkup(createElement(Albums, { state, actions, busy: false, locked: state.mutation.phase !== "idle", ...extra }));
    const empty = render(initialAlbums()); assert.match(empty, /No albums yet/); assert.match(empty, /Create an album/);
    assert.match(empty, /class="archive-intro"/); assert.match(empty, /class="archive-empty" role="status"/);
    assert.match(empty, /<svg[^>]*aria-hidden="true"[^>]*focusable="false"/);
    const emptyPagination = empty.match(/<nav class="archive-pagination"[\s\S]*?<\/nav>/)?.[0] ?? "";
    assert.equal((emptyPagination.match(/disabled=""/g) ?? []).length, 2, "an empty first page cannot navigate beyond either boundary");
    const create = render({ ...initialAlbums(), view: "create" }); assert.match(create, /Create a private album/); assert.match(create, /maxLength="200"/);
    const album = { albumId: "11111111-1111-4111-8111-111111111111", name: "Wedding", revision: "22222222-2222-4222-8222-222222222222", memberCount: 51, deletedAt: null };
    const member = { ...MEDIA_DETAIL, source: "COUPLE", guestName: null, title: null };
    const page = render({ ...initialAlbums(), view: "detail", album, nextCursor: "opaque-next", cursors: [null, "opaque-current"], members: [
      { memory: member, canMoveEarlier: true, canMoveLater: true }, { memory: MEMORY_DETAIL, canMoveEarlier: true, canMoveLater: false }] });
    assert.match(page, /Move Couple memory earlier/); assert.match(page, /Remove Couple memory from album/); assert.match(page, /Page 2/);
    assert.match(page, /Next album page/); assert.match(page, /Guest contribution/); assert.match(page, /from every album/);
    const pagination = page.match(/<nav class="archive-pagination"[\s\S]*?<\/nav>/)?.[0] ?? "";
    assert.match(pagination, /Previous album page/); assert.doesNotMatch(pagination, /disabled=""/);
    assert.doesNotMatch(page, /<img|<audio|<video|https:\/\//);
    const deleted = render({ ...initialAlbums(), view: "detail", album: { ...album, name: null, deletedAt: "2026-10-09T12:00:00Z", memberCount: 0 } });
    assert.match(deleted, /Deleted album/); assert.match(deleted, /original files remain/); assert.doesNotMatch(deleted, /Save album name|Add memories|Confirm delete album/);
    const uncertain = render({ ...initialAlbums(), view: "create", mutation: { phase: "uncertain", canRetry: true, needsName: true, error: "Unconfirmed change" } });
    assert.match(uncertain, /Original album name/); assert.match(uncertain, /Retry this same album change/); assert.match(uncertain, /Reload current album/);
    assert.match(uncertain, /disabled=""[^>]*>All albums/);
    const busy = render(initialAlbums(), { busy: true });
    assert.match(busy, /disabled=""[^>]*>Create an album/); assert.match(busy, /Loading albums…/); assert.doesNotMatch(busy, /class="archive-empty"/);
    const failed = render({ ...initialAlbums(), error: "Temporary", nextCursor: "opaque-next", cursors: [null, "opaque-current"] });
    assert.equal((failed.match(/<nav class="archive-pagination"[\s\S]*?<\/nav>/)?.[0].match(/disabled=""/g) ?? []).length, 2,
      "page errors keep both pagination controls disabled");
  } finally { await server.close(); }
});
