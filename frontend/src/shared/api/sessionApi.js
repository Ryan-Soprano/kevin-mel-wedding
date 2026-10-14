import { csrf, decodeSession } from "./archiveContracts.js";

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
    logout({ csrfToken, signal } = {}) {
      return client.request("/api/session", {
        method: "DELETE", headers: csrf(csrfToken), statuses: [204], signal,
      });
    },
  };
}
