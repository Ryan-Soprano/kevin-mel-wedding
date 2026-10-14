import { ApiError, contractMismatch, parseRetryAfter } from "./apiClient.js";
import { csrf, decodeGrant, decodeReceipt, id, key, normalizeMediaContribution, normalizeTextContribution } from "./archiveContracts.js";

/** Guest and couple contribution scopes share the original-file upload lifecycle. */
export function createContributionApi({ client, uploadFetch }) {
  const receiptRequest = (path, options, expectedId) => client.request(path, {
    ...options,
    decode(value) {
      const receipt = decodeReceipt(value);
      if (receipt.contributionId !== expectedId) throw contractMismatch();
      return receipt;
    },
  });
  return {
    createCoupleTextContribution(payload, { idempotencyKey, csrfToken, signal } = {}) {
      const body = normalizeTextContribution(payload);
      if (body.guestName !== null) throw new TypeError("Private memories do not have a guest name.");
      return client.request("/api/memories/contributions", {
        method: "POST", body, headers: { ...csrf(csrfToken), "Idempotency-Key": key(idempotencyKey) }, statuses: [200, 201], signal,
        decode(value) {
          const receipt = decodeReceipt(value);
          if (receipt.memories[0].memoryType !== "TEXT") throw contractMismatch();
          return receipt;
        },
      });
    },
    createCoupleMediaContribution(payload, { idempotencyKey, csrfToken, signal } = {}) {
      const body = normalizeMediaContribution(payload);
      if (body.guestName !== null) throw new TypeError("Private memories do not have a guest name.");
      return client.request("/api/memories/contributions", {
        method: "POST", body, headers: { ...csrf(csrfToken), "Idempotency-Key": key(idempotencyKey) }, statuses: [200, 201], signal,
        decode(value) {
          const receipt = decodeReceipt(value);
          if (receipt.memories.length !== body.items.length || receipt.memories.some(memory => memory.memoryType !== body.memoryType
            || !body.items.some(item => item.clientItemId === memory.clientItemId))) throw contractMismatch();
          return receipt;
        },
      });
    },
    getCoupleReceipt(contributionId, { idempotencyKey, signal } = {}) {
      return receiptRequest("/api/memories/contributions/" + id(contributionId) + "/receipt", {
        headers: { "Idempotency-Key": key(idempotencyKey) }, signal,
      }, contributionId);
    },
    authorizeCoupleUpload(contributionId, memoryId, { idempotencyKey, csrfToken, signal } = {}) {
      return client.request("/api/memories/contributions/" + id(contributionId) + "/memories/" + id(memoryId) + "/upload-grants", {
        method: "POST", headers: { ...csrf(csrfToken), "Idempotency-Key": key(idempotencyKey) }, statuses: [201], decode: decodeGrant, signal,
      });
    },
    finalizeCoupleUpload(contributionId, memoryId, grantId, { idempotencyKey, csrfToken, signal } = {}) {
      return receiptRequest("/api/memories/contributions/" + id(contributionId) + "/memories/" + id(memoryId) + "/finalize", {
        method: "POST", body: { grantId: id(grantId) }, headers: { ...csrf(csrfToken), "Idempotency-Key": key(idempotencyKey) }, signal,
      }, contributionId);
    },
    createTextContribution(payload, { idempotencyKey, signal } = {}) {
      return client.request("/api/contributions", {
        method: "POST", body: normalizeTextContribution(payload),
        headers: { "Idempotency-Key": key(idempotencyKey) }, statuses: [200, 201], signal,
        decode(value) {
          const receipt = decodeReceipt(value);
          if (receipt.memories[0].memoryType !== "TEXT") throw contractMismatch();
          return receipt;
        },
      });
    },
    createMediaContribution(payload, { idempotencyKey, signal } = {}) {
      const body = normalizeMediaContribution(payload);
      return client.request("/api/contributions", {
        method: "POST", body, headers: { "Idempotency-Key": key(idempotencyKey) },
        statuses: [200, 201], signal,
        decode(value) {
          const receipt = decodeReceipt(value);
          if (receipt.memories.length !== body.items.length
            || receipt.memories.some((memory) => memory.memoryType !== body.memoryType
              || !body.items.some((item) => item.clientItemId === memory.clientItemId))) throw contractMismatch();
          return receipt;
        },
      });
    },
    getReceipt(contributionId, { idempotencyKey, signal } = {}) {
      return receiptRequest("/api/contributions/" + id(contributionId) + "/receipt", {
        headers: { "Idempotency-Key": key(idempotencyKey) }, signal,
      }, contributionId);
    },
    authorizeUpload(contributionId, memoryId, { idempotencyKey, signal } = {}) {
      return client.request("/api/contributions/" + id(contributionId) + "/memories/"
        + id(memoryId) + "/upload-grants", {
        method: "POST", headers: { "Idempotency-Key": key(idempotencyKey) },
        statuses: [201], decode: decodeGrant, signal,
      });
    },
    async uploadMedia(grant, file, { signal } = {}) {
      decodeGrant(grant);
      if (Date.parse(grant.expiresAt) <= Date.now()) {
        throw new ApiError("The upload link expired. Request a new link for this item.", {
          code: "UPLOAD_GRANT_EXPIRED", status: 410,
        });
      }
      let response;
      try {
        response = await uploadFetch(grant.uploadUrl, {
          method: "PUT", headers: grant.headers, body: file,
          credentials: "omit", redirect: "error", signal,
        });
      } catch (cause) {
        throw new ApiError("The file transfer could not be confirmed. Retry this item.", {
          code: "UPLOAD_FAILED", unknownOutcome: true, cause,
        });
      }
      if (!response.ok) throw new ApiError("The file was not uploaded. Retry this item.", {
        code: [401, 403].includes(response.status) ? "UPLOAD_GRANT_EXPIRED" : "UPLOAD_FAILED",
        status: response.status,
        retryAfterSeconds: parseRetryAfter(response.headers.get("Retry-After")),
      });
      return { transferred: true };
    },
    finalizeUpload(contributionId, memoryId, grantId, { idempotencyKey, signal } = {}) {
      return receiptRequest("/api/contributions/" + id(contributionId) + "/memories/"
        + id(memoryId) + "/finalize", {
        method: "POST", body: { grantId: id(grantId) },
        headers: { "Idempotency-Key": key(idempotencyKey) }, signal,
      }, contributionId);
    },
  };
}
