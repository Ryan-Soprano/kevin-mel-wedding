# Private library search and tags — ARC-04

Kevin and Melanie can search their authorized private memories and organize them with tags. Search uses the existing PostgreSQL database. It does not inspect photo pixels or transcribe audio. Tags reference originals without changing their content, files, review state, memory dates or saved timestamps.

## Library search

`GET /api/library/memories` returns `{ items: [MemoryDetail], nextCursor }` using existing private memory details. Only completed private notes and verified available photo/audio memories in `PENDING`, `KEEP` or `ARCHIVED` are eligible. Deleted, purging, purged, unfinished and unavailable originals are excluded, including when they match the search text or tag. Eligibility uses the existing persisted verification/storage metadata; listing does not probe physical provider presence for every result.

| Parameter | Meaning |
|---|---|
| `q` | Optional trimmed text, at most 200 raw UTF-16 units using existing storable Unicode rules |
| `memoryType` | `ALL` (default), `TEXT`, `PHOTO` or `AUDIO` |
| `reviewStatus` | `ALL` (default), `PENDING`, `KEEP` or `ARCHIVED` |
| `datePrecision` | `ALL` (default), `UNKNOWN`, `YEAR`, `MONTH` or `DAY` |
| `fromYear`, `toYear` | Inclusive known memory-date years, 0001–9999 |
| `tagId` | Optional single canonical UUID-v4 tag identity |
| `limit` | 1–50; default 20 |
| `cursor` | Opaque continuation for these normalized filters |

Filters combine with AND. Blank search text means no text restriction. A nonblank query is one case-insensitive literal substring across title, description, written memory content, caption, guest name and original filename. Percent, underscore, backslash and quotes are literal characters; there is no wildcard, regular-expression, fuzzy or relevance-search syntax. SQL parameters bind the query.

Year bounds apply to **Memory date**, preserving actual year/month/day precision. They exclude unknown dates; `UNKNOWN` combined with a year bound or a reversed range is invalid. Filtering never invents January 1 or changes originals. Results always sort newest **Saved on** first, then canonical memory identity descending. Memory date and saved time remain separate labels. Opening results uses existing private detail/media routes; listing does not preload originals.

Pages are live, rather than an archive-wide historical snapshot. Each page resolves its eligible matching anchor, selected tag and rows in one SQL statement snapshot. The cursor stores only a format version, SHA-256 fingerprint of canonical filters and anchor memory identity; it contains no private query text, tag name or actual memory date. A malformed or mismatched-filter cursor returns `400 INVALID_CURSOR`; a no-longer-eligible/matching anchor returns `412 LIBRARY_CONFLICT`. Reload the first page with the same applied filters. A missing/deleted selected tag returns 404. New results and metadata/review/tag changes between pages can change what is visible.

Normal result-detail navigation preserves applied filters and the cursor stack and rereads the current page on return. A stale anchor keeps the filters and offers a first-page reload. Hiding private content clears search text, filters, selected names, cards, drafts and cursor context; resume checks access and starts a fresh unfiltered library read.

## Private tags

Tags use a required trimmed storable name of at most 200 raw UTF-16 units. Label names may repeat; UUID-v4 identities distinguish tags. Every tag is `COUPLE_ONLY`. Its detail contains `tagId`, `name`, `visibility`, `revision`, `memberCount`, `createdAt`, `updatedAt` and `deletedAt`.

| Method and route | Purpose |
|---|---|
| GET `/api/tags?q=…&limit=20&cursor=…` | Bounded live tag catalogue; optional literal name search |
| PUT `/api/tags/{tagId}` | Create known UUID-v4 identity with `{ name }` |
| GET `/api/tags/{tagId}` | Current tag, including terminal tombstone |
| PATCH `/api/tags/{tagId}` | Rename with `{ name }` |
| DELETE `/api/tags/{tagId}` | Remove only this label and its relationships |
| GET `/api/tags/{tagId}/members?limit=20&cursor=…` | Bounded current tagged memories |
| PUT `/api/tags/{tagId}/members/{memoryId}` | Attach an eligible existing memory once |
| DELETE `/api/tags/{tagId}/members/{memoryId}` | Remove only this association |
| GET `/api/library/memories/{memoryId}/tags?limit=20&cursor=…` | Bounded current labels attached to one eligible memory |

Catalogue and memory-tag reads return bounded tag details, ordered by immutable tag creation time and identity descending. The catalogue returns `{ items, nextCursor }`; attachment reads additionally identify `memoryId`. Their cursors bind query or memory context and anchor identity. Anchors that are no longer available, attached or matching return `412 TAG_CONFLICT`; malformed or mismatched cursors return `400 INVALID_CURSOR`. Memory attachment reads reject deleted/unavailable originals with 404.

Tag member pages return `{ tag, items: [{ memory }], nextCursor }`, with eligible memories ordered by saved time and identity descending. Tag revision, member count, anchor and rows share one statement snapshot. Member cursors bind tag identity, revision and anchor memory identity without private text or dates. Changed tag revision returns `412 TAG_CONFLICT`.

Create requires `If-None-Match: *` and returns 201 with current tag and agreeing strong ETag. A used identity, including its tombstone, returns 412. Rename, deletion and membership changes require `If-Match: "<revision>"` and return 200 with current tag and agreeing ETag. Missing conditions return 428, malformed inputs 400 and stale conditions `412 TAG_CONFLICT`. Actual changes rotate the UUID-v4 equality token; current no-ops retain it. Member IDs include supported legacy memory UUIDs.

All routes require `X-Api-Contract: 1`, a current enabled `COUPLE` account and the open reveal gate. Writes require current session CSRF and same-origin authority. Authority is rechecked after lock waits and before success. Create/rename bodies are bounded to 16,384 bytes; all other routes are bodyless. Listing routes reject unknown/repeated query parameters. The UI shares the existing unresolved-write fence with review, metadata, authoring, albums, timeline, navigation and logout. Read current state before deliberate exact retry; a new identity cannot replace an unresolved creation. Hide retains only opaque reconciliation identities/revisions and a one-way name fingerprint.

## Deletion, recovery and scale

Tag deletion scrubs its name and removes associations while retaining a content-free terminal identity. Unlinking and tag deletion preserve originals. Original memory Delete atomically detaches every tag and refreshes affected tag revisions; Restore returns to the inbox without automatically attaching labels. Lock order is memory, existing albums, timeline state/events, then sorted tag locks. Other tag mutations never acquire a memory lock after a tag lock.

Additive V13 introduces `tag` and `memory_tag` with reverse association and private-library saved-time indexes. Fresh migration leaves tag archive tables empty. Recovery v6 preserves tags, revisions and scrubbed tombstones; exact reviewed v1–v5 packages restore upwards with empty tag tables. v6 requires V13, with full graph validation before writes. Installed target version governs locks, emptiness checks and erasure replay. Current independent memory-erasure evidence removes restored associations and erased originals while preserving unrelated tags and sibling memories.

Tag-only deletion has no independent deletion ledger; an older valid package can restore earlier labels or organization. It cannot bypass authoritative memory erasure. V13 closes binary rollback to a V12 artifact under the existing guard. Couple self-service export remains ARC-05. Physical-device/provider/hosted acceptance and real couple feedback remain separate release work. Representative archive-size correctness and observed query plans belong in the local verification record; literal substring queries may scan eligible rows, and no hosted latency or capacity claim follows from a local fixture.
