const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ApiError extends Error {
  constructor(message, {
    code = "HTTP_ERROR",
    status = 0,
    requestId = null,
    fieldErrors = [],
    retryAfterSeconds = null,
    unknownOutcome = false,
    cause,
  } = {}) {
    super(message, { cause });
    this.name = "ApiError";
    Object.assign(this, {
      code, status, requestId, fieldErrors, retryAfterSeconds, unknownOutcome,
    });
  }
}

export function contractMismatch(status = 0) {
  return new ApiError("The server returned an unexpected response. Your work is still here.", {
    code: "CONTRACT_MISMATCH", status, unknownOutcome: true,
  });
}

export function parseRetryAfter(value) {
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number.isSafeInteger(Number(value)) ? Number(value) : null;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : null;
}

function safeRequestId(value) {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

/** A same-origin JSON transport. Mutations are never retried automatically. */
export function createApiClient({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required.");

  return {
    async request(path, {
      method = "GET", body, headers = {}, signal, statuses = [200], decode,
    } = {}) {
      if (!path.startsWith("/api/") || path.includes("\\") || path.includes("#")) {
        throw new TypeError("API requests must use a /api/ path.");
      }
      const requestHeaders = new Headers({
        Accept: "application/json",
        "X-Api-Contract": "1",
        ...headers,
      });
      if (body !== undefined) requestHeaders.set("Content-Type", "application/json");
      const mutation = !["GET", "HEAD"].includes(method);
      let response;
      try {
        response = await fetchImpl(path, {
          method,
          headers: requestHeaders,
          credentials: "same-origin",
          cache: "no-store",
          body: body === undefined ? undefined : JSON.stringify(body),
          signal,
        });
      } catch (cause) {
        throw new ApiError(
          cause?.name === "AbortError" ? "The request was cancelled." : "Could not reach the server. Your work is still here.",
          {
            code: cause?.name === "AbortError" ? "REQUEST_ABORTED" : "NETWORK_ERROR",
            unknownOutcome: mutation,
            cause,
          },
        );
      }

      let payload;
      if (response.status !== 204) {
        try {
          if (!response.headers.get("Content-Type")?.includes("application/json")) {
            throw new Error("Expected JSON.");
          }
          payload = await response.json();
        } catch {
          if (response.ok) {
            const error = contractMismatch(response.status);
            error.unknownOutcome = mutation;
            throw error;
          }
        }
      }

      if (!response.ok) {
        const error = payload?.error;
        const structured = typeof error?.code === "string" && typeof error?.message === "string";
        const wait = parseRetryAfter(response.headers.get("Retry-After"));
        throw new ApiError(
          structured ? error.message : "The request could not be completed. Please try again.",
          {
            code: structured ? error.code : "HTTP_ERROR",
            status: response.status,
            requestId: safeRequestId(error?.requestId) ?? safeRequestId(response.headers.get("X-Request-ID")),
            fieldErrors: Array.isArray(error?.fieldErrors)
              ? error.fieldErrors.filter((field) => typeof field?.field === "string"
                && typeof field?.code === "string" && typeof field?.message === "string")
              : [],
            retryAfterSeconds: wait,
            unknownOutcome: mutation && response.status >= 500,
          },
        );
      }
      if (!statuses.includes(response.status)) {
        const error = contractMismatch(response.status);
        error.unknownOutcome = mutation;
        throw error;
      }
      try {
        return decode ? decode(payload, response) : payload;
      } catch (error) {
        if (error instanceof ApiError && error.code === "CONTRACT_MISMATCH") {
          error.status = response.status;
          error.unknownOutcome = mutation;
        }
        throw error;
      }
    },
  };
}
