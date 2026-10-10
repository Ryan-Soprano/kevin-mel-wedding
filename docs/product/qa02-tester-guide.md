# Kevin & Melanie's tester guide — QA-02 preparation

Prepared October 9, 2026. **Scenarios prepared; tester results pending.**

Updated October 10 with the approved public photo gallery, private timeline, library/tag and portable-export scenarios. These additions remain prepared checks until tried in the intended test environment.

We would like your help making the archive easy to use and useful to you. Try it first as a wedding guest, then as someone reviewing the private inbox. Tell Ryan what feels confusing, awkward or missing, as well as what works.

## Before you begin

Ryan will supply the intended test link, synthetic sample files and, when private inbox testing is ready, test sign-in details. A local demo is not a published wedding site. The [disposable local review session](../runbooks/local-couple-review.md) gives Ryan a loopback link, published synthetic fixture credentials and sample notes/organization to explore together on his computer. Its temporary data is erased when the session is cleaned up; deliberately downloaded files remain on the computer. Real account activation and a hosted test link remain later steps; this guide does not create or authorize them.

Use made-up names such as **Test guest A**, short test messages, generated sample photos and a clip saying only **“This is a test.”** Use no real guest messages, personal photos or other people's voices. Test data stays within the supplied test environment until its owner clears it; do not assume a saved local submission disappears when you close the page.

Keep sign-in details, private links, downloaded test media and screenshots out of the results report. Report the scenario, what you expected and what happened in plain words. Ryan handles environment setup and cleanup; you do not need to change settings or delete database records.

Audio is hidden in the normal build today. Only try voice memories if Ryan has explicitly enabled them in the controlled synthetic test environment. Otherwise record the audio scenario as **Not tested — test option unavailable**. This does not establish wedding audio availability.

Ryan will also identify whether test photo storage is available. When it is disabled, check selection, review and accurate unsaved feedback; mark successful photo saving, playback and original download **Not tested — storage unavailable**. A successful partial-batch recovery requires the separate controlled scenario Ryan supplies.

## Guest scenarios

Keep the page open while sending or recovering an uncertain result. Refreshing, closing the tab or restarting the browser loses unfinished drafts, selected files and retry state. It does not remove a memory already saved. Selecting files again starts a new attempt, rather than recovering the earlier one.

| ID | Try this | What to look for |
|---|---|---|
| G0 — Couple gallery | On the guest welcome, browse Kevin and Melanie's approved photos, then use the link back to sharing a memory. | All 52 selected photos are available without sign-in, with full framing and readable descriptions. Sharing stays easy to reach. Viewing the couple gallery does not reveal private guest submissions. Use only the separate synthetic files Ryan supplies for upload tests. |
| G1 — Named note | Choose **Write a note**. Try an empty message, then enter a made-up name and a short test note. Review it, edit it, review again and send. Tap Send twice quickly. | Clear validation keeps your work. Review shows the intended name/message. Sending produces one saved note and a clear confirmation. **Done** and **Share another memory** have distinct, understandable results. |
| G2 — Unnamed note and draft | Start a note with the name blank. Before sending, go back to the memory choices and return. Send it, then choose another memory. | The draft survives in-page navigation. Leaving the name blank works. The inbox later says **Name not provided**. Returning to a saved result does not silently send again. |
| G3 — Five photos | Select five supplied JPEG, PNG or WebP photos, each under 10 MB. Add a made-up name and different test captions. Review, edit, then send. | All five previews, filenames and captions stay associated with the correct photos. Progress distinguishes sending from saving. Only the confirmed saved count is celebrated. All five photos later appear in the private inbox with their matching captions. |
| G4 — Photo selection limits | In a fresh photo draft, retain one valid sample, then try adding too many files or a supplied unsupported file. Remove a selected photo and review the remainder. Also try one valid photo with the name blank. | The explanation says what to change. Rejected additions do not erase already accepted selections or captions. No HEIC/HEIF support is promised. Anonymous photos remain attributable as **Name not provided**. |
| G5 — Uncertain or partial result | Use only the failure scenario Ryan supplies. For a note with an unconfirmed result, use its retry action. For a partial photo batch, retry the unsaved photo while retaining the saved siblings. | The page does not claim everything was saved early. Your work remains visible, and recovery preserves the same attempt. Saved siblings are not sent twice. Do not refresh, replace files or start a fresh batch while the outcome is uncertain. Record **Not tested** if this scenario is unavailable. |
| G6 — Voice memory, if enabled for testing | Select a supplied supported clip, or make the short synthetic recording Ryan requests. Play it back, discard/reselect it, add a test caption and send. Repeat once with the name blank. | Controls and permission errors make sense. Playback is audible, discard removes the previous clip, and saved confirmation appears only after saving. The current test limit is two minutes/25 MB; actual device format support remains pending. A note remains an understandable fallback. |

## Private inbox scenarios

Use a personal test session. A shared or signed-out browser must not retain a visible private inbox. Downloads cannot be reclaimed by signing out; remove only the test files you deliberately saved.

| ID | Try this | What to look for |
|---|---|---|
| I1 — Find and open | Sign in with the supplied synthetic account. Find the test notes, each photo from the batch and the enabled audio sample. Open each, then return to the inbox. | Names or **Name not provided**, type and captions are accurate. Available previews/playback and original downloads correspond to the selected sample. Never paste a media link into your report. |
| I2 — Keep and Archive | **Keep privately** a test item, find it under **Kept**, then Archive it and find it under **Archived**. Choose **Restore to inbox**. | Each action is understandable, affects only the chosen item and stays private. Restoring returns it to Pending. Nothing becomes public. |
| I3 — Cancel, Delete and Restore | Open **Delete…**, read the explanation and choose **Cancel**. Repeat and choose **Confirm delete**. Find it in **Recently deleted**, then **Restore to inbox**. | Cancel changes nothing. The confirmation explains the 30-day recovery window. The deleted item cannot be played or downloaded. Restoring makes the item available again within that window. Other photos in the batch are unaffected. |
| I4 — A pending or conflicting change | Use the supplied slow/conflict scenario, if available. Read the feedback and use **Reload current state** or the offered same-change retry. | The interface distinguishes saved, pending and unconfirmed changes. Conflicting actions are paused. Reload shows the current state rather than claiming the old change succeeded. Do not leave a pending review unresolved on a shared device. |
| I5 — Sign out and return | Sign out, then use Back/Forward, refresh and switch away/back to the tab. Return to the guest page. For an interrupted sign-out, use only the supplied scenario and complete its recovery. | Private rows, details and previews clear. Access is checked before private content returns. A failed sign-out stays visibly unconfirmed; do not assume the device is safe until recovery succeeds. Record exactly which browser actions you tried. |
| I6 — Events and partial dates | Open **Timeline** and create synthetic events with an exact day, month only, year only and unknown date. Edit one date, then try the inclusive year and precision filters. | Events appear oldest first with truthful date precision; unknown dates appear separately. A year range excludes unknown dates. No memory's own date or original changes. Record which ordering or label feels unclear. |
| I7 — Link and preserve memories | Link a synthetic note to two events. Open it from an event and return. Unlink it once; then delete and restore the note. Delete one event after reading its confirmation. | Links can be shared across events. **Memory date** and **Saved on** are distinct from the event date. Unlinking or deleting an event preserves originals. Deleting a memory removes all its links; restoring returns it to the inbox without silently relinking. |
| I8 — Search your library | Open **Library**. Search a synthetic title, note, caption or guest name, then combine memory type, review status, memory-date year/precision and one tag. Try an empty result and clear the filters. Open a result from a later page and return. | Matching is literal and ignores letter case. Results stay newest-saved first; year bounds use the memory's date and exclude unknown dates. Applied filters and page context survive normal detail navigation, with a useful reload if results changed. Clearing filters restores the library. Hiding or signing out clears private search text and results. |
| I9 — Manage private tags | Create a synthetic tag, attach several test memories and rename it. Add a second tag to one memory from its detail view. Find those labels using the library tag chooser. Remove a label, then delete and restore the memory. Cancel a tag deletion, then delete the label. | Labels and their members remain private. Tag searches and pages are clear as the collection grows. Removing or deleting a label preserves originals. Memory Delete removes all labels; Restore requires deliberate reattachment. Conflicting or unconfirmed changes pause other actions until reconciled. |

For **I10 — Portable archive**, use only Ryan's synthetic archive. Open **Export archive**, prepare an export, check progress and prepare/download each original part followed by the index part. Extract every part into one private folder and open the offline reader while disconnected from the application. Check written memories, truthful dates, album order, events, tags and supplied original files. A missing-original scenario should show a clear incomplete report. Record whether the instructions and retry actions make sense; a “Download started” notice does not prove the browser saved the file. Ryan supplies expiry, interrupted-response or application-restart scenarios when available. Remove the deliberately downloaded test copies afterwards; signing out cannot remove them.

## Comfort and access checks

| ID | Check | Result boundary |
|---|---|---|
| A1 — Keyboard | Use Tab/Shift+Tab, Enter and Space through guest choices, forms, review, results and inbox actions. Try a validation error and Delete/Cancel. | Focus is visible and moves to useful feedback. Hidden forms are not reachable. Cancel returns focus sensibly. Record the exact step if you lose your place. |
| A2 — Larger text and narrow layout | Use 200% browser zoom and a narrow window. Include long synthetic names, captions and filenames. | Text and buttons remain readable; controls and important content are not clipped. Desktop resizing is preparation, not a physical-phone result. |
| A3 — Screen reader | When an actual screen reader is available, check field labels, validation, sending/saved announcements and private review feedback. | Record browser/OS and reader/version. Otherwise mark **Not tested**; visible labels or an automated semantic check do not prove audible announcements. |
| A4 — Phones and interruptions | Later, repeat relevant scenarios on physical iPhone Safari and Android Chrome, including permission refusal, background/lock interruption and touch controls. | **Pending physical-device acceptance.** Desktop/emulator checks cannot close this row. Ryan will arrange the intended environment and tester. |
| A5 — Connection and shared-network use | Later, exercise a real interruption, deliberate retry and several guests on the intended network. | **Pending actual network/hosted acceptance.** A synthetic lost response or a small local simultaneous run is useful preparation, not reception-network proof. |

## Results to return

Copy this template and add one row per scenario. No screenshots or credentials are needed.

```text
Date:
Tester:
Environment label supplied by Ryan: local demo / local app / approved hosted test
Reviewed build or run label supplied by Ryan:
Device / OS / browser and version:
Audio test option: unavailable / enabled for this synthetic exercise
Screen reader, if used:

Scenario ID | Pass / Issue / Not tested | Expected result | What happened

Most confusing step:
One thing you would change:
Would this be useful for you after the wedding? What would make it more useful?
```

A result applies only to the environment and actions actually tried. Ryan records the technical evidence separately and decides what needs another test. This draft does not mark QA-02, device, network or release acceptance complete.
