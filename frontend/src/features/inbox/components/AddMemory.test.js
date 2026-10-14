import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { audioCollectionEnabled } from "../../audio/audioConstraints.js";
import { initialTags } from "../../library/api/tagActions.js";
import { MEMORY_DETAIL, MEDIA_DETAIL } from "../../../shared/api/v1/fixtures.js";

function createViewServer() {
  return createServer({ configFile: false, logLevel: "silent", root: fileURLToPath(new URL("../../../../", import.meta.url)),
    plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] } });
}

test("private creator view hides voice collection behind the exact existing audio build gate", async () => {
  // SSR renders real React markup through installed Vite tooling. No DOM,
  // browser, microphone permission or codec acceptance is claimed here.
  const server = await createViewServer();
  try {
    const { default: AddMemory } = await server.ssrLoadModule("/src/features/inbox/components/AddMemory.jsx");
    const props = { getApi: () => ({}), onDone: () => {}, onBack: () => {} };
    for (const value of [undefined, "false", "TRUE", true]) {
      const markup = renderToStaticMarkup(createElement(AddMemory, { ...props, audioEnabled: audioCollectionEnabled(value) }));
      assert.match(markup, /Write a note/); assert.match(markup, /Add photos/);
      assert.doesNotMatch(markup, /Add a voice memory/);
    }
    const enabled = renderToStaticMarkup(createElement(AddMemory, { ...props, audioEnabled: audioCollectionEnabled("true") }));
    assert.match(enabled, /Add a voice memory/);
  } finally { await server.close(); }
});

test("extracted private inbox views preserve loading precedence, memory attribution, media locks and explicit review recovery", async () => {
  // Real React markup checks presentation contracts. Focus, lifecycle events and
  // controller ownership still require the separate interactive browser check.
  const server = await createViewServer();
  try {
    const { default: Inbox } = await server.ssrLoadModule("/src/features/inbox/components/Inbox.jsx");
    const { InboxLogin, InboxAccessRecovery } = await server.ssrLoadModule("/src/features/inbox/components/InboxAccess.jsx");
    const { default: InboxList } = await server.ssrLoadModule("/src/features/inbox/components/InboxList.jsx");
    const { default: MemoryDetail } = await server.ssrLoadModule("/src/features/inbox/components/MemoryDetail.jsx");
    const render = (Component, props) => renderToStaticMarkup(createElement(Component, props));
    const noop = () => {};
    const actions = {
      navigation: { create: noop, export: noop, openMemory: noop, reloadInbox: noop, back: noop },
      albums: { list: noop }, timeline: { list: noop }, library: { list: noop }, tags: { list: noop },
      metadata: { save: noop, reload: noop, retry: noop }, media: { retry: noop },
      memoryTags: { attached: noop, choose: noop, change: noop, page: noop, reload: noop, retry: noop },
      review: { reload: noop, retry: noop, refresh: noop },
    };
    const reviewControls = { confirmingDelete: false, change: noop, beginDelete: noop, cancel: noop };
    const state = {
      busy: false, error: null, items: [MEMORY_DETAIL], reviewStatus: "PENDING", nextCursor: null,
      detail: MEMORY_DETAIL, photo: { phase: "idle", url: null, error: null },
      metadata: { phase: "idle", error: null, canRetry: false },
      review: { phase: "idle", targetStatus: null, error: null, canRetry: false }, tags: initialTags(), notice: null,
    };
    let factoryCalls = 0;
    const checking = render(Inbox, { createController: () => { factoryCalls++; } });
    assert.match(checking, /Checking archive access/);
    assert.doesNotMatch(checking, /Signed in as|Open memory|Sign out/);
    assert.equal(factoryCalls, 0, "server rendering does not construct a private controller");

    const login = render(InboxLogin, { busy: true, username: "", password: "", setUsername: noop, setPassword: noop, onSubmit: noop });
    assert.match(login, /autoComplete="username"/);
    assert.match(login, /autoComplete="current-password"/);
    assert.match(login, /disabled="">Signing in…/);
    const access = render(InboxAccessRecovery, { busy: false, logoutUnconfirmed: true, onRetry: noop, onLogout: noop });
    assert.match(access, /Retry signing out/);
    assert.doesNotMatch(access, /Check access again|Sign out of any active session/);

    const listProps = { state, pages: [null], actions, onFilter: noop, onNext: noop, onPrevious: noop };
    const guest = { ...MEMORY_DETAIL, guestName: "A <guest>", textContent: "x".repeat(200) };
    const list = render(InboxList, { ...listProps, state: { ...state, items: [guest] } });
    assert.match(list, /1 memory on this page · times shown in Eastern time/);
    assert.match(list, /<h2>A &lt;guest&gt;<\/h2>/);
    assert.match(list, /aria-label="Open note from A &lt;guest&gt;"/);
    assert.match(list, new RegExp(`class="inbox-excerpt">${"x".repeat(180)}<`));
    assert.doesNotMatch(list, /x{181}/);
    const loading = render(InboxList, { ...listProps, state: { ...state, busy: true, error: "Temporary", items: [guest] } });
    assert.match(loading, /Loading your memories/);
    assert.doesNotMatch(loading, /Try again|Open memory|A &lt;guest&gt;/);
    const failedPage = render(InboxList, { ...listProps, pages: [null, "cursor"], state: { ...state, error: "Temporary" } });
    assert.match(failedPage, /Try again/);
    assert.match(failedPage, /Page 2 could not be loaded/);
    assert.doesNotMatch(failedPage, /Open memory/);
    const empty = render(InboxList, { ...listProps, state: { ...state, items: [] } });
    assert.match(empty, /No pending memories right now/);
    const couple = render(InboxList, { ...listProps, state: { ...state, items: [{ ...MEDIA_DETAIL, source: "COUPLE", title: "Our <photo>" }] } });
    assert.match(couple, /Our &lt;photo&gt;/);
    assert.match(couple, /aria-label="Open Our &lt;photo&gt;"/);
    assert.match(couple, /Couple memory/);
    assert.doesNotMatch(couple, /Guest contribution/);

    const detailProps = { state, locked: false, actions, reviewControls };
    const detail = render(MemoryDetail, { ...detailProps, state: { ...state, libraryReturn: true, detail: { ...MEMORY_DETAIL, memoryDate: "2024-06", datePrecision: "MONTH" } } });
    assert.match(detail, /Back to library/);
    assert.match(detail, /Memory date: 2024-06 \(month precision\)/);
    assert.match(detail, /Eastern time/);
    assert.match(detail, /From Name not provided/);
    assert.match(detail, />Keep Private</);
    assert.match(detail, />Share with Friends &amp; Family</);
    assert.match(detail, />Share with Public</);
    assert.match(detail, />Delete</);
    const photoState = { ...state, detail: MEDIA_DETAIL, photo: { phase: "ready", url: "blob:verified-original", error: null } };
    const photo = render(MemoryDetail, { ...detailProps, state: photoState });
    assert.match(photo, /<img[^>]*src="blob:verified-original"[^>]*alt="A happy moment"/);
    assert.match(photo, /href="blob:verified-original" download="wedding.jpg"/);
    const locked = render(MemoryDetail, { ...detailProps, state: { ...photoState, review: { ...state.review, phase: "uncertain", error: "Unconfirmed", canRetry: true } }, locked: true });
    assert.match(locked, /disabled="">Back to inbox/);
    assert.match(locked, /Reload current state/);
    assert.match(locked, /Retry this same change/);
    assert.doesNotMatch(locked, /blob:verified-original|>Keep Private<|>Share with Public<|>Delete</);
    const noRetry = render(MemoryDetail, { ...detailProps, state: { ...state, review: { ...state.review, phase: "uncertain" } }, locked: true });
    assert.match(noRetry, /Reload current state/);
    assert.doesNotMatch(noRetry, /Retry this same change/);
    const csrf = render(MemoryDetail, { ...detailProps, state: { ...state, review: { ...state.review, phase: "csrf" } }, locked: true });
    assert.match(csrf, /Refresh session and current memory/);
    assert.doesNotMatch(csrf, /Retry this same change/);
    const confirming = render(MemoryDetail, { ...detailProps, reviewControls: { ...reviewControls, confirmingDelete: true } });
    assert.match(confirming, /<fieldset[^>]*aria-describedby="inbox-delete-copy"/);
    assert.match(confirming, /<legend id="inbox-delete-title">Delete this memory\?<\/legend>/);
    assert.match(confirming, />Cancel</);
    assert.match(confirming, />Confirm delete</);
    assert.doesNotMatch(confirming, />Delete</);
    const deleted = render(MemoryDetail, { ...detailProps, state: { ...photoState, detail: { ...MEDIA_DETAIL, reviewStatus: "DELETE", deleteAfter: "2026-11-08T12:00:00Z" } } });
    assert.match(deleted, /30-day recovery window ends/);
    assert.match(deleted, /Restore to inbox/);
    assert.doesNotMatch(deleted, /blob:verified-original|Editable memory details|Tags attached to this memory|>Delete</);

    const audio = { ...MEDIA_DETAIL, memoryType: "AUDIO", source: "COUPLE", caption: null, media: { ...MEDIA_DETAIL.media, originalFilename: "voice.webm", durationSeconds: 12.2 } };
    const voice = render(MemoryDetail, { ...detailProps, state: { ...photoState, detail: audio } });
    assert.match(voice, /13 seconds · Original audio/);
    assert.match(voice, /<audio[^>]*aria-label="Couple voice memory"/);
    assert.match(voice, /<track kind="captions" src="data:text\/vtt,WEBVTT"/);
    assert.match(voice, /download="voice.webm"/);
    assert.doesNotMatch(voice, /<img/);
  } finally { await server.close(); }
});
