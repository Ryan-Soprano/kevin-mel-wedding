import { LocalAudioProbe, validateLocalAudio, MAX_BYTES, MAX_SECONDS } from './probe-model.js';

const element = id => document.getElementById(id);
const phaseCopy = {
  idle: 'Ready. Choose Start recording when you want to test the microphone.',
  unsupported: 'Recording is unavailable here. Open the approved HTTPS staging address, or choose an existing audio file or written note.',
  requesting: 'Waiting for your microphone permission. Nothing has been recorded yet.',
  recording: 'Recording on this device. Choose Stop recording when you finish.',
  stopping: 'Microphone stopped. Finishing the local clip…',
  checking: 'Checking the actual audio bytes and duration on this device…',
  ready: 'Local audio is ready. Use the player to listen, then discard it.',
  denied: 'Microphone access was denied or blocked. Allow it in browser settings and try again, or choose an existing audio file or written note.',
  unavailable: 'The microphone or recorder could not start. Try again, choose an existing audio file, or use a written note.',
  interrupted: 'Recording was interrupted and discarded. Return to this page and start a new test, or choose a fallback.',
  rejected: 'This local clip could not be accepted. Discard it and try another short recording or audio file.',
};
const errorCopy = { BYTE_LIMIT: 'The clip exceeds 25,000,000 bytes and was discarded.',
  DURATION_LIMIT: 'The decoded clip exceeds two minutes and was discarded.', EMPTY: 'The clip contains no audio bytes.',
  DECODE_FAILED: 'This browser could not decode the audio bytes. Try another recording or file.',
  DECODE_UNSUPPORTED: 'Local byte decoding is unsupported in this browser. Use a written note and record this result.' };
const checks = [ ['permission', 'Permission allow and deny paths'], ['recordStop', 'Start, stop and microphone indicator off'],
  ['replay', 'Listen: audio is audible and replay works'], ['discard', 'Discard: player clears and microphone stays off'],
  ['fallback', 'Existing-file fallback and written-note link'], ['interruption', 'Lock/background interruption and clear recovery'],
  ['limits', 'Two-minute / 25 MB boundaries'], ['accessibility', 'Screen-reader announcements and focus'] ];
for (const [id, label] of checks) {
  const wrapper = document.createElement('label'); wrapper.textContent = label;
  const select = document.createElement('select'); select.id = 'check-' + id;
  for (const value of ['not tested', 'pass', 'fail']) { const option = document.createElement('option'); option.textContent = value; select.append(option); }
  wrapper.append(select); element('checks').append(wrapper);
}
const ua = navigator.userAgent;
const match = ua.match(/(?:CriOS|Chrome)\/([\d.]+)/) || ua.match(/Version\/([\d.]+).*Safari/);
element('browser-version').value = match ? (ua.includes('Chrome') || ua.includes('CriOS') ? 'Chrome ' : 'Safari ') + match[1] : '';
let previousPhase; let lastClipEvidence = null; const exports = new Set();
const probe = new LocalAudioProbe({ Recorder: window.MediaRecorder,
  requestStream: navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices), secure: window.isSecureContext,
  validate: blob => validateLocalAudio(blob, window.AudioContext || window.webkitAudioContext),
  createUrl: blob => URL.createObjectURL(blob), revokeUrl: url => URL.revokeObjectURL(url), onChange: render });
function report() {
  return { spike: 'AUD-01', timestampUtc: new Date().toISOString(), environment: element('environment').value,
    deviceModel: element('device').value.trim(), osVersion: element('os-version').value.trim(),
    browserVersion: element('browser-version').value.trim(), secureContext: window.isSecureContext,
    recordingApiAvailable: probe.supported, limits: { maxSeconds: MAX_SECONDS, maxBytes: MAX_BYTES },
    localAudioOnly: true, uploaded: false, phase: probe.phase, events: probe.snapshot().events,
    lastValidatedClip: lastClipEvidence, manualObservations: Object.fromEntries(checks.map(([id]) => [id, element('check-' + id).value])),
    acceptance: 'Preparation evidence only; actual iPhone Safari and Android Chrome HTTPS acceptance remains required' };
}
function render(snapshot) {
  element('start').disabled = !snapshot.supported || ['requesting', 'recording', 'stopping', 'checking'].includes(snapshot.phase);
  element('stop').disabled = snapshot.phase !== 'recording'; element('file').disabled = ['requesting', 'recording', 'stopping', 'checking'].includes(snapshot.phase);
  element('status').textContent = (phaseCopy[snapshot.phase] || '') + (snapshot.errorCode && errorCopy[snapshot.errorCode] ? ' ' + errorCopy[snapshot.errorCode] : '');
  const audio = element('audio');
  if (snapshot.clip) {
    if (audio.getAttribute('src') !== snapshot.clip.url) audio.src = snapshot.clip.url;
    lastClipEvidence = { ...snapshot.clip.evidence };
    element('clip-info').textContent = `${snapshot.clip.evidence.decodedDurationSeconds.toFixed(1)} seconds · ${snapshot.clip.evidence.byteSize.toLocaleString()} bytes · ${snapshot.clip.evidence.containerFromBytes}. Declared MIME is recorded separately; no production format is approved.`;
  } else if (audio.hasAttribute('src')) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
  element('playback').hidden = !snapshot.clip;
  if (['ready', 'denied', 'unavailable', 'interrupted', 'rejected'].includes(snapshot.phase) && snapshot.phase !== previousPhase) element('status').focus();
  previousPhase = snapshot.phase; element('report').textContent = JSON.stringify(report(), null, 2);
}
element('support').textContent = probe.supported ? 'Recording APIs are present. Actual recording bytes and replay still need this test.' : 'Recording APIs or a secure context are unavailable. The local-file and written-note fallbacks remain below.';
element('start').addEventListener('click', () => void probe.start());
element('stop').addEventListener('click', () => probe.stop());
element('discard').addEventListener('click', () => {
  probe.discard(); element('file').value = ''; element(probe.supported ? 'start' : 'file').focus();
});
element('download-clip').addEventListener('click', () => {
  if (!probe.clip) return;
  const extension = { WAV: 'wav', 'MP4 family': 'mp4', Ogg: 'ogg', WebM: 'webm' }[probe.clip.evidence.containerFromBytes] || 'bin';
  const link = document.createElement('a'); link.href = probe.clip.url; link.download = 'aud01-synthetic-test.' + extension; link.click();
  probe.events.push({ event: 'local-synthetic-clip-download-clicked' });
  element('status').textContent = 'Local test-clip download requested. Transfer it yourself; this page has not uploaded or submitted it.';
  element('report').textContent = JSON.stringify(report(), null, 2);
});
element('file').addEventListener('change', () => void probe.useFile(element('file').files[0]));
element('audio').addEventListener('error', () => {
  if (!probe.clip || !element('audio').error) return;
  element('status').textContent = 'The player could not replay this clip. Record replay as fail, then discard or try a fallback.';
  element('status').focus();
});
element('download').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(report(), null, 2)], { type: 'application/json' })); exports.add(url);
  const link = document.createElement('a'); link.href = url; link.download = 'aud01-technical-results.json'; link.click();
  setTimeout(() => { URL.revokeObjectURL(url); exports.delete(url); }, 1000);
});
document.addEventListener('change', () => { element('report').textContent = JSON.stringify(report(), null, 2); });
document.addEventListener('visibilitychange', () => { if (document.hidden) probe.interrupt(); });
window.addEventListener('pagehide', () => { probe.dispose(); for (const url of exports) URL.revokeObjectURL(url); exports.clear(); });
setInterval(() => {
  const seconds = probe.phase === 'recording' ? Math.min(MAX_SECONDS, Math.floor((performance.now() - probe.startedAt) / 1000)) : Math.floor(probe.elapsedSeconds || 0);
  element('timer').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} / 2:00`;
}, 250);
render(probe.snapshot());
