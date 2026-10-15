import { navigationLocked } from "./guestFlow.js";

/** History remembers screen names only. Drafts and retry keys stay in mounted forms. */
export function attachGuestHistory({
  getFlow, navigate, eventTarget = window, historyImpl = window.history,
  randomId = () => crypto.randomUUID(),
}) {
  const owner = randomId();
  const screens = new Map();
  let active = null;
  let disposed = false;

  function sync(screen) {
    if (disposed || (active && screens.get(active.key)?.screen === screen)) return;
    const entry = { owner, key: randomId(), index: active ? active.index + 1 : 0 };
    if (active) {
      for (const [key, destination] of screens) if (destination.index > active.index) screens.delete(key);
    }
    screens.set(entry.key, { screen, index: entry.index });
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
    active = entry;
    navigate(destination.screen);
  }

  eventTarget.addEventListener("popstate", pop);
  sync(getFlow().screen);
  return {
    sync,
    dispose() { disposed = true; screens.clear(); eventTarget.removeEventListener("popstate", pop); },
  };
}
