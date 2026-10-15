import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers";
import { AudioCaptureError, createAudioCapture, validateAudioFile } from "./audioCapture.js";
import { audioCollectionEnabled } from "./audioConstraints.js";

const turn = () => new Promise(resolve => setImmediate(resolve));
const clip = new File(["synthetic audio bytes"], "message.webm", { type: "audio/webm;codecs=opus" });
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
function fixture(overrides = {}) {
  const timers = new Map(), created = [], revoked = [], states = [];
  let timerId = 0, permissionRequests = 0, stopped = 0, elapsed = 0;
  const listeners = new Map();
  const track = { addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: type => listeners.delete(type), stop: () => stopped++ };
  const stream = { getTracks: () => [track] };
  class Recorder {
    static isTypeSupported = type => type === "audio/webm;codecs=opus";
    constructor(incoming, options) { assert.equal(incoming, stream); this.mimeType = options?.mimeType ?? "audio/webm"; this.state = "inactive"; Recorder.latest = this; }
    start(timeslice) { assert.equal(timeslice, 1000); this.state = "recording"; }
    stop() { this.state = "inactive"; }
    finish(blob = clip) { this.ondataavailable({ data: blob }); this.onstop(); }
  }
  const capture = createAudioCapture({ Recorder, secure: true,
    requestStream: async constraints => { permissionRequests++; assert.deepEqual(constraints, { audio: true, video: false }); return stream; },
    validate: async file => ({ file: new File([file], file.name, { type: "audio/webm" }), durationSeconds: 6.7 }),
    now: () => elapsed,
    setTimeoutImpl: (callback, milliseconds) => { const id = ++timerId; timers.set(id, { callback, milliseconds }); return id; },
    clearTimeoutImpl: id => timers.delete(id),
    createUrl: file => { created.push(file); return "blob:voice-" + created.length; },
    revokeUrl: url => revoked.push(url), onChange: state => states.push(state), ...overrides,
  });
  return { capture, Recorder, stream, timers, created, revoked, states, listeners,
    get permissionRequests() { return permissionRequests; }, get stopped() { return stopped; },
    set elapsed(value) { elapsed = value; },
    fire(milliseconds) {
      const [id, timer] = [...timers].find(([, value]) => value.milliseconds === milliseconds) ?? [];
      assert.ok(timer, "Expected timer " + milliseconds); timers.delete(id); timer.callback();
    },
  };
}

test("collection gate requires the exact true string and stays off by default", () => {
  for (const value of [undefined, null, true, "TRUE", "false", "1", " true "]) assert.equal(audioCollectionEnabled(value), false);
  assert.equal(audioCollectionEnabled("true"), true);
});

test("microphone request is explicit; stop releases tracks before local checking and retains original bytes", async () => {
  const f = fixture();
  assert.equal(f.permissionRequests, 0);
  await f.capture.start();
  assert.equal(f.permissionRequests, 1); assert.equal(f.capture.getSnapshot().phase, "recording");
  f.elapsed = 6700; f.capture.stop();
  assert.equal(f.stopped, 1); assert.equal(f.capture.getSnapshot().phase, "stopping");
  f.Recorder.latest.finish(); await turn();
  const ready = f.capture.getSnapshot();
  assert.equal(ready.phase, "ready"); assert.equal(ready.clip.durationSeconds, 6.7);
  assert.deepEqual(new Uint8Array(await ready.clip.file.arrayBuffer()), new Uint8Array(await clip.arrayBuffer()));
  assert.equal(ready.clip.file.type, "audio/webm"); assert.equal(f.timers.size, 0);
  f.capture.discard(); assert.deepEqual(f.revoked, ["blob:voice-1"]); assert.equal(f.capture.getSnapshot().clip, null);
});

test("automatic stop leaves encoding room within two minutes and stalled finishing releases resources", async () => {
  const f = fixture(); await f.capture.start(); f.elapsed = 119000; f.fire(119000);
  assert.equal(f.capture.getSnapshot().phase, "stopping"); assert.equal(f.stopped, 1);
  f.fire(5000);
  assert.equal(f.capture.getSnapshot().errorCode, "RECORDER_ERROR"); assert.equal(f.timers.size, 0);
  f.Recorder.latest.finish(); await turn(); assert.equal(f.created.length, 0);
});

test("permission denial gives a file/note fallback without leaking a stream or requesting again", async () => {
  const denied = Object.assign(new Error("private browser message"), { name: "NotAllowedError" });
  const f = fixture({ requestStream: async () => { throw denied; } });
  await f.capture.start(); assert.equal(f.capture.getSnapshot().errorCode, "PERMISSION_DENIED");
  assert.equal(f.timers.size, 0); assert.equal(JSON.stringify(f.capture.getSnapshot()).includes("private browser"), false);
  await f.capture.useFile(clip); assert.equal(f.capture.getSnapshot().phase, "ready");
});

test("late permission after timeout or page interruption stops its tracks and cannot create a recording", async () => {
  for (const timeout of [false, true]) {
    const permission = deferred(); const f = fixture({ requestStream: () => permission.promise });
    const request = f.capture.start();
    if (timeout) f.fire(30000); else f.capture.interrupt();
    permission.resolve(f.stream); await request;
    assert.equal(f.stopped, 1); assert.equal(f.Recorder.latest, undefined);
    assert.equal(f.capture.getSnapshot().errorCode, timeout ? "PERMISSION_TIMEOUT" : "INTERRUPTED");
  }
});

test("hidden/disposed capture, ended track, unsolicited recorder stop and excessive bytes cannot retain partial clips", async () => {
  for (const action of [f => f.capture.interrupt(), f => f.capture.dispose(), f => f.listeners.get("ended")(),
    f => f.Recorder.latest.onstop(), f => f.Recorder.latest.ondataavailable({ data: new Blob([new Uint8Array(25_000_001)]) })]) {
    const f = fixture(); await f.capture.start(); action(f);
    f.Recorder.latest.finish(); await turn();
    assert.equal(f.created.length, 0); assert.equal(f.timers.size, 0); assert.ok(f.stopped >= 1);
    assert.equal(f.capture.getSnapshot().clip, null);
  }
});

test("late local decode cannot replace a newer file and reset/dispose revoke every owned preview", async () => {
  const first = deferred(); let checks = 0;
  const f = fixture({ validate: async file => ++checks === 1 ? first.promise : { file: new File([file], "next.ogg", { type: "audio/ogg" }), durationSeconds: 1 } });
  const old = f.capture.useFile(clip); await f.capture.useFile(clip);
  first.resolve({ file: new File([clip], "old.webm", { type: "audio/webm" }), durationSeconds: 2 }); await old;
  assert.equal(f.capture.getSnapshot().clip.file.name, "next.ogg"); assert.equal(f.created.length, 1);
  await f.capture.useFile(clip); assert.deepEqual(f.revoked, ["blob:voice-1"]);
  f.capture.dispose(); assert.deepEqual(f.revoked, ["blob:voice-1", "blob:voice-2"]);
});

test("unsupported recording still permits an existing file and does not ask for microphone access", async () => {
  const f = fixture({ secure: false }); await f.capture.start(); assert.equal(f.permissionRequests, 0);
  assert.equal(f.capture.getSnapshot().phase, "unsupported");
  await f.capture.useFile(clip); assert.equal(f.capture.getSnapshot().phase, "ready");
});

test("local validation bounds input, checks real decoded duration, preserves bytes and closes context", async () => {
  let contexts = 0, closed = 0, duration = 2.125;
  class Context { constructor() { contexts++; } decodeAudioData() { return Promise.resolve({ duration }); } close() { closed++; } }
  const accepted = await validateAudioFile(clip, { AudioContextType: Context });
  assert.equal(accepted.file.type, "audio/webm"); assert.equal(accepted.durationSeconds, duration);
  assert.deepEqual(new Uint8Array(await accepted.file.arrayBuffer()), new Uint8Array(await clip.arrayBuffer()));
  for (const seconds of [0, Infinity, 120.001]) {
    duration = seconds; await assert.rejects(validateAudioFile(clip, { AudioContextType: Context }), AudioCaptureError);
  }
  for (const bad of [new File([], "empty.webm", { type: "audio/webm" }), new File([clip], "mismatched.ogg", { type: "video/mp4" }),
    new File([new Uint8Array(25_000_001)], "large.ogg", { type: "audio/ogg" })]) {
    await assert.rejects(validateAudioFile(bad, { AudioContextType: Context }), { code: "FILE_INVALID" });
  }
  assert.equal(contexts, 4); assert.equal(closed, 4);
});

test("a browser-labeled WebM reaches ready with canonical audio metadata and unchanged original bytes", async () => {
  const original = new File(["synthetic audio-only fixture"], "browser-labeled.webm", { type: "video/webm" });
  let decoded, closed = 0;
  class Context {
    decodeAudioData(bytes) { decoded = bytes; return Promise.resolve({ duration: 3 }); }
    close() { closed++; }
  }
  const f = fixture({ validate: file => validateAudioFile(file, { AudioContextType: Context }) });
  await f.capture.useFile(original);
  const ready = f.capture.getSnapshot();
  assert.equal(ready.phase, "ready");
  assert.equal(ready.clip.file.type, "audio/webm");
  assert.equal(ready.clip.file.name, original.name);
  assert.equal(ready.clip.durationSeconds, 3);
  assert.equal(original.type, "video/webm");
  assert.deepEqual(new Uint8Array(decoded), new Uint8Array(await original.arrayBuffer()));
  assert.deepEqual(new Uint8Array(await ready.clip.file.arrayBuffer()), new Uint8Array(await original.arrayBuffer()));
  assert.equal(f.created[0], ready.clip.file);
  assert.equal(closed, 1);
  f.capture.dispose();
});

test("local decoder timeout settles even if decoding or context cleanup never settles", async () => {
  let expire, closeCalls = 0;
  class Context { decodeAudioData() { return new Promise(() => {}); } close() { closeCalls++; return new Promise(() => {}); } }
  const checking = validateAudioFile(clip, { AudioContextType: Context,
    setTimeoutImpl: callback => { expire = callback; return 1; }, clearTimeoutImpl: () => {} });
  await turn(); expire(); await assert.rejects(checking, { code: "DECODE_TIMEOUT" }); assert.equal(closeCalls, 1);
});
