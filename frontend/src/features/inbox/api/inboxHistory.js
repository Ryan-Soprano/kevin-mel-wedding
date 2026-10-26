import { isInboxLocked } from "../inboxDisplay.js";

const pagesOf = value => Array.isArray(value) && value.length ? [...value] : [null];
const cursorOf = pages => pages.at(-1) ?? null;
const filtersOf = value => value ? { ...value } : {};

function featureRoute(phase, state, idField, recordField) {
  return { phase, view: state.view, pages: pagesOf(state.cursors),
    ...(["detail", "select"].includes(state.view) ? { id: state[recordField]?.[idField] ?? state.requestedId ?? null } : {}),
    ...(state.view === "select" ? { selectorStatus: state.selectorStatus } : {}),
    ...(phase === "timeline" ? { filters: filtersOf(state.filters) } : {}),
    ...(phase === "tags" ? { q: state.q } : {}) };
}

function libraryRoute(state) {
  const choosing = state.view === "chooseTag";
  return { phase: "library", view: state.view,
    filters: filtersOf(choosing ? state.draftFilters : state.filters),
    pages: pagesOf(choosing ? state.tagCursors : state.cursors), ...(choosing ? { q: state.tagQuery } : {}) };
}

function tagParentRoute(tagId, previousRoute) {
  // Memory-tag controls replace the tag detail presentation. Retain only its
  // matching navigation metadata, never another tag's page or query.
  const previous = previousRoute?.phase === "detail" && previousRoute.context.tagId === tagId
    ? previousRoute.parent : previousRoute;
  return previous?.phase === "tags" && previous.view === "detail" && previous.id === tagId
    ? { ...previous, pages: pagesOf(previous.pages) }
    : { phase: "tags", view: "detail", id: tagId, q: "", pages: [null] };
}

// Only navigation metadata enters this private, disposable map. In particular,
// never retain presentation snapshots, editable drafts, capabilities or originals.
function routeOf(snapshot, inboxPages, previousRoute) {
  switch (snapshot.phase) {
    case "inbox": return { phase: "inbox", reviewStatus: snapshot.reviewStatus, pages: pagesOf(inboxPages) };
    case "create": return { phase: "create" };
    case "albums": return featureRoute("albums", snapshot.albums, "albumId", "album");
    case "timeline": return featureRoute("timeline", snapshot.timeline, "eventId", "event");
    case "tags": return featureRoute("tags", snapshot.tags, "tagId", "tag");
    case "library": return libraryRoute(snapshot.library);
    case "export": return { phase: "export", parts: snapshot.export.partCursors.length, issues: snapshot.export.issueCursors.length };
    case "detail": {
      const id = snapshot.detail?.memoryId ?? snapshot.requestedMemoryId;
      if (!id) return null;
      const parent = snapshot.albumReturnId ? featureRoute("albums", snapshot.albums, "albumId", "album")
        : snapshot.timelineReturnId ? featureRoute("timeline", snapshot.timeline, "eventId", "event")
          : snapshot.tagReturnId ? tagParentRoute(snapshot.tagReturnId, previousRoute)
            : snapshot.libraryReturn ? libraryRoute(snapshot.library)
              : { phase: "inbox", reviewStatus: snapshot.reviewStatus, pages: pagesOf(inboxPages) };
      return { phase: "detail", id, parent,
        context: { albumId: snapshot.albumReturnId ?? null, eventId: snapshot.timelineReturnId ?? null,
          tagId: snapshot.tagReturnId ?? null, libraryReturn: Boolean(snapshot.libraryReturn) },
        tags: { view: snapshot.tags.view === "attach" ? "attach" : "memory", q: snapshot.tags.q,
          pages: pagesOf(snapshot.tags.cursors) } };
    }
    default: return null;
  }
}

function destinationOf(route) {
  // A mutation can reset a memory's return page without navigating to another
  // screen. Refresh that metadata in place instead of adding a history entry.
  if (route.phase !== "detail") return JSON.stringify(route);
  return JSON.stringify({ phase: route.phase, id: route.id, context: route.context, tags: route.tags });
}

/** Browser history stores opaque ownership only; private routes live in memory. */
export function attachInboxHistory({ controller, eventTarget = window, historyImpl = window.history,
  getInboxPages = () => [null], setInboxPages = () => {}, isCreationBlocked = () => false,
  confirmDiscard = () => window.confirm("Discard this unfinished memory and leave this screen?"),
  hasCreationDraft = () => false, onBlocked = () => {}, onNavigate = () => {}, randomId = () => crypto.randomUUID(),
}) {
  const routes = new Map();
  let owner = randomId(), current = null, restoring = null, bouncing = false, disposed = false, generation = 0;

  function clear() {
    routes.clear(); current = null; restoring = null; bouncing = false; generation++;
    owner = randomId();
  }
  function known(value) {
    return value && Object.keys(value).length === 3 && value.owner === owner
      && typeof value.key === "string" && Number.isSafeInteger(value.index) && value.index >= 0
      && routes.get(value.key)?.index === value.index;
  }
  function write(method, value) { historyImpl[method](value, ""); }
  function sync(snapshot) {
    if (disposed) return;
    if (!snapshot.session?.authenticated || snapshot.session.passwordChangeRequired || ["checking", "login", "unavailable", "password-change"].includes(snapshot.phase)) {
      if (current || routes.size || restoring) clear();
      return;
    }
    // Read destinations must own an entry before their transport settles, so
    // Back can cancel a slow read and Forward can reread the intended target.
    if (restoring || isInboxLocked(snapshot)) return;
    const route = routeOf(snapshot, getInboxPages(), current ? routes.get(current.key)?.route : null);
    if (!route) return;
    const destination = destinationOf(route);
    if (current && routes.get(current.key)?.destination === destination) {
      routes.set(current.key, { route, destination, index: current.index });
      return;
    }
    const next = { owner, key: randomId(), index: current ? current.index + 1 : 0 };
    if (current) {
      for (const [key, value] of routes) if (value.index > current.index) routes.delete(key);
    }
    routes.set(next.key, { route, destination, index: next.index });
    write(current ? "pushState" : "replaceState", next);
    current = next;
  }

  async function restore(route, active) {
    if (!active()) return;
    const pages = route.pages ?? [null], cursor = cursorOf(pages);
    switch (route.phase) {
      case "inbox":
        setInboxPages([...pages]);
        await controller.loadInbox(route.reviewStatus, cursor);
        if (active()) setInboxPages([...pages]);
        break;
      case "create": controller.beginCreation(); break;
      case "albums":
      case "timeline":
      case "tags": {
        const names = route.phase === "albums" ? ["loadAlbums", "openAlbum", "beginAlbumCreation", "showAlbumSelector"]
          : route.phase === "timeline" ? ["loadTimeline", "openTimelineEvent", "beginTimelineCreation", "showTimelineSelector"]
            : ["loadTags", "openTag", "beginTagCreation", "showTagSelector"];
        if (route.view === "list") {
          if (route.phase === "albums") await controller[names[0]](cursor, [...pages]);
          else await controller[names[0]](route.phase === "timeline" ? filtersOf(route.filters) : route.q, cursor, [...pages]);
        } else if (route.view === "create") await controller[names[2]]();
        else if (route.id) {
          // Restore the list context before opening a nested destination. Other
          // screens may have reset it since this history entry was recorded.
          if (route.phase === "timeline" && JSON.stringify(controller.getSnapshot().timeline.filters) !== JSON.stringify(route.filters)) {
            await controller.loadTimeline(filtersOf(route.filters), null, [null]);
          } else if (route.phase === "tags" && controller.getSnapshot().tags.q !== route.q) {
            await controller.loadTags(route.q, null, [null]);
          }
          if (!active()) return;
          await controller[names[1]](route.id, route.view === "select" ? null : cursor, route.view === "select" ? [null] : [...pages]);
          if (active() && route.view === "select") await controller[names[3]](route.selectorStatus, cursor, [...pages]);
        }
        break;
      }
      case "library":
        if (route.view === "chooseTag") await controller.chooseLibraryTag(filtersOf(route.filters), route.q, cursor, [...pages]);
        else await controller.loadLibrary(filtersOf(route.filters), cursor, [...pages]);
        break;
      case "detail": {
        await restore(route.parent, active);
        if (!active()) return;
        await controller.openMemory(route.id, { ...route.context,
          ...(route.parent.phase === "inbox" ? { inboxCursors: pagesOf(route.parent.pages) } : {}) });
        if (!active() || !controller.getSnapshot().detail) return;
        const tagPages = route.tags.pages;
        if (route.tags.view === "attach") await controller.chooseMemoryTag(route.tags.q, cursorOf(tagPages), [...tagPages]);
        else if (tagPages.length > 1) await controller.loadMemoryTags(cursorOf(tagPages), [...tagPages]);
        break;
      }
      case "export":
        await controller.loadExport();
        for (const [kind, count, next] of [["parts", route.parts, "partsNextCursor"], ["issues", route.issues, "issuesNextCursor"]]) {
          for (let page = 1; page < count && active() && controller.getSnapshot().export[next]; page++) {
            await controller.exportPage(kind, true);
          }
        }
        break;
    }
  }

  function returnToCurrent(target) {
    bouncing = true;
    if (known(target) && target.index !== current.index) historyImpl.go(current.index - target.index);
    else {
      // An entry from another page or expired owner cannot supply a trusted
      // traversal distance. Re-establish this screen without cancelling its work.
      write("pushState", current);
      bouncing = false;
    }
  }

  function pop(event) {
    if (disposed || !current) return;
    const target = event.state;
    if (known(target) && target.key === current.key) { bouncing = false; return; }
    const snapshot = controller.getSnapshot();
    const blocked = isInboxLocked(snapshot) || (snapshot.phase === "create" && isCreationBlocked());
    if (bouncing || blocked || (snapshot.phase === "create" && hasCreationDraft() && !confirmDiscard())) {
      returnToCurrent(target);
      if (blocked) onBlocked();
      return;
    }
    const saved = known(target) ? routes.get(target.key) : null;
    onNavigate(saved?.route ?? null);
    if (!saved) { clear(); return; }
    current = { owner, key: target.key, index: target.index };
    const token = ++generation;
    restoring = token;
    const active = () => !disposed && generation === token && controller.getSnapshot().session?.authenticated;
    void restore(saved.route, active).catch(() => {
      if (active()) onBlocked();
    }).finally(() => {
      if (generation !== token || disposed) return;
      restoring = null;
      const state = controller.getSnapshot();
      if (!state.session?.authenticated) { clear(); return; }
      const route = routeOf(state, getInboxPages(), routes.get(current.key)?.route);
      if (route) routes.set(current.key, { route, destination: destinationOf(route), index: current.index });
    });
  }
  eventTarget.addEventListener("popstate", pop);
  eventTarget.addEventListener("pagehide", clear);
  return { sync, cancelRestore() {
    if (restoring === null) return;
    generation++;
    restoring = null;
  }, dispose() {
    if (disposed) return;
    disposed = true; clear();
    eventTarget.removeEventListener("popstate", pop);
    eventTarget.removeEventListener("pagehide", clear);
  } };
}
