# Voice memories — AUD-02 / AUD-03

The guest recorder and file picker share the existing private intent → grant →
PUT → finalize → committed receipt lifecycle. An authorized private inbox reviewer
can play or download the verified original, Keep/Archive/Restore/Delete it, and
include it in console export and isolated restore. Original bytes are preserved;
there is no transcription, editing or public playback.

## Admission and runtime

On October 14, 2026, Ryan explicitly requested that the audio option be made
available on the existing Render service. This supersedes the October 9 deferral
for audio enablement; physical-device acceptance and live audio verification
remain separately tracked.

Both gates retain explicit opt-in defaults. Build the guest and private creation
UI with `VITE_AUDIO_ENABLED=true`, and enable new server audio admission with
`MEMORY_ARCHIVE_AUDIO_ENABLED=true`; private storage must also be configured and
enabled, uploads unpaused, and reservation capacity available. The build flag is
public configuration, never a secret. The Docker build accepts
`--build-arg VITE_AUDIO_ENABLED=true`; its default is `false`. Rebuild the frontend
when changing this flag; a runtime-only change cannot expose the audio option.

The October 14 Render configuration enables both flags. Configuration and a
successful deployment do not establish a recorded clip's upload, finalization or
private playback; record those results separately when verified.

The runtime needs `ffmpeg` and `ffprobe`. The Docker image and Linux CI install
the Ubuntu package. Local tests also require both executables on PATH, or explicit
`MEMORY_ARCHIVE_FFMPEG` and `MEMORY_ARCHIVE_FFPROBE` absolute paths. Keep binaries
outside Git and update them with the host/image's security maintenance. The
[FFmpeg download page](https://ffmpeg.org/download.html) links supported platform
packages; verify a downloaded archive against its publisher's checksum.

The verifier runs fixed argument arrays without a shell. Only file/pipe protocols
and the accepted demuxers are allowed; MOV external data references stay disabled.
Each process has a 20-second deadline, one codec thread, a 64 MiB single-allocation
limit, bounded output, a minimal environment without app secrets, and private
temporary storage. The existing media-finalization concurrency limit also covers
audio. Deployments must measure concurrent full-limit decoding on their selected
memory/CPU plan before opening collection. Decoder diagnostics, private originals,
signed URLs and retry capabilities must not enter logs or analytics.

The [v1 contract](../api/v1/README.md#media-authorization-transfer-and-finalize)
owns MIME, codec, duration, size and retry rules. Switching admission off preserves
same-key intent replay, existing unexpired permissions, finalization and accepted
private playback. It prevents new intents and newly issued audio permissions.
The independent upload pause and reservation budgets still apply.

## Guest and reviewer behavior

Recording starts only after a guest presses Record. Stop/replay/discard and a file
fallback are available. The recorder stops before the two-minute server boundary;
permission denial, unsupported browsers and interruptions have recovery guidance.
Microphone tracks stop before upload and when capture ends or the page leaves.
Stopped originals, their checksum and one retry identity stay in memory for a
deliberate retry. Refresh or closing the tab discards an unsaved local draft.

A PUT alone never means saved. The form requires a valid COMPLETE receipt after
verification, and reconciles the retained receipt/grant before resending bytes.
The private inbox rechecks current couple/reveal authority before issuance. It
fetches signed originals without app credentials/referrers, checks exact size,
MIME and SHA-256, then exposes a temporary Blob for playback/original download.
An unsupported player offers download. Owned URLs and private state are cleared
on the existing inbox lifecycle boundaries. Issued signed URLs remain bearer
permissions until expiry; logout does not revoke an already issued permission.

Console recovery uses V9 bundle v2 for verified audio metadata. Legacy V8 bundle
v1 note/photo imports remain supported by the reviewed V9 target. Follow the
[recovery runbook](operator-recovery.md) and independent deletion-ledger safeguards.
Before upgrading the decoder runtime, verify restores from retained packages:
decoded duration must still match the saved millisecond metadata exactly.

## Verification boundary

See the [dated verification record](../api/v1/audio-verification.md) for automated
evidence and the retained physical/provider acceptance checks.

Automated checks use synthetic FFmpeg tones, disposable PostgreSQL, storage
adapters and recorder/browser mocks. They exercise supported containers, codec and
stream rejection, corruption/truncation, hash and byte limits, decoded duration,
retry identity, gated admission, authenticated playback, review and audio
export/restore/deletion replay. They establish implementation behavior and do not
replace physical device or real-R2 acceptance.

The October 14 enablement instruction does not complete AUD-01 device/browser
acceptance. Record actual microphone permission, interruptions, stop/replay,
native files, container/codec compatibility, and the full phone recording → saved
receipt → private playback or download → export byte comparison. Verify real R2
exact-size signing, CORS, expiry/recovery, inaccessible public objects, capacity
and hosted decoder deadlines. Physical-phone and live audio IO passes remain
unclaimed until that evidence exists; the historical automated verification
record remains unchanged.

## Audio form structure and local verification — October 19, 2026

`AudioForm` keeps the public prop defaults, form shell and saved result.
`useAudioForm` owns the existing capture/submission references, effects, draft
state, retry locks, interruption and completion actions. `AudioCompose` renders
the unsaved controls without adding a DOM wrapper. The controller bodies and
their ordering were moved intact; capture, validation and upload coordinators
retain their existing implementations.

An isolated intended source snapshot passes all **504 frontend tests**, ESLint
and the production build on Node 24.16.0. Two cases added to the existing private
creation test file cover controller-free server rendering, private attribution,
recording guidance, fallback controls, retained-clip locks and caption ARIA. No
new test files were added. Independent source review found no actionable issue.

Headless Chromium compares the merged baseline and refactored component using
deterministic injected capture/submission owners at 1280, 390 and 320 px widths.
All **36 mounted cases**, **422 assertions** and **18 baseline comparisons** pass,
covering normalized DOM, controls, focus and lifecycle traces across capture,
fallback, recovery, guest/private completion and hide/unmount states. The run
records 198 snapshots and 18 screenshots; desktop and narrow samples were
visually inspected. Another 107 ownership/completion/source audit checks pass;
all 144 factory owners are disposed exactly once. Source hashes remain stable,
including the separate `guestFlow.js` edit excluded from this increment. Reports
and harnesses remain ignored under `logs/audio-form-refactor.local/` and
`frontend/audio-form-refactor.local/`; owned browser/server resources are closed.
These component checks use synthetic owners and make no microphone, codec,
upload, persistence, physical-device or provider acceptance claim.
