// AUD-01 feasibility only: local memory, no submission/storage/network adapter.
export const MAX_BYTES = 25_000_000;
export const MAX_SECONDS = 120;
export const MIME_CANDIDATES = [
  'audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4',
  'audio/ogg;codecs=opus', 'audio/webm',
];

export function recordingSupport(Recorder, requestStream, secure) {
  return Boolean(secure && Recorder && requestStream);
}

export function containerFromBytes(bytes) {
  const ascii = (start, length) => String.fromCharCode(...bytes.slice(start, start + length));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') return 'WAV';
  if (ascii(4, 4) === 'ftyp') return ascii(8, 4) === 'qt  ' ? 'QuickTime family' : 'MP4 family';
  if (ascii(0, 4) === 'OggS') return 'Ogg';
  if (ascii(0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return 'MP3/ADTS family';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    // Read the EBML DocType element (0x4282), not a filename or declared MIME claim.
    for (let i = 4; i < Math.min(bytes.length - 7, 128); i++) {
      if (bytes[i] === 0x42 && bytes[i + 1] === 0x82 && bytes[i + 2] === 0x84
          && ascii(i + 3, 4) === 'webm') return 'WebM';
    }
    return 'EBML family (DocType unconfirmed)';
  }
  return 'Unidentified container';
}

export class ProbeError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export async function validateLocalAudio(blob, AudioContextType) {
  if (!blob.size) throw new ProbeError('EMPTY');
  if (blob.size > MAX_BYTES) throw new ProbeError('BYTE_LIMIT');
  if (!AudioContextType) throw new ProbeError('DECODE_UNSUPPORTED');
  const header = new Uint8Array(await blob.slice(0, 65_536).arrayBuffer());
  const context = new AudioContextType();
  try {
    const encoded = await blob.arrayBuffer();
    const digest = globalThis.crypto?.subtle ? await globalThis.crypto.subtle.digest('SHA-256', encoded) : null;
    const checksumSha256 = digest ? Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') : 'unavailable';
    const decoded = await context.decodeAudioData(encoded);
    if (!Number.isFinite(decoded.duration) || decoded.duration <= 0) throw new ProbeError('DECODE_FAILED');
    if (decoded.duration > MAX_SECONDS) throw new ProbeError('DURATION_LIMIT');
    return { byteSize: blob.size, blobReportedMime: blob.type || 'not reported',
      containerFromBytes: containerFromBytes(header), localDecode: 'pass',
      checksumSha256,
      decodedDurationSeconds: Number(decoded.duration.toFixed(6)), channels: decoded.numberOfChannels,
      sampleRateHz: decoded.sampleRate, formatPolicy: 'Not approved; requires mobile and server verification' };
  } catch (error) {
    if (error instanceof ProbeError) throw error;
    throw new ProbeError('DECODE_FAILED');
  } finally { await context.close().catch(() => {}); }
}

export class LocalAudioProbe {
  constructor({ Recorder, requestStream, secure, validate, createUrl, revokeUrl,
    now = () => performance.now(), schedule = (callback, milliseconds) => setTimeout(callback, milliseconds),
    cancel = timer => clearTimeout(timer), onChange = () => {} }) {
    Object.assign(this, { Recorder, requestStream, validate, createUrl, revokeUrl, now, schedule, cancel, onChange });
    this.supported = recordingSupport(Recorder, requestStream, secure);
    this.phase = this.supported ? 'idle' : 'unsupported'; this.events = []; this.generation = 0;
    this.clip = null; this.recorder = null; this.stream = null; this.timer = null; this.chunks = [];
  }
  snapshot() { return { phase: this.phase, supported: this.supported, clip: this.clip,
    errorCode: this.errorCode, events: [...this.events], elapsedSeconds: this.elapsedSeconds || 0 }; }
  change(phase, code) {
    this.phase = phase; this.errorCode = code;
    this.events.push({ event: phase, ...(code ? { code } : {}) });
    this.onChange(this.snapshot());
  }
  releaseTracks() {
    this.cancel(this.timer); this.timer = null;
    for (const track of this.stream?.getTracks() || []) {
      track.removeEventListener('ended', this.trackEnded); track.stop();
    }
    this.stream = null;
  }
  clearClip() { if (this.clip) this.revokeUrl(this.clip.url); this.clip = null; }
  discard() {
    this.generation++; this.clearClip(); this.chunks = [];
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.recorder = null; this.releaseTracks(); this.elapsedSeconds = 0;
    this.change(this.supported ? 'idle' : 'unsupported');
  }
  async start() {
    if (!this.supported || ['requesting', 'recording', 'checking', 'stopping'].includes(this.phase)) return;
    this.discard(); const generation = this.generation; this.change('requesting');
    try {
      // This is the only microphone request; the UI calls it from an explicit button click.
      const stream = await this.requestStream({ audio: true, video: false });
      if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      let recorder; let requestedMime = 'browser default';
      for (const type of MIME_CANDIDATES) {
        if (!this.Recorder.isTypeSupported?.(type)) continue;
        try { recorder = new this.Recorder(stream, { mimeType: type }); requestedMime = type; break; }
        catch { /* A supported hint may still fail when allocating the recorder. */ }
      }
      recorder ||= new this.Recorder(stream);
      this.recorder = recorder; this.requestedMime = requestedMime;
      this.recorderMime = recorder.mimeType || 'not reported'; this.chunks = []; this.bytes = 0;
      this.trackEnded = () => { if (generation === this.generation) this.interrupt('TRACK_ENDED'); };
      stream.getTracks().forEach(track => track.addEventListener('ended', this.trackEnded));
      recorder.ondataavailable = ({ data }) => {
        if (generation !== this.generation || !data.size) return;
        this.bytes += data.size;
        if (this.bytes > MAX_BYTES) { this.interrupt('BYTE_LIMIT'); return; }
        this.chunks.push(data);
        if (this.now() - this.startedAt >= MAX_SECONDS * 1000 && this.phase === 'recording') this.stop();
      };
      recorder.onerror = () => { if (generation === this.generation) this.interrupt('RECORDER_ERROR'); };
      recorder.onstop = () => {
        if (generation !== this.generation) return;
        if (this.phase === 'recording') {
          this.elapsedSeconds = (this.now() - this.startedAt) / 1000;
          this.events.push({ event: 'recorder-ended-without-stop-click' });
        }
        const blob = new Blob(this.chunks, { type: recorder.mimeType || this.chunks[0]?.type || '' });
        this.chunks = []; this.recorder = null; this.releaseTracks();
        void this.checkClip(blob, 'recording', generation);
      };
      this.startedAt = this.now(); recorder.start(1000); this.change('recording');
      // Leave encoder finishing time before the strict decoded 120-second acceptance limit.
      this.timer = this.schedule(() => this.stop(), (MAX_SECONDS - 1) * 1000);
    } catch (error) {
      if (generation !== this.generation) return;
      this.releaseTracks(); this.recorder = null;
      this.change(error.name === 'NotAllowedError' || error.name === 'SecurityError' ? 'denied' : 'unavailable');
    }
  }
  stop() {
    if (this.phase !== 'recording') return;
    this.elapsedSeconds = (this.now() - this.startedAt) / 1000;
    this.cancel(this.timer); this.timer = null; this.change('stopping');
    if (this.recorder?.state !== 'inactive') this.recorder.stop();
    this.releaseTracks();
  }
  interrupt(code = 'PAGE_HIDDEN') {
    if (!['recording', 'requesting', 'stopping', 'checking'].includes(this.phase)) return;
    this.discard(); this.change(code === 'BYTE_LIMIT' ? 'rejected' : 'interrupted', code);
  }
  async useFile(blob) {
    this.discard(); const generation = this.generation;
    if (blob) await this.checkClip(blob, 'existing file', generation);
  }
  async checkClip(blob, source, generation) {
    this.change('checking');
    try {
      const evidence = await this.validate(blob);
      if (generation !== this.generation) return;
      this.clip = { url: this.createUrl(blob), evidence: { source, ...evidence,
        ...(source === 'recording' ? { requestedRecorderMime: this.requestedMime,
          recorderReportedMime: this.recorderMime, captureWallSeconds: Number(this.elapsedSeconds.toFixed(3)) } : {}) } };
      this.change('ready');
    } catch (error) {
      if (generation !== this.generation) return;
      this.change('rejected', error instanceof ProbeError ? error.code : 'DECODE_FAILED');
    }
  }
  dispose() { this.discard(); }
}
