import test from "node:test";
import assert from "node:assert/strict";
import { PINNED_IMAGE, parseReceptionArguments, assertReceptionOwnership, receptionPool, receptionTimings } from "./reception-helpers.mjs";

test("reception CLI refuses mutable, remote and uncontrolled inputs before Docker work", () => {
  assert.deepEqual(parseReceptionArguments([]), { image: PINNED_IMAGE });
  assert.deepEqual(parseReceptionArguments(["--image", PINNED_IMAGE]), { image: PINNED_IMAGE });
  assert.deepEqual(parseReceptionArguments(["--probe-failure-cleanup", "--image", PINNED_IMAGE]), { image: PINNED_IMAGE, probeFailureCleanup: true });
  assert.equal(parseReceptionArguments(["--help"]).help, true);
  for (const args of [["--image", "archive:latest"], ["--image", "123456"], ["--image", "https://fixture.invalid"],
    ["--image", "registry.invalid/archive@" + PINNED_IMAGE], ["--image", PINNED_IMAGE, "--pull"],
    ["--image", PINNED_IMAGE, "--image", PINNED_IMAGE], ["toString", PINNED_IMAGE], ["__proto__", PINNED_IMAGE],
    ["--concurrency", "1000"], ["--help", "--image", PINNED_IMAGE], ["--probe-failure-cleanup", "--probe-failure-cleanup"]]) assert.throws(() => parseReceptionArguments(args));
});

test("resource mutation rejects similar names and unknown ownership labels", () => {
  const run = "11111111-2222-4333-8444-555555555555", name = "archive-reception-" + run + "-db-load";
  assert.doesNotThrow(() => assertReceptionOwnership(name, run, run));
  for (const [target, owner] of [[name, ""], [name, run + "\n"], [name, "another-run"],
    [name + "-extra", run], [name.replace("db-load", "existing-db"), run], ["--force", run],
    [name.replace("archive-reception-", "memory-archive-rollback-"), run]]) {
    assert.throws(() => assertReceptionOwnership(target, run, owner));
  }
});

test("bounded guest pool preserves results and drains active work on a failed request", async () => {
  let active = 0, peak = 0;
  const results = await receptionPool([0, 1, 2, 3, 4], 2, async value => {
    active++; peak = Math.max(peak, active);
    await new Promise(done => setTimeout(done, value % 2 ? 4 : 1));
    active--; return value * 2;
  });
  assert.deepEqual(results, [0, 2, 4, 6, 8]); assert.equal(peak, 2); assert.equal(active, 0);
  const started = [], completed = [];
  await assert.rejects(receptionPool([0, 1, 2, 3], 2, async value => {
    started.push(value);
    if (value === 0) throw new Error("synthetic request failure");
    await new Promise(done => setTimeout(done, 5)); completed.push(value);
  }), /synthetic request failure/);
  assert.deepEqual(started, [0, 1]); assert.deepEqual(completed, [1]);
  for (const [items, concurrency] of [[[], 1], [Array(101), 20], [[1], 0], [[1], 21], [[1], Infinity]]) {
    await assert.rejects(receptionPool(items, concurrency, async value => value));
  }
});

test("aggregate timings preserve input and reject invalid observations", () => {
  const values = [10, 1, 3, 2];
  assert.deepEqual(receptionTimings(values), { requests: 4, p50Ms: 2, p95Ms: 10, maxMs: 10 });
  assert.deepEqual(values, [10, 1, 3, 2]);
  for (const invalid of [[], [-1], [NaN], [Infinity], ["1"]]) assert.throws(() => receptionTimings(invalid));
});
