import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { initialTimeline } from "../api/timelineActions.js";
import { MEDIA_DETAIL, MEMORY_DETAIL } from "../../../shared/api/v1/fixtures.js";
import { ApiError } from "../../../shared/api/apiClient.js";
import {
  emptyEventFields,
  normalizeEventFields,
  normalizeTimelineFilters,
} from "../timelineFields.js";
import {
  getTimelineFeedback,
  getTimelineFilterErrors,
} from "../timelineDisplay.js";

const event = { eventId: "22222222-2222-4222-8222-222222222222", title: "Our <milestone>", description: "Private description",
  eventDate: "2024-03", datePrecision: "MONTH", visibility: "COUPLE_ONLY", revision: "33333333-3333-4333-8333-333333333333",
  createdAt: "2026-10-10T12:00:00Z", updatedAt: "2026-10-10T12:00:00Z", deletedAt: null, memberCount: 1 };
const noop = () => {}, actions = Object.fromEntries(["inbox", "list", "open", "beginCreate", "create", "edit", "delete", "select", "link", "unlink", "openMemory", "page", "reload", "retry"].map(key => [key, noop]));

function createViewServer() {
  return createServer({ configFile: false, logLevel: "silent", root: fileURLToPath(new URL("../../../../", import.meta.url)),
    plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
}

test("timeline-local validation identifies event fields and keeps filter and server feedback contracts distinct", () => {
  const fields = {
    title: "Milestone",
    description: null,
    eventDate: "2000-02-29",
    datePrecision: "DAY",
  };
  assert.deepEqual(normalizeEventFields(fields), fields);
  for (const [input, expected] of [
    [{ ...fields, title: " " }, ["title"]],
    [{ ...fields, eventDate: "1900-02-29" }, ["eventDate"]],
    [{ ...fields, description: "private\0description", eventDate: "1900-02-29" }, ["description", "eventDate"]],
  ]) {
    assert.throws(() => normalizeEventFields(input), (failure) => {
      assert.ok(failure instanceof ApiError);
      assert.equal(failure.code, "VALIDATION_FAILED");
      assert.deepEqual(failure.fieldErrors.map(item => item.field), expected);
      assert.ok(failure.fieldErrors.every(item => item.message));
      return true;
    });
  }
  assert.deepEqual(
    getTimelineFilterErrors({ fromYear: "1", toYear: "9999", precision: "ALL" }),
    {},
  );
  for (const [values, expected] of [
    [{ fromYear: "0", toYear: "", precision: "ALL" }, "fromYear"],
    [{ fromYear: "", toYear: "abcd", precision: "ALL" }, "toYear"],
    [{ fromYear: "2025", toYear: "2024", precision: "ALL" }, "toYear"],
    [{ fromYear: "2025", toYear: "", precision: "UNKNOWN" }, "datePrecision"],
  ]) {
    assert.deepEqual(Object.keys(getTimelineFilterErrors(values)), [expected]);
  }
  assert.throws(
    () => normalizeTimelineFilters({ fromYear: 2025, datePrecision: "UNKNOWN" }),
    TypeError,
    "the API filter normalizer retains its existing error contract",
  );
  assert.equal(
    getTimelineFeedback("Earlier local error", {
      ...initialTimeline(),
      mutation: { ...initialTimeline().mutation, error: "New server error" },
    }).text,
    "New server error",
  );
});
test("real private timeline views expose honest partial dates, original dates/saved times, paging, exact recovery and tombstone controls", async () => {
  // Real SSR verifies view contracts. Root separately verifies actual Chrome
  // keyboard focus, phone/zoom layout and packaged authenticated HTTP flows.
  const server = await createViewServer();
  try {
    const { default: Timeline } = await server.ssrLoadModule("/src/features/timeline/components/Timeline.jsx");
    const render = (state, extra = {}) => renderToStaticMarkup(createElement(Timeline, { state: { ...initialTimeline(), ...state }, busy: false, locked: false, actions, ...extra }));
    const empty = render({}); assert.match(empty, /No events on this timeline page/); assert.match(empty, /Create a timeline event/);
    assert.match(
      empty,
      /<h2[^>]*tab[Ii]ndex="-1"[^>]*class="visually-hidden">Timeline events · Page 1<\/h2>/,
    );
    assert.match(empty, /class="archive-intro"/); assert.match(empty, /class="archive-empty" role="status"/);
    assert.match(empty, /<svg[^>]*aria-hidden="true"[^>]*focusable="false"/);
    const list = render({ items: [event, { ...event, eventId: "44444444-4444-4444-8444-444444444444", eventDate: null, datePrecision: "UNKNOWN" }], nextCursor: "opaque-next" });
    assert.match(list, /March 2024/); assert.doesNotMatch(list, /March 1, 2024|2024-03-01/); assert.match(list, /Events with unknown dates/);
    assert.match(list, /From year \(inclusive\)/); assert.match(list, /A year range excludes unknown dates/); assert.match(list, /Next timeline page/);
    const filterGrid = list.match(/<div class="archive-filter-grid">[\s\S]*?<div class="archive-actions">/)?.[0] ?? "";
    assert.match(filterGrid, /id="timeline-from-year"/); assert.match(filterGrid, /id="timeline-to-year"/);
    assert.match(filterGrid, /<select id="timeline-filter-precision"/);
    assert.match(list, /Our &lt;milestone&gt;/); assert.doesNotMatch(list, /<milestone>/);
    const create = render({ view: "create" }); assert.match(create, /Create a private timeline event/); assert.match(create, /Event date precision/); assert.doesNotMatch(create, /id="timeline-date"/);
    const detail = render({ view: "detail", event, members: [{ memory: { ...MEMORY_DETAIL, memoryDate: "2022", datePrecision: "YEAR" } }] });
    assert.match(detail, /Event date: March 2024/); assert.match(detail, /Memory date: Sometime in 2022/); assert.match(detail, /Saved on:/);
    assert.match(detail, /Oct 24, 2026, 2:30 PM EDT<\/time> · Eastern/); assert.doesNotMatch(detail, /Chicago|CDT|CST/);
    assert.match(detail, /YYYY-MM/); assert.match(detail, /Save event details/); assert.match(detail, /Unlink from event/); assert.match(detail, /Guest contribution/);
    assert.match(
      detail,
      /class="visually-hidden">Linked timeline memories · Page 1<\/h2>/,
    );
    assert.doesNotMatch(detail.match(/<input[^>]*id="timeline-date"[^>]*>/)?.[0] ?? "", /inputMode="numeric"/);
    const yearDetail = render({ view: "detail", event: { ...event, eventDate: "2024", datePrecision: "YEAR" } });
    assert.match(yearDetail.match(/<input[^>]*id="timeline-date"[^>]*>/)?.[0] ?? "", /inputMode="numeric"/);
    assert.doesNotMatch(detail, /<img|<audio|\/playback/);
    const picker = render({ view: "select", event, candidates: [MEMORY_DETAIL], nextCursor: "opaque-next" }); assert.match(picker, /Link to event/); assert.match(picker, /Pending/); assert.match(picker, /Archived/);
    const locked = render({ view: "detail", event, mutation: { phase: "uncertain", error: "Unconfirmed", canRetry: true, needsFields: true } }, { locked: true });
    assert.match(locked, /Reload current event/); assert.match(locked, /Retry this same timeline change/); assert.match(locked, /timeline-retry-title/);
    assert.match(locked, /disabled=""[^>]*>Back to inbox/); assert.match(locked, /disabled=""[^>]*>Save event details/);
    assert.equal((locked.match(/<nav class="archive-pagination"[\s\S]*?<\/nav>/)?.[0].match(/disabled=""/g) ?? []).length, 2,
      "the shared pagination honors the pending-change lock");
    const busy = render({}, { busy: true });
    assert.match(busy, /disabled=""[^>]*>Create a timeline event/); assert.match(busy, /<select[^>]*disabled=""/);
    assert.match(busy, /Loading timeline events…/); assert.doesNotMatch(busy, /class="archive-empty"/);
    const tombstone = render({ view: "detail", event: { ...event, title: null, description: null, eventDate: null, datePrecision: "UNKNOWN", deletedAt: event.updatedAt, memberCount: 0 } });
    assert.match(tombstone, /Deleted timeline event/); assert.match(tombstone, /original files remain/); assert.doesNotMatch(tombstone, /Save event details|Link memories|Delete this event/);
  } finally { await server.close(); }
});

test("extracted timeline views preserve stale-page results, separate recovery drafts, exact date controls and locked confirmations", async () => {
  // Actual React markup checks presentation boundaries; mounted checks remain
  // responsible for focus restoration, draft retention and action arguments.
  const server = await createViewServer();
  try {
    const { default: Timeline } = await server.ssrLoadModule("/src/features/timeline/components/Timeline.jsx");
    const { default: TimelineEventFields } = await server.ssrLoadModule("/src/features/timeline/components/TimelineEventFields.jsx");
    const { default: TimelineRecovery } = await server.ssrLoadModule("/src/features/timeline/components/TimelineRecovery.jsx");
    const { default: TimelineDetail } = await server.ssrLoadModule("/src/features/timeline/components/TimelineDetail.jsx");
    const { default: TimelineMemorySummary } = await server.ssrLoadModule("/src/features/timeline/components/TimelineMemorySummary.jsx");
    const { default: TimelineList } = await server.ssrLoadModule(
      "/src/features/timeline/components/TimelineList.jsx",
    );
    const renderComponent = (Component, props) => renderToStaticMarkup(createElement(Component, props));
    const render = (state, extra = {}) => renderComponent(Timeline, { state: { ...initialTimeline(), ...state }, busy: false, locked: false, actions, ...extra });
    const stale = render({ error: "Page unavailable", items: [event], cursors: [null, "previous"], nextCursor: "next" });
    assert.match(stale, /Our &lt;milestone&gt;/);
    assert.match(stale, /Reload timeline first page/);
    assert.doesNotMatch(stale, /No events on this timeline page/);
    assert.equal((stale.match(/<nav class="archive-pagination"[\s\S]*?<\/nav>/)?.[0].match(/disabled=""/g) ?? []).length, 2);
    const failedEmpty = render({ error: "Page unavailable", items: [] });
    assert.match(failedEmpty, /<ol class="inbox-list timeline-events"><\/ol>/);
    assert.doesNotMatch(failedEmpty, /No events on this timeline page/);
    const busyStale = render({ error: "Page unavailable", items: [event] }, { busy: true });
    assert.match(busyStale, /Loading timeline events…/);
    assert.doesNotMatch(busyStale, /Our &lt;milestone&gt;|class="archive-empty"/);

    const unknown = { ...event, eventDate: null, datePrecision: "UNKNOWN" };
    const grouped = render({ items: [event, { ...unknown, eventId: "unknown-1" }, { ...unknown, eventId: "unknown-2" }] });
    assert.equal((grouped.match(/Events with unknown dates/g) ?? []).length, 1);
    const firstUnknown = render({ items: [unknown] });
    assert.match(firstUnknown, /Events with unknown dates/);
    assert.equal((firstUnknown.match(/Create a timeline event/g) ?? []).length, 1, "the create action stays in the shared intro");
    const candidate = { ...MEMORY_DETAIL, title: "Retained <candidate>" };
    const staleSelector = render({ view: "select", event, error: "Page unavailable", candidates: [candidate] });
    assert.match(staleSelector, /Retained &lt;candidate&gt;/);
    assert.doesNotMatch(staleSelector, /No memories on this page/);
    const staleMembers = render({ view: "detail", event, error: "Page unavailable", members: [{ memory: candidate }] });
    assert.match(staleMembers, /Retained &lt;candidate&gt;/);
    assert.match(staleMembers, /Unlink from event/);

    for (const [precision, date, length, placeholder] of [
      ["YEAR", "0001", 4, "YYYY"], ["MONTH", "2024-03", 7, "YYYY-MM"], ["DAY", "9999-12-31", 10, "YYYY-MM-DD"],
    ]) {
      const markup = renderComponent(TimelineEventFields, { fields: { ...emptyEventFields(), title: "Draft <title>", eventDate: date, datePrecision: precision }, onChange: noop, disabled: false });
      const input = markup.match(/<input[^>]*id="timeline-date"[^>]*>/)?.[0] ?? "";
      assert.match(input, /type="text"/);
      assert.match(input, new RegExp(`maxLength="${length}"`));
      assert.match(input, new RegExp(`placeholder="${placeholder}"`));
      assert.match(input, new RegExp(`value="${date}"`));
      if (precision === "YEAR") assert.match(input, /inputMode="numeric"/);
      else assert.doesNotMatch(input, /inputMode=/);
      assert.match(markup, /Draft &lt;title&gt;/);
    }
    const unknownFields = renderComponent(TimelineEventFields, { fields: emptyEventFields(), onChange: noop, disabled: false });
    assert.doesNotMatch(unknownFields, /id="timeline-date"/);

    for (const prefix of ["timeline", "timeline-retry"]) {
      const invalidFields = renderComponent(TimelineEventFields, {
        fields: {
          ...emptyEventFields(),
          title: " ",
          eventDate: "1900-02-29",
          datePrecision: "DAY",
        },
        onChange: noop,
        disabled: false,
        prefix,
        errors: {
          title: "Correct the title",
          eventDate: "Correct the date",
        },
      });
      assert.match(
        invalidFields,
        new RegExp(`id="${prefix}-title"[^>]*aria-invalid="true"[^>]*aria-describedby="${prefix}-title-error"`),
      );
      assert.match(
        invalidFields,
        new RegExp(`id="${prefix}-date"[^>]*aria-invalid="true"[^>]*aria-describedby="${prefix}-date-help ${prefix}-date-error"`),
      );
      assert.match(
        invalidFields,
        new RegExp(`<p id="${prefix}-title-error" class="form-error" role="alert">Correct the title<`),
      );
      assert.match(
        invalidFields,
        new RegExp(`<p id="${prefix}-date-error" class="form-error" role="alert">Correct the date<`),
      );
    }
    const invalidFilters = renderComponent(TimelineList, {
      view: {
        state: initialTimeline(),
        busy: false,
        disabled: false,
        actions,
        fromYear: "0",
        setFromYear: noop,
        toYear: "",
        setToYear: noop,
        precision: "UNKNOWN",
        setPrecision: noop,
        handlers: { filter: noop, clearFilters: noop },
        fieldErrors: {
          editor: { title: "Unrelated editor message" },
          filters: {
            fromYear: "Correct the year",
            datePrecision: "Clear the range or change precision",
          },
        },
      },
    });
    assert.match(
      invalidFilters,
      /id="timeline-from-year"[^>]*aria-invalid="true"[^>]*aria-describedby="timeline-from-year-error"/,
    );
    assert.match(
      invalidFilters,
      /id="timeline-filter-precision"[^>]*aria-invalid="true"[^>]*aria-describedby="timeline-filter-precision-error"/,
    );
    assert.doesNotMatch(invalidFilters, /Unrelated editor message/);

    const recoveryView = {
      state: { ...initialTimeline(), event, mutation: { phase: "csrf", error: "Refresh needed", canRetry: true, needsFields: true } },
      busy: false, locked: true, actions, retryFields: emptyEventFields(), handlers: { retry: noop, changeRetryFields: noop },
    };
    const recovery = renderComponent(TimelineRecovery, { view: recoveryView });
    assert.match(recovery, /class="archive-panel timeline-recovery"/);
    assert.match(recovery, /Refresh session and current event/);
    assert.match(recovery, /<input id="timeline-retry-title"[^>]*value=""/);
    assert.match(recovery, /Retry this same timeline change/);
    assert.doesNotMatch(recovery, /disabled=""|Our &lt;milestone&gt;/, "recovery stays editable while the ordinary view is locked");
    const busyRecovery = renderComponent(TimelineRecovery, { view: { ...recoveryView, busy: true } });
    assert.match(busyRecovery, /disabled="">Refresh session and current event/);
    assert.match(busyRecovery, /<input id="timeline-retry-title"[^>]*disabled=""/);
    const noRetry = renderComponent(TimelineRecovery, { view: { ...recoveryView, state: { ...recoveryView.state, mutation: { ...recoveryView.state.mutation, canRetry: false } } } });
    assert.doesNotMatch(noRetry, /timeline-retry-title|Retry this same timeline change/);

    const confirmationView = { state: { ...initialTimeline(), view: "detail", event }, busy: false, disabled: true, actions,
      fields: { title: event.title, description: event.description, eventDate: event.eventDate, datePrecision: event.datePrecision },
      confirmDelete: true, handlers: { save: noop, changeFields: noop, beginDelete: noop, cancelDeletion: noop, confirmDeletion: noop } };
    const confirmation = renderComponent(TimelineDetail, { view: confirmationView });
    assert.match(confirmation, /role="group" aria-labelledby="timeline-delete-heading"/);
    assert.match(confirmation, /disabled="">Cancel event deletion/);
    assert.match(confirmation, /disabled="">Delete this event/);
    assert.match(confirmation, /Linked memories and originals remain in your archive/);

    const photo = renderComponent(TimelineMemorySummary, { memory: { ...MEDIA_DETAIL, source: "COUPLE", title: "", caption: "", memoryDate: "2024-03", datePrecision: "MONTH" } });
    assert.match(photo, /<h3><\/h3>/);
    assert.match(photo, /Couple memory/);
    assert.match(photo, /class="inbox-excerpt"><\/p>/);
    assert.match(photo, /Memory date: March 2024/);
    assert.doesNotMatch(photo, /Guest contribution|wedding.jpg|<img|<audio|\/playback/);
    const filename = renderComponent(TimelineMemorySummary, { memory: { ...MEDIA_DETAIL, caption: null, guestName: "Guest <name>" } });
    assert.match(filename, /wedding.jpg/);
    assert.match(filename, /Guest contribution · From Guest &lt;name&gt;/);

    assert.deepEqual(getTimelineFeedback("", { ...initialTimeline(), error: "Later error" }),
      { visible: true, className: "form-error", role: "alert", text: "Later error" }, "server errors remain independent from earlier local validation");
    const emptyFirstError = render({ error: "", mutation: { phase: "idle", error: "Later mutation error", canRetry: false, needsFields: false } });
    assert.match(emptyFirstError, /class="form-error" role="alert"><\/p>/);
    assert.doesNotMatch(emptyFirstError, /Later mutation error/);
    const notice = render({ notice: "Current <notice>" });
    assert.match(notice, /class="inbox-review-notice" role="status">Current &lt;notice&gt;/);
  } finally { await server.close(); }
});
