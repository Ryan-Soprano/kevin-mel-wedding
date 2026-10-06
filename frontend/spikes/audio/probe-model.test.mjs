import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { LocalAudioProbe, ProbeError, validateLocalAudio, MAX_BYTES, containerFromBytes } from './probe-model.js';

function fixture(options = {}) {
  const track = { stops: 0, listeners: new Map(), stop() { this.stops++; },
    addEventListener(name, listener) { this.listeners.set(name, listener); },
    removeEventListener(name) { this.listeners.delete(name); } };
  const stream = { getTracks: () => [track] }; let requests = 0; let validations = 0; let created = 0;
  const revoked = []; const timers = []; let currentTime = 0;
  class Recorder {
    static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }
    constructor(_stream, config) { this.mimeType = config?.mimeType || 'audio/webm'; this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.emit(new Blob(['synthetic'], { type: this.mimeType })); this.onstop?.(); }
    emit(data) { this.ondataavailable?.({ data }); }
  }
  const probe = new LocalAudioProbe({ Recorder, secure: true,
    requestStream: async () => { requests++; return stream; },
    validate: async blob => { validations++; return { byteSize: blob.size, decodedDurationSeconds: 1, localDecode: 'pass' }; },
    createUrl: () => { created++; return 'blob:synthetic-' + created; }, revokeUrl: url => revoked.push(url),
    now: () => currentTime, schedule: callback => { timers.push(callback); return timers.length; }, cancel: () => {}, ...options });
  return { probe, track, stream, timers, setTime: value => { currentTime = value; },
    counts: () => ({ requests, validations, created, revoked }) };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('default timers invoke browser globals without the probe as their receiver', async t => {
  t.mock.method(globalThis, 'setTimeout', function () { assert.ok(this === undefined || this === globalThis); return 42; });
  t.mock.method(globalThis, 'clearTimeout', function () { assert.ok(this === undefined || this === globalThis); });
  const f = fixture({ schedule: undefined, cancel: undefined });
  await f.probe.start(); assert.equal(f.probe.phase, 'recording'); f.probe.stop(); await settle();
  assert.equal(f.track.stops, 1); assert.equal(f.probe.phase, 'ready');
});

test('construction and existing-file fallback never request the microphone', async () => {
  const f = fixture({ Recorder: undefined });
  assert.equal(f.probe.phase, 'unsupported'); await f.probe.start();
  await f.probe.useFile(new Blob(['synthetic']));
  assert.equal(f.counts().requests, 0); assert.equal(f.probe.phase, 'ready');
  f.probe.discard(); assert.deepEqual(f.counts().revoked, ['blob:synthetic-1']);
});

test('permission denial is explicit and allows a later explicit retry', async () => {
  let requests = 0;
  const f = fixture({ requestStream: async () => { requests++; throw Object.assign(new Error(), { name: 'NotAllowedError' }); } });
  await f.probe.start(); assert.equal(f.probe.phase, 'denied');
  await f.probe.start(); assert.equal(requests, 2); assert.equal(f.counts().created, 0);
});

test('discard while permission is pending releases a later granted stream', async () => {
  let resolveStream;
  const f = fixture({ requestStream: () => new Promise(resolve => { resolveStream = resolve; }) });
  const started = f.probe.start(); assert.equal(f.probe.phase, 'requesting');
  f.probe.discard(); resolveStream(f.stream); await started;
  assert.equal(f.track.stops, 1); assert.equal(f.probe.phase, 'idle'); assert.equal(f.counts().created, 0);
});

test('stop releases tracks and waits for byte validation before exposing replay', async () => {
  let finishValidation;
  const f = fixture({ validate: () => new Promise(resolve => { finishValidation = resolve; }) });
  await f.probe.start(); assert.equal(f.counts().requests, 1);
  f.setTime(2500); f.probe.stop(); assert.equal(f.track.stops, 1);
  assert.equal(f.probe.phase, 'checking'); assert.equal(f.counts().created, 0);
  finishValidation({ byteSize: 9, decodedDurationSeconds: 2.5, containerFromBytes: 'WebM' }); await settle();
  assert.equal(f.probe.phase, 'ready'); assert.equal(f.probe.clip.evidence.requestedRecorderMime, 'audio/webm;codecs=opus');
  f.probe.discard(); assert.deepEqual(f.counts().revoked, ['blob:synthetic-1']);
});

test('a supported MIME hint whose constructor fails falls back without format approval', async () => {
  class Recorder {
    static isTypeSupported() { return true; }
    constructor(_stream, config) { if (config) throw new Error('allocation'); this.state = 'inactive'; this.mimeType = 'audio/mp4'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable({ data: new Blob(['synthetic'], { type: 'audio/mp4' }) }); this.onstop(); }
  }
  const f = fixture({ Recorder }); await f.probe.start(); f.probe.stop(); await settle();
  assert.equal(f.probe.clip.evidence.requestedRecorderMime, 'browser default');
  assert.equal(f.probe.clip.evidence.recorderReportedMime, 'audio/mp4');
});

test('track loss and background interruption discard incomplete bytes and release tracks', async () => {
  for (const interruptedByTrack of [true, false]) {
    const f = fixture(); await f.probe.start();
    if (interruptedByTrack) f.track.listeners.get('ended')(); else f.probe.interrupt();
    await settle(); assert.equal(f.probe.phase, 'interrupted'); assert.equal(f.track.stops, 1);
    assert.equal(f.counts().validations, 0); assert.equal(f.counts().created, 0);
  }
});

test('queued callbacks from a discarded recorder cannot interrupt the next attempt', async () => {
  const f = fixture(); await f.probe.start(); const old = f.probe.recorder; const ended = f.probe.trackEnded;
  f.probe.discard(); await f.probe.start(); const current = f.probe.recorder;
  old.onerror(); ended(); await settle();
  assert.equal(f.probe.phase, 'recording'); assert.equal(f.probe.recorder, current); assert.equal(f.track.stops, 1);
  f.probe.stop(); await settle(); assert.equal(f.probe.phase, 'ready');
});

test('spontaneous recorder stop reports measured capture time instead of zero', async () => {
  const f = fixture(); await f.probe.start(); f.setTime(3500);
  f.probe.recorder.stop(); await settle();
  assert.equal(f.probe.clip.evidence.captureWallSeconds, 3.5);
  assert.ok(f.probe.events.some(event => event.event === 'recorder-ended-without-stop-click'));
  assert.equal(f.track.stops, 1);
});

test('size overflow stops capture and never validates or exposes a partial clip', async () => {
  const f = fixture(); await f.probe.start();
  f.probe.recorder.emit(new Blob([new Uint8Array(MAX_BYTES + 1)])); await settle();
  assert.equal(f.probe.phase, 'rejected'); assert.equal(f.probe.errorCode, 'BYTE_LIMIT');
  assert.equal(f.track.stops, 1); assert.equal(f.counts().validations, 0); assert.equal(f.counts().created, 0);
});

test('bounded automatic stop releases the microphone, and discard cancels a pending decode', async () => {
  let finishValidation;
  const f = fixture({ validate: () => new Promise(resolve => { finishValidation = resolve; }) });
  await f.probe.start(); f.setTime(119000); f.timers[0]();
  assert.equal(f.track.stops, 1); assert.equal(f.probe.phase, 'checking');
  f.probe.dispose(); finishValidation({ decodedDurationSeconds: 119, byteSize: 9 }); await settle();
  assert.equal(f.counts().created, 0); assert.equal(f.probe.phase, 'idle');
});

test('strict byte/decoded-duration limits and byte-derived containers ignore a MIME label', async () => {
  await assert.rejects(validateLocalAudio(new Blob([new Uint8Array(MAX_BYTES + 1)])), error => error.code === 'BYTE_LIMIT');
  const bytes = new TextEncoder().encode('RIFF0000WAVEsynthetic');
  let closed = 0;
  class Context {
    async decodeAudioData() { return { duration: 120, numberOfChannels: 1, sampleRate: 48000 }; }
    async close() { closed++; }
  }
  const accepted = await validateLocalAudio(new Blob([bytes], { type: 'audio/webm' }), Context);
  assert.equal(accepted.containerFromBytes, 'WAV'); assert.equal(accepted.blobReportedMime, 'audio/webm');
  assert.equal(accepted.checksumSha256, createHash('sha256').update(bytes).digest('hex'));
  assert.match(accepted.formatPolicy, /Not approved/); assert.equal(closed, 1);
  class TooLong extends Context { async decodeAudioData() { return { duration: 120.01 }; } }
  await assert.rejects(validateLocalAudio(new Blob([bytes]), TooLong), error => error instanceof ProbeError && error.code === 'DURATION_LIMIT');
  assert.equal(closed, 2);
  assert.equal(containerFromBytes(new Uint8Array([1, 2, 3])), 'Unidentified container');
});
