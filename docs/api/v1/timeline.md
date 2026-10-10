# Private life timeline — ARC-03

Kevin and Melanie can create private events or milestones and explicitly attach existing memories. Events are independent of albums and reference originals without copying or changing memory content, media, review decisions, memory dates or submission timestamps. All events remain `COUPLE_ONLY`.

## Dates and browsing

An event has a required title of at most 200 raw UTF-16 code units, an optional description of at most 2,000, and an independent `eventDate` / `datePrecision` pair. Values use the existing storable Unicode and date rules: `UNKNOWN` with null, `YEAR` with `yyyy`, `MONTH` with `yyyy-MM`, or `DAY` with Gregorian `yyyy-MM-dd`. Years are 0001–9999; future dates are allowed. Unknown fields, invalid Unicode and inconsistent dates are rejected.

Browsing is oldest first. Canonical partial dates sort before their more precise descendants: a year-only event precedes that year's months, and a month-only event precedes days in that month. Equal dates use immutable creation time and identity. Unknown dates appear last under **Events with unknown dates**, labeled **Date unknown**. Labels preserve actual precision; a year-only event does not claim January 1. Linked memories show their own **Memory date** and **Saved on** separately from the event date.

The list supports inclusive `fromYear` / `toYear` and `datePrecision=ALL|UNKNOWN|YEAR|MONTH|DAY`. Year bounds exclude unknown dates; `UNKNOWN` combined with a year bound is invalid. Page sizes are 1–50, default 20. Event lists and member pages are bounded; linking does not fetch original media.

## Routes and conditional changes

Every route requires `X-Api-Contract: 1`, a current enabled `COUPLE` account and the open reveal gate. Mutations also require current session CSRF and same-origin authority. Authorization is rechecked after lock waits and before successful completion. Create/edit JSON is bounded to 16,384 bytes; reads, deletion and membership routes reject bodies.

| Method and route | Purpose |
|---|---|
| GET `/api/timeline/events?limit=20&cursor=…` | Filtered chronological event page |
| PUT `/api/timeline/events/{eventId}` | Create a known UUID-v4 identity |
| GET `/api/timeline/events/{eventId}` | Read current event, including its tombstone |
| PATCH `/api/timeline/events/{eventId}` | Replace editable event metadata |
| DELETE `/api/timeline/events/{eventId}` | Delete only this event's organization |
| GET `/api/timeline/events/{eventId}/memories?limit=20&cursor=…` | Page linked available memories |
| PUT `/api/timeline/events/{eventId}/memories/{memoryId}` | Link an existing memory once |
| DELETE `/api/timeline/events/{eventId}/memories/{memoryId}` | Remove the relationship |

Create and edit use exactly `{ title, description, eventDate, datePrecision }`. Creation requires `If-None-Match: *` and returns 201; a used identity returns `412 TIMELINE_CONFLICT`, including after deletion. Read the same identity before resolving an uncertain create. A new UUID must not replace an unresolved creation.

Other changes require a strong `If-Match: "<revision>"` using the event's canonical UUID-v4 equality token. Missing conditions return `428 PRECONDITION_REQUIRED`, malformed conditions `400 VALIDATION_FAILED`, and stale changes `412 TIMELINE_CONFLICT`. Actual changes refresh affected event and timeline-list revisions; genuine no-ops preserve both. Successful changes return 200 with the current event and agreeing ETag.

Event details contain `eventId`, `title`, `description`, `eventDate`, `datePrecision`, `visibility`, `revision`, `memberCount`, `createdAt`, `updatedAt` and `deletedAt`. A deleted event has null title, description and date, `UNKNOWN` precision, zero links and a terminal deletion timestamp. List responses contain `{ revision, items, nextCursor }` with an agreeing list ETag. Member responses contain `{ event, items, nextCursor }`, where each item contains `{ memory }` using existing private memory details. Members sort by memory creation time and identity.

Listing cursors bind the timeline revision, canonical filters and anchor identity without including private titles or dates. Member cursors bind event identity and revision. Each page resolves its anchor and data in one database snapshot. Changed organization invalidates old cursors with `412 TIMELINE_CONFLICT`; malformed or mismatched current cursors return `400 INVALID_CURSOR`. Reload before continuing after a conflict.

## Privacy, interruption and deletion

Only completed private notes and verified available photo/audio memories in `PENDING`, `KEEP` or `ARCHIVED` can be linked or exposed. Unfinished, deleted, purging, purged or unavailable originals are excluded. Opening a linked memory uses existing private detail, media, review and metadata routes.

The browser shares one unresolved-write fence across timeline, albums, authoring, review, navigation and logout. Interrupted writes require a current read before deliberate exact retry; mutations are never automatically resent. A confirmed mutation remains confirmed if its follow-up read fails. Fresh revisions clear old member cards, candidates and cursors before another read. Hiding the archive clears private fields, cards, filters and drafts; only opaque unresolved action identity/revision and a one-way fingerprint of normalized metadata may remain for reconciliation. Retrying cleared metadata requires re-entering the exact matching fields.

Deleting an event scrubs its metadata and removes relationships while preserving a content-free identity for retry reconciliation. Unlinking has the same organization-only effect. Memory Delete atomically detaches that original from every event and refreshes affected event/list tokens. Restore returns it to the inbox without automatically relinking. Permanent retention and authoritative deletion replay defensively remove links too. The lock order is memory, existing album locks, timeline state, then event locks; other event changes lock state before event without subsequently locking memory.

## Recovery and compatibility

Additive V12 introduces `timeline_event`, `timeline_event_memory` and lazily created singleton `timeline_state`; V1–V11 remain unchanged. Fresh migration leaves these archive tables empty. Recovery v5 preserves the full timeline graph, revisions, partial dates and scrubbed tombstones. Exact reviewed v1–v4 packages restore upwards with empty timeline tables; v5 requires V12. Full graph validation precedes destination writes. Accounts, passwords, sessions and configuration remain excluded.

Current independent memory-erasure evidence removes restored links and erased originals while preserving unrelated memories and events. Event-only deletion has no independent deletion ledger; an older valid backup can restore earlier event metadata or organization. It cannot bypass authoritative memory erasure. V12 closes binary rollback to a V11 artifact under the existing migration guard; use a verified compatible build, fix forward or reviewed isolated recovery.

See [operator recovery](../../runbooks/operator-recovery.md) and [local verification](../../product/arc03-verification.md). Self-service couple export remains ARC-05; real onboarding, feedback, device and hosted acceptance remain separate release work.
