export const MEMORY_TYPES = Object.freeze(["note", "photos"]);

const emptyForm = () => ({ busy: false, pending: false, hasDraft: false, complete: false });

export function createGuestFlow() {
  return {
    screen: "welcome",
    started: [],
    forms: { note: emptyForm(), photos: emptyForm() },
  };
}

export function navigationLocked(flow) {
  const form = flow.forms[flow.screen];
  return Boolean(form && (form.busy || form.pending));
}

export function hasUnfinishedWork(flow) {
  return Object.values(flow.forms).some(form =>
    form.busy || form.pending || (form.hasDraft && !form.complete));
}

export function guestFlowReducer(flow, action) {
  switch (action.type) {
    case "CHOOSE":
      if (navigationLocked(flow)) return flow;
      return { ...flow, screen: "choose" };
    case "SELECT":
      if (!MEMORY_TYPES.includes(action.kind) || navigationLocked(flow)) return flow;
      return {
        ...flow,
        screen: action.kind,
        started: flow.started.includes(action.kind) ? flow.started : [...flow.started, action.kind],
      };
    case "BACK":
      if (navigationLocked(flow)) return flow;
      return { ...flow, screen: MEMORY_TYPES.includes(flow.screen) ? "choose" : "welcome" };
    case "FORM_STATE": {
      if (!MEMORY_TYPES.includes(action.kind)) return flow;
      const previous = flow.forms[action.kind];
      const next = Object.fromEntries(Object.keys(previous).map(key => [key, Boolean(action.state[key])]));
      if (Object.keys(previous).every(key => previous[key] === next[key])) return flow;
      return { ...flow, forms: { ...flow.forms, [action.kind]: next } };
    }
    case "FINISHED":
    case "ANOTHER":
      // Only forms invoke these callbacks after confirming and resetting their receipts.
      if (action.kind !== flow.screen || !MEMORY_TYPES.includes(action.kind)) return flow;
      return {
        ...flow,
        screen: action.type === "FINISHED" ? "done" : "choose",
        forms: { ...flow.forms, [action.kind]: emptyForm() },
      };
    default:
      return flow;
  }
}
