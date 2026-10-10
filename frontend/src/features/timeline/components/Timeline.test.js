import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { initialTimeline } from "../api/timelineActions.js";
import { MEMORY_DETAIL } from "../../../shared/api/v1/fixtures.js";

const event = { eventId: "22222222-2222-4222-8222-222222222222", title: "Our <milestone>", description: "Private description",
  eventDate: "2024-03", datePrecision: "MONTH", visibility: "COUPLE_ONLY", revision: "33333333-3333-4333-8333-333333333333",
  createdAt: "2026-10-10T12:00:00Z", updatedAt: "2026-10-10T12:00:00Z", deletedAt: null, memberCount: 1 };
const noop = () => {}, actions = Object.fromEntries(["inbox", "list", "open", "beginCreate", "create", "edit", "delete", "select", "link", "unlink", "openMemory", "page", "reload", "retry"].map(key => [key, noop]));
test("real private timeline views expose honest partial dates, original dates/saved times, paging, exact recovery and tombstone controls", async () => {
  // Real SSR verifies view contracts. Root separately verifies actual Chrome
  // keyboard focus, phone/zoom layout and packaged authenticated HTTP flows.
  const server = await createServer({ configFile: false, logLevel: "silent", root: fileURLToPath(new URL("../../../../", import.meta.url)),
    plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { default: Timeline } = await server.ssrLoadModule("/src/features/timeline/components/Timeline.jsx");
    const render = (state, extra = {}) => renderToStaticMarkup(createElement(Timeline, { state: { ...initialTimeline(), ...state }, busy: false, locked: false, actions, ...extra }));
    const empty = render({}); assert.match(empty, /No events on this timeline page/); assert.match(empty, /Create a timeline event/);
    const list = render({ items: [event, { ...event, eventId: "44444444-4444-4444-8444-444444444444", eventDate: null, datePrecision: "UNKNOWN" }], nextCursor: "opaque-next" });
    assert.match(list, /March 2024/); assert.doesNotMatch(list, /March 1, 2024|2024-03-01/); assert.match(list, /Events with unknown dates/);
    assert.match(list, /From year \(inclusive\)/); assert.match(list, /A year range excludes unknown dates/); assert.match(list, /Next timeline page/);
    assert.match(list, /Our &lt;milestone&gt;/); assert.doesNotMatch(list, /<milestone>/);
    const create = render({ view: "create" }); assert.match(create, /Create a private timeline event/); assert.match(create, /Event date precision/); assert.doesNotMatch(create, /id="timeline-date"/);
    const detail = render({ view: "detail", event, members: [{ memory: { ...MEMORY_DETAIL, memoryDate: "2022", datePrecision: "YEAR" } }] });
    assert.match(detail, /Event date: March 2024/); assert.match(detail, /Memory date: Sometime in 2022/); assert.match(detail, /Saved on:/);
    assert.match(detail, /YYYY-MM/); assert.match(detail, /Save event details/); assert.match(detail, /Unlink from event/); assert.match(detail, /Guest contribution/);
    assert.doesNotMatch(detail.match(/<input[^>]*id="timeline-date"[^>]*>/)?.[0] ?? "", /inputMode="numeric"/);
    const yearDetail = render({ view: "detail", event: { ...event, eventDate: "2024", datePrecision: "YEAR" } });
    assert.match(yearDetail.match(/<input[^>]*id="timeline-date"[^>]*>/)?.[0] ?? "", /inputMode="numeric"/);
    assert.doesNotMatch(detail, /<img|<audio|\/playback/);
    const picker = render({ view: "select", event, candidates: [MEMORY_DETAIL], nextCursor: "opaque-next" }); assert.match(picker, /Link to event/); assert.match(picker, /Pending/); assert.match(picker, /Archived/);
    const locked = render({ view: "detail", event, mutation: { phase: "uncertain", error: "Unconfirmed", canRetry: true, needsFields: true } }, { locked: true });
    assert.match(locked, /Reload current event/); assert.match(locked, /Retry this same timeline change/); assert.match(locked, /timeline-retry-title/);
    assert.match(locked, /disabled=""[^>]*>Back to inbox/); assert.match(locked, /disabled=""[^>]*>Save event details/);
    const tombstone = render({ view: "detail", event: { ...event, title: null, description: null, eventDate: null, datePrecision: "UNKNOWN", deletedAt: event.updatedAt, memberCount: 0 } });
    assert.match(tombstone, /Deleted timeline event/); assert.match(tombstone, /original files remain/); assert.doesNotMatch(tombstone, /Save event details|Link memories|Delete this event/);
  } finally { await server.close(); }
});
