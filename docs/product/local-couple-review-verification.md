# Disposable local review runner — verification record

Prepared October 10, 2026. **Local technical preparation is verified within the scope below. Human walkthrough feedback remains pending.** These results do not close QA-02 or wedding release acceptance.

`scripts/local-review.mjs` leaves the actual packaged guest and couple application available for an interactive synthetic session, then removes only that run's owned resources. See the [review walkthrough](../runbooks/local-couple-review.md) and [QA-02 tester guide](qa02-tester-guide.md).

## Fixture and boundaries

The mandatory application argument is an existing full immutable `sha256:` image ID. PostgreSQL 17 is also pinned to an existing local image. The runner performs no image build/pull, dependency install, provider call, deployment or mutation of an existing database. Docker must resolve to a local endpoint.

Resources are a separately owned standard bridge network, a PostgreSQL tmpfs database without a host port, and a nonroot read-only application container bound to a random IPv4 loopback port. A standard bridge is used because previous Docker Desktop fixtures could not reach their published HTTP port with an internal-only bridge. This is an isolated synthetic fixture, not a claim that its bridge blocks every outbound route. An environment allowlist and disabled storage/audio/retention prevent ambient provider configuration from entering the application.

The executed seed contains exactly 25 synthetic TEXT memories created through the actual guest/couple APIs and zero media assets: 24 guest notes (eight anonymous), one couple note, 22 Pending, two Kept and one Archived. It includes unknown, year-only `2017`, month-only `2020-06` and exact-day `2024-02-29` memory/event dates; two albums sharing a note; four events linked to their corresponding notes; and three tags, one empty. Two published synthetic fixture accounts exist only inside the disposable database; this does not replace the operator console or activate real couple accounts. The unchanged login throttle applies, including the one startup sign-in per account.

The approved public 52-photo gallery is served by the existing package. Private media saving is unavailable in this storage-disabled fixture. Export checks cover notes and organization with no original-file parts; they do not establish successful original photo/audio retrieval. Any manually added unsaved photo attempt remains subject to the existing truthful UI and export exclusion rules.

## Recorded checks — October 10, 2026

| Check | Current result | Evidence |
|---|---|---|
| CLI/input and ownership helpers | Passed: 11 cases, no skips | Four new review-helper cases and seven existing rehearsal-helper cases pass. Reviewed source rejects remote Docker endpoints and image-declared volumes before fixture startup. This is not an executed test against an unrelated retained database. |
| Existing image and packaged build identity | Confirmed | Existing ARC-05 combined runtime and pinned PostgreSQL 17 identities below; no build or pull performed by this runner. |
| Healthy seeded fixture | Passed | Exact 25 TEXT / 0 media / 2 album / 4 event / 3 tag seed, current-session API writes, role/source/status/date checks and library pages of 20 + 5. |
| Local isolation and configuration | Confirmed in scoped runs | Local Docker endpoint; loopback-only app port; DB tmpfs with no host port; no bind mount or persistent volume; synthetic settings with storage/audio/retention disabled. |
| Final self-check mode | Passed, exit 0 | Run `47f1c049-be4d-4b5c-bdb2-079ff3a3892b` after the cleanup-race correction: seed/package checks and verified absence of its owned containers/network. |
| Final deliberate failure cleanup | Passed, exit 0 | Run `7f43478b-7b83-44b6-af5f-cdd9080bd8d1` after the cleanup-race correction: expected healthy-fixture failure before seeding reached verified owned cleanup. |
| Runner-specific browser rehearsal | Passed | 38 rendered states: 23 desktop at 1280 × 900 and 15 narrow at 320 × 720. Headless Chrome 155.0.8059.39 / bundled Playwright 1.62.1; details below. |
| Human interactive review | Pending | Ryan and the couple have not yet supplied dated walkthrough feedback. Automated UI operation is technical preparation, not their usability acceptance. |
| Automatic lifetime expiry | Passed, exit 0 | Final-source one-minute run `2f89ff89-9a0b-4ff8-90af-a24deb222cb1` expired and verified all its owned resources absent. |
| Final manual stop and repeated stop | Passed, exit 0 | Fresh run `40d957d2-aff8-485c-b21c-0a1f6a15471a`: stop, repeated stop and original parent each exited 0 after the cleanup-race correction; resources absent. |
| Windows-terminal Ctrl+C cleanup | Passed cleanup | Actual ConPTY interrupt of run `468ebe26-2b2c-4ca5-8207-662739476710` printed verified absence. The interrupted outer terminal returned exit 1; this is cleanup evidence, not a claim of normal process exit 0. |
| Remote endpoint and ownership mismatch | Refused safely | Remote `DOCKER_HOST=tcp://192.0.2.1:2375` stop exited 1 before mutation. Controlled wrong-owner network run `425464f6-7044-4586-abce-44c44eb99011` exited 1 with that network intact; its owner then verified and removed only that probe resource. |
| Synthetic portable archive | Passed | Actual saved notes-only index ZIP: 45,964 bytes, descriptor/independent length and SHA-256 agree. Extraction, exact notes/source/date/organization comparison and a fresh offline reader context pass. |
| Privacy and browser behavior | Passed within headless scope | Save → Back to inbox → ordinary blur clears private DOM; focus rechecks access; sign-out, browser Back and protected-page refresh retain no private rows. No JavaScript errors or horizontal overflow in checked states. |

The browser rehearsal resolves all 52 gallery images through their actual responsive URLs with positive natural dimensions and HTTP 200. Guest voice controls are absent. Two notes are submitted through the real guest UI, one named and one anonymous, then recovered by their receipt identities in the private archive. Private Add a memory saves another note as COUPLE/Kept; a metadata edit preserves its original text and records month precision. The resulting 28 TEXT memories contain 26 guest and two couple notes. Pending pagination is 20 + 4 after the guest additions; the library has 20 + 7 before the private addition. Album, event and tag browsing, a later-page detail return and title/partial-date filtering pass at both layouts.

The export is captured after the private addition. The saved ZIP's SHA-256 is `f4e0ea40c003d21b720d304b8596372aa4b43430a9dc7ba7914e19822cd0e9a3`. Its index is complete for these 28 notes and contains zero original-file parts. Independent checks compare each note's text, source, guest attribution, review state and partial metadata; album member order; event dates/links; and tag membership against the live read snapshot. A separate cookie-free browser context opens the extracted `index.html` and complete `archive.txt`, blocks HTTP/HTTPS and records zero HTTP attempts. Literal script-like synthetic text remains text. This does not test photo/audio originals or demonstrate saving on a physical device.

Four synthetic viewport screenshots were visually inspected without a visible blocker in that sample. Browser contexts and the Playwright-owned temporary profile closed in `finally`; this browser helper does not remove the runner's Docker resources.

A preliminary concurrent manual-stop test found a race: another cleanup could remove a resource after its ownership check, causing the original runner to report failure despite complete removal. The final correction rechecks exact absence after a failed removal. The fresh manual-stop test above confirms both cleanup callers and a repeat stop succeed. After all scoped exercises, listings for the review ownership label showed no remaining containers or networks.

## Existing artifact identities

| Artifact | Identity |
|---|---|
| Combined application runtime | `sha256:201ed8ebd94ae5dbb2b4c913a298c1cdcf871eeedb6e9cba1d9b0829cb306649` |
| Packaged JAR SHA-256 | `912234dcab46ffcb69f481682f8194bbb87e376103977c17a15d1047f7c540aa` |
| PostgreSQL 17 local image | `sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3` |

The application is the existing package recorded in [ARC-05 verification](arc05-verification.md). No production application source, schema, dependency or provider/runtime configuration change is needed for this runner.

Raw startup output includes deliberately published synthetic fixture credentials and local URLs. Keep technical evidence content-free; record identities, aggregate counts, fixed results and cleanup, rather than archive content, session cookies or password hashes. Downloads and screenshots can persist after Docker cleanup and must be handled separately by the reviewer.

## Acceptance that remains separate

These passes establish the specific local fixture, browser and cleanup paths exercised. They do not close human couple feedback, actual account onboarding, hosted HTTPS, provider storage, backups/retention scheduling, successful media saving/playback, physical iPhone/Android or native dialogs, screen-reader behavior, real network-loss recovery, reception capacity or final QR/release acceptance. Record those results in [QA-02](qa02-verification.md) and the [release checklist](wedding-release-checklist.md) when the intended environment and people have tried them.
