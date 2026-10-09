import assert from "node:assert/strict";
import test from "node:test";
import { stopAudioPlayback } from "./audioPlayback.js";

test("private audio stops playback, clears its source and resets decoded bytes before view cleanup", () => {
  const calls = [];
  stopAudioPlayback({ pause: () => calls.push("pause"), removeAttribute: name => calls.push("remove " + name), load: () => calls.push("reset") });
  assert.deepEqual(calls, ["pause", "remove src", "reset"]);
  stopAudioPlayback(null);
});

test("a browser pause failure cannot prevent clearing the private media source", () => {
  const calls = [];
  stopAudioPlayback({ pause: () => { throw new Error("browser failure"); }, removeAttribute: name => calls.push(name), load: () => calls.push("reset") });
  assert.deepEqual(calls, ["src", "reset"]);
});
