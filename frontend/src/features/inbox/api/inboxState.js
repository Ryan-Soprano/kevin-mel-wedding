export const EMPTY_ITEMS = Object.freeze([]);
export const idlePhoto = () => Object.freeze({ phase: "idle", url: null, error: null });
export const idleReview = () => Object.freeze({ phase: "idle", targetStatus: null, error: null, canRetry: false });
export const idleMetadata = () => Object.freeze({ phase: "idle", error: null, canRetry: false });
export const idleShareLink = () => Object.freeze({ url: null, error: null });

export function frozenCopy(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(frozenCopy));
  if (value && typeof value === "object") {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, frozenCopy(item)])));
  }
  return value;
}

export function sessionCopy(value) {
  // Only session contract fields enter presentation state, never credential echoes.
  return frozenCopy({ authenticated: value.authenticated, csrfToken: value.csrfToken,
    user: value.user === null ? null : { displayName: value.user.displayName, roles: value.user.roles } });
}
