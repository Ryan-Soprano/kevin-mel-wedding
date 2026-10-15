import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { initialAlbums } from "../api/albumActions.js";
import {
  MEMORY_DETAIL,
  MEDIA_DETAIL,
} from "../../../shared/api/v1/fixtures.js";
import { getAlbumFeedback } from "../albumDisplay.js";

function createViewServer() {
  return createServer({
    configFile: false,
    logLevel: "silent",
    root: fileURLToPath(new URL("../../../../", import.meta.url)),
    plugins: [react()],
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
}

test("real album views provide empty/create/tombstone recovery and accessible paginated controls without original preloads", async () => {
  // Real React SSR through installed tooling: no DOM, physical browser,
  // assistive technology, original playback or provider acceptance claim.
  const server = await createViewServer();
  const actions = Object.fromEntries(
    [
      "inbox",
      "list",
      "open",
      "beginCreate",
      "create",
      "rename",
      "delete",
      "add",
      "remove",
      "move",
      "select",
      "openMemory",
      "page",
      "reload",
      "retry",
    ].map((name) => [name, () => {}]),
  );
  try {
    const { default: Albums } = await server.ssrLoadModule(
      "/src/features/albums/components/Albums.jsx",
    );
    const render = (state, extra = {}) =>
      renderToStaticMarkup(
        createElement(Albums, {
          state,
          actions,
          busy: false,
          locked: state.mutation.phase !== "idle",
          ...extra,
        }),
      );
    const empty = render(initialAlbums());
    assert.match(empty, /No albums yet/);
    assert.match(empty, /Create an album/);
    assert.match(empty, /class="archive-intro"/);
    assert.match(empty, /class="archive-empty" role="status"/);
    assert.match(empty, /<svg[^>]*aria-hidden="true"[^>]*focusable="false"/);
    const emptyPagination =
      empty.match(/<nav class="archive-pagination"[\s\S]*?<\/nav>/)?.[0] ?? "";
    assert.equal(
      (emptyPagination.match(/disabled=""/g) ?? []).length,
      2,
      "an empty first page cannot navigate beyond either boundary",
    );
    const create = render({ ...initialAlbums(), view: "create" });
    assert.match(create, /Create a private album/);
    assert.match(create, /maxLength="200"/);
    const album = {
      albumId: "11111111-1111-4111-8111-111111111111",
      name: "Wedding",
      revision: "22222222-2222-4222-8222-222222222222",
      memberCount: 51,
      deletedAt: null,
    };
    const member = {
      ...MEDIA_DETAIL,
      source: "COUPLE",
      guestName: null,
      title: null,
    };
    const page = render({
      ...initialAlbums(),
      view: "detail",
      album,
      nextCursor: "opaque-next",
      cursors: [null, "opaque-current"],
      members: [
        { memory: member, canMoveEarlier: true, canMoveLater: true },
        { memory: MEMORY_DETAIL, canMoveEarlier: true, canMoveLater: false },
      ],
    });
    assert.match(page, /Move Couple memory earlier/);
    assert.match(page, /Remove Couple memory from album/);
    assert.match(page, /Page 2/);
    assert.match(page, /Next album page/);
    assert.match(page, /Guest contribution/);
    assert.match(page, /from every album/);
    const pagination =
      page.match(/<nav class="archive-pagination"[\s\S]*?<\/nav>/)?.[0] ?? "";
    assert.match(pagination, /Previous album page/);
    assert.doesNotMatch(pagination, /disabled=""/);
    assert.doesNotMatch(page, /<img|<audio|<video|https:\/\//);
    const deleted = render({
      ...initialAlbums(),
      view: "detail",
      album: {
        ...album,
        name: null,
        deletedAt: "2026-10-09T12:00:00Z",
        memberCount: 0,
      },
    });
    assert.match(deleted, /Deleted album/);
    assert.match(deleted, /original files remain/);
    assert.doesNotMatch(
      deleted,
      /Save album name|Add memories|Confirm delete album/,
    );
    const uncertain = render({
      ...initialAlbums(),
      view: "create",
      mutation: {
        phase: "uncertain",
        canRetry: true,
        needsName: true,
        error: "Unconfirmed change",
      },
    });
    assert.match(uncertain, /Original album name/);
    assert.match(uncertain, /Retry this same album change/);
    assert.match(uncertain, /Reload current album/);
    assert.match(uncertain, /disabled=""[^>]*>All albums/);
    const busy = render(initialAlbums(), { busy: true });
    assert.match(busy, /disabled=""[^>]*>Create an album/);
    assert.match(busy, /<output>Loading albums…<\/output>/);
    assert.doesNotMatch(busy, /class="archive-empty"/);
    const failed = render({
      ...initialAlbums(),
      error: "Temporary",
      nextCursor: "opaque-next",
      cursors: [null, "opaque-current"],
    });
    assert.equal(
      (
        failed
          .match(/<nav class="archive-pagination"[\s\S]*?<\/nav>/)?.[0]
          .match(/disabled=""/g) ?? []
      ).length,
      2,
      "page errors keep both pagination controls disabled",
    );
  } finally {
    await server.close();
  }
});

test("extracted album views preserve cached-member loading, separate recovery names, nullish summaries and confirmation locks", async () => {
  // Actual React markup covers presentation contracts. Mounted checks separately
  // verify callback arguments, focus and initial-only drafts across rerenders.
  const server = await createViewServer();
  const noop = () => {};
  const actions = Object.fromEntries(
    [
      "inbox",
      "list",
      "open",
      "beginCreate",
      "create",
      "rename",
      "delete",
      "add",
      "remove",
      "move",
      "select",
      "openMemory",
      "page",
      "reload",
      "retry",
    ].map((name) => [name, noop]),
  );
  const album = {
    albumId: "11111111-1111-4111-8111-111111111111",
    name: "Private <album>",
    revision: "22222222-2222-4222-8222-222222222222",
    memberCount: 1,
    deletedAt: null,
  };
  const memory = { ...MEMORY_DETAIL, title: "Retained <member>" };
  try {
    const { default: Albums } = await server.ssrLoadModule(
      "/src/features/albums/components/Albums.jsx",
    );
    const { default: AlbumDetail } = await server.ssrLoadModule(
      "/src/features/albums/components/AlbumDetail.jsx",
    );
    const { default: AlbumRecovery } = await server.ssrLoadModule(
      "/src/features/albums/components/AlbumRecovery.jsx",
    );
    const { default: AlbumMemorySummary } = await server.ssrLoadModule(
      "/src/features/albums/components/AlbumMemorySummary.jsx",
    );
    const renderComponent = (Component, props) =>
      renderToStaticMarkup(createElement(Component, props));
    const render = (state, extra = {}) =>
      renderComponent(Albums, {
        state: { ...initialAlbums(), ...state },
        busy: false,
        locked: false,
        actions,
        ...extra,
      });

    const staleList = render({
      items: [album],
      error: "Page unavailable",
      nextCursor: "next",
      cursors: [null, "previous"],
    });
    assert.match(staleList, /Private &lt;album&gt;/);
    assert.match(staleList, /1 memory · Couple only/);
    assert.match(staleList, /Reload album first page/);
    assert.doesNotMatch(staleList, /No albums yet/);
    assert.equal(
      (
        staleList
          .match(/<nav class="archive-pagination"[\s\S]*?<\/nav>/)?.[0]
          .match(/disabled=""/g) ?? []
      ).length,
      2,
    );
    const busyList = render({ items: [album] }, { busy: true });
    assert.match(busyList, /<output>Loading albums…<\/output>/);
    assert.doesNotMatch(busyList, /Private &lt;album&gt;/);
    const failedList = render({ error: "Page unavailable" });
    assert.match(failedList, /<ul class="inbox-list album-list"><\/ul>/);
    assert.doesNotMatch(failedList, /No albums yet/);

    const memberState = {
      view: "detail",
      album,
      members: [{ memory, canMoveEarlier: false, canMoveLater: true }],
    };
    const busyMembers = render(memberState, { busy: true });
    assert.match(busyMembers, /Retained &lt;member&gt;/);
    assert.doesNotMatch(
      busyMembers,
      /Loading album memories…|This album is empty/,
    );
    assert.match(busyMembers, /disabled=""[^>]*>Open memory/);
    assert.match(busyMembers, /disabled=""[^>]*>Remove from album/);
    const controls = render(memberState);
    assert.match(controls, /disabled=""[^>]*>Move earlier/);
    assert.doesNotMatch(controls, /disabled=""[^>]*>Move later/);
    const busyEmptyMembers = render({ view: "detail", album }, { busy: true });
    assert.match(
      busyEmptyMembers,
      /<output>Loading album memories…<\/output>/,
    );
    assert.doesNotMatch(busyEmptyMembers, /This album is empty/);
    const lockedEmptyMembers = render(
      { view: "detail", album },
      { locked: true },
    );
    assert.match(
      lockedEmptyMembers,
      /<ol class="inbox-list album-members"><\/ol>/,
    );
    assert.doesNotMatch(lockedEmptyMembers, /This album is empty/);
    assert.match(
      render({ ...memberState, error: "Page unavailable" }),
      /Retained &lt;member&gt;/,
    );

    const selector = {
      view: "select",
      album,
      candidates: [memory],
      error: "Page unavailable",
      selectorStatus: "PENDING",
    };
    assert.match(render(selector), /Retained &lt;member&gt;/);
    assert.match(render(selector), /aria-pressed="true">Pending/);
    const busySelector = render(selector, { busy: true });
    assert.match(
      busySelector,
      /<output>Loading available memories…<\/output>/,
    );
    assert.doesNotMatch(busySelector, /Retained &lt;member&gt;/);
    const failedSelector = render({ ...selector, candidates: [] });
    assert.match(
      failedSelector,
      /<ul class="inbox-list album-candidates"><\/ul>/,
    );
    assert.doesNotMatch(failedSelector, /No memories on this page/);

    const recoveryView = {
      state: {
        ...initialAlbums(),
        album,
        mutation: {
          phase: "csrf",
          error: "Refresh needed",
          canRetry: true,
          needsName: true,
        },
      },
      busy: false,
      locked: true,
      actions,
      originalName: "",
      setOriginalName: noop,
      handlers: { retry: noop },
    };
    const recovery = renderComponent(AlbumRecovery, { view: recoveryView });
    assert.match(recovery, /Refresh session and current album/);
    assert.match(recovery, /<input id="album-original-name"[^>]*value=""/);
    assert.match(recovery, /Retry this same album change/);
    assert.doesNotMatch(recovery, /disabled=""|Private &lt;album&gt;/);
    const busyRecovery = renderComponent(AlbumRecovery, {
      view: { ...recoveryView, busy: true },
    });
    assert.match(busyRecovery, /disabled="">Refresh session and current album/);
    assert.match(
      busyRecovery,
      /<input id="album-original-name"[^>]*disabled=""/,
    );
    const noName = renderComponent(AlbumRecovery, {
      view: {
        ...recoveryView,
        state: {
          ...recoveryView.state,
          mutation: { ...recoveryView.state.mutation, needsName: false },
        },
      },
    });
    assert.match(noName, /Retry this same album change/);
    assert.doesNotMatch(noName, /album-original-name/);
    const noRetry = renderComponent(AlbumRecovery, {
      view: {
        ...recoveryView,
        state: {
          ...recoveryView.state,
          mutation: { ...recoveryView.state.mutation, canRetry: false },
        },
      },
    });
    assert.doesNotMatch(
      noRetry,
      /album-original-name|Retry this same album change/,
    );
    const saving = renderComponent(AlbumRecovery, {
      view: {
        ...recoveryView,
        state: {
          ...recoveryView.state,
          mutation: { ...recoveryView.state.mutation, phase: "saving" },
        },
      },
    });
    assert.match(saving, /<output>Saving album change…<\/output>/);
    assert.doesNotMatch(saving, /album-original-name|Reload current album/);
    const checking = renderComponent(AlbumRecovery, {
      view: {
        ...recoveryView,
        state: {
          ...recoveryView.state,
          mutation: { ...recoveryView.state.mutation, phase: "loading" },
        },
      },
    });
    assert.match(
      checking,
      /<output>Checking the current album…<\/output>/,
    );

    const confirmationView = {
      state: { ...initialAlbums(), ...memberState },
      busy: false,
      locked: false,
      disabled: true,
      actions,
      name: album.name,
      setName: noop,
      confirmDelete: true,
      handlers: {
        submitName: noop,
        beginDelete: noop,
        cancelDeletion: noop,
        confirmDeletion: noop,
      },
    };
    const confirmation = renderComponent(AlbumDetail, {
      view: confirmationView,
    });
    assert.match(
      confirmation,
      /<fieldset class="inbox-delete-confirmation" aria-describedby="album-delete-copy">/,
    );
    assert.match(
      confirmation,
      /<legend id="album-delete-title">Delete this album\?<\/legend>/,
    );
    assert.match(
      confirmation,
      /<p id="album-delete-copy">Only this album and its membership will be removed\./,
    );
    assert.match(
      confirmation,
      /Every memory and original file stays in your archive/,
    );
    assert.doesNotMatch(
      confirmation,
      /disabled="">Cancel album deletion|disabled="">Confirm delete album/,
      "confirmation uses the busy flag separately from the ordinary disabled controls",
    );
    const busyConfirmation = renderComponent(AlbumDetail, {
      view: { ...confirmationView, busy: true },
    });
    assert.match(busyConfirmation, /disabled="">Cancel album deletion/);
    assert.match(busyConfirmation, /disabled="">Confirm delete album/);
    const hiddenConfirmation = renderComponent(AlbumDetail, {
      view: { ...confirmationView, locked: true },
    });
    assert.doesNotMatch(
      hiddenConfirmation,
      /Delete this album\?|Cancel album deletion|Confirm delete album/,
    );

    const emptyPhoto = renderComponent(AlbumMemorySummary, {
      memory: {
        ...MEDIA_DETAIL,
        source: "COUPLE",
        title: "",
        caption: "",
        memoryDate: "2024-03",
        datePrecision: "MONTH",
      },
    });
    assert.match(emptyPhoto, /<h3><\/h3>/);
    assert.match(emptyPhoto, /class="inbox-excerpt"><\/p>/);
    assert.match(emptyPhoto, /Memory date: 2024-03/);
    assert.doesNotMatch(
      emptyPhoto,
      /Guest contribution|wedding.jpg|Saved on:|Eastern|2024-03-01|<img|<audio|<video/,
    );
    const filename = renderComponent(AlbumMemorySummary, {
      memory: {
        ...MEDIA_DETAIL,
        title: null,
        caption: null,
        guestName: "Guest <name>",
      },
    });
    assert.match(filename, /<h3>From Guest &lt;name&gt;<\/h3>/);
    assert.match(filename, /wedding.jpg/);
    assert.match(filename, /Guest contribution · From Guest &lt;name&gt;/);
    const text = renderComponent(AlbumMemorySummary, {
      memory: {
        ...MEMORY_DETAIL,
        title: null,
        guestName: null,
        memoryDate: "2024",
        datePrecision: "YEAR",
        textContent: "a".repeat(180) + "private tail",
      },
    });
    assert.match(text, /From Name not provided/);
    assert.match(text, /Memory date: 2024<\/p>/);
    assert.match(text, new RegExp(`class="inbox-excerpt">${"a".repeat(180)}<`));
    assert.doesNotMatch(text, /private tail/);

    assert.deepEqual(
      getAlbumFeedback({
        ...initialAlbums(),
        error: "",
        mutation: { error: "Later mutation error" },
      }),
      { visible: true, className: "form-error", role: "alert", text: "" },
      "truthy feedback visibility and nullish text precedence remain distinct",
    );
    const emptyFirstError = render({
      error: "",
      mutation: { ...initialAlbums().mutation, error: "Later mutation error" },
    });
    assert.match(emptyFirstError, /class="form-error" role="alert"><\/p>/);
    assert.doesNotMatch(emptyFirstError, /Later mutation error/);
    assert.match(
      render({ notice: "Current <notice>" }),
      /class="inbox-review-notice" role="status">Current &lt;notice&gt;/,
    );
  } finally {
    await server.close();
  }
});
