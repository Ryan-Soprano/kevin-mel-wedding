import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { audioCollectionEnabled } from "../../audio/audioConstraints.js";

test("private creator view hides voice collection behind the exact existing audio build gate", async () => {
  // SSR renders real React markup through installed Vite tooling. No DOM,
  // browser, microphone permission or codec acceptance is claimed here.
  const server = await createServer({ configFile: false, logLevel: "silent", root: fileURLToPath(new URL("../../../../", import.meta.url)),
    plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { default: AddMemory } = await server.ssrLoadModule("/src/features/inbox/components/AddMemory.jsx");
    const props = { getApi: () => ({}), onDone: () => {}, onBack: () => {} };
    for (const value of [undefined, "false", "TRUE", true]) {
      const markup = renderToStaticMarkup(createElement(AddMemory, { ...props, audioEnabled: audioCollectionEnabled(value) }));
      assert.match(markup, /Write a note/); assert.match(markup, /Add photos/);
      assert.doesNotMatch(markup, /Add a voice memory/);
    }
    const enabled = renderToStaticMarkup(createElement(AddMemory, { ...props, audioEnabled: audioCollectionEnabled("true") }));
    assert.match(enabled, /Add a voice memory/);
  } finally { await server.close(); }
});
