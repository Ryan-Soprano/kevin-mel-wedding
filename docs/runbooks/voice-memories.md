# Voice memories — AUD-02 / AUD-03

The guest recorder and file picker share the existing private intent → grant →
PUT → finalize → committed receipt lifecycle. An authorized private inbox reviewer
can play or download the verified original, Keep/Archive/Restore/Delete it, and
include it in console export and isolated restore. Original bytes are preserved;
there is no transcription, editing or public playback.

## Admission and runtime

Audio remains disabled by default while AUD-01 physical phone/browser acceptance
is deferred. Build the guest UI with `VITE_AUDIO_ENABLED=true` only for a deliberate
synthetic test. Enable new server audio admission with
`MEMORY_ARCHIVE_AUDIO_ENABLED=true`; private storage must also be configured and
enabled. The build flag is public configuration, never a secret. The Docker build
accepts `--build-arg VITE_AUDIO_ENABLED=true`; its default is `false`.

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

Before opening audio collection, record AUD-01 device/browser evidence for actual
microphone permission, interruptions, stop/replay, native files, container/codec
compatibility, and the full phone recording → saved receipt → private playback or
download → export byte comparison. Verify real R2 exact-size signing, CORS,
expiry/recovery, inaccessible public objects, capacity and hosted decoder deadlines.
No physical-phone test, provider change or deployment is claimed by this slice.
