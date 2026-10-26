import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { pid } from "node:process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

test("pending-password screen precedes every archive route and exposes only password change or sign out", async () => {
  const server = await createServer({ configFile: false, logLevel: "silent", cacheDir: `node_modules/.vite/password-screen-${pid}`,
    root: fileURLToPath(new URL("../../../../", import.meta.url)), plugins: [react()],
    server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { default: Screen } = await server.ssrLoadModule("/src/features/inbox/components/InboxScreens.jsx");
    const noop = () => {};
    const render = (phase, recovery = false, retryAfter = 0) => renderToStaticMarkup(createElement(Screen, { view: {
      snapshot: { phase, busy: false, loginRetryAfterSeconds: retryAfter, session: { authenticated: true, passwordChangeRequired: true },
        detail: { title: "Private archive sentinel" }, passwordChange: { phase: recovery ? "uncertain" : "idle" } },
      changePassword: noop, retryAccess: noop, logout: noop,
    } }));
    for (const phase of ["password-change", "inbox", "detail", "create", "albums", "timeline", "library", "tags", "export"]) {
      const html = render(phase);
      assert.match(html, /aria-label="Choose your password"/);
      assert.match(html, /Current temporary password/); assert.match(html, /Repeat new password/);
      assert.equal((html.match(/type="password"/g) ?? []).length, 3);
      assert.equal((html.match(/autoComplete="new-password"/g) ?? []).length, 2);
      assert.match(html, /autoComplete="current-password"/); assert.match(html, /8 characters/);
      assert.match(html, /72 UTF-8 bytes/); assert.match(html, /Sign out/);
      assert.doesNotMatch(html, /Private archive sentinel|Add a memory|Back to inbox|value="/);
    }
    const uncertain = render("password-change", true);
    assert.match(uncertain, /Check my session/); assert.match(uncertain, /use your new password/);
    assert.match(uncertain, /not be sent again automatically/); assert.match(uncertain, /Sign out/);
    assert.doesNotMatch(uncertain, /type="password"|Save password and open archive/);
    const throttled = render("password-change", false, 3);
    assert.match(throttled, /wait 3 seconds/); assert.equal((throttled.match(/disabled=""/g) ?? []).length, 4);
    assert.match(throttled, /class="button-secondary">Sign out/);
    assert.doesNotMatch(render("password-change", true, 3), /disabled=""/);
  } finally { await server.close(); }
});
