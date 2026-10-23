export function initialPhotoNavigation() {
  return { index: 0, key: 0, serial: 0, ready: false, pending: null, error: null };
}

export function isActivePhotoRequest(state, key) {
  return key === state.key || key === state.pending?.key;
}

function requestPhoto(state, index, total, automatic = false) {
  if (!total || (automatic && (state.pending || !state.ready || state.error))) return state;
  const target = ((index % total) + total) % total;
  if (target === state.index && state.ready && !state.error) {
    return state.pending ? { ...state, pending: null } : state;
  }
  const serial = state.serial + 1;
  return { ...state, serial, pending: { index: target, key: serial, automatic }, error: null };
}

// A requested photo never becomes the displayed photo until its own image is
// ready. Keys also prevent a superseded load/error from changing a later slide.
export function photoNavigation(state, action) {
  switch (action.type) {
    case "request":
      return requestPhoto(state, action.index, action.total);
    case "move":
      return requestPhoto(
        state,
        (action.automatic ? state.index : (state.pending?.index ?? state.index)) + action.direction,
        action.total,
        action.automatic,
      );
    case "ready":
      if (action.key === state.pending?.key) {
        return { ...state, index: state.pending.index, key: action.key, ready: true, pending: null, error: null };
      }
      if (action.key === state.key && (!state.ready || state.error?.key === action.key)) {
        return { ...state, ready: true, error: state.error?.key === action.key ? null : state.error };
      }
      return state;
    case "failed":
      if (action.key === state.pending?.key) {
        return { ...state, pending: null, error: { index: state.pending.index, key: action.key } };
      }
      return action.key === state.key ? { ...state, ready: false, error: { index: state.index, key: action.key } } : state;
    case "cancel":
      return state.pending ? { ...state, pending: null } : state;
    case "cancelAutomatic":
      return state.pending?.automatic ? { ...state, pending: null } : state;
    default:
      return state;
  }
}

export async function decodeGalleryImage(image) {
  if (!image.complete || image.naturalWidth < 1) throw new Error("Photo did not load");
  if (typeof image.decode === "function") await image.decode();
  if (!image.complete || image.naturalWidth < 1) throw new Error("Photo did not decode");
}
