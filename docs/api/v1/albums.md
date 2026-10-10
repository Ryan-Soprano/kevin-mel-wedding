# Private albums and event collections — ARC-02

Kevin and Melanie share private named albums for weddings, trips, anniversaries and other collections. Membership is many-to-many: one memory can appear in several albums, with independent order in each. Albums reference memories; they never copy or replace original content or media. Every album remains `COUPLE_ONLY`, with no publication or guest album route.

## Routes and conditional changes

All routes require `X-Api-Contract: 1`, a current enabled `COUPLE` account and the open reveal gate. Mutations require the session's `X-CSRF-Token` and same-origin authority. Authorization is rechecked after waiting for locks. These endpoints use the existing private session boundary and bounded request-body handling. Create/rename JSON is limited to 16,384 bytes and move JSON to 1,024 bytes; album reads, deletion and membership add/remove reject bodies. Oversized JSON returns `413 PAYLOAD_TOO_LARGE`; a body on a bodyless route returns `400 VALIDATION_FAILED`.

| Method and route | Purpose |
|---|---|
| GET `/api/albums?limit=20&cursor=…` | Page through active albums |
| PUT `/api/albums/{albumId}` | Create a known UUID-v4 album identity with `{ "name": "Wedding" }` |
| GET `/api/albums/{albumId}` | Read current organization, including a deleted identity |
| PATCH `/api/albums/{albumId}` | Rename with `{ "name": "Wedding weekend" }` |
| DELETE `/api/albums/{albumId}` | Delete only this album's organization |
| GET `/api/albums/{albumId}/members?limit=20&cursor=…` | Page through ordered available memories |
| PUT `/api/albums/{albumId}/members/{memoryId}` | Add a memory once, at the end |
| DELETE `/api/albums/{albumId}/members/{memoryId}` | Remove the association |
| POST `/api/albums/{albumId}/members/{memoryId}/move` | Move with `{ "direction": "EARLIER" }` or `"LATER"` |

Page sizes are 1–50, default 20. Album names are required, nonblank after trimming, valid storable Unicode, and at most 200 raw UTF-16 code units. Duplicate names are allowed; UUIDs distinguish albums. Unknown request-body fields and invalid supported route/query/body values are rejected.

Creation requires `If-None-Match: *`. The first successful creation returns 201. A previously used identity returns `412 ALBUM_CONFLICT`, including after deletion; read that same identity to reconcile. A delayed creation retry cannot recreate a deleted album. Do not replace an uncertain create with a new UUID without resolving the original identity.

Rename, delete and membership changes require `If-Match: "<revision>"`, a strong quoted canonical UUID-v4 token from the current album. Missing preconditions return `428 PRECONDITION_REQUIRED`; malformed tokens return `400 VALIDATION_FAILED`. Stale changes return `412 ALBUM_CONFLICT`. Every actual organization change generates a fresh token and keeps `updatedAt` nondecreasing. Genuine no-ops at the current token preserve it. The response is the current album with an agreeing ETag; successful changes return 200. Revisions are equality tokens, not numbers or memory-review revisions.

Album details contain `albumId`, `name`, `visibility`, `revision`, `memberCount`, `createdAt`, `updatedAt` and `deletedAt`. A deleted identity has a null name, zero members and a deletion timestamp. Album-list responses contain `{ items, nextCursor }`. Member pages contain `{ album, items, nextCursor }`; each item has `{ memory, canMoveEarlier, canMoveLater }`, using the existing private memory detail. Membership cursors bind album identity, revision and the server's ordered position. A changed revision invalidates an old member cursor with `412 ALBUM_CONFLICT`; reload the collection before continuing.

Earlier/later moves find the adjacent member on the server, including across page boundaries. Large albums require neither a whole-album reorder payload nor downloading all original media. Positions are positive sparse PostgreSQL BIGINT values, opaque to the browser. Removing a member preserves the relative order of its siblings.

## Membership, privacy and deletion

Available completed notes and verified photo/audio memories in `PENDING`, `KEEP` or `ARCHIVED` can be organized. Unfinished, unavailable, deleted, purging or purged memories cannot be added or exposed by an album. Membership pages and counts apply this private availability boundary. Opening a member uses existing memory detail/media permissions, review and editable metadata.

Deleting an album scrubs its name and removes its links, while retaining a terminal content-free identity for retry reconciliation. It does not delete or change any original memory, file, review decision or editable detail. Removing a member has the same organization-only effect. Deleting a memory removes all of its album links atomically and changes the affected album revisions. Restoring that memory returns it to the inbox; either partner can deliberately add it to collections again. Permanent retention and independent memory-deletion replay defensively remove relationships too.

The browser uses the archive's existing session/privacy lifecycle and one unresolved-write fence across organization, review, authoring, navigation and logout. On interrupted changes it reads current state before offering a deliberate exact retry; it never automatically resends a mutation or attributes a changed state to a particular actor. Hiding the archive clears private names, content and drafts. Only opaque unresolved identity/action data and a one-way name fingerprint can remain for fresh-session reconciliation. An exact name retry after clearing requires re-entering the matching name.

## Recovery and compatibility

Additive migration V11 introduces albums and ordered memberships without changing V1–V10. Recovery package v4 preserves album identities, names, UUID revisions, tombstones and membership order alongside original archive data. Exact reviewed v1/v2/v3 packages restore upwards with empty album tables; v4 requires V11 and cannot restore into an older target. Full graph validation precedes destination mutation. Accounts, passwords, sessions and provider configuration remain excluded.

Current independent memory-deletion evidence removes restored relationships to erased memories and preserves unrelated members, originals and empty albums. Album-only deletion is organization maintenance, without an independent album-deletion ledger: an older valid backup can restore earlier album names or organization. It cannot bypass authoritative memory erasure. Preserve the current source deletion ledger and follow the existing isolated recovery procedure.

V11 closes binary rollback to a V10 artifact under the migration guard. Use a verified compatible V11 build, fix forward, or perform reviewed isolated recovery. See [operator recovery](../../runbooks/operator-recovery.md) and [local verification](../../product/arc02-verification.md). Real onboarding, couple feedback, device and hosted acceptance remain separate release work.
