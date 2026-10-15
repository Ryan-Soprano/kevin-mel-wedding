# Browser navigation and memory screen layout

Verified locally on October 14, 2026, using synthetic memories through the existing mock transport. No deployed archive data or credentials were used.

- Private archive Back and Forward reread screens through the controller. Inbox pages, applied filters, nested collections and memory return context live in disposable in-memory route records. Browser history stores only opaque ownership, entry keys and indices; URLs contain no private route data.
- Pending or unconfirmed memory, album, timeline, tag, metadata and export changes fence history traversal. Private creation reports its own submission state to the shell; leaving an unsaved private draft asks for discard confirmation. Auth loss, page exit and disposal invalidate private routes.
- Guest Back and Forward preserve visited forms and their drafts in memory. Busy or unconfirmed submissions block traversal; history never contains draft text or retry keys.
- Notes validate and submit from the compose form. The extra review screen was removed; the underlying submission coordinator and same-key retry behavior are unchanged.
- Albums, Timeline, Library, Tags and Export share React cards, action groups, empty states and pagination. Guest and private creation share memory-choice cards. Inbox screen adapters retain the original component reset keys and access checks.

Automated verification: frontend tests, lint and production build. Regression coverage includes history races, privacy clearing, pagination, mutation guards, draft-discard handling, malformed entries, stale Forward branches and screen adapter identities. The local slideshow assertion was excluded because a separate user edit changes its interval from 3.5 to 5 seconds; that source edit is outside this change. CI verifies the committed tree with its unchanged slideshow interval.

Interactive browser checks: archive Back/Forward; guest Back/Forward with a retained note draft; direct note submission; lost-response same-note retry; server validation and focus restoration; private draft-discard cancellation; private pending-save traversal and sign-out locks; desktop and narrow-screen layouts. This does not replace physical-phone and original-media acceptance checks tracked elsewhere.
