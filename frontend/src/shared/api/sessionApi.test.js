import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "./apiClient.js";
import { createArchiveApi } from "./archiveApi.js";
import { createInboxController } from "../../features/inbox/api/inboxController.js";
import { ANONYMOUS_SESSION, COUPLE_SESSION, MEMORY_DETAIL } from "./v1/fixtures.js";

const operatorSession = () => ({
  ...structuredClone(COUPLE_SESSION),
  user: { displayName: "Synthetic operator", roles: ["OPERATOR"] },
});
const json = value => new Response(JSON.stringify(value), {
  headers: { "Content-Type": "application/json" },
});
const apiReturning = value => createArchiveApi({
  client: createApiClient({ fetchImpl: async () => json(value) }),
});

test("session discovery and login retain the server-authorized operator role", async () => {
  const expected = operatorSession(), calls = [];
  const api = createArchiveApi({ client: createApiClient({ fetchImpl: async (path, options) => {
    calls.push({ path, options });
    return json(expected);
  } }) });
  assert.deepEqual(await api.getSession(), expected);
  assert.deepEqual(await api.login({ username: "synthetic-operator", password: "synthetic-password" }, {
    csrfToken: ANONYMOUS_SESSION.csrfToken,
  }), expected);
  assert.equal(calls[1].path, "/api/session");
  assert.equal(calls[1].options.method, "POST");
  assert.equal(calls[1].options.headers.get("X-CSRF-Token"), ANONYMOUS_SESSION.csrfToken);
  assert.equal(calls[1].options.credentials, "same-origin");
  assert.deepEqual(expected.user.roles, ["OPERATOR"]);
});

test("couple and anonymous session contracts remain valid", async () => {
  assert.deepEqual(await apiReturning(COUPLE_SESSION).getSession(), COUPLE_SESSION);
  assert.deepEqual(await apiReturning(ANONYMOUS_SESSION).getSession(), ANONYMOUS_SESSION);
});

for (const roles of [[], ["DEVELOPER"], ["ADMIN"], ["UNKNOWN"], ["operator"],
  ["COUPLE", "OPERATOR"], ["OPERATOR", "OPERATOR"], "OPERATOR", null]) {
  test(`session contracts reject unsupported or ambiguous roles ${JSON.stringify(roles)}`, async () => {
    const session = operatorSession();
    session.user.roles = roles;
    await assert.rejects(apiReturning(session).getSession(), { code: "CONTRACT_MISMATCH" });
  });
}

test("an operator-shaped user cannot authenticate an anonymous session", async () => {
  await assert.rejects(apiReturning({ ...operatorSession(), authenticated: false }).getSession(), {
    code: "CONTRACT_MISMATCH",
  });
});

test("the inbox uses an authenticated operator session without relabeling its authority", async () => {
  const calls = [], expected = operatorSession();
  const api = createArchiveApi({ client: createApiClient({ fetchImpl: async path => {
    calls.push(path);
    if (path === "/api/session") return json(expected);
    return json({ items: [MEMORY_DETAIL], nextCursor: null });
  } }) });
  const controller = createInboxController({ api });
  try {
    await controller.loadSession();
    const state = controller.getSnapshot();
    assert.equal(state.phase, "inbox");
    assert.equal(state.busy, false);
    assert.deepEqual(state.session.user.roles, ["OPERATOR"]);
    assert.equal(Object.isFrozen(state.session.user.roles), true);
    assert.deepEqual(state.items, [MEMORY_DETAIL]);
    assert.equal(calls.length, 2);
    assert.equal(calls[0], "/api/session");
    assert.match(calls[1], /^\/api\/memories\?/);
  } finally { controller.dispose(); }
});

test("a rejected operator session never loads private inbox entries", async () => {
  const calls = [];
  const api = createArchiveApi({ client: createApiClient({ fetchImpl: async path => {
    calls.push(path);
    return new Response(JSON.stringify({ error: { code: "ARCHIVE_UNAVAILABLE", message: "Unavailable" } }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  } }) });
  const controller = createInboxController({ api });
  try {
    await controller.loadSession();
    assert.equal(controller.getSnapshot().phase, "unavailable");
    assert.equal(controller.getSnapshot().session, null);
    assert.deepEqual(controller.getSnapshot().items, []);
    assert.deepEqual(calls, ["/api/session"]);
  } finally { controller.dispose(); }
});
