import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { MEMORY_DETAIL } from "../../../shared/api/v1/fixtures.js";

const PRIMARY_ACTIONS = ["Keep Private", "Share with Friends &amp; Family", "Share with Public", "Delete"];
const EXPECTED_ACTIONS = {
  PENDING: [...PRIMARY_ACTIONS, "Archive"],
  KEEP: [...PRIMARY_ACTIONS, "Archive"],
  ARCHIVED: [...PRIMARY_ACTIONS, "Restore to inbox"],
  DELETE: ["Restore to inbox"],
};

function buttons(markup) {
  return [...markup.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)]
    .map(([, attributes, label]) => ({ label, disabled: attributes.includes('disabled=""') }));
}

test("memory review keeps sharing choices and the existing Archive/Restore actions across every review state", async () => {
  // Real React SSR checks the rendered action contract. Existing controller
  // transition tests cover persistence and callback behavior separately.
  const server = await createServer({ configFile: false, logLevel: "silent", root: fileURLToPath(new URL("../../../../", import.meta.url)),
    plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { default: MemoryReview } = await server.ssrLoadModule("/src/features/inbox/components/MemoryReview.jsx");
    const noop = () => {};
    function render(reviewStatus, { busy = false, locked = false, confirmingDelete = false } = {}) {
      return renderToStaticMarkup(createElement(MemoryReview, {
        memory: { ...MEMORY_DETAIL, reviewStatus, visibility: "COUPLE_ONLY" },
        review: { phase: "idle", error: null, canRetry: false }, busy, locked,
        controls: { confirmingDelete, change: noop, beginDelete: noop, cancel: noop },
        actions: { reload: noop, retry: noop, refresh: noop },
      }));
    }

    for (const [status, expected] of Object.entries(EXPECTED_ACTIONS)) {
      const available = buttons(render(status));
      assert.deepEqual(available.map(button => button.label), expected, `${status} exposes only its supported actions`);
      assert.ok(available.every(button => !button.disabled), `${status} actions are available when idle`);

      const busy = buttons(render(status, { busy: true }));
      assert.deepEqual(busy.map(button => button.label), expected, `${status} retains its actions while busy`);
      assert.ok(busy.every(button => button.disabled), `${status} cannot send another action while busy`);

      assert.deepEqual(buttons(render(status, { locked: true })), [], `${status} hides normal actions while recovery is locked`);
    }

    for (const status of ["PENDING", "KEEP", "ARCHIVED"]) {
      const confirming = render(status, { confirmingDelete: true });
      assert.match(confirming, /<fieldset[^>]*aria-describedby="inbox-delete-copy"/);
      assert.deepEqual(buttons(confirming).map(button => button.label), ["Cancel", "Confirm delete"],
        `${status} hides sharing, Archive and Restore during deletion confirmation`);
      assert.ok(buttons(render(status, { confirmingDelete: true, busy: true })).every(button => button.disabled));
    }
  } finally { await server.close(); }
});
