import { ApiError, contractMismatch } from "../../../shared/api/apiClient.js";
import { normalizeAlbumName } from "../albumName.js";

const EMPTY = Object.freeze([]);
const idle = () =>
  Object.freeze({
    phase: "idle",
    error: null,
    canRetry: false,
    needsName: false,
  });
export const initialAlbums = () =>
  Object.freeze({
    view: "list",
    items: EMPTY,
    album: null,
    members: EMPTY,
    requestedId: null,
    candidates: EMPTY,
    nextCursor: null,
    cursors: Object.freeze([null]),
    selectorStatus: "KEEP",
    mutation: idle(),
    error: null,
    notice: null,
  });
const fingerprint = async (name) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(name)),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

/** Album work shares the host's session, cancellation generation and write fence. */
export function createAlbumActions({
  api,
  getState,
  publish,
  start,
  bounded,
  run,
  assertCurrent,
  isCurrent,
  authFailure,
  freeze,
  canNavigate,
  openMemory,
  randomId = () => crypto.randomUUID(),
  nameFingerprint = fingerprint,
}) {
  let intent = null,
    inFlight = null,
    uncertain = false,
    returnAlbumId = null,
    hiddenAlbumId = null;
  const state = () => getState().albums;
  const set = (patch) =>
    publish({ albums: Object.freeze({ ...state(), ...patch }) });
  const mutation = (phase, error = null, canRetry = false) =>
    Object.freeze({
      phase,
      error,
      canRetry,
      needsName: Boolean(
        intent &&
        ["create", "rename"].includes(intent.kind) &&
        intent.name === null,
      ),
    });
  const visible = () => !intent && canNavigate();
  const base = (patch) => ({
    phase: "albums",
    detail: null,
    items: EMPTY,
    nextCursor: null,
    albumReturnId: null,
    notice: null,
    albums: Object.freeze({ ...state(), error: null, notice: null, ...patch }),
  });

  function readFailure(failure) {
    if (authFailure(failure)) return;
    set({
      error:
        failure?.status === 412
          ? "This album changed while you were browsing. Reload its first page."
          : failure?.status === 404
            ? "This album is unavailable. Return to your albums."
            : "Your albums could not be loaded. Try again.",
    });
  }
  async function members(
    op,
    albumId,
    cursor = null,
    cursors = [null],
    notice = null,
  ) {
    const result = await bounded(op, (signal) =>
      api.listAlbumMembers(albumId, { ...(cursor ? { cursor } : {}), signal }),
    );
    assertCurrent(op);
    set({
      view: "detail",
      requestedId: albumId,
      album: freeze(result.album),
      members: freeze(result.items),
      candidates: EMPTY,
      nextCursor: result.nextCursor,
      cursors: freeze(cursors),
      notice,
      error: null,
    });
    assertCurrent(op);
  }
  async function accepted(op, album, notice) {
    assertCurrent(op);
    intent = null;
    uncertain = false;
    hiddenAlbumId = null;
    // The new token must never authorize controls derived from an older order.
    // Install identity only until a fresh member page has actually been read.
    set({
      view: "detail",
      requestedId: album.albumId,
      album: freeze(album),
      mutation: idle(),
      notice,
      items: EMPTY,
      members: EMPTY,
      candidates: EMPTY,
      nextCursor: null,
      cursors: freeze([null]),
      error: null,
    });
    try {
      await members(op, album.albumId, null, [null], notice);
    } catch (failure) {
      // A timed-out follow-up read does not undo an acknowledged write. An
      // obsolete generation must never republish content after hide/navigation.
      if (!isCurrent(op)) throw failure;
      readFailure(failure);
    }
  }
  function writeFailure(failure) {
    if (
      intent &&
      ["create", "rename"].includes(intent.kind) &&
      intent.nameHash === null
    ) {
      intent = null;
      set({
        mutation: idle(),
        error:
          "The album name could not be prepared. No change was sent. Try again.",
      });
    } else if (failure?.status === 403 && failure.code === "CSRF_INVALID") {
      set({
        mutation: mutation(
          "csrf",
          "Refresh your session and the album before choosing this action again.",
        ),
      });
    } else if (authFailure(failure)) {
      // The host clears all album intent and private state on access loss.
    } else if ([412, 428].includes(failure?.status)) {
      set({
        mutation: mutation(
          "conflict",
          "This album changed or its revision could not be checked. Reload its current state.",
        ),
      });
    } else if (
      uncertain ||
      failure?.unknownOutcome ||
      !failure?.status ||
      failure.status >= 500
    ) {
      uncertain = true;
      set({
        mutation: mutation(
          "uncertain",
          "We could not confirm this album change. Reload current state before doing anything else.",
        ),
      });
    } else {
      intent = null;
      set({
        mutation: idle(),
        error:
          failure?.status === 404
            ? "That album or memory is unavailable. Reload the album."
            : failure?.status === 429
              ? "Please wait before trying again. This request was not accepted."
              : "This album change was not accepted. Check the fields and reload before trying again.",
      });
    }
  }
  function remember(op, task, onFailure = writeFailure) {
    const completion = run(op, task, onFailure).finally(() => {
      if (inFlight === completion) inFlight = null;
    });
    inFlight = completion;
    return completion;
  }
  function send() {
    const frozen = intent,
      token = getState().session?.csrfToken;
    const op = start(base({ mutation: mutation("saving") }));
    return remember(op, async () => {
      const options = { revision: frozen.revision, csrfToken: token };
      const album = await bounded(
        op,
        (signal) => {
          options.signal = signal;
          if (frozen.kind === "create")
            return api.createAlbum(frozen.albumId, frozen.name, options);
          if (frozen.kind === "rename")
            return api.renameAlbum(frozen.albumId, frozen.name, options);
          if (frozen.kind === "delete")
            return api.deleteAlbum(frozen.albumId, options);
          if (frozen.kind === "add")
            return api.addAlbumMember(frozen.albumId, frozen.memoryId, options);
          if (frozen.kind === "remove")
            return api.removeAlbumMember(
              frozen.albumId,
              frozen.memoryId,
              options,
            );
          return api.moveAlbumMember(
            frozen.albumId,
            frozen.memoryId,
            frozen.direction,
            options,
          );
        },
        undefined,
        true,
      );
      if (album.albumId !== frozen.albumId) throw contractMismatch();
      if (
        frozen.kind === "rename" &&
        (album.deletedAt !== null || album.name !== frozen.name)
      )
        throw contractMismatch();
      if (frozen.kind === "delete" && album.deletedAt === null)
        throw contractMismatch();
      await accepted(
        op,
        album,
        frozen.kind === "delete"
          ? "Album deleted. Its memories and original files remain in your archive."
          : "Album change accepted. Current album loaded; memory sharing is unchanged.",
      );
    });
  }
  async function reconcile(op) {
    const frozen = intent;
    let album;
    try {
      album = await bounded(op, (signal) =>
        api.getAlbum(frozen.albumId, { signal }),
      );
    } catch (failure) {
      if (failure?.status !== 404 || frozen.kind !== "create") throw failure;
      // A read can precede a late create. Keep the same UUID until confirmed.
      set({
        view: "create",
        album: null,
        members: EMPTY,
        candidates: EMPTY,
        mutation: mutation(
          "uncertain",
          "This album is not present in the current read. The earlier request may still finish. Retry only this same album name and identity, or reload again.",
          true,
        ),
      });
      return;
    }
    if (album.albumId !== frozen.albumId) throw contractMismatch();
    if (
      frozen.kind !== "create" &&
      album.revision === frozen.revision &&
      uncertain
    ) {
      set({
        view: "detail",
        requestedId: album.albumId,
        album: freeze(album),
        members: EMPTY,
        candidates: EMPTY,
        nextCursor: null,
        mutation: mutation(
          "uncertain",
          "The current read still shows the earlier revision. The first request may still finish. Retry only this same change, or reload again.",
          true,
        ),
      });
      return;
    }
    await accepted(
      op,
      album,
      "Current album loaded. Review it before choosing another action; this does not identify who changed it.",
    );
  }
  function act(kind, extra = {}) {
    if (inFlight) return inFlight;
    if (
      !visible() ||
      getState().busy ||
      !state().album ||
      state().album.deletedAt !== null
    )
      return Promise.resolve(getState());
    intent = Object.freeze({
      kind,
      albumId: state().album.albumId,
      revision: state().album.revision,
      ...extra,
    });
    uncertain = false;
    return send();
  }
  const actions = {
    locked: () => intent !== null,
    hasPending: () => intent !== null || hiddenAlbumId !== null,
    clear() {
      intent = null;
      inFlight = null;
      uncertain = false;
      returnAlbumId = null;
      hiddenAlbumId = null;
    },
    clearNavigation() {
      returnAlbumId = null;
      hiddenAlbumId = null;
      return { albumReturnId: null };
    },
    memoryContext(albumId) {
      returnAlbumId = albumId;
      publish({ albumReturnId: albumId });
    },
    hasReturn: () => returnAlbumId !== null,
    returnId: () => returnAlbumId,
    returnToAlbum() {
      return actions.openAlbum(returnAlbumId);
    },
    suspend() {
      if (
        intent &&
        ["create", "rename"].includes(intent.kind) &&
        intent.nameHash === null
      )
        intent = null;
      hiddenAlbumId =
        intent?.albumId ??
        returnAlbumId ??
        (getState().phase === "albums"
          ? (state().album?.albumId ?? state().requestedId)
          : null) ??
        hiddenAlbumId;
      if (intent) {
        uncertain = true;
        // A hash permits deliberate same-name retry without retaining private text.
        intent = Object.freeze({ ...intent, name: null });
      }
      inFlight = null;
      return {
        albums: Object.freeze({
          ...initialAlbums(),
          mutation: intent ? mutation("uncertain") : idle(),
        }),
      };
    },
    async resume(op) {
      publish({ phase: "albums" });
      if (intent) await reconcile(op);
      else if (hiddenAlbumId) {
        const target = hiddenAlbumId;
        await members(op, target);
        hiddenAlbumId = null;
      } else await actions.readList(op);
    },
    async readList(op, cursor = null, cursors = [null]) {
      const result = await bounded(op, (signal) =>
        api.listAlbums({ ...(cursor ? { cursor } : {}), signal }),
      );
      assertCurrent(op);
      set({
        view: "list",
        items: freeze(result.items),
        album: null,
        members: EMPTY,
        candidates: EMPTY,
        nextCursor: result.nextCursor,
        cursors: freeze(cursors),
        error: null,
      });
    },
    loadAlbums(cursor = null, cursors = [null]) {
      if (!visible()) return Promise.resolve(getState());
      returnAlbumId = null;
      const op = start(
        base({
          view: "list",
          items: EMPTY,
          album: null,
          members: EMPTY,
          candidates: EMPTY,
          nextCursor: null,
          cursors: freeze(cursors),
        }),
      );
      return run(op, () => actions.readList(op, cursor, cursors), readFailure);
    },
    openAlbum(albumId, cursor = null, cursors = [null]) {
      if (!visible() || !albumId) return Promise.resolve(getState());
      returnAlbumId = null;
      const op = start(
        base({
          view: "detail",
          requestedId: albumId,
          album: state().album?.albumId === albumId ? state().album : null,
          members: EMPTY,
          candidates: EMPTY,
          nextCursor: null,
          cursors: freeze(cursors),
        }),
      );
      return run(op, () => members(op, albumId, cursor, cursors), readFailure);
    },
    beginAlbumCreation() {
      if (!visible()) return getState();
      const op = start(base({ ...initialAlbums(), view: "create" }));
      return run(op, async () => {}, readFailure);
    },
    createAlbum(name) {
      if (inFlight) return inFlight;
      if (!visible() || getState().busy || state().view !== "create")
        return Promise.resolve(getState());
      const normalized = normalizeAlbumName(name),
        albumId = randomId();
      intent = Object.freeze({
        kind: "create",
        albumId,
        revision: null,
        name: normalized,
        nameHash: null,
      });
      const op = start(base({ mutation: mutation("saving") }));
      return remember(op, async () => {
        const nameHash = await bounded(op, () => nameFingerprint(normalized));
        assertCurrent(op);
        intent = Object.freeze({ ...intent, nameHash });
        const album = await bounded(
          op,
          (signal) =>
            api.createAlbum(albumId, normalized, {
              csrfToken: getState().session.csrfToken,
              signal,
            }),
          undefined,
          true,
        );
        await accepted(
          op,
          album,
          "Album created privately. Add memories whenever you are ready.",
        );
      });
    },
    renameAlbum(name) {
      if (
        inFlight ||
        !visible() ||
        getState().busy ||
        !state().album ||
        state().album.deletedAt !== null
      )
        return Promise.resolve(getState());
      const normalized = normalizeAlbumName(name);
      intent = Object.freeze({
        kind: "rename",
        albumId: state().album.albumId,
        revision: state().album.revision,
        name: normalized,
        nameHash: null,
      });
      uncertain = false;
      const op = start(base({ mutation: mutation("saving") }));
      return remember(op, async () => {
        const nameHash = await bounded(op, () => nameFingerprint(normalized));
        assertCurrent(op);
        intent = Object.freeze({ ...intent, nameHash });
        const album = await bounded(
          op,
          (signal) =>
            api.renameAlbum(intent.albumId, normalized, {
              revision: intent.revision,
              csrfToken: getState().session.csrfToken,
              signal,
            }),
          undefined,
          true,
        );
        await accepted(op, album, "Album name saved privately.");
      });
    },
    deleteAlbum() {
      return act("delete");
    },
    addAlbumMember(memoryId) {
      return act("add", { memoryId });
    },
    removeAlbumMember(memoryId) {
      return act("remove", { memoryId });
    },
    moveAlbumMember(memoryId, direction) {
      return act("move", { memoryId, direction });
    },
    reloadAlbumMutation({ refreshSession = false } = {}) {
      if (inFlight) return inFlight;
      if (!intent || getState().busy || !getState().session?.authenticated)
        return Promise.resolve(getState());
      const previous = state().mutation.phase;
      const op = start(base({ mutation: mutation("loading") }));
      return remember(
        op,
        async () => {
          if (refreshSession) {
            const session = await bounded(op, (signal) =>
              api.getSession({ signal }),
            );
            if (!session.authenticated)
              throw new ApiError("Sign in again.", { status: 401 });
            publish({
              session: freeze({
                authenticated: session.authenticated,
                csrfToken: session.csrfToken,
                user: {
                  displayName: session.user.displayName,
                  roles: session.user.roles,
                },
              }),
            });
          }
          await reconcile(op);
        },
        (failure) => {
          if (!authFailure(failure))
            set({
              mutation: mutation(
                previous,
                "Current album could not be loaded. Try reloading again.",
              ),
            });
        },
      );
    },
    retryAlbumMutation(name) {
      if (inFlight) return inFlight;
      if (
        !intent ||
        getState().busy ||
        !getState().session?.authenticated ||
        !state().mutation.canRetry
      )
        return Promise.resolve(getState());
      if (!state().mutation.needsName) return send();
      const normalized = normalizeAlbumName(name),
        frozen = intent;
      const op = start(base({ mutation: mutation("loading") }));
      return remember(op, async () => {
        const hash = await bounded(op, () => nameFingerprint(normalized));
        assertCurrent(op);
        if (frozen.nameHash === null || hash !== frozen.nameHash) {
          set({
            mutation: mutation(
              "uncertain",
              "Re-enter the same name used for the unconfirmed change. A different name will not be sent.",
              true,
            ),
          });
          return;
        }
        intent = Object.freeze({ ...frozen, name: normalized });
        const options = {
          revision: frozen.revision,
          csrfToken: getState().session.csrfToken,
        };
        const album = await bounded(
          op,
          (signal) =>
            frozen.kind === "create"
              ? api.createAlbum(frozen.albumId, normalized, {
                  ...options,
                  signal,
                })
              : api.renameAlbum(frozen.albumId, normalized, {
                  ...options,
                  signal,
                }),
          undefined,
          true,
        );
        await accepted(
          op,
          album,
          "Same album change accepted. Current state loaded privately.",
        );
      });
    },
    showAlbumSelector(reviewStatus = "KEEP", cursor = null, cursors = [null]) {
      if (!visible() || !state().album || state().album.deletedAt !== null)
        return Promise.resolve(getState());
      const op = start(
        base({
          view: "select",
          candidates: EMPTY,
          nextCursor: null,
          selectorStatus: reviewStatus,
          cursors: freeze(cursors),
        }),
      );
      return run(
        op,
        async () => {
          const result = await bounded(op, (signal) =>
            api.listMemories({
              reviewStatus,
              limit: 20,
              ...(cursor ? { cursor } : {}),
              signal,
            }),
          );
          assertCurrent(op);
          set({
            candidates: freeze(result.items),
            nextCursor: result.nextCursor,
            cursors: freeze(cursors),
            error: null,
          });
        },
        readFailure,
      );
    },
    openAlbumMemory(memoryId) {
      if (!visible() || !state().album) return Promise.resolve(getState());
      return openMemory(memoryId, { albumId: state().album.albumId });
    },
    albumPage(next) {
      if (!visible() || getState().busy || state().error)
        return Promise.resolve(getState());
      const cursors = next
        ? [...state().cursors, state().nextCursor]
        : state().cursors.slice(0, -1);
      if ((next && !state().nextCursor) || !cursors.length)
        return Promise.resolve(getState());
      if (state().view === "list")
        return actions.loadAlbums(cursors.at(-1), cursors);
      if (state().view === "select")
        return actions.showAlbumSelector(
          state().selectorStatus,
          cursors.at(-1),
          cursors,
        );
      return actions.openAlbum(state().album.albumId, cursors.at(-1), cursors);
    },
  };
  return actions;
}
