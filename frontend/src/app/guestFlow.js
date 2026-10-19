export const MEMORY_TYPES = Object.freeze(["note", "photos", "audio"]);

const emptyForm = () => ({
  busy: false,
  capturing: false,
  pending: false,
  hasDraft: false,
  complete: false,
});

export function createGuestFlow({ audioEnabled = false } = {}) {
  return {
    screen: "welcome",
    started: [],
    forms: { note: emptyForm(), photos: emptyForm(), audio: emptyForm() },
    audioEnabled: audioEnabled === true,
  };
}

export function navigationLocked(flow) {
  const form = flow.forms[flow.screen];
  return Boolean(form && (form.busy || form.pending));
}

export function hasUnfinishedWork(flow) {
  return Object.values(flow.forms).some(
    (form) => form.busy || form.pending || (form.hasDraft && !form.complete),
  );
}

function canNavigate(flow, screen) {
  const validScreen = ["welcome", "done", ...MEMORY_TYPES].includes(screen);
  const audioAllowed = screen !== "audio" || flow.audioEnabled;
  return !navigationLocked(flow) && validScreen && audioAllowed;
}

function markStarted(flow, screen) {
  if (!MEMORY_TYPES.includes(screen) || flow.started.includes(screen))
    return flow.started;
  return [...flow.started, screen];
}

function navigate(flow, screen) {
  if (!canNavigate(flow, screen)) return flow;
  return { ...flow, screen, started: markStarted(flow, screen) };
}

function selectMemory(flow, kind) {
  if (!MEMORY_TYPES.includes(kind)) return flow;
  return navigate(flow, kind);
}

function updateForm(flow, action) {
  if (!MEMORY_TYPES.includes(action.kind)) return flow;
  const previous = flow.forms[action.kind];
  const next = Object.fromEntries(
    Object.keys(previous).map((key) => [key, Boolean(action.state[key])]),
  );
  const unchanged = Object.keys(previous).every((key) => previous[key] === next[key]);
  if (unchanged) return flow;
  return { ...flow, forms: { ...flow.forms, [action.kind]: next } };
}

function finishMemory(flow, kind) {
  if (kind !== flow.screen || !MEMORY_TYPES.includes(kind)) return flow;
  return {
    ...flow,
    screen: "welcome",
    forms: { ...flow.forms, [kind]: emptyForm() },
  };
}

export function guestFlowReducer(flow, action) {
  switch (action.type) {
    case "NAVIGATE":
      return navigate(flow, action.screen);
    case "SELECT":
      return selectMemory(flow, action.kind);
    case "BACK":
      return navigationLocked(flow) ? flow : { ...flow, screen: "welcome" };
    case "FORM_STATE":
      return updateForm(flow, action);
    case "FINISHED":
    case "ANOTHER":
      // Only forms invoke these callbacks after confirming and resetting their receipts.
      return finishMemory(flow, action.kind);
    default:
      return flow;
  }
}
