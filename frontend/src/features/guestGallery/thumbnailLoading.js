/** Load one batch each time the gallery footer comes into view. */
export function observeMorePhotos(target, onMore, {
  IntersectionObserverImpl = globalThis.IntersectionObserver,
  shouldLoad = () => true,
} = {}) {
  if (!target || typeof onMore !== "function" || typeof IntersectionObserverImpl !== "function") {
    return () => {};
  }

  let active = true;
  let inside = false;
  const observer = new IntersectionObserverImpl((entries) => {
    if (!active) return;
    for (const entry of entries) {
      if (entry.target !== target) continue;
      if (!entry.isIntersecting) {
        inside = false;
      } else if (!inside) {
        // Appending can leave the footer visible on a large screen. Wait for
        // another approach instead of loading every photo in one burst.
        inside = true;
        if (shouldLoad()) onMore();
      }
    }
  }, { rootMargin: "0px 0px 320px 0px", threshold: 0 });
  observer.observe(target);

  return () => {
    active = false;
    observer.disconnect();
  };
}
