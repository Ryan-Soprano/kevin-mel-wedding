import { ApiError } from "../../../shared/api/apiClient.js";
import { decodeSession } from "../../../shared/api/archiveContracts.js";

/** Reuse upload coordinators through authenticated routes only; never expose a guest fallback. */
export function createCoupleSubmissionApi({
  api,
  getSession,
  isCurrent = () => true,
  onSessionRefresh = () => {},
  onAccessFailure = () => {},
}) {
  const denied = () => new ApiError("Private archive access must be checked again.", { status: 401, code: "AUTH_REQUIRED" });
  const cancelled = () => new ApiError("The private draft was cleared.", {
    code: "REQUEST_ABORTED", unknownOutcome: true,
  });
  async function call(method, args, options = {}) {
    const session = getSession();
    if (!isCurrent() || !session?.authenticated) throw denied();
    const ownsSession = () => isCurrent() && getSession() === session && !options.signal?.aborted;
    try {
      const result = await api[method](...args, { ...options, csrfToken: session.csrfToken });
      if (!isCurrent()) throw new ApiError("The private draft was cleared.", { code: "REQUEST_ABORTED", unknownOutcome: true });
      return result;
    } catch (failure) {
      // Signed storage grant expiry is an item-level retry, not an account failure.
      if (method !== "uploadMedia" && ownsSession() && failure?.status === 403 && failure.code === "CSRF_INVALID") {
        try {
          // The enclosing coordinator bounds this read with the original request's signal.
          // Refresh credentials only; the rejected mutation still requires an explicit retry.
          const refreshed = decodeSession(await api.getSession({ signal: options.signal }));
          if (!ownsSession()) throw cancelled();
          if (!refreshed.authenticated) throw denied();
          if (refreshed.user.displayName !== session.user.displayName
            || JSON.stringify(refreshed.user.roles) !== JSON.stringify(session.user.roles)) {
            throw new ApiError("Private archive access changed. Check access again.", {
              status: 403, code: "ARCHIVE_UNAVAILABLE",
            });
          }
          onSessionRefresh(refreshed, session);
        } catch (refreshFailure) {
          // An obsolete read cannot replace or clear a newer session/creator owner.
          if (ownsSession()) {
            onAccessFailure([401, 403].includes(refreshFailure?.status) ? refreshFailure
              : new ApiError("Private archive access could not be checked.", {
                status: 403, code: "ARCHIVE_UNAVAILABLE",
              }));
          }
          throw refreshFailure;
        }
      } else if (method !== "uploadMedia" && ownsSession() && [401, 403].includes(failure?.status)) {
        onAccessFailure(failure);
      }
      throw failure;
    }
  }
  return Object.freeze({
    createTextContribution: (payload, options) => call("createCoupleTextContribution", [{ ...payload, guestName: null }], options),
    createMediaContribution: (payload, options) => call("createCoupleMediaContribution", [{ ...payload, guestName: null }], options),
    getReceipt: (contributionId, options) => call("getCoupleReceipt", [contributionId], options),
    authorizeUpload: (contributionId, memoryId, options) => call("authorizeCoupleUpload", [contributionId, memoryId], options),
    finalizeUpload: (contributionId, memoryId, grantId, options) => call("finalizeCoupleUpload", [contributionId, memoryId, grantId], options),
    // This direct transfer uses the already issued grant and the exact original Blob.
    uploadMedia: (grant, file, options) => call("uploadMedia", [grant, file], options),
  });
}
