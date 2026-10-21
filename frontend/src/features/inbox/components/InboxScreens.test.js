import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { pid } from "node:process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { initialAlbums } from "../../albums/api/albumActions.js";
import { initialTimeline } from "../../timeline/api/timelineActions.js";
import { initialLibrary } from "../../library/api/libraryActions.js";
import { initialTags } from "../../library/api/tagActions.js";
import { initialExport } from "../../export/api/exportActions.js";

test("screen adapters preserve access precedence, creation guards and editor reset boundaries", async () => {
  const server = await createServer({ configFile: false, logLevel: "silent", cacheDir: `node_modules/.vite/inbox-screens-test-${pid}`, root: fileURLToPath(new URL("../../../../", import.meta.url)),
    plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { default: InboxScreen } = await server.ssrLoadModule("/src/features/inbox/components/InboxScreens.jsx");
    const noop = () => {};
    const actions = Object.fromEntries(["albums", "timeline", "library", "tags", "export", "creation"].map(name => [name, { action: noop }]));
    const base = { phase: "inbox", session: { authenticated: true }, busy: false,
      albums: initialAlbums(), timeline: initialTimeline(), library: initialLibrary(), tags: initialTags(), export: initialExport() };
    const view = { snapshot: base, actions, reviewLocked: true, setDialogState: noop, setCreationState: noop,
      pages: [null], filter: noop, nextPage: noop, previousPage: noop, retryAccess: noop, logout: noop,
      loginForm: { username: "", password: "", setUsername: noop, setPassword: noop, onSubmit: noop }, reviewControls: {} };
    const render = snapshot => renderToStaticMarkup(createElement(InboxScreen, { view: { ...view, snapshot } }));
    for (const phase of ["inbox", "detail", "create", "albums", "timeline", "library", "tags", "export"]) {
      assert.equal(render({ phase, session: null }), "", `${phase} cannot render without current access`);
      assert.equal(render({ phase, session: { authenticated: false } }), "");
    }
    for (const session of [null, { authenticated: true }]) {
      const checking = render({ phase: "checking", session, detail: { title: "Private sentinel" } });
      assert.match(checking, /Checking archive access/); assert.doesNotMatch(checking, /Private sentinel/);
      assert.match(render({ phase: "login", session, busy: false }), /Username/);
      assert.match(render({ phase: "unavailable", session, busy: false, logoutUnconfirmed: true }), /Retry signing out/);
    }
    assert.equal(render({ phase: "unknown", session: { authenticated: true } }), "");

    // Resolve only the pure adapter, leaving the feature component's hooks and
    // local state intact. Features transfer reset keys into their editors so
    // their unkeyed boundaries can retain deliberate request focus.
    const leaf = (snapshot, extra = {}) => {
      const route = InboxScreen({ view: { ...view, snapshot }, ...extra });
      return route.type(route.props);
    };
    const keys = {
      albums: { ...base.albums, view: "detail", album: { albumId: "album-one", revision: "r1" } },
      timeline: { ...base.timeline, view: "detail", event: { eventId: "event-one", revision: "r1" } },
      library: base.library,
      tags: { ...base.tags, view: "detail", tag: { tagId: "tag-one", revision: "r1" } },
    };
    const editorKeyOf = screen => screen.props.editorKey ?? screen.key;
    for (const [phase, state] of Object.entries(keys)) {
      const snapshot = { ...base, phase, [phase]: state, busy: true };
      const screen = leaf(snapshot);
      assert.equal(screen.props.state, state); assert.equal(screen.props.actions, actions[phase]);
      assert.equal(screen.props.busy, true); assert.equal(screen.props.locked, true);
      const pagedScreen = leaf({
        ...snapshot,
        [phase]: {
          ...state,
          cursors: [null, "next"],
          error: "Reload failed",
        },
      });
      assert.equal(
        editorKeyOf(pagedScreen),
        editorKeyOf(screen),
        `${phase} pagination and feedback preserve the current editor`,
      );
      assert.notEqual(
        editorKeyOf(leaf({
          ...snapshot,
          [phase]: { ...state, view: "create" },
        })),
        editorKeyOf(screen),
      );
    }
    const keyFor = (phase, state) => editorKeyOf(leaf({ ...base, phase, [phase]: state }));
    assert.equal(
      leaf({ ...base, phase: "albums", albums: keys.albums }).key,
      null,
      "album paging ownership survives its editor revision reset",
    );
    for (const [phase, record, idField] of [["albums", "album", "albumId"], ["timeline", "event", "eventId"], ["tags", "tag", "tagId"]]) {
      const state = keys[phase], original = keyFor(phase, state);
      assert.notEqual(keyFor(phase, { ...state, [record]: { ...state[record], revision: "r2" } }), original,
        `${phase} replaces a stale form after a new server revision`);
      assert.notEqual(keyFor(phase, { ...state, [record]: { ...state[record], [idField]: "other-record" } }), original);
    }
    assert.notEqual(
      keyFor("timeline", {
        ...keys.timeline,
        filters: { ...keys.timeline.filters, fromYear: 2025 },
      }),
      keyFor("timeline", keys.timeline),
    );
    assert.equal(
      leaf({ ...base, phase: "timeline", timeline: keys.timeline }).key,
      null,
      "timeline paging ownership survives editor revision/filter resets",
    );
    for (const patch of [{ filters: { ...base.library.filters, q: "another search" } }, { tagQuery: "another tag" }, { formResetVersion: base.library.formResetVersion + 1 }]) {
      assert.notEqual(keyFor("library", { ...base.library, ...patch }), keyFor("library", base.library));
    }
    assert.notEqual(keyFor("tags", { ...keys.tags, q: "another tag" }), keyFor("tags", keys.tags));
    for (const phase of ["library", "tags"]) {
      assert.equal(
        leaf({ ...base, phase, [phase]: keys[phase] }).key,
        null,
        `${phase} read focus survives its editor reset`,
      );
    }
    const create = leaf({ ...base, phase: "create" }, { audioEnabled: true });
    assert.equal(create.props.onNavigationStateChange, view.setCreationState);
    assert.equal(create.props.onDialogStateChange, view.setDialogState); assert.equal(create.props.audioEnabled, true);
    assert.equal(create.props.action, actions.creation.action);
    const list = leaf(base);
    assert.equal(list.props.onFilter, view.filter); assert.equal(list.props.onNext, view.nextPage); assert.equal(list.props.onPrevious, view.previousPage);
    const audioPlayback = {}, deleteButton = {}, cancelDelete = {}, reviewFeedback = {};
    const detail = leaf({ ...base, phase: "detail" }, { audioPlayback, deleteButton, cancelDelete, reviewFeedback });
    assert.equal(detail.props.audioPlayback, audioPlayback); assert.equal(detail.props.deleteButton, deleteButton);
    assert.equal(detail.props.cancelDelete, cancelDelete); assert.equal(detail.props.reviewFeedback, reviewFeedback);
    assert.equal(detail.props.reviewControls, view.reviewControls);
  } finally { await server.close(); }
});
