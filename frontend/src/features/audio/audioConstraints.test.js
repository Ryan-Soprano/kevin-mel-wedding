import assert from "node:assert/strict";
import test from "node:test";
import { AUDIO_ACCEPT, audioContentType, audioFileContentType } from "./audioConstraints.js";

test("file selection recognizes browser container labels and M4A aliases without changing recorder MIME rules", () => {
  for (const [name, type, expected] of [
    ["clip.webm", "video/webm", "audio/webm"],
    ["clip.WEBM", "audio/webm;codecs=opus", "audio/webm"],
    ["clip.webm", "audio/x-webm", "audio/webm"],
    ["clip.ogg", "application/ogg", "audio/ogg"],
    ["clip.oga", "application/x-ogg", "audio/ogg"],
    ["clip.ogg", "video/ogg", "audio/ogg"],
    ["clip.ogg", "audio/x-ogg", "audio/ogg"],
    ["clip.opus", "audio/ogg", "audio/ogg"],
    ["clip.m4a", "audio/x-m4a", "audio/mp4"],
    ["clip.M4A", "audio/m4a", "audio/mp4"],
    ["clip.m4a", "audio/x-mp4", "audio/mp4"],
    ["clip.mp4", "video/mp4", "audio/mp4"],
    ["clip.mp4", "application/mp4", "audio/mp4"],
  ]) {
    assert.equal(audioFileContentType(new File(["synthetic clip"], name, { type })), expected, `${name}: ${type}`);
  }
  for (const type of ["video/webm", "video/mp4", "audio/x-m4a", "application/ogg", ""]) {
    assert.equal(audioContentType(type), null, "recorder MIME acceptance remains strict");
  }
});

test("missing or generic file labels require a recognized container extension", () => {
  for (const type of ["", "application/octet-stream", "binary/octet-stream", "application/binary"]) {
    for (const [name, expected] of [["clip.webm", "audio/webm"], ["clip.ogg", "audio/ogg"],
      ["clip.oga", "audio/ogg"], ["clip.opus", "audio/ogg"], ["clip.m4a", "audio/mp4"], ["clip.mp4", "audio/mp4"]]) {
      assert.equal(audioFileContentType(new File(["synthetic clip"], name, { type })), expected);
    }
    for (const name of ["clip", "clip.bin", "clip.mp3", "clip.wav", "clip.webm.exe"]) {
      assert.equal(audioFileContentType(new File(["synthetic clip"], name, { type })), null);
    }
  }
});

test("conflicting container labels and unsupported file types cannot be inferred from a misleading extension", () => {
  for (const [name, type] of [
    ["clip.webm", "audio/mp4"], ["clip.ogg", "video/webm"], ["clip.m4a", "application/ogg"],
    ["clip.webm", "audio/x-m4a"], ["clip.webm", "audio/mpeg"], ["clip.m4a", "audio/wav"],
    ["clip.mp3", "audio/mpeg"], ["clip.wav", "audio/wav"], ["clip.mp3", "audio/webm"],
    ["clip.webm", "image/png"], ["clip.mp4", "text/plain"], ["clip.txt", "audio/mp4"],
  ]) {
    assert.equal(audioFileContentType(new File(["synthetic clip"], name, { type })), null, `${name}: ${type}`);
  }
  assert.equal(audioFileContentType(new Blob(["synthetic clip"], { type: "video/webm" })), null);
  assert.equal(audioFileContentType(new Blob(["synthetic clip"], { type: "audio/webm" })), "audio/webm");
});

test("the file picker includes supported extensions and no broad audio or video wildcard", () => {
  assert.deepEqual(AUDIO_ACCEPT.split(","), ["audio/webm", "audio/ogg", "audio/mp4", ".webm", ".ogg", ".oga", ".opus", ".m4a", ".mp4"]);
});
