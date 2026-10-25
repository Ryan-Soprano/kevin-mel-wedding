import { csrf, decodeSession } from "./archiveContracts.js";
import { contractMismatch } from "./apiClient.js";

export function createSessionApi({ client }) {
  return {
    getSession({ signal } = {}) {
      return client.request("/api/session", { decode: decodeSession, signal });
    },
    login(credentials, { csrfToken, signal } = {}) {
      return client.request("/api/session", {
        method: "POST", body: credentials, headers: csrf(csrfToken),
        decode: decodeSession, signal,
      });
    },
    changePassword(credentials, { csrfToken, signal } = {}) {
      return client.request("/api/session/password", {
        method: "POST", body: credentials, headers: csrf(csrfToken), signal,
        decode(value) {
          const session = decodeSession(value);
          if (!session.authenticated || value.passwordChangeRequired !== false) throw contractMismatch();
          return session;
        },
      });
    },
    logout({ csrfToken, signal } = {}) {
      return client.request("/api/session", {
        method: "DELETE", headers: csrf(csrfToken), statuses: [204], signal,
      });
    },
  };
}
