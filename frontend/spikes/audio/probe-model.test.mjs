import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { LocalAudioProbe, ProbeError, validateLocalAudio, measureDecodedSignal, MAX_BYTES, containerFromBytes } from './probe-model.js';

function fixture(options = {}) {
  const track = { kind: 'audio', enabled: true, muted: false, readyState: 'live',
    stops: 0, listeners: new Map(), stop() { this.stops++; },
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
const decodedAudio = (channels, duration = 1) => ({ duration, numberOfChannels: channels.length,
  sampleRate: 48000, getChannelData: channel => Float32Array.from(channels[channel]) });

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

test('muted live tracks remain recording and final evidence precedes owned track shutdown', async () => {
  const f = fixture();
  f.track.label = 'Private microphone label'; f.track.id = 'private-device-id';
  f.track.stop = function () { this.stops++; this.readyState = 'ended'; };
  await f.probe.start();
  f.track.muted = true; f.track.listeners.get('mute')();
  assert.equal(f.probe.phase, 'recording'); assert.equal(f.track.stops, 0);
  assert.deepEqual(f.probe.events.find(event => event.event === 'track-muted').trackStates,
    [{ kind: 'audio', enabled: true, muted: true, readyState: 'live' }]);
  f.track.muted = false; f.track.listeners.get('unmute')();
  f.track.muted = true; f.track.listeners.get('mute')();
  f.probe.stop(); await settle();
  assert.equal(f.track.readyState, 'ended'); assert.equal(f.track.listeners.size, 0);
  assert.deepEqual(f.probe.clip.evidence.initialTrackStates,
    [{ kind: 'audio', enabled: true, muted: false, readyState: 'live' }]);
  assert.deepEqual(f.probe.clip.evidence.finalTrackStates,
    [{ kind: 'audio', enabled: true, muted: true, readyState: 'live' }]);
  assert.ok(f.probe.events.some(event => event.event === 'track-unmuted'));
  assert.doesNotMatch(JSON.stringify(f.probe.snapshot()), /Private microphone|private-device-id|deviceId|settings|label/);
});

test('stale mute and unmute callbacks cannot add events to a new recording attempt', async () => {
  const f = fixture(); await f.probe.start();
  const muted = f.track.listeners.get('mute'); const unmuted = f.track.listeners.get('unmute');
  f.probe.discard(); assert.equal(f.track.listeners.size, 0);
  await f.probe.start(); const eventsBefore = f.probe.events.length;
  muted(); unmuted();
  assert.equal(f.probe.events.length, eventsBefore); assert.equal(f.probe.phase, 'recording');
  f.probe.discard();
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
    async decodeAudioData() { return decodedAudio([[0.125, -0.125]], 120); }
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

test('decoded digital silence has exact zero measurements and finite JSON-safe dBFS floor', () => {
  const signal = measureDecodedSignal(decodedAudio([[0, -0, 0], [0, 0, 0]]));
  assert.equal(signal.peakAmplitude, 0); assert.equal(signal.rmsAmplitude, 0);
  assert.equal(signal.allZeroSamples, true); assert.equal(signal.lowSignal, true);
  assert.equal(signal.peakDbfs, -160); assert.equal(signal.rmsDbfs, -160);
  assert.equal(signal.dbfsFloor, -160); assert.equal(signal.measuredChannels, 2);
  assert.equal(signal.measuredSamples, 6);
  assert.match(signal.interpretation, /heuristic/);
  assert.ok(Object.values(signal).every(value => typeof value !== 'number' || Number.isFinite(value)));
});

test('voice-level synthetic PCM measures peak and RMS across every channel', () => {
  const signal = measureDecodedSignal(decodedAudio([[0.5, -0.5], [0.25, -0.25]]));
  assert.equal(signal.peakAmplitude, 0.5);
  assert.ok(Math.abs(signal.rmsAmplitude - Math.sqrt(0.15625)) < 1e-12);
  assert.ok(Math.abs(signal.peakDbfs - 20 * Math.log10(0.5)) < 1e-12);
  assert.ok(Math.abs(signal.rmsDbfs - 20 * Math.log10(Math.sqrt(0.15625))) < 1e-12);
  assert.equal(signal.allZeroSamples, false); assert.equal(signal.lowSignal, false);
  assert.equal(signal.lowSignalThresholdDbfs, -60);
  assert.doesNotMatch(JSON.stringify(signal), /channelData|samples":|Float32Array/);
});

test('one silent channel does not hide an active channel, while low nonzero PCM stays distinct', () => {
  const stereo = measureDecodedSignal(decodedAudio([[0, 0], [0.25, -0.25]]));
  assert.equal(stereo.allZeroSamples, false); assert.equal(stereo.lowSignal, false);
  assert.equal(stereo.peakAmplitude, 0.25);
  assert.ok(Math.abs(stereo.rmsAmplitude - Math.sqrt(0.03125)) < 1e-12);
  const quiet = measureDecodedSignal(decodedAudio([[0.0001, -0.0001]]));
  assert.equal(quiet.allZeroSamples, false); assert.equal(quiet.lowSignal, true);
  assert.ok(quiet.rmsDbfs < quiet.lowSignalThresholdDbfs);
});

test('non-finite samples in any decoded channel are rejected', () => {
  for (const sample of [NaN, Infinity, -Infinity]) {
    assert.throws(() => measureDecodedSignal(decodedAudio([[0, 0], [0.25, sample]])),
      error => error instanceof ProbeError && error.code === 'DECODE_FAILED');
  }
});

test('silent valid clips remain replayable with an offline decoder lacking close', async () => {
  class OfflineDecoder {
    async decodeAudioData() { return decodedAudio([[0, 0], [0, 0]]); }
  }
  const accepted = await validateLocalAudio(new Blob(['synthetic']), OfflineDecoder);
  assert.equal(accepted.localDecode, 'pass'); assert.equal(accepted.signal.allZeroSamples, true);
  assert.equal(accepted.signal.lowSignal, true);
});

test('decoder cleanup failures do not replace a signal result or non-finite validation failure', async () => {
  const blob = new Blob(['synthetic']);
  class ThrowingCleanup {
    async decodeAudioData() { return decodedAudio([[0.25, -0.25]]); }
    close() { throw new Error('private cleanup detail'); }
  }
  assert.equal((await validateLocalAudio(blob, ThrowingCleanup)).signal.lowSignal, false);
  class RejectedCleanup extends ThrowingCleanup {
    close() { return Promise.reject(new Error('private cleanup detail')); }
  }
  assert.equal((await validateLocalAudio(blob, RejectedCleanup)).signal.lowSignal, false);
  class InvalidDecoded extends ThrowingCleanup {
    async decodeAudioData() { return decodedAudio([[NaN]]); }
  }
  await assert.rejects(validateLocalAudio(blob, InvalidDecoded),
    error => error instanceof ProbeError && error.code === 'DECODE_FAILED');
});
