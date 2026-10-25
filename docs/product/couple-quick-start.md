# Kevin and Melanie's archive: quick start

Updated October 25, 2026. This guide explains your private archive and first sign-in.

Your guest memories and the memories you add yourselves share one private archive. You decide which submissions to keep, archive or delete, and what to share. Ryan runs the infrastructure, handles account recovery, maintains backups and has a separate administrator account. Kade helps with development.

## Getting access

Open the [private inbox](https://kevinandmel.com/?view=inbox). Kevin's username is `kevin-admin`; Melanie's is `melanie-admin`. Ryan supplies each temporary password privately. Enter your own username and temporary password, then choose **Sign in**.

On your first sign-in, choose a different password and repeat it. Use at least 15 characters; a passphrase works well. Complete this step before opening your memories. After it succeeds, use your chosen password for future sign-ins; the temporary password stops working.

Keep passwords private and use your separate accounts. If the connection drops during the password change, check access again; if asked to sign in, try the new password you chose. Contact Ryan if you cannot get in, and avoid repeated attempts while a retry delay is displayed.

## Review guest memories

Guests need no account to contribute. Their names are optional, and every confirmed contribution enters **Pending** privately. The public couple-photo gallery is separate from those contributions.

From **Memory inbox**, choose a status, then **Open memory**. Use **Previous page** and **Next page** for more results. Each photo or note is an individual memory, even when a guest submitted several photos together.

| Control | What happens |
|---|---|
| **Keep privately** | Moves the memory to **Kept**. It remains couple only. |
| **Archive** | Moves it to **Archived** for later browsing. It remains available in the library and eligible for export. |
| **Restore to inbox** | Returns an archived or recoverable deleted memory to **Pending** for another review. |
| **Delete…** | Opens a confirmation. **Confirm delete** moves this individual memory to **Recently deleted** and removes every album, event and tag link. **Cancel** leaves it alone. |

Keeping and archiving do not publish anything. Deleting one memory does not delete the other items in its guest submission.

To undo a deletion, open **Recently deleted**, open the memory and choose **Restore to inbox** before its displayed recovery deadline. The window is 30 days from its first deletion; use the date shown in the app. You must add it back to albums, events and tags yourselves. Deleted photos and audio cannot be opened or downloaded, and the memory becomes unavailable after its recovery window. Do not rely on backups to undo that deadline.

When media is available in an accepted environment, an opened memory offers its original preview and **Download original photo** or **Download original audio**. Keep downloaded files private; signing out cannot erase copies already saved on a device.

## Add your own memories and context

From the inbox, choose **Add a memory**, then **Write a note**. Write your memory, choose **Review note**, then **Save note privately**. Wait for the saved confirmation, then choose **View added memory**. Your additions start in **Kept** and carry the **Couple memory** label.

**Add photos** accepts up to five original JPEG, PNG or WebP photos, up to 10 MB each, when storage is available. HEIC/HEIF is unsupported. Review the selection, choose **Save photos privately**, and check each photo's result. A transfer alone is not a saved confirmation. If some photos remain unsaved, use **Retry selected photos** for those items; confirmed photos stay saved. Adding voice memories remains gated pending the audio release checks; it is unavailable in the local review.

Open any available guest or couple memory to add a **Title**, **Description** and **Memory date** under **Memory details**. Choose only the date precision you know: unknown, year (`2024`), year and month (`2024-06`), or full date (`2024-06-15`). Choose **Save memory details** and wait for confirmation.

These fields add context. They preserve the submitted note, caption and original file. **Memory date** describes when the remembered event happened; **Saved on** describes when the memory entered the archive. Saved times, recovery deadlines and export times are displayed in Eastern time, including daylight-saving changes. The portable reader and complete readable archive use Eastern time too; machine-readable timestamps remain UTC.

## Organize your archive

**Albums:** choose **Create an album**, enter a name, then **Create album**. Open it and choose **Add memories**; select **Kept**, **Pending** or **Archived**, then **Add to album** beside a memory. **Move earlier** and **Move later** change its order. One memory can belong to several albums. **Remove from album** and **Delete album…** preserve the memories and original files. To rename an album, edit **Album name** and choose **Save album name**.

**Timeline:** choose **Create a timeline event**, enter a title, optional description and the date precision you know, then **Create event**. Open the event and use **Link memories**, then **Link to event**. An event date is separate from each linked memory's date. Unknown-date events have their own group; year filters apply to known event dates. **Unlink from event** or **Delete event…** preserves the memories. Use **Save event details** to update the event itself.

**Library:** enter **Search text**, choose any type, review-status, date-precision or year filters, and select **Apply library filters**. **Choose tag filter** lets you select one tag. All selected filters must match. Text search checks titles, descriptions, written notes, captions, guest names and filenames; it does not recognize objects in photos or transcribe audio. Year bounds use **Memory date**, exclude unknown dates and include the boundary years. Results show the newest saved memories first. **Back to library** preserves your search during ordinary detail browsing; **Reset library search** starts over.

**Tags:** use **Tags** from the inbox or **Manage tags** from the library to create or rename labels such as “Family” or “Trips.” In a memory's **Memory tags**, choose **Add tags**, find a label and choose **Attach tag**. A memory can have several tags. **Remove tag**, **Remove from tag** and **Delete tag…** preserve its original content. Removing a label from a memory does not delete the label itself.

## Save a portable copy

Choose **Export archive**, then **Prepare archive export**. This captures completed Pending, Kept and Archived memories, their details, albums, timeline events and tags. Deleted and unfinished memories are excluded. The download is a readable copy, not a database backup or an import package.

1. Use **Check export progress** until ZIP parts are ready.
2. For each **Original files** part, choose **Prepare this part**, check progress, then **Load and verify ZIP part**. When verification succeeds, choose **Save verified ZIP part** and confirm it actually saved in your browser's downloads.
3. Save that part before preparing another: only one prepared ZIP is cached at a time. Repeat for every original part, using **Next ZIP parts** if needed.
4. Prepare, verify and save the **Final index and offline reader** part last. In the notes-only local review, this is the only part.
5. Extract every ZIP from this export into the same new private folder. Open `index.html` to read it offline. `archive.txt` contains the complete captured text; the reader shows bounded previews. Keep `README.txt` and the manifest with the files.

Check **Original-file warnings** and the final report. Missing or unreadable originals make the copy incomplete. Ask Ryan for help with a warning; an export cannot manufacture a missing file. A “complete” status confirms processing, not that your browser saved every part.

If you retry an original part, prepare and save the final index again so its report is current. If the archive changes, the job expires, or the app restarts, explicitly **Start a new export** and save its parts into a new folder. Do not mix parts from different captures. Jobs expire after 30 minutes without activity and show their final deadline. **Cancel export…** discards temporary export files while preserving the archive and copies already downloaded.

## Finish, recover and get help

Keep the page open while a save is pending or unconfirmed. The app pauses other changes, navigation and sign-out until that action is checked. Use the offered **Reload current state**, current-details check or **Check unconfirmed export action** first. Review what is now saved, then use the offered same-action retry if needed. Do not create a second submission, album, event, tag or export to guess whether the first succeeded. If your partner changed the same item, reload it before deciding whether to apply your edit again.

Switching away from the private page clears private presentation, unfinished drafts and search context. Returning checks access again. Confirm saves before switching apps; the archive does not retain unsaved drafts for later. A confirmed memory stays saved.

Choose **Sign out** when finished and wait for confirmation. If offered **Retry signing out**, use it to confirm the server session ended. **Check access again** can recover a failed access check. If login is temporarily limited, wait for the displayed retry time instead of repeatedly trying.

For a forgotten password, unavailable access or a suspected account compromise, contact Ryan directly. Ryan verifies your identity and handles recovery; keep passwords, private download links and account details out of feedback notes and screenshots. Password recovery ends earlier sessions but cannot erase downloaded files.

During the local review, tell Ryan what you tried, what you expected, the visible result and the device/browser. Use made-up contributions and the [tester results template](qa02-tester-guide.md). Ryan signs off cleanup using the [local walkthrough](../runbooks/local-couple-review.md). Your feedback informs the next improvements; actual onboarding, phone/provider tests and wedding release acceptance remain on the [release checklist](wedding-release-checklist.md).
