import { ApiError } from "../../../shared/api/apiClient.js";

/** Reuse upload coordinators through authenticated routes only; never expose a guest fallback. */
export function createCoupleSubmissionApi({ api, getSession, isCurrent = () => true, onAccessFailure = () => {} }) {
  const denied = () => new ApiError("Private archive access must be checked again.", { status: 401, code: "AUTH_REQUIRED" });
  async function call(method, args, options = {}) {
    const session = getSession();
    if (!isCurrent() || !session?.authenticated) throw denied();
    try {
      const result = await api[method](...args, { ...options, csrfToken: session.csrfToken });
      if (!isCurrent()) throw new ApiError("The private draft was cleared.", { code: "REQUEST_ABORTED", unknownOutcome: true });
      return result;
    } catch (failure) {
      // Signed storage grant expiry is an item-level retry, not an account failure.
      if (method !== "uploadMedia" && isCurrent() && [401, 403].includes(failure?.status)) onAccessFailure(failure);
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
