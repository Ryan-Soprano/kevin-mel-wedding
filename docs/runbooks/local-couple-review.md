# Disposable local guest and couple review

Prepared October 10, 2026; package updated October 11. **Local technical preparation is verified; human walkthrough feedback remains pending.** See the [original verification record](../product/local-couple-review-verification.md) for the lifecycle/browser scope and the [pre-walkthrough review](../product/pre-walkthrough-review.md) for the fresh package containing the authorization/privacy fixes.

This runner gives Ryan a short interactive session in the actual packaged application, with synthetic archive data already present. It uses an existing local application image and the pinned PostgreSQL 17 image. It does not build or pull images, install dependencies, contact providers, deploy a site or use the existing Compose database.

The guest welcome includes the already approved 52-photo couple gallery. The runner seeds 25 written notes: 24 guest notes, eight without names, and one couple memory. There are 22 Pending, two Kept and one Archived, plus partial memory dates, two albums, four timeline events and three tags. The gallery is public static content; it does not make private submissions public.

## Start a session

From the repository root, use the existing Node runtime and a running local Docker engine. Supply the full immutable image ID of the reviewed combined application build containing the current features. Tags and abbreviated IDs are rejected. If either required image is absent, the runner stops; it does not download a replacement.

```powershell
node scripts/local-review.mjs --help
# Fresh combined package containing the October 11 authorization/privacy fixes.
$reviewImage = 'sha256:262b120db02b462aa6f893551b8fc9d46cf3658f31b436b94b2f5b8f16f60cee'
node scripts/local-review.mjs --image $reviewImage --minutes 30
```

Keep this terminal open. The runner prints its run UUID before creating resources; retain it so `--stop` can recover cleanup even if startup is interrupted. After startup and fixture checks, it prints the loopback address, image/JAR identity, synthetic sign-in details and deadline. Open the printed guest address; use the same address with `/?view=inbox` for the private archive. The randomly assigned port is bound to `127.0.0.1`, so this is a review on this computer rather than a shareable hosted link.

The disposable accounts are **synthetic-kevin** / **Synthetic Kevin** and **synthetic-mel** / **Synthetic Melanie**. Both use the published fixture passphrase **synthetic-auth-container-passphrase**. These are deliberately nonsecret test credentials for this runner's disposable database. They must never be copied to a retained database or used for real accounts. Synthetic fixture seeding is separate from the hidden-input operator provisioning procedure in [account access](account-access.md).

The runner creates an owned standard bridge network, a PostgreSQL tmpfs data directory with no published database port, and a nonroot application container with a read-only filesystem. The bridge permits network routing; it is not an air gap. Only synthetic application settings enter the containers, ambient provider credentials are excluded, and storage, audio and retention are disabled. Saved changes persist within this run until cleanup removes its containers and tmpfs database. Restarting the runner creates a fresh archive. The normal Compose database and its `postgres_data` volume remain outside this fixture.

Before seeding, the selected application's packaged read-only schema validator checks that the database exactly matches its bundled migrations, checksums and schema. A mismatch stops startup and triggers owned-resource cleanup. This check follows the selected package rather than a fixed migration count.

## A 25-minute walkthrough

Use made-up names and notes for anything you add. The supplied couple gallery is for browsing; use separate synthetic files for photo selection. Follow the existing [tester guide](../product/qa02-tester-guide.md) for fuller scenarios and the results template.

| Time | Try this | Check |
|---|---|---|
| 0–3 minutes | Browse the guest gallery, then choose **Write a note**. Review and send a named synthetic note, then one with the name blank. | Sharing remains easy to reach; only a confirmed saved result is celebrated. The gallery reveals no private guest memories. |
| 3–8 minutes | Open `/?view=inbox`, sign in, find the new notes, then try **Add a memory** with another written note. Open it and edit its title, description and partial memory date. Try **Keep privately**, **Archive** and **Restore to inbox** on a guest note. | Guest attribution and **Couple memory** remain accurate. Editing metadata preserves the original note. Couple additions start Kept; the saved time is distinct from the memory date. |
| 8–12 minutes | Open **Albums**. Inspect the two fixtures, create or rename an album, add a note and try **Move earlier** / **Move later**. Remove a member; cancel a deletion before deleting a test album. | Shared membership and order make sense. Removing a member or deleting an album preserves the memory and its original. |
| 12–17 minutes | Open **Timeline** and compare exact-day, month, year and unknown-date fixtures. Open **Library**, combine search/date/type/tag filters, try an empty result and **Reset library search**, then open a later-page memory and return. Manage or attach a test tag. | Dates express their actual precision. Unknown dates stay separate from inclusive year ranges. Search, page return and tag controls remain understandable. |
| 17–22 minutes | Open **Export archive**, choose **Prepare archive export**, then **Check export progress**. Prepare the final index part, **Load and verify ZIP part**, and **Save verified ZIP part**. Extract it into a new private test folder and open `index.html`. | This notes-only fixture has no original-file parts. Check readable notes, dates, album order, events and tags in the offline reader. Confirm the browser actually saved the ZIP; **Download started** alone is insufficient. |
| 22–25 minutes | Return to the private app, switch away and back, then sign out. Try Back/Forward and refresh. Stop the runner and remove only the test downloads or screenshots you deliberately saved. | Private presentation clears when hidden and requires an access check when returning. Sign-out is confirmed. Cleanup reports the owned resources absent. |

For a memory Delete/Restore check, use a synthetic note linked to an album, event and tag. Read **Delete…**, cancel once, then confirm, find it in **Recently deleted** and **Restore to inbox**. Delete detaches every album, event and tag link; Restore returns the note to the inbox and requires deliberate reattachment. This short session cannot establish the full 30-day recovery or retention schedule.

Photo selection and review can be explored, but successful photo saving, playback and original downloads are **Not tested — storage unavailable**. Audio is unavailable. The runner does not manufacture a successful media result or provide failure injection for uncertain-response acceptance. If an operation is unconfirmed, use the offered current-state check and deliberate same-action retry; do not treat a new submission as recovery. Hiding the private page clears drafts and private search context.

The existing login policy counts successful and failed attempts: five per username and thirty per direct peer in fifteen minutes. Startup uses one successful sign-in per fixture account. Respect `Retry-After` if throttled. The runner leaves those limits and counters intact; the second synthetic account is available for separate checks. End this disposable run and begin a new one if a fresh fixture is needed.

## Finish and recover cleanup

Resolve any visible unconfirmed action, sign out, and press **Ctrl+C** in the runner terminal. A normal session also stops automatically at its deadline; `--minutes` accepts whole minutes from 1 to 120 and defaults to 30. Startup has a separate five-minute deadline. Signal and failure paths attempt the same exact owned-resource cleanup. Automatic expiry, manual stop/repeated stop and actual Windows-terminal Ctrl+C cleanup have been exercised; their precise outcomes are in the verification record.

Expected successful cleanup ends with:

```text
Local review cleanup: verified absent.
```

If the terminal or process was forcibly closed, use the exact run UUID printed at startup in a new terminal:

```powershell
$reviewRun = '<run UUID printed at startup>'
node scripts/local-review.mjs --stop $reviewRun
```

`--stop` accepts no other options and checks this runner's exact resource names and ownership. It is safe to repeat after successful cleanup. An ownership mismatch or unconfirmed cleanup is a failure, not permission to remove arbitrary Docker resources. Preserve the run UUID and the safe failure result for Ryan rather than deleting unrelated containers, networks, databases or volumes.

Cleanup erases this run's application data. It does not revoke browser downloads, remove screenshots, erase browser history or clear site cookies. Close the review tabs after signing out and clear their loopback site data if needed. Remove only synthetic files you intentionally saved; do not report passwords, cookies, CSRF values, private links or screenshots in the tester results.

## Operator checks

These modes are separate from interactive review and do not accept `--minutes`:

```powershell
node scripts/local-review.mjs --image $reviewImage --self-check
node scripts/local-review.mjs --image $reviewImage --probe-failure-cleanup
```

`--self-check` starts, checks and cleans a disposable fixture without leaving it open. `--probe-failure-cleanup` deliberately fails in a healthy owned fixture before seeding and succeeds only when that expected failure reaches verified cleanup. Both scoped modes have passed with exit 0 and verified absence. The two modes cannot be combined; `--help` and `--stop` also run alone. See the [verification record](../product/local-couple-review-verification.md) for actual outcomes.

This review can supply local usability feedback. Actual couple onboarding, hosted HTTPS/provider operation, successful media storage, native phone/file-picker/audio behavior, assistive-technology use and reception-network acceptance remain open in the [release checklist](../product/wedding-release-checklist.md).
