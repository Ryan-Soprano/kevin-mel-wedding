/** Rotate only while this tab is visible; cleanup also removes the listener. */
export function startSlideshow(
  advance,
  {
    documentImpl = document,
    setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval,
  } = {},
) {
  let timer = null;
  function update() {
    if (timer !== null) clearIntervalImpl(timer);
    timer = documentImpl.hidden ? null : setIntervalImpl(advance, 5000);
  }
  documentImpl.addEventListener("visibilitychange", update);
  update();
  return () => {
    if (timer !== null) clearIntervalImpl(timer);
    documentImpl.removeEventListener("visibilitychange", update);
  };
}
