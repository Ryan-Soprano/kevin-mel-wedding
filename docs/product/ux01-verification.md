# UX-01 — guest welcome and navigation

Date: 2026-10-09  
Base: merged `main` `8f66ac1` (MED-02, PR #18)  
Branch: `feature/guest-contribution-flow`

## Implemented behavior

The guest page follows the approved [guest journey](guest-and-review-journeys.md): invitation, memory choice, optional name within the chosen form, compose/select, review, send, confirmed result, then **Done** or **Share another memory**. Notes and photos are implemented choices. Audio is hidden until its recording, durable storage and release checks are ready.

The invitation uses “Help Kevin and Melanie remember their wedding.” It explains the recipients, optional name, no account requirement and private handling without suggesting the couple can access the archive before reveal.

Visited forms remain mounted when hidden. Going back preserves the original note draft, photo files, captions, review step and controller identities. Choice labels distinguish a new contribution, a retained draft and a saved result. The guest must use an explicit successful-result action to reset the completed type; a draft of the other type survives and is identified on the finished screen.

Navigation is locked while submitting, waiting through a server cooldown or recovering an uncertain/partial outcome. The existing same-key/manual retry and selective-photo retry behavior remains. A completely known-rejected photo remainder can still be abandoned through the form's explicit **Start a new batch** action. No navigation reset, automatic retry or background request creates a new submission identity.

Photos now have a review screen displaying the original previews, normalized optional name and captions before any server intent or file checksum is created. **Edit photos** returns to the original editable selection; **Send photos** begins the existing grouped coordinator. Once an intent exists, metadata remains locked until the outcome is resolved.

The previously prepared note timeout fix from PR #17 is included: the entire request, including a stalled JSON body, has a 30-second deadline. Abort and a promise race ignore late responses while retaining the original draft/key for manual retry. The unrelated staging/audio/account-console work remains in PR #17.

## Accessibility and retention

- A visible heading receives focus when the shell screen changes. Inactive forms do not move focus. Existing validation focus, explicit labels and live submission/result announcements remain.
- Touch controls are at least 48 px high; choice text, filenames, captions and long names wrap within the existing narrow layout.
- Hidden forms are excluded from layout and interaction using the HTML `hidden` attribute and an explicit stylesheet rule.
- Drafts and original files live only in memory. A conditional browser leave-page warning protects unfinished work where the browser supports it. Refresh, tab closure or operating-system termination can still lose unfinished work; there is no offline/local-storage recovery promise.
- Actual browser focus/zoom/screen-reader/physical-device acceptance remains open. Noninteractive rendering is a source/semantic check, not a substitute.

## Verification

- Frontend suite: **132 tests pass**, including eight guest navigation/preservation cases and three note deadline/late-body cases.
- Existing photo coordinator, adapter integration, receipt, recovery, cooldown and selection regressions pass unchanged.
- ESLint, production build and `git diff --check` pass.
- Noninteractive React rendering confirms the invitation, privacy/account copy and initial action; no forms or audio action appear before a choice.
- Independent source review identified and corrected completed-result choice labels. Final integrated review is recorded in the PR/tracker.

No dependency, API endpoint, migration, credential, provider resource or deployment is introduced by UX-01. UX-01 remains in progress for audio and deferred device/release acceptance; the note/photo implementation is ready for code review.
