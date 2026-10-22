# Private inbox style consistency — October 22, 2026

Ryan requested that the private archive closely match the main guest page's
forms, hooks, style and behavior across its sections and subpages. This is a
frontend presentation change. Coming Soon and the deployment hold remain in
effect; account activation and reveal are separate.

## Changes

- The private foundation uses the existing self-hosted Manrope/Fraunces fonts
  and guest colors. Fields, focus outlines, buttons, panels, review controls,
  metadata and tag editors share one private styling foundation.
- Private photo/audio forms use the same form/media styles as guest forms.
  The existing submission components and hooks remain shared, with their
  private copy, account-bound requests and retry ownership intact. The guest
  photo-only rule that hides a repeated heading remains guest-only.
- Inbox empty states and pagination reuse the organization screens' archive
  components. Memory detail uses the same screen/action spacing with a detail
  panel. Existing labels, error-page text, refs and action handlers remain.
- No API, backend, authentication, lifecycle, navigation controller, dependency,
  public layout or deployment configuration changes are included.

## Local evidence

The existing frontend suite passed **592/592** tests; lint and the production
build passed. Guest CSS invariance was checked by reversing the 81 selector
expansions: the result exactly matches the previous file, after newline
normalization. Declarations and selector specificity are preserved.

The actual Inbox and its real controllers/hooks were mounted in an ignored,
loopback-only Vite preview, using disposable in-memory mock data and synthetic
JPEG/audio fixtures. It loads no environment files, starts no backend and blocks
provider/API network requests. Its entry and fixtures are under
`logs/private-inbox-design.local/`; they are excluded from the production build
and Git. Physical microphone access is disabled in that preview.

Desktop inspection confirmed Manrope body text and Fraunces headings. At a
**320-pixel viewport**, no horizontal document overflow was observed in sign-in,
inbox, empty inbox, access failure, note confirmation, memory detail/metadata,
album list/detail, timeline list/editor, library filters/results, tag list/detail,
export guide/progress, or private photo/audio forms. Text inputs/selects and
buttons retain at least 48-pixel height; the intentionally hidden photo file
input remains 1 × 1 pixel.

A synthetic private note exercised empty-field validation and its focused error,
then a successful save and focused confirmation. Opening it retained private
attribution; metadata fields expanded correctly. Delete confirmation focused
Cancel, and cancelling restored focus to Delete. The audio denial fallback and
access-error recovery remained visible and usable. Temporary viewport overrides
were reset afterward.

## Limits

This is local design verification. It does not establish hosted acceptance,
physical-device or screen-reader acceptance, new media-upload/recovery evidence,
real microphone behavior, successful private-link issuance, or portable-export
integrity. Existing privacy, retry, access and organization regression tests
remain the behavioral evidence; no new controller or mock-only production path
was introduced. The preview's private-link success case is unsupported, and its
export is a synthetic fixture. No real memories or hosted data were changed.
