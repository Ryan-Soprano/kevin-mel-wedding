# Wedding release checklist and guest materials — preparation

Prepared October 9, 2026 for QA-02 / REL-01 / REL-02. **Drafts prepared; release gates pending.**

Kevin and Melanie are product collaborators and the private archive's intended users. Ryan operates infrastructure; Kevin and Melanie decide moderation, publication and continued use. This document prepares reviewable materials and later acceptance. It does not authorize hosting, spending, account activation, messaging testers, public collection or printing final QR cards.

## Prepared locally

- [Tester scenarios and results template](qa02-tester-guide.md) for synthetic guest and private-inbox use.
- Guest-copy variants below, for Kevin and Melanie to review against the final available features.
- [Printable QR-card layout draft](wedding-qr-card-draft.html), with a blank, unscannable QR space and an explicit final-link placeholder. It contains no final QR or working collection link.

QA-01 has existing [integrated local evidence](qa01-verification.md), OPS-03 has [local operations/rollback evidence](../api/v1/operations-verification.md), and QA-02 records its [local browser/load rehearsal](qa02-verification.md). Their scope stays as recorded there. Preparation here does not promote any hosted, device or release gate to passed.

## Gates to record before guest release

All rows below remain **Pending** in this preparation document. Record actual outcomes in their owning issues; link the relevant evidence when reviewing this checklist.

| Gate | Owner / record | Required outcome |
|---|---|---|
| Guest and inbox browser rehearsal | QA-02; [tester guide](qa02-tester-guide.md) | Actual guest/inbox interaction, named and unnamed contributions, accurate confirmation, safe retry/partial recovery, review/Delete/Restore, sign-out privacy, keyboard focus and 200% zoom. Distinguish local synthetic preparation from real-browser/device acceptance. |
| Physical phones and assistive technology | QA-02, D-03/D-04, AUD-01 | Actual iPhone Safari and physical Android Chrome behavior, selected/recorded media, interruptions and actual screen-reader announcements. Leave unobserved cases open. |
| Simultaneous collection and recovery | QA-02, SEC-01, D-03 | Local load/retry evidence is preparation. Verify the intended guest mix, safe rejections/cooldowns, shared-network behavior and actual forwarding before public collection. Do not treat a small local run as the required reception-network acceptance. |
| Final contribution choices and copy | Kevin/Melanie with Ryan; REL-01 | Advertise only the types enabled and accepted in the final wedding build. Notes/photos still need release acceptance; audio is hidden in the normal build and requires its separate acceptance before inclusion. Hide unavailable choices. |
| Approved public photo gallery | UX-01, QA-02; [gallery verification](guest-gallery-verification.md), [source audit](guest-gallery-source-audit.json) | Confirm the final QR opens the full app's guest welcome and all 300 approved photos can be browsed without sign-in on the intended phones. Validate the source groups below, including every addition at IDs 219-300. Verify Previous/Next, all 300 thumbnails, optional five-second Play/Pause slideshow, reduced-motion browsing, full framing and current-slide loading on the reception network. The original 218 entries remain in order, with the original 52 first and Grand Central opening the slideshow. Approved web copies of the scanned photos are included; raw source files stay outside the public package. Private guest uploads and couple albums stay private. The temporary coming-soon selfie is not evidence that the full gallery is deployed. |
| Deliberate access activation | AUTH-01/02; [account procedure](../runbooks/account-access.md) | Approved target, separate confidential couple accounts, private credential handoff, recovery verification and intentional access-gate activation. No test credential or account is promoted to production. |
| Hosting and stable collection address | OPS-01, REL-02; [staging procedure](../runbooks/staging-deployment.md) | Evaluate hosting/costs after functional/local work, obtain authorization, verify the full app's HTTPS target and origin/session behavior. The existing coming-soon domain is not evidence that collection works. |
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
