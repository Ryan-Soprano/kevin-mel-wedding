import test from "node:test";
import assert from "node:assert/strict";
import { createInboxController } from "./inboxController.js";
import { ApiError } from "../../../shared/api/apiClient.js";
import { ANONYMOUS_SESSION, COUPLE_SESSION, MEMORY_DETAIL, IDS } from "../../../shared/api/v1/fixtures.js";

const copy = value => structuredClone(value);
const pending = () => ({ ...copy(COUPLE_SESSION), passwordChangeRequired: true });
const completed = () => ({ ...copy(COUPLE_SESSION), csrfToken: "synthetic-new-password-session-token" });
const credentials = () => ({ currentPassword: "synthetic temporary password", newPassword: "a different synthetic password" });
function fixture(initial = pending(), options = {}) {
  const calls = [];
  let session = initial;
  const api = {
    getSession: async () => { calls.push("session"); return copy(session); },
    login: async () => { calls.push("login"); return copy(session); },
    listMemories: async () => { calls.push("list"); return { items: [copy(MEMORY_DETAIL)], nextCursor: null }; },
    getMemory: async () => { calls.push("memory"); return copy(MEMORY_DETAIL); },
    createCoupleTextContribution: async () => { calls.push("create"); },
    changePassword: async (value, options) => {
      calls.push({ change: copy(value), csrf: options.csrfToken }); session = completed(); return copy(session);
    },
    logout: async () => { calls.push("logout"); session = copy(ANONYMOUS_SESSION); },
  };
  return { calls, api, controller: createInboxController({ api, ...options }), setSession: value => { session = value; } };
}

for (const entry of ["loadSession", "login", "resume"]) {
  test(`${entry} routes a pending account before any inbox, detail, or creator request`, async () => {
    const f = fixture(), phases = [];
    f.controller.subscribe(s => phases.push(s.phase));
    try {
      if (entry === "resume") f.controller.suspend();
      await f.controller[entry](credentials());
      const state = f.controller.getSnapshot();
      assert.equal(state.phase, "password-change"); assert.equal(state.session.authenticated, true);
      assert.equal(state.session.passwordChangeRequired, true); assert.deepEqual(state.session.user.roles, ["COUPLE"]);
      assert.deepEqual(state.items, []); assert.equal(state.detail, null);
      assert.ok(!phases.includes("inbox")); assert.ok(!f.calls.includes("list"));
      await f.controller.loadInbox(); await f.controller.openMemory(IDS.text); f.controller.beginCreation();
      assert.equal(f.controller.getSnapshot().phase, "password-change");
      assert.ok(!f.calls.includes("list") && !f.calls.includes("memory") && !f.calls.includes("create"));
    } finally { f.controller.dispose(); }
  });
}

test("a foreground-required flag clears private presentation and invalidates a retained creator", async () => {
  const f = fixture(copy(COUPLE_SESSION));
  try {
    await f.controller.loadSession(); f.controller.beginCreation();
    const retained = f.controller.getCreationApi();
    f.setSession(pending()); await f.controller.recheckSession();
    assert.equal(f.controller.getSnapshot().phase, "password-change"); assert.deepEqual(f.controller.getSnapshot().items, []);
    await assert.rejects(retained.createTextContribution({ message: "synthetic" }), { code: "AUTH_REQUIRED" });
    assert.ok(!f.calls.includes("create"));
  } finally { f.controller.dispose(); }
});

test("only a confirmed rotated session opens the inbox and credentials never enter snapshots", async () => {
  const f = fixture(), snapshots = [];
  f.controller.subscribe(s => snapshots.push(s));
  try {
    await f.controller.loadSession();
    const supplied = Object.freeze(credentials());
    await f.controller.changePassword(supplied);
    assert.equal(f.controller.getSnapshot().phase, "inbox");
    assert.equal(f.controller.getSnapshot().session.csrfToken, completed().csrfToken);
    assert.equal(f.controller.getSnapshot().session.passwordChangeRequired, false);
    assert.deepEqual(f.calls, ["session", { change: credentials(), csrf: COUPLE_SESSION.csrfToken }, "list"]);
    for (const snapshot of snapshots) {
      const value = JSON.stringify(snapshot);
      assert.ok(!value.includes(supplied.currentPassword) && !value.includes(supplied.newPassword));
    }
  } finally { f.controller.dispose(); }
});

for (const failure of [new ApiError("lost", { unknownOutcome: true }), new ApiError("race", { status: 409, code: "PASSWORD_CHANGE_CONFLICT" })]) {
  test(`uncertain ${failure.code} never sends a second password write, even after a pending session recheck`, async () => {
    const f = fixture(); let writes = 0;
    f.api.changePassword = async () => { writes++; throw failure; };
    try {
      await f.controller.loadSession(); await f.controller.changePassword(credentials());
      assert.equal(f.controller.getSnapshot().passwordChange.phase, "uncertain");
      await f.controller.changePassword(credentials()); await f.controller.loadSession(); await f.controller.changePassword(credentials());
      assert.equal(writes, 1); assert.equal(f.controller.getSnapshot().phase, "password-change");
      assert.equal(f.controller.getSnapshot().passwordChange.phase, "uncertain"); assert.ok(!f.calls.includes("list"));
      f.setSession(completed()); await f.controller.loadSession();
      assert.equal(f.controller.getSnapshot().phase, "inbox");
    } finally { f.controller.dispose(); }
  });
}

test("wrong current password keeps the required-change session with a safe error and no archive request", async () => {
  const f = fixture();
  f.api.changePassword = async () => { throw new ApiError("never echo this server text", { status: 401, code: "INVALID_CREDENTIALS" }); };
  try {
    await f.controller.loadSession(); await f.controller.changePassword(credentials());
    const state = f.controller.getSnapshot();
    assert.equal(state.phase, "password-change"); assert.equal(state.passwordChange.phase, "idle");
    assert.match(state.error, /temporary password was not accepted/); assert.doesNotMatch(state.error, /server text/);
    assert.ok(!f.calls.includes("list")); await f.controller.logout();
    assert.equal(f.controller.getSnapshot().phase, "login"); assert.ok(f.calls.includes("logout"));
  } finally { f.controller.dispose(); }
});

test("an unchanged CSRF token cannot confirm a password change", async () => {
  const f = fixture(); f.api.changePassword = async () => copy(COUPLE_SESSION);
  try {
    await f.controller.loadSession(); await f.controller.changePassword(credentials());
    assert.equal(f.controller.getSnapshot().passwordChange.phase, "uncertain"); assert.ok(!f.calls.includes("list"));
  } finally { f.controller.dispose(); }
});

test("password Retry-After blocks another write until the countdown expires while sign-out stays available", async () => {
  let time = 0, nextTimer = 0, writes = 0;
  const timers = new Map();
  const f = fixture(pending(), { now: () => time,
    setTimeoutImpl: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, at: time + delay }); return id; },
    clearTimeoutImpl: id => timers.delete(id) });
  const advance = ms => { time += ms; for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.callback(); } };
  f.api.changePassword = async () => { writes++; if (writes === 1) throw new ApiError("limited", { status: 429, code: "RATE_LIMITED", retryAfterSeconds: 3 }); return completed(); };
  try {
    await f.controller.loadSession(); await f.controller.changePassword(credentials());
    assert.equal(f.controller.getSnapshot().loginRetryAfterSeconds, 3);
    await f.controller.changePassword(credentials()); assert.equal(writes, 1);
    advance(1000); assert.equal(f.controller.getSnapshot().loginRetryAfterSeconds, 2);
    await f.controller.changePassword(credentials()); assert.equal(writes, 1);
    advance(2000); assert.equal(f.controller.getSnapshot().loginRetryAfterSeconds, 0);
    await f.controller.changePassword(credentials()); assert.equal(writes, 2);
    assert.equal(f.controller.getSnapshot().phase, "inbox");
  } finally { f.controller.dispose(); }
  const signedOut = fixture();
  signedOut.api.changePassword = async () => { throw new ApiError("limited", { status: 429, retryAfterSeconds: 30 }); };
  try {
    await signedOut.controller.loadSession(); await signedOut.controller.changePassword(credentials());
    await signedOut.controller.logout(); assert.equal(signedOut.controller.getSnapshot().phase, "login");
  } finally { signedOut.controller.dispose(); }
});

test("a known completed password change is not mislabeled failed when the following inbox read fails", async () => {
  const f = fixture(); f.api.listMemories = async () => { throw new ApiError("read failed"); };
  try {
    await f.controller.loadSession(); await f.controller.changePassword(credentials());
    const state = f.controller.getSnapshot(); assert.equal(state.session.passwordChangeRequired, false);
    assert.equal(state.phase, "inbox"); assert.match(state.error, /password was changed/);
  } finally { f.controller.dispose(); }
});

test("page hiding during a password write preserves uncertainty across BFCache resume and discards a late response", async () => {
  const f = fixture(); let resolve;
  f.api.changePassword = () => new Promise(yes => { resolve = yes; });
  try {
    await f.controller.loadSession(); const write = f.controller.changePassword(credentials());
    await new Promise(yes => setTimeout(yes, 0)); f.controller.suspend(); await write;
    await f.controller.resume(); assert.equal(f.controller.getSnapshot().passwordChange.phase, "uncertain");
    resolve(completed()); await Promise.resolve();
    assert.equal(f.controller.getSnapshot().phase, "password-change"); assert.ok(!f.calls.includes("list"));
  } finally { f.controller.dispose(); }
});
