import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  OPERATIONAL_CHECKS, OPERATIONAL_STATUS_PATH, OPERATIONAL_STATUS_REF, evaluateOperationalStatus,
  parseOperationalReceiptJson, parseOperationalStatusJson, publishOperationalStatus, readOperationalReceipt,
  statusFromOperationalReceipt, validateOperationalStatus,
} from "./operational-status.mjs";
import {
  CANONICAL_HEALTH_URL, OPERATIONAL_REPOSITORY, WATCHED_CHECKS, checkCanonicalHealth, createOperationalApi,
  decodeOperationalStatusFile, decodeOperationalWatchdogState, encodeOperationalWatchdogState,
  planOperationalNotifications, readOperationalWatchdogConfiguration, runOperationalWatchdog,
} from "./operational-watchdog.mjs";

const NOW = Date.parse("2026-10-23T03:00:00.000Z");
const iso = value => new Date(value).toISOString();
function status(at = NOW, changes = {}) {
  return { schemaVersion: 1, kind: "kevin-mel-operational-status", observedAt: iso(at),
    ...Object.fromEntries(OPERATIONAL_CHECKS.map(name => [name, { checkedAt: iso(at), state: "clear" }])), failure: null, ...changes };
}
function observations(state = "clear") {
  return { ...Object.fromEntries([...OPERATIONAL_CHECKS, "observation"].map(name => [name, state])), canonical: "disabled" };
}
function env(mode = "live") {
  return { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: OPERATIONAL_REPOSITORY, GITHUB_TOKEN: "synthetic-token",
    GITHUB_RUN_ID: "123", GITHUB_EVENT_NAME: "workflow_dispatch", ARCHIVE_BACKUP_WATCHDOG_BUDGET_CONFIRMED: "true",
    ARCHIVE_BACKUP_WATCHDOG_RECIPIENT_CONFIRMED: "true", ARCHIVE_BACKUP_WATCHDOG_ISSUE: "116",
    ARCHIVE_OPERATIONAL_WATCHDOG_ENABLED: "true", ARCHIVE_OPERATIONAL_WATCHDOG_HOST_PROOF_CONFIRMED: "true",
    ARCHIVE_OPERATIONAL_WATCHDOG_MODE: mode };
}
function response(value, options) { return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" }, ...options }); }

test("operational protocol accepts only exact content-free typed evidence", () => {
  const valid = status();
  assert.deepEqual(validateOperationalStatus(valid, { now: NOW }), valid);
  const receipt = { ...valid, kind: "kevin-mel-operational-receipt" };
  assert.deepEqual(statusFromOperationalReceipt(receipt, { now: NOW }), valid);
  assert.deepEqual(parseOperationalReceiptJson(JSON.stringify(receipt), { now: NOW }), valid);
  const changes = [
    { guestCount: 1 }, { failure: "raw-secret" }, { kind: "kevin-mel-backup-status" }, { schemaVersion: "1" },
    { observedAt: "2026-10-23T03:00:00Z" }, { observedAt: "2026-10-23T03:00:00.000+00:00" },
    { observedAt: iso(NOW + 1) }, { observedAt: "2026-02-30T00:00:00.000Z" },
    { media: { checkedAt: iso(NOW), state: "healthy" } }, { media: { checkedAt: null, state: "unconfirmed" } },
    { media: { checkedAt: iso(NOW + 1), state: "clear" } },
    { media: { checkedAt: iso(NOW), state: "clear", path: "private" } }, { failure: "observation_gap" },
  ];
  for (const change of changes) assert.throws(() => validateOperationalStatus({ ...valid, ...change }, { now: NOW }));
  const withGetter = { ...valid };
  Object.defineProperty(withGetter, "failure", { enumerable: true, get() { throw new Error("must not execute"); } });
  assert.throws(() => validateOperationalStatus(withGetter, { now: NOW }));
  assert.throws(() => validateOperationalStatus({ ...valid, [Symbol("hidden")]: "private" }, { now: NOW }));
  for (const text of [JSON.stringify(valid).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
    JSON.stringify(valid).replace('"media":{', '"media":{},"m\\u0065dia":{'), "{" + " ".repeat(4096) + "}", "not-json"]) {
    assert.throws(() => parseOperationalStatusJson(text, { now: NOW }));
  }
});

test("freshness fails closed per category and global failure never appears healthy", () => {
  const expected = observations(); delete expected.canonical;
  assert.deepEqual(evaluateOperationalStatus(status(), { now: NOW }), expected);
  for (const value of [undefined, status(NOW + 1), status(NOW - 300001), { ...status(), unknown: true }]) {
    assert.ok(Object.values(evaluateOperationalStatus(value, { now: NOW })).every(item => item === "unconfirmed"));
  }
  const oldMedia = status(NOW, { media: { checkedAt: iso(NOW - 300001), state: "clear" } });
  const checked = evaluateOperationalStatus(oldMedia, { now: NOW });
  assert.equal(checked.media, "unconfirmed"); assert.equal(checked.database, "clear");
  const reset = status(NOW, { guestSaves: { checkedAt: iso(NOW), state: "unconfirmed" }, failure: "observation_gap" });
  assert.equal(evaluateOperationalStatus(reset, { now: NOW }).observation, "unconfirmed");
  assert.throws(() => evaluateOperationalStatus(status(), { now: NOW, maxAgeMs: 300001 }));
});

test("per-category incidents, reminder, simultaneous recovery and disabled probe remain independent", () => {
  const initial = planOperationalNotifications(null, observations(), NOW, "live");
  assert.equal(initial.notices.length, 0);
  const failed = observations(); failed.guestSaves = "incident"; failed.capacity = "incident";
  const incident = planOperationalNotifications(initial.state, failed, NOW + 1, "live");
  assert.deepEqual(incident.notices.map(item => item.check), ["guestSaves", "capacity"]);
  assert.equal(planOperationalNotifications(incident.state, failed, NOW + 300000, "live").notices.length, 0);
  const changed = { ...failed, guestSaves: "clear", media: "unconfirmed" };
  const mixed = planOperationalNotifications(incident.state, changed, NOW + 300000, "live");
  assert.deepEqual(mixed.notices.map(item => [item.check, item.outcome]), [["guestSaves", "recovery"], ["media", "incident"]]);
  const reminder = planOperationalNotifications(mixed.state, changed, NOW + 3600001, "live");
  assert.deepEqual(reminder.notices.map(item => item.check), ["capacity"]);
  const canonical = planOperationalNotifications(null, { ...observations(), canonical: "unconfirmed" }, NOW, "live");
  const disabled = planOperationalNotifications(canonical.state, observations(), NOW + 1, "live");
  assert.equal(disabled.state.checks.canonical.state, "unconfirmed");
  assert.equal(disabled.notices.length, 0);
  const body = encodeOperationalWatchdogState(mixed.state);
  assert.deepEqual(decodeOperationalWatchdogState(body, "live", NOW + 300000), mixed.state);
  assert.throws(() => decodeOperationalWatchdogState(body, "synthetic", NOW + 300000));
  assert.throws(() => decodeOperationalWatchdogState(body.replace('"state":"clear"', '"state":"raw"'), "live", NOW + 300000));
  assert.throws(() => decodeOperationalWatchdogState(body.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'), "live", NOW + 300000));
});

test("default off, gates, fixed issue and explicit synthetic isolation", () => {
  assert.equal(readOperationalWatchdogConfiguration({}), null);
  for (const gate of ["ARCHIVE_BACKUP_WATCHDOG_BUDGET_CONFIRMED", "ARCHIVE_BACKUP_WATCHDOG_RECIPIENT_CONFIRMED",
    "ARCHIVE_OPERATIONAL_WATCHDOG_ENABLED", "ARCHIVE_OPERATIONAL_WATCHDOG_HOST_PROOF_CONFIRMED"]) {
    assert.equal(readOperationalWatchdogConfiguration({ ...env(), [gate]: "" }), null);
  }
  for (const change of [{ GITHUB_REPOSITORY: "other/repo" }, { GITHUB_TOKEN: "raw\nvalue" },
    { ARCHIVE_BACKUP_WATCHDOG_ISSUE: "117" }, { ARCHIVE_OPERATIONAL_WATCHDOG_CANONICAL_HTTPS_ENABLED: "yes" },
    { ARCHIVE_OPERATIONAL_WATCHDOG_MODE: "synthetic-failure", GITHUB_EVENT_NAME: "schedule" }]) {
    assert.throws(() => readOperationalWatchdogConfiguration({ ...env(), ...change }));
  }
  assert.equal(readOperationalWatchdogConfiguration({ ...env("synthetic-failure"),
    ARCHIVE_OPERATIONAL_WATCHDOG_ENABLED: "", ARCHIVE_OPERATIONAL_WATCHDOG_HOST_PROOF_CONFIRMED: "" }).mode, "synthetic-failure");
  assert.equal(readOperationalWatchdogConfiguration(env()).canonicalEnabled, false);
});

test("optional canonical probe uses fixed HTTPS URL and exact public health contract", async () => {
  let calls = 0;
  const good = async (url, options) => {
    calls++; assert.equal(url, CANONICAL_HEALTH_URL); assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit"); assert.equal(options.headers.Authorization, undefined);
    return response({ status: "ok" });
  };
  assert.equal(await checkCanonicalHealth({ fetchImpl: good }), "clear");
  for (const fetchImpl of [async () => response({ status: "ok", detail: "private" }),
    async () => response({ status: "ok" }, { status: 503 }), async () => response({ status: "OK" }),
    async () => new Response('{"status":"ok","status":"ok"}', { headers: { "content-type": "application/json" } }),
    async () => new Response("x".repeat(129)), async () => { throw new Error("raw private error"); },
    async () => response({ status: "ok" }, { headers: { "content-type": "text/html" } })]) {
    assert.equal(await checkCanonicalHealth({ fetchImpl }), "unconfirmed");
  }
  assert.equal(calls, 1);
  const start = Date.now();
  assert.equal(await checkCanonicalHealth({ fetchImpl: async () => new Promise(() => {}), timeoutMs: 20 }), "unconfirmed");
  assert.ok(Date.now() - start < 1000);
});

test("remote body/header bounds and stream deadlines cover trickle and hung responses", async () => {
  for (const fetchImpl of [async () => new Promise(() => {}), async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode("{")); }, cancel() {},
  }), { headers: { "content-type": "application/json" } })]) {
    const start = Date.now();
    await assert.rejects(createOperationalApi("test", { fetchImpl, timeoutMs: 20 })(`/repos/${OPERATIONAL_REPOSITORY}`), /github_unavailable/);
    assert.ok(Date.now() - start < 1000);
  }
  const tooBig = createOperationalApi("test", { fetchImpl: async () => new Response("x".repeat(512 * 1024 + 1)), timeoutMs: 1000 });
  await assert.rejects(tooBig(`/repos/${OPERATIONAL_REPOSITORY}`), /github_unavailable/);
  const stuckCancel = createOperationalApi("test", { fetchImpl: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode("{")); }, cancel() { return new Promise(() => {}); },
  })), timeoutMs: 20 });
  const began = Date.now();
  await assert.rejects(stuckCancel(`/repos/${OPERATIONAL_REPOSITORY}`), /github_unavailable/);
  assert.ok(Date.now() - began < 1000);
});

function fakeGithub({ current = status(), comments = [], failWrite = false, privateRepo = true, issueBody = "<!-- kevin-mel-backup-watchdog:allow -->", failStatus = false } = {}) {
  const writes = []; const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.redirect, "error");
    const pathname = new URL(url).pathname;
    const root = `/repos/${OPERATIONAL_REPOSITORY}`;
    if (options.method !== "GET") {
      const body = JSON.parse(options.body).body;
      writes.push({ pathname, method: options.method, body });
      if (failWrite) return response({ message: "private provider error" }, { status: 500 });
      const id = options.method === "PATCH" ? Number(pathname.split("/").at(-1)) : 100 + writes.length;
      return response({ id, body, user: { login: "github-actions[bot]", type: "Bot" }, issue_url: `https://api.github.com${root}/issues/116` });
    }
    if (pathname === root) return response({ private: privateRepo, full_name: OPERATIONAL_REPOSITORY, owner: { login: "Ryan-Soprano" } });
    if (pathname === root + "/issues/116") return response({ number: 116, state: "open", title: "Backup watchdog operations", body: issueBody });
    if (pathname === root + "/issues/116/comments") return response(comments);
    if (pathname === root + "/contents/" + OPERATIONAL_STATUS_PATH) {
      assert.equal(new URL(url).searchParams.get("ref"), OPERATIONAL_STATUS_REF);
      if (failStatus) return response({}, { status: 404 });
      const bytes = Buffer.from(JSON.stringify(current));
      return response({ type: "file", path: OPERATIONAL_STATUS_PATH, encoding: "base64", size: bytes.length, content: bytes.toString("base64") });
    }
    throw new Error("unexpected request");
  };
  return { fetchImpl, writes, calls };
}
function stateComment(state, id = 42) {
  return { id, body: encodeOperationalWatchdogState(state), user: { login: "github-actions[bot]", type: "Bot" } };
}

test("watchdog live healthy initializes without alert; disabled canonical never fetches public app", async () => {
  const api = fakeGithub();
  assert.equal((await runOperationalWatchdog({ env: env(), fetchImpl: api.fetchImpl, now: NOW })).outcome, "initialized");
  assert.equal(api.writes.length, 1); assert.match(api.writes[0].body, /operational-watchdog-state:v1:live/);
  assert.ok(api.calls.every(call => call.url.startsWith("https://api.github.com/")));
  const noCalls = await runOperationalWatchdog({ env: {}, fetchImpl: () => { throw new Error("must not call"); }, now: NOW });
  assert.equal(noCalls.outcome, "skipped");
});

test("watchdog unknown/malformed/missing state notifies; refuses ambiguous/damaged prior state", async () => {
  for (const options of [{ failStatus: true }, { current: { ...status(), guestId: "private" } }, { current: status(NOW + 1) }, { current: status(NOW - 300001) }]) {
    const api = fakeGithub(options);
    const result = await runOperationalWatchdog({ env: env(), fetchImpl: api.fetchImpl, now: NOW });
    assert.equal(result.notifications, 6); assert.equal(api.writes.length, 2);
    assert.match(api.writes[0].body, /unconfirmed/); assert.doesNotMatch(api.writes[0].body, /guestId|private provider|originals\/|sha256/);
  }
  const previous = planOperationalNotifications(null, observations(), NOW, "live").state;
  for (const comments of [[stateComment(previous), stateComment(previous, 43)],
    [stateComment(previous)].map(item => ({ ...item, body: item.body.replace('"schemaVersion":1', '"schemaVersion":2') }))]) {
    const api = fakeGithub({ comments });
    await assert.rejects(runOperationalWatchdog({ env: env(), fetchImpl: api.fetchImpl, now: NOW }), /invalid_state/);
    assert.equal(api.writes.length, 0);
  }
});

test("notification is written before state; write failure cannot silently acknowledge incident", async () => {
  const api = fakeGithub({ failStatus: true, failWrite: true });
  await assert.rejects(runOperationalWatchdog({ env: env(), fetchImpl: api.fetchImpl, now: NOW }), /github_unavailable/);
  assert.equal(api.writes.length, 1); assert.match(api.writes[0].body, /^@Ryan-Soprano/);
  assert.doesNotMatch(api.writes[0].body, /state:v1/);
  for (const options of [{ privateRepo: false }, { issueBody: "missing opt-in" }]) {
    const refused = fakeGithub(options);
    await assert.rejects(runOperationalWatchdog({ env: env(), fetchImpl: refused.fetchImpl, now: NOW }), /configuration_error/);
    assert.equal(refused.writes.length, 0);
  }
});

test("watchdog retains source watermark and refuses replayed clear status or equal-time edits", async () => {
  const recent = status(NOW - 1000, { media: { checkedAt: iso(NOW - 1000), state: "incident" } });
  const previous = planOperationalNotifications(null, { ...observations(), media: "incident" }, NOW - 1000, "live").state;
  previous.lastStatus = recent;
  for (const current of [status(NOW - 2000), status(NOW - 1000),
    status(NOW, { media: { checkedAt: iso(NOW - 1000), state: "clear" } })]) {
    const api = fakeGithub({ current, comments: [stateComment(previous)] });
    await runOperationalWatchdog({ env: env(), fetchImpl: api.fetchImpl, now: NOW });
    assert.equal(api.writes.length, 2);
    const stored = decodeOperationalWatchdogState(api.writes[1].body, "live", NOW);
    assert.equal(stored.checks.media.state, "unconfirmed");
    assert.deepEqual(stored.lastStatus, recent);
    assert.doesNotMatch(api.writes[0].body, /\(recovery\)/);
  }
});

test("damaged state marker family cannot initialize a new clear history", async () => {
  const previous = planOperationalNotifications(null, observations("incident"), NOW - 1000, "live").state;
  const good = stateComment(previous);
  for (const body of [good.body.replace("v1:live", "v2:live"), good.body.replace(" -->\n", " -->"), " " + good.body]) {
    const api = fakeGithub({ comments: [{ ...good, body }] });
    await assert.rejects(runOperationalWatchdog({ env: env(), fetchImpl: api.fetchImpl, now: NOW }), /invalid_state/);
    assert.equal(api.writes.length, 0);
  }
});

test("live and synthetic comments never share state, and all-clear recovery is deduplicated", async () => {
  const incident = planOperationalNotifications(null, observations("incident"), NOW - 1000, "synthetic").state;
  const live = planOperationalNotifications(null, observations(), NOW - 1000, "live").state;
  const api = fakeGithub({ comments: [stateComment(incident), stateComment(live, 43)] });
  const result = await runOperationalWatchdog({ env: env("synthetic-recovery"), fetchImpl: api.fetchImpl, now: NOW });
  assert.equal(result.notifications, 6); assert.equal(api.writes[1].pathname.endsWith("/42"), true);
  assert.match(api.writes[0].body, /Synthetic operational/); assert.match(api.writes[0].body, /recovery/);
  assert.ok(!api.calls.some(call => call.url.includes("/contents/")));
  const recovered = planOperationalNotifications(incident, observations(), NOW, "synthetic").state;
  const repeat = fakeGithub({ comments: [stateComment(recovered), stateComment(live, 43)] });
  assert.equal((await runOperationalWatchdog({ env: env("synthetic-recovery"), fetchImpl: repeat.fetchImpl, now: NOW + 1 })).outcome, "unchanged");
  assert.equal(repeat.writes.length, 0);
});

function git(directory, args, input) {
  const result = spawnSync("git", ["-C", directory, ...args], { encoding: "utf8", input, maxBuffer: 65536, windowsHide: true });
  assert.equal(result.status, 0, "isolated Git command failed");
  return result.stdout.trim();
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "operational-alert-test-"));
  if (process.platform === "win32") {
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "$ErrorActionPreference='Stop';$u=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;& ($env:SystemRoot+'\\System32\\icacls.exe') $env:OP_TEST_ROOT '/inheritance:r' '/grant:r' ('*'+$u+':(OI)(CI)F') | Out-Null;exit $LASTEXITCODE"],
    { env: { ...process.env, OP_TEST_ROOT: root }, encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0);
  } else fs.chmodSync(root, 0o700);
  const repository = path.join(root, "checkout"); const remote = path.join(root, "remote.git");
  fs.mkdirSync(repository); git(repository, ["init", "-q"]);
  git(repository, ["config", "user.name", "Synthetic"]); git(repository, ["config", "user.email", "test@example.invalid"]);
  git(repository, ["init", "--bare", "-q", remote]);
  fs.writeFileSync(path.join(repository, "application.txt"), "application original\n");
  git(repository, ["add", "application.txt"]); git(repository, ["commit", "-qm", "fixture"]);
  git(repository, ["push", "--quiet", remote, "HEAD:refs/heads/fixture-app"]);
  git(repository, ["remote", "add", "origin", "https://github.com/Ryan-Soprano/kevin-mel-wedding.git"]);
  const snapshot = () => ({ head: git(repository, ["rev-parse", "HEAD"]), index: fs.readFileSync(path.join(repository, ".git", "index")).toString("hex"),
    dirty: git(repository, ["status", "--porcelain=v1"]), body: fs.readFileSync(path.join(repository, "application.txt"), "utf8") });
  let beforePush;
  const spawnImpl = (executable, args, options) => {
    assert.equal(executable, "git");
    assert.equal(options.env.GIT_TERMINAL_PROMPT, "0");
    assert.equal(options.env.GIT_NO_REPLACE_OBJECTS, "1");
    const forwarded = [...args];
    for (const command of ["ls-remote", "fetch", "push"]) {
      const at = forwarded.indexOf(command);
      if (at >= 0) {
        const origin = forwarded.indexOf("origin", at + 1); assert.ok(origin >= 0);
        forwarded[origin] = remote;
        if (command === "push" && beforePush) { const action = beforePush; beforePush = undefined; action(); }
      }
    }
    return spawnSync(executable, forwarded, options);
  };
  const publish = value => publishOperationalStatus(value, { repository, privateWorkDirectory: root, now: NOW, spawnImpl });
  const destroy = () => {
    assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith("operational-alert-test-"));
    fs.rmSync(root, { recursive: true, force: true });
  };
  return { root, repository, remote, snapshot, publish, destroy, race(action) { beforePush = action; } };
}

test("plumbing publishes one file, preserves dirty application index/HEAD and backup ref", () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.repository, "application.txt"), "staged update\n"); git(f.repository, ["add", "application.txt"]);
    fs.appendFileSync(path.join(f.repository, "application.txt"), "unstaged update\n");
    fs.writeFileSync(path.join(f.repository, "untracked.txt"), "untracked\n");
    const before = f.snapshot();
    const appHead = git(f.repository, ["rev-parse", "HEAD"]);
    git(f.repository, ["--git-dir=" + f.remote, "update-ref", "refs/heads/feature/backup-status", appHead]);
    assert.equal(f.publish(status(NOW - 1000)).published, true);
    assert.deepEqual(f.snapshot(), before);
    assert.equal(git(f.repository, ["--git-dir=" + f.remote, "ls-tree", "-r", "--name-only", OPERATIONAL_STATUS_REF]), OPERATIONAL_STATUS_PATH);
    assert.equal(git(f.repository, ["--git-dir=" + f.remote, "rev-parse", "refs/heads/feature/backup-status"]), appHead);
    assert.equal(f.publish(status()).published, true);
    assert.equal(f.publish(status()).published, false);
    assert.deepEqual(f.snapshot(), before);
    assert.throws(() => f.publish(status(NOW - 1)), /status_regression/);
    assert.throws(() => f.publish(status(NOW, { guestSaves: { checkedAt: iso(NOW), state: "incident" } })), /status_regression/);
    assert.equal(fs.readdirSync(f.root).filter(name => name.startsWith("operational-status-")).length, 0);
    assert.deepEqual(f.snapshot(), before);
  } finally { f.destroy(); }
});

test("publisher refuses an application-tree ref collision, bad origin and concurrent update without force", () => {
  const collision = fixture();
  try {
    const before = collision.snapshot();
    const head = git(collision.repository, ["rev-parse", "HEAD"]);
    git(collision.repository, ["--git-dir=" + collision.remote, "update-ref", OPERATIONAL_STATUS_REF, head]);
    assert.throws(() => collision.publish(status()), /invalid_remote_status/);
    assert.equal(git(collision.repository, ["--git-dir=" + collision.remote, "rev-parse", OPERATIONAL_STATUS_REF]), head);
    assert.deepEqual(collision.snapshot(), before);
    git(collision.repository, ["remote", "set-url", "origin", "https://example.invalid/other.git"]);
    assert.throws(() => collision.publish(status()), /origin_not_allowed/);
  } finally { collision.destroy(); }
  const race = fixture();
  try {
    race.publish(status(NOW - 2000));
    const before = race.snapshot();
    race.race(() => { race.publish(status(NOW - 1000)); });
    assert.throws(() => race.publish(status()), /git_failed/);
    const current = JSON.parse(git(race.repository, ["--git-dir=" + race.remote, "show", OPERATIONAL_STATUS_REF + ":" + OPERATIONAL_STATUS_PATH]));
    assert.equal(current.observedAt, iso(NOW - 1000));
    assert.deepEqual(race.snapshot(), before);
  } finally { race.destroy(); }
});

test("receipt file is bounded/no-follow and CLI usage cannot publish implicitly", () => {
  const f = fixture();
  try {
    const file = path.join(f.root, "receipt.json");
    fs.writeFileSync(file, JSON.stringify({ ...status(), kind: "kevin-mel-operational-receipt" }));
    assert.deepEqual(readOperationalReceipt(file, NOW), status());
    fs.writeFileSync(file, "x".repeat(4097)); assert.throws(() => readOperationalReceipt(file, NOW), /invalid_receipt/);
    const script = path.resolve("scripts/operational-status.mjs");
    const outcome = spawnSync(process.execPath, [script], { encoding: "utf8", windowsHide: true });
    assert.equal(outcome.status, 1); assert.match(outcome.stderr, /invalid_arguments/);
    assert.doesNotMatch(outcome.stderr, /[A-Z]:\\|at file:/);
  } finally { f.destroy(); }
});

test("base64 status envelope rejects wrong file, size and trailing bytes", () => {
  const bytes = Buffer.from(JSON.stringify(status()));
  const file = { type: "file", path: OPERATIONAL_STATUS_PATH, encoding: "base64", size: bytes.length, content: bytes.toString("base64") };
  assert.deepEqual(decodeOperationalStatusFile(file, { now: NOW }), status());
  for (const change of [{ size: bytes.length - 1 }, { path: "ops/backup-status.json" }, { content: file.content + "!" },
    { encoding: "raw" }, { type: "symlink" }]) assert.throws(() => decodeOperationalStatusFile({ ...file, ...change }, { now: NOW }));
  assert.deepEqual(WATCHED_CHECKS, [...OPERATIONAL_CHECKS, "observation", "canonical"]);
});
