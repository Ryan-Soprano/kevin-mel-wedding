import { MEMORY_TYPES, navigationLocked } from "./guestFlow.js";

function copyHomeView(view) {
  if (!view || typeof view !== "object") return null;
  return {
    kind: MEMORY_TYPES.includes(view.kind) ? view.kind : null,
    scrollY: Number.isFinite(view.scrollY) ? view.scrollY : null,
    showOpening: view.showOpening === true,
    ...(view.target === "gallery" ? { target: "gallery" } : {}),
  };
}

/** Screen/view metadata stays in memory. History stores only opaque ownership keys. */
export function attachGuestHistory({
  getFlow, navigate, eventTarget = window, historyImpl = window.history,
  randomId = () => crypto.randomUUID(),
  getHomeView = () => null, restoreHomeView = () => {},
}) {
  const owner = randomId();
  const screens = new Map();
  let active = null;
  let disposed = false;
  const previousScrollRestoration = historyImpl.scrollRestoration;
  if (previousScrollRestoration !== undefined) historyImpl.scrollRestoration = "manual";

  function saveActiveHomeView() {
    const destination = active && screens.get(active.key);
    if (destination?.screen === "welcome") destination.homeView = copyHomeView(getHomeView());
  }

  function sync(screen) {
    if (disposed || (active && screens.get(active.key)?.screen === screen)) return;
    saveActiveHomeView();
    const entry = { owner, key: randomId(), index: active ? active.index + 1 : 0 };
    if (active) {
      for (const [key, destination] of screens) if (destination.index > active.index) screens.delete(key);
    }
    screens.set(entry.key, {
      screen,
      index: entry.index,
      ...(screen === "welcome" ? { homeView: copyHomeView(getHomeView()) } : {}),
    });
    if (active) historyImpl.pushState(entry, "");
    else historyImpl.replaceState(entry, "");
    active = entry;
  }

  function pop(event) {
    if (disposed || !active) return;
    const entry = event.state;
    const destination = entry?.owner === owner ? screens.get(entry.key) : null;
    if (!destination || !Number.isSafeInteger(entry.index) || entry.index !== destination.index || entry.key === active.key) return;
    if (navigationLocked(getFlow())) {
      historyImpl.go(active.index - entry.index);
      return;
    }
    saveActiveHomeView();
    active = entry;
    if (destination.screen === "welcome") restoreHomeView(copyHomeView(destination.homeView));
    navigate(destination.screen);
  }

  eventTarget.addEventListener("popstate", pop);
  sync(getFlow().screen);
  return {
    sync,
    dispose() {
      if (disposed) return;
      disposed = true;
      screens.clear();
      eventTarget.removeEventListener("popstate", pop);
      if (previousScrollRestoration !== undefined && historyImpl.scrollRestoration === "manual") {
        historyImpl.scrollRestoration = previousScrollRestoration;
      }
    },
  };
}
