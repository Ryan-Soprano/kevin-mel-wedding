import test from "node:test";
import assert from "node:assert/strict";
import { attachPasswordFormPrivacy, passwordChangeValidation, readAndClearPasswordForm } from "./passwordChange.js";

const valid = { currentPassword: "synthetic temporary password", newPassword: "a new synthetic password", repeatedPassword: "a new synthetic password" };
test("password policy counts Unicode code points and enforces UTF-8 bytes without trimming", () => {
  assert.equal(passwordChangeValidation(valid), null);
  const check = newPassword => passwordChangeValidation({ ...valid, newPassword, repeatedPassword: newPassword });
  assert.match(check("a".repeat(7)), /8 characters/);
  assert.equal(check("a".repeat(8)), null);
  assert.match(check("😀".repeat(7)), /8 characters/);
  assert.equal(check("😀".repeat(8)), null);
  assert.equal(check("😀".repeat(18)), null);
  assert.match(check("😀".repeat(19)), /72 UTF-8 bytes/);
  assert.equal(check("a".repeat(72)), null); assert.match(check("a".repeat(73)), /72 UTF-8 bytes/);
  assert.equal(check(" 123456 "), null);
  assert.match(check(valid.currentPassword), /different/);
  assert.match(passwordChangeValidation({ ...valid, repeatedPassword: "different" }), /do not match/);
  for (const invalid of ["a".repeat(8) + "\0", "a".repeat(8) + "\ud800", "a".repeat(8) + "\udc00"]) assert.match(check(invalid), /valid text/);
  assert.match(passwordChangeValidation({ ...valid, currentPassword: "" }), /current temporary/);
});

function formFixture() {
  const fields = Object.fromEntries(Object.entries(valid).map(([name, value]) => [name, { value }]));
  const form = { elements: { namedItem: name => fields[name] }, reset() { for (const field of Object.values(fields)) field.value = ""; } };
  return { form, fields };
}
test("reading a submitted form clears all three DOM values synchronously", () => {
  const { form, fields } = formFixture();
  assert.deepEqual(readAndClearPasswordForm(form), valid);
  assert.ok(Object.values(fields).every(field => field.value === ""));
});
test("password form privacy clears hidden/BFCache/unmounted forms and detaches listeners", () => {
  const { form, fields } = formFixture(), eventTarget = new EventTarget(), documentTarget = new EventTarget();
  documentTarget.visibilityState = "visible";
  const detach = attachPasswordFormPrivacy(form, { eventTarget, documentTarget });
  documentTarget.visibilityState = "hidden"; documentTarget.dispatchEvent(new Event("visibilitychange"));
  assert.ok(Object.values(fields).every(field => field.value === ""));
  fields.newPassword.value = "synthetic pagehide draft"; eventTarget.dispatchEvent(new Event("pagehide"));
  assert.equal(fields.newPassword.value, "");
  fields.currentPassword.value = "synthetic unmount draft"; detach(); assert.equal(fields.currentPassword.value, "");
  fields.currentPassword.value = "unowned form"; eventTarget.dispatchEvent(new Event("pagehide"));
  assert.equal(fields.currentPassword.value, "unowned form");
});
