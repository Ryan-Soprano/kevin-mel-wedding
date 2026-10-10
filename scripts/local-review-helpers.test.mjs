import test from "node:test";
import assert from "node:assert/strict";
import { parseLocalReviewArguments, localReviewNames, assertLocalReviewOwnership, localReviewDockerEnvironment } from "./local-review-helpers.mjs";

const image = "sha256:" + "a".repeat(64), run = "11111111-2222-4333-8444-555555555555";

test("review requires an explicit immutable image and bounded interactive duration", () => {
  assert.deepEqual(parseLocalReviewArguments(["--image", image]), { image, durationMinutes: 30, selfCheck: false, probeFailureCleanup: false, stop: null });
  for (const minutes of ["1", "30", "120"]) assert.equal(parseLocalReviewArguments(["--minutes", minutes, "--image", image]).durationMinutes, Number(minutes));
  for (const value of ["0", "-1", "121", "1000", "1.5", "01", "+1", "Infinity", " 30", "30\n", "--self-check"]) {
    assert.throws(() => parseLocalReviewArguments(["--image", image, "--minutes", value]));
  }
  for (const args of [[], ["--image"], ["--image", "archive:latest"], ["--image", "registry.invalid/app@" + image],
    ["--image", image.toUpperCase()], ["--image", image + "\n"], ["--image", image, "--image", image], ["--image", image, "--pull"],
    ["--image", image, "--minutes", "30", "--minutes", "30"], ["toString", image], ["__proto__", image], ["--image", image, "--database", "existing"]]) {
    assert.throws(() => parseLocalReviewArguments(args));
  }
});

test("stop and check modes cannot silently launch a different operation", () => {
  assert.deepEqual(parseLocalReviewArguments(["--help"]), { help: true });
  assert.deepEqual(parseLocalReviewArguments(["--stop", run]), { stop: run });
  assert.equal(parseLocalReviewArguments(["--image", image, "--self-check"]).selfCheck, true);
  assert.equal(parseLocalReviewArguments(["--probe-failure-cleanup", "--image", image]).probeFailureCleanup, true);
  for (const args of [["--stop"], ["--stop", run, "--image", image], ["--stop", "--force"], ["--stop", run + "\n"],
    ["--stop", run.replace("4333", "1333")], ["--help", "--image", image], ["--image", image, "--stop", run],
    ["--image", image, "--self-check", "--probe-failure-cleanup"], ["--image", image, "--self-check", "--self-check"],
    ["--image", image, "--probe-failure-cleanup", "--probe-failure-cleanup"], ["--image", image, "--self-check", "--minutes", "30"]]) {
    assert.throws(() => parseLocalReviewArguments(args));
  }
});

test("ownership rejects near-matching names, runs and labels before resource mutations", () => {
  const names = localReviewNames(run);
  for (const name of Object.values(names)) assert.doesNotThrow(() => assertLocalReviewOwnership(name, run, run));
  for (const [name, owner] of [[names.db, ""], [names.db, run + "\n"], [names.app, run.replace("555555555555", "555555555556")],
    [names.db + "-extra", run], [names.db.replace("-db", "-postgres_data"), run], ["postgres", run], ["--force", run],
    [names.network.replace("archive-local-review-", "archive-reception-"), run]]) {
    assert.throws(() => assertLocalReviewOwnership(name, run, owner));
  }
  for (const id of [run + "\n", "", "--force", null, run.replace("8444", "7444")]) assert.throws(() => localReviewNames(id));
  assert.throws(() => localReviewNames(run.replace("11111111", "AAAAAAAA")));
});

test("Docker subprocesses cannot inherit ambient provider, database, Node or JVM settings", () => {
  const source = { PATH: "/test/path", SystemRoot: "C:/Windows", DOCKER_HOST: "npipe:////./pipe/docker_engine", DOCKER_CONTEXT: "desktop-linux",
    HOME: "/test/home", MEMORY_ARCHIVE_R2_SECRET_ACCESS_KEY: "synthetic-forbidden", MEMORY_ARCHIVE_DB_URL: "synthetic-forbidden",
    MEMORY_ARCHIVE_REVEALED: "true", AWS_ACCESS_KEY_ID: "synthetic-forbidden", PGPASSWORD: "synthetic-forbidden",
    NODE_OPTIONS: "synthetic-forbidden", JAVA_TOOL_OPTIONS: "synthetic-forbidden", CODEX_HOME: "synthetic-forbidden", TEMP: null };
  assert.deepEqual(localReviewDockerEnvironment(source), { PATH: source.PATH, SystemRoot: source.SystemRoot,
    HOME: source.HOME, DOCKER_HOST: source.DOCKER_HOST, DOCKER_CONTEXT: source.DOCKER_CONTEXT });
  assert.equal(source.PGPASSWORD, "synthetic-forbidden");
  assert.deepEqual(localReviewDockerEnvironment(Object.create({ PATH: "inherited", MEMORY_ARCHIVE_R2_BUCKET: "inherited" })), {});
});
