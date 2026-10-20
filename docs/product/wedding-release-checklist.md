# Wedding release checklist and guest materials — preparation

Prepared October 9, 2026 for QA-02 / REL-01 / REL-02. **Drafts prepared; release gates pending.**

Kevin and Melanie are product collaborators and the private archive's intended users. Ryan operates infrastructure; Kevin and Melanie decide moderation, publication and continued use. This document prepares reviewable materials and later acceptance. It does not authorize hosting, spending, account activation, messaging testers, public collection or printing final QR cards.

## Prepared locally

- [Tester scenarios and results template](qa02-tester-guide.md) for synthetic guest and private-inbox use.
- Guest-copy variants below, for Kevin and Melanie to review against the final available features.
- [Printable QR-card layout draft](wedding-qr-card-draft.html), with a blank, unscannable QR space and an explicit final-link placeholder. It contains no final QR or working collection link.

QA-01 has existing [integrated local evidence](qa01-verification.md), OPS-03 has [local operations/rollback evidence](../api/v1/operations-verification.md), and QA-02 records its [local browser/load rehearsal](qa02-verification.md). Their scope stays as recorded there. Preparation here does not promote any hosted, device or release gate to passed.

## October 20 readiness check — Thursday October 22 target

The existing full application is available at
[the staging HTTPS address](https://kevinandmel-staging.onrender.com/), separate
from the intentional coming-soon page on `kevinandmel.com`. Initial read-only
inspection found PR 87 deployed. The subsequent authorized manual deployment
`dep-dbbu350m7kps73d8tnog` became live at 21:49:18 UTC on October 20 with commit
`a4ad947cb2ba76b311a9c20ef0f35cdc348a443b`; the bounded checks below are repeated
against that deployment. Automatic deployment remains off. The existing Ohio
service has one 1-CPU/2-GB instance. An existing same-region PostgreSQL 17 database
reports available with external access disabled. Refresh the build identity and
repeat affected checks after a later deployment.

The guest HTML, JavaScript, stylesheet, health endpoint, and sampled first/last
approved gallery images return HTTP 200. Anonymous private-memory and
source/configuration probes return `401 AUTH_REQUIRED`; the disabled recorder
spike returns 404. These responses use `no-store`. The served JavaScript contains
both preserved landing sentences and compiles the frontend audio option on.
This does not establish effective server audio admission, complete guest saving,
private playback, the entire gallery/device matrix, or database/storage readiness
from `/api/health`. Before this deployment, sampled idle memory was about
250.5 MB of 2 GiB and a severity-filtered 24-hour query returned no application
error entries. Those earlier limited observations do not establish this build's
peak mixed-media capacity, uptime, logging privacy or alert delivery.

A mounted in-app browser check on this deployment confirms the landing and
photo form remain readable at a 390-by-844 viewport. Opening gallery photo 1,
navigating to photo 3 and choosing **Back to gallery** restores the original
1099-pixel scroll position and focus on photo 1. The page width stays within
the viewport. This focused hosted check supplements the existing 34-case local
gallery matrix; it does not rerun that matrix or establish physical-phone,
screen-reader, microphone or saved-media acceptance.

A subsequent read-only console check inside the deployed service exits 0 and
confirms the bounded database/migration/schema checks. Its aggregate output is
private operator evidence. This check does not contact R2, verify retained
backups or retention-job health, establish every running profile/session setting,
or complete release acceptance. The [operations procedure](../runbooks/operations-and-rollback.md)
defines its exact scope.

Ryan's October 15 report credits successful recording and saving of a WebM
memory. Device/browser versions, private-inbox playback and original
download/export were not recorded for that report. Preserve that result while
retaining the unobserved acceptance checks. The October 14 audio-enablement
instruction remains in force; it is separate from completing those checks.
After the updated staging link was supplied on October 20, Ryan reports
completing the requested note, photo, voice-memory, gallery-return and recording
interruption checks on an iPhone using DuckDuckGo, with no failure reported. He
also reports earlier Safari tests and Android Chrome tests performed by Kade.
Device/browser versions and the earlier dates/builds were not supplied. These
are credited human reports, not new automated results or evidence for private
playback, original-byte comparison, export, audible screen-reader or printed-QR
acceptance.

Prioritize these outcomes before Thursday October 22; the wedding remains
October 24:

- Finish the remaining review/check gates and deploy further source changes
  deliberately only after exact-current-head CI and configured AI review.
  Repeat affected route/asset checks. Keep a compatible V14 rollback artifact
  and automatic deployment off.
- Exercise synthetic notes, photos and voice memories through committed
  receipts, private playback/original-byte comparison and deliberate retry on
  that build. Record actual R2 CORS/expiry/integrity and hosted peak-memory
  outcomes. Preserve saved siblings and the original retry identities.
- Record backup freshness, independent deletion authority, representative timed
  restore and operator alert/access evidence. Complete the bounded physical
  iPhone Safari/Android, audible screen-reader, interruption/native-save and
  actual printed-QR checks with their human testers.
- Verify the final full-app collection address and record the release decision
  before any custom-domain cutover or final QR distribution. The coming-soon
  site remains intentional until that separate step.

This is an observed deployment/readiness supplement. It creates no guest
contributions and closes none of the full acceptance gates below by itself.

## Gates to record before guest release

All rows below remain **Pending** in this preparation document. Record actual outcomes in their owning issues; link the relevant evidence when reviewing this checklist.

| Gate | Owner / record | Required outcome |
|---|---|---|
| Guest and inbox browser rehearsal | QA-02; [tester guide](qa02-tester-guide.md) | Actual guest/inbox interaction, named and unnamed contributions, accurate confirmation, safe retry/partial recovery, review/Delete/Restore, sign-out privacy, keyboard focus and 200% zoom. Distinguish local synthetic preparation from real-browser/device acceptance. |
| Physical phones and assistive technology | QA-02, D-03/D-04, AUD-01 | Actual iPhone Safari and physical Android Chrome behavior, selected/recorded media, interruptions and actual screen-reader announcements. Leave unobserved cases open. |
| Simultaneous collection and recovery | QA-02, SEC-01, D-03 | Local load/retry evidence is preparation. Verify the intended guest mix, safe rejections/cooldowns, shared-network behavior and actual forwarding before public collection. Do not treat a small local run as the required reception-network acceptance. |
| Final contribution choices and copy | Kevin/Melanie with Ryan; REL-01 | Advertise only the types enabled and accepted in the final wedding build. Notes/photos still need release acceptance. Ryan requested audio enablement on October 14; confirm both gates and complete its retained device/provider acceptance on the final reviewed build. Hide unavailable choices. |
| Approved public photo gallery | UX-01, QA-02; [gallery verification](guest-gallery-verification.md), [source audit](guest-gallery-source-audit.json) | Confirm the final QR opens the full app's guest welcome and all 300 approved photos can be browsed without sign-in on the intended phones. Validate the source groups below, including every addition at IDs 219-300. Verify Previous/Next, all 300 thumbnails, optional five-second Play/Pause slideshow, reduced-motion browsing, full framing and current-slide loading on the reception network. The original 218 entries remain in order, with the original 52 first and Grand Central opening the slideshow. Approved web copies of the scanned photos are included; raw source files stay outside the public package. Private guest uploads and couple albums stay private. The temporary coming-soon selfie is not evidence that the full gallery is deployed. |
| Deliberate access activation | AUTH-01/02; [account procedure](../runbooks/account-access.md) | Approved target, separate confidential couple accounts, private credential handoff, recovery verification and intentional access-gate activation. No test credential or account is promoted to production. |
| Hosting and stable collection address | OPS-01, REL-02; [staging procedure](../runbooks/staging-deployment.md) | Verify the existing full app's reviewed commit, HTTPS target, origin/session behavior and measured capacity. Record the final collection address and release decision; the intentional coming-soon domain does not establish collection readiness. |
| Storage, privacy and operations | SEC-02, OPS-02/03; [security checklist](../runbooks/security-review.md), [operations procedure](../runbooks/operations-and-rollback.md) | Actual private storage/CORS/original integrity, expiry and browser behavior; monitoring, independent backups/deletion-ledger recovery, representative restoration and operator access. Preserve each remaining provider/hosted boundary. |
| Final QR generation and print/scan check | REL-01 | Encode the approved stable collection URL. Scan the actual-size printed proof on the intended phones in realistic lighting; confirm correct landing, readable fallback address and working guest path. Draft layout review is not a print/scan pass. |
| Rehearsal, freeze and release decision | Ryan with Kevin/Melanie; REL-02 | Rehearsal target October 17, freeze target October 20, wedding October 24, 2026. Review the final build, unresolved gates, operator procedure and guest material together before collection opens. These dates do not automatically enable features. |

### Expected public gallery source set

Use the [source audit](guest-gallery-source-audit.json) to reconcile each supplied
scan and later couple photo with its gallery ID. Record the reviewed build and
results for all groups; validating only the original 218 does not pass this gate.

| Source group | Expected photos | Gallery IDs / checks |
|---|---:|---|
| Original standalone photos | 52 | 1-52, with Grand Central first. |
| `wedding3.0` additions | 166 | 53-218; the ten documented copies of existing photos are already represented. |
| Scanned PDF | 50 | 219-268. All 52 pages are accounted for: page 21 duplicates page 22 (gallery 239), and page 23 duplicates page 24 (gallery 240). |
| Saved `image_page*.jpg` scan photos | 30 | 269-298. These are distinct scenes from the current PDF; filenames are not PDF page numbers. Check the upright beach photo at ID 283. |
| Later couple photos | 2 | 299: brick archway; 300: sunny globe selfie. |
| Total | 300 | Verify slideshow advancement from 218 to 219 and wraparound from 300 to 1, plus thumbnail access to every addition. |

Verify that **Browse all 300 photos** opens the currently displayed photo's marked
thumbnail, centered on screen when the page has room. Include photos 24/48 with
little content after the gallery; subsequent batch loading must preserve that
centered entry.

From the thumbnail gallery, note the page's scroll position, open photo 86 and
advance to photo 124. **Back to gallery**, the top-right close button and Escape
must restore that original scroll position and focus photo 86, without moving
the gallery to photo 124 or dropping already loaded thumbnails. Repeat with
reverse navigation and across a thumbnail batch boundary. The last viewed photo
remains current, but closing the enlarged photo preserves the gallery's place.

Clicking the main-page slideshow photo must also enlarge it directly. Closing
with **Back to slideshow**, the close button or Escape restores the original
page position and photo-button focus, while retaining the last viewed slide.
Include keyboard opening, contained dialog focus, reduced motion and resizing;
after a resize, restore the previous place as far as the new layout permits.

The [local gallery verification](guest-gallery-verification.md#october-19-2026---enlarged-photo-return-position)
records 34 passing mounted Edge cases at desktop and narrow widths, including
exact scroll restoration and a corrected mobile scroll-lock drift. This local
evidence does not close the physical-phone, assistive-technology or hosted release
gates above.

## Guest-copy drafts

Choose one contribution sentence only after the final available choices pass their release checks. These are copy proposals, not current availability claims.

| Location | Draft |
|---|---|
| Headline | Help Kevin and Melanie remember their wedding. |
| Notes/photos version | Share a note or photos from the day. |
| Voice version, only if accepted and enabled | Share a note, photos or a voice memory from the day. |
| Privacy | Your memories go to Kevin and Melanie and aren't posted publicly. |
| Name/account reassurance | No account needed. Your name is optional. |
| Card action, after final QR is verified | Scan to share a memory. |
| Fallback address | **FINAL COLLECTION ADDRESS — PENDING** |
| Successful submission | Thank you — your memory was saved for Kevin and Melanie. |
| Unconfirmed result | We couldn't confirm that your memory was saved. Keep this page open and use Try again. |

Keep the final card short: headline, accepted contribution sentence, scan action, verified fallback address and privacy/account reassurance. Keep technical setup, test instructions and the draft marker outside the final guest copy. Do not promise automatic notifications or publication.

Collection is intended to remain available through October 31, 2026. Kevin and Melanie will decide continued intake afterward. October 31 is a handoff/review milestone, not an automatic closing action; no scheduled closure or permanent availability is promised here.

## Final QR and print handoff

1. Record the stable collection URL and final accepted type list after the hosting/release decision. Do not encode temporary admission URLs, private inbox links, credentials or media permissions.
2. Replace the layout's blank QR area and final-address placeholder with the reviewed code and readable address. Remove all draft markings only when the content is approved.
3. Produce an actual-size print proof. Verify scans, the full-app guest destination, all selected public gallery photos and the complete contribution path on the intended phones; check contrast, lighting, trim margins and readable fallback address. Record printer/card size and outcomes without private links or content.
4. Have Kevin/Melanie review the wording and Ryan review the release gates. Printing and distributing the final material follow that concrete release decision. This draft sends no invitations or tester messages.

## Release-review record

```text
Review date:
Reviewed build/commit:
Final accepted contribution types:
Guest-copy decision:
Stable URL verification record (link to approved public release evidence):
Final QR / actual-size print / phone-scan evidence:
QA-02 evidence and remaining issues:
Security / storage / operations evidence and remaining issues:
Couple access activation status:
Collection-through-October-31 plan and later intake decision:
Release decision and owner:
```

Until those outcomes exist, retain **Pending** for the affected gate and keep the QR/card marked as a draft.
