# Voice-memory verification — AUD-02 / AUD-03

Audio implementation is gated pending physical-device and provider acceptance.
The [audio runbook](../../runbooks/voice-memories.md) owns runtime/admission controls;
the [v1 API contract](README.md#media-authorization-transfer-and-finalize) owns
format, size, duration and retry behavior.

## Automated evidence — October 9

The final clean local backend suite ran 305 tests with zero failures/errors: 304
passed and the existing actual-symlink case skipped for Windows privilege. This
includes SDK checks for the final one-second signing margin and actual PUT expiry
response. Final-head Linux CI provides the integrated final revision gate.
Frontend validation passes 265 tests without failures/skips, ESLint, enabled and
default-off production builds, and a clean production dependency audit.

Real FFmpeg synthetic tones exercise WebM/Opus, Ogg/Opus and MP4/AAC. Twenty-five
verifier cases cover unchanged originals, wrong container/codec/hash/size,
truncation and Ogg framing, video/additional streams/channels, the two-minute
boundary in all three formats, streaming WebM just beyond the cap, interior
timestamp-gap counting and rejection without a duration header, missing runtime,
and real hanging/overflowing subprocesses. Timeout/overflow tests hold the
private original open and verify process termination before file/directory removal.

Linux CI exposed an extra 7 ms of startup silence from `first_pts=0` on FFmpeg 6
WebM/Opus. Removing that option retains `aresample=async=1` for interior gaps and
the unchanged strict PCM cap. Windows FFmpeg 9 and the packaged Linux FFmpeg 6
both pass the boundary and gap regressions. Originals remain unchanged. See the
[FFmpeg resampler option documentation](https://www.ffmpeg.org/ffmpeg-resampler.html).

Disposable PostgreSQL HTTP/service checks cover committed AUDIO metadata and
receipts, server duration independent of the client claim, same-key conflicts and
recovery, failed integrity, storage/runtime failures, concurrent finalization,
capacity and admission pauses, publication-before-commit rollback, restart with
admission disabled, actual synthetic couple login, private playback, review/delete/
restore, and account revocation. SDK checks bind exact audio size/MIME/key/method,
verify private HEAD before GET, and retain both requested and five-minute actual
signature expiry bounds.

Recovery/retention integration covers exact originals and metadata for all three
containers, unfinished/failed media counts, changed hash and rehashed duration
rejection, current independent audio deletion replay, absent erased-key
reservations, genuine V8/v1 imports into V9, v1 AUDIO rejection and v2-to-V8
rejection. Existing note/photo cases remain passing.

The combined Docker image builds with guest audio disabled. Thirteen checks against
its actual nonroot Linux JRE/FFmpeg runtime verify supported originals, hash
rejection, exact boundaries and decoded streaming/timestamp-gap duration caps,
with network disabled. The
isolated 2 GB app smoke also passes staging access/assets, private text commit/
retry/concurrency, SQL/bcrypt couple sessions, Secure cookies, CSRF/logout/account
revocation, restart and persisted login caps. Its temporary resources are removed;
it does not access R2 or the retained development database.

## Remaining acceptance

An interactive browser preview was attempted but the browser helper failed to
initialize twice with a missing kernel-assets path. No interactive UI pass is
claimed. Recorder controller, API/recovery, guest gates, verified inbox integrity,
private lifecycle cleanup and review behavior have automated coverage.

Physical Android/iPhone microphone, permission denial, interruption, accessibility,
native file/codec compatibility and same-original replay/download/export remain
the retained AUD-01/AUD-02/AUD-03 acceptance work. Real R2 audio PUT/GET/CORS,
exact-size permission behavior, private bucket settings, hosted decoder capacity
and representative recovery timing remain open. Audio admission stays off until
those release checks are deliberately completed. No provider change, paid resource,
deployment or production-readiness claim is made by these automated checks.
