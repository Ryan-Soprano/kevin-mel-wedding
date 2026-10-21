# Guest launch rehearsal and cutover preparation — October 21, 2026

**Guest submission rehearsal passed on the current staging deployment. Production promotion, canonical-origin acceptance and guest distribution remain pending.** Use the [Go Live checklist](go-live-checklist.md) and [cutover guide](../runbooks/go-live-kevinandmel-com.md) for the attended launch.

Ryan directed this work after the database feasibility checkpoint and deferred failure-handling/recovery automation for now. That work remains open; this rehearsal does not waive or complete its requirements. No domain, production configuration, account activation, reveal, sizing or database-access change was performed.

## Deployment and retained targets

Read-only Render discovery still identifies the existing Ohio application on one **1-CPU / 2 GiB** instance, automatic deployment off, and deployment `dep-dbchp7dg1s2s73blbqa0` live at commit **`3b2fd0a985fdc526843dde34bb8a6086a8e2da87`**. The existing PostgreSQL instance remains available on **0.1 CPU / 256 MiB / 1 GB**, with no external-access allowlist entries. No second environment is being created.

The deployed application, Docker, scripts and workflow sources match reviewed release **`4f23d9f7a7a30b8f8509621538663c1509274411`**, whose [exact-release CI passed](https://github.com/Ryan-Soprano/kevin-mel-wedding/actions/runs/39651085958). The rehearsal branch starts from main `f9f758b`, which adds documentation only relative to the deployed commit. This establishes the source baseline; the actual production-setting deployment/artifact and compatible rollback artifact still need their cutover record. The connector's legacy commit-status view returned no status entries; it was not used to claim a fresh Actions result for the deployed merge.

## Fresh guest and privacy observations

The owned browser exercise ran **23:37:06–23:38:46 UTC / 6:37:06–6:38:46 p.m. CDT**. It used an isolated installed Chrome session with no couple login, current guest UI, small synthetic fixtures and an owner-only local intent/receipt journal.

| Check | Observed result | Boundary |
| --- | --- | --- |
| Named and anonymous notes | Two separate notes showed the saved confirmation and returned to the gallery. | Synthetic content; no real-account access. |
| Photo batch | Two original files, JPEG and WebP, passed picker/review/send, saved confirmation and gallery return. | Small existing test fixtures; no new maximum-size or burst claim. |
| Audio file | A three-second M4A/AAC fixture decoded and entered playing state in the local preview, then saved and returned to the gallery. | File path, not microphone recording or human-audible acceptance. |
| Actual storage transfer | Exactly three issued, owned R2 PUTs carried the prehashed fixture bytes and returned successful responses through the browser. | Confirms the exercised provider-origin browser transfer/CORS path; canonical-origin CORS remains pending. |
| Persisted completion and private defaults | Readback of all four contribution receipts confirmed **five memories**, correct per-group types/counts, stable IDs, `COMPLETE`, media `UPLOADED`, and every item `PENDING` / `COUPLE_ONLY`. | Guest receipts contain states/identities, not private inbox detail or independently downloaded originals. |
| Human test-inbox verification | Ryan confirmed all five new items, including the two notes, opening photos and playing tone, were verified in the authorized test inbox. The photos match the fixtures: JPEG is solid black and WebP solid gray. | Human-reported inbox/preview acceptance; no independent authenticated download/hash comparison or complete couple-session security acceptance. |
| Public listing | Those owned IDs and the synthetic marker were absent from the public listing's first page. | No exhaustive enumeration or new publication decision. |
| Anonymous private APIs | Memories, albums, timeline, library, tags and exports returned **401 `AUTH_REQUIRED`**, `no-store`, without a Basic Auth challenge. | Confirms application authorization rather than staging admission. |
| Session and origin | Fresh anonymous session; explicit actual `Set-Cookie` attributes **Secure, HttpOnly, SameSite=Lax, Path=/**; session response `no-store`. Empty foreign-origin session/contribution POSTs returned **403 `ORIGIN_INVALID`**. | Tokens/cookies stayed in memory; no credentials were attempted and the empty bodies could not create a contribution. |
| Private object denial | Unsigned GETs to each exact journal-owned staging object returned the provider's authentication-required rejection. | Not an authenticated original-byte comparison or a current readback of every bucket/public-domain setting. |
| Layout | Gallery fit 390 × 844 and 1280 × 900 viewports without horizontal overflow. | Chrome viewports do not represent physical iPhone/Android acceptance. |

The first helper attempt stopped at an ambiguous photo-picker locator after both notes were confirmed, before any media creation. Its journal/summary were preserved. The corrected continuation retained those same notes and created only the previously unattempted photo/audio groups. Final assertions and network observers settled before the successful record was published; all owned browser contexts closed. No new key was used to duplicate a confirmed note.

The four groups / five memories remain private in the retained archive. Added to the preceding two rehearsal cohorts' 105 known groups / 150 memories, the recorded inventory now includes **at least 109 known synthetic groups / 155 memories**, plus earlier retained content. This is a scoped ownership inventory, not an exhaustive archive count or a cleanup allowlist. Preserve all three rehearsal cohorts and their journals. No moderation, deletion or fixture reset was performed. Detailed identities, retry capabilities, grant URLs, payloads and fixture hashes remain in the owner-only ignored journal, outside Git.

Ryan completed the human test-inbox check and confirmed all five items. A local read-only fixture inspection independently confirmed the expected solid-black JPEG and solid-gray WebP, matching his description. The in-app browser controller could not initialize; the isolated guest browser did not reuse or extract the user's authenticated session. This is human inbox/preview evidence alongside automated guest receipt/storage checks; independent authenticated original-byte comparison and full private-account security acceptance remain separate.

## Physical phones and QR proof

Ryan reports that the requested note/photo/record-preview-send/gallery flows have previously been performed successfully on **both iPhone and Android**. Carry that report forward as prior human acceptance; no new model, OS/browser version, network or same-build physical observation was supplied in this exercise. The final canonical origin and printed QR still need physical checks after cutover.

The [printable QR proof](wedding-qr-card-proof.html) now contains a real [QR SVG](kevinandmel-qr.svg) for exactly **`https://kevinandmel.com`**. Independent decoding of a 300-dpi raster, screen render and print-CSS render returned those exact bytes, with no trailing slash. The QR has a four-module white quiet zone and measures 48 mm including that zone; its bordered card is A6, 105 × 148 mm. Layout and dimensions were inspected. Print the A4 proof sheet at 100% / Actual size with browser headers/footers off.

This is visibly marked **PROOF — NOT APPROVED FOR DISTRIBUTION**, including on the printed card. Kevin/Melanie's wording/feature approval, actual printed scans on both phones and final handout approval remain pending. The old placeholder [layout draft](wedding-qr-card-draft.html) remains intact.

## Production and domain preparation

Public readback at **23:36 UTC / 6:36 p.m. CDT** found valid HTTPS on apex and `www`, with both reaching Coming Soon and `www` redirecting to the apex. The apex A answer remains `216.24.57.1`; `www` CNAME remains the Coming Soon provider hostname. No AAAA answer was returned for either hostname. Observed apex A and `www` CNAME TTLs were 1800 seconds; resolver answers are not the authoritative account's record inventory. No DNS or Render domain association was changed.

The cutover guide now contains the corrected deployment baseline, source-checked production matrix, runtime-deploy versus frontend-rebuild choice, preserved-data requirements and a ready-to-fill execution record. The source requires explicit production profile/environment, HTTPS canonical origin, Secure cookies, retained database credentials and one finalizer. Reveal stays false for guest launch. Existing app/database/bucket/deletion authority and current sizes are retained.

Current provider environment values, private bucket CORS/lifecycle/public-domain settings, effective production settings and private readiness still require readback during the attended cutover. The available Render connector has no read-environment operation; this preparation did not infer saved or running secrets/settings from source defaults. Keep the old provider-host policy explicit: the canonical-origin setting alone does not redirect or disable that hostname.

Ryan selected **Thursday, October 22, 6 p.m. CDT / 23:00 UTC** as the attended cutover start. This is the planned start of the operator window, not a guaranteed public-opening time or an automatic scheduled action. Before public collection, record the chosen production deployment/artifact, effective configuration and current checkpoint, resolve the checklist's open decisions, then perform the domain/TLS move behind maintenance. Finish canonical save/privacy/CORS checks and printed-phone scans before distributing the link/cards. Shared-network enforcement remains inconclusive from the earlier probe; this small rehearsal did not repeat it. Deferred recovery/failure handling remains open in the [checklist](go-live-checklist.md).
