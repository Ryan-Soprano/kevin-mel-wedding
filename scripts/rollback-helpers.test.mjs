import test from "node:test";
import assert from "node:assert/strict";
import { parseArguments, localDockerEndpoint, readJarTar, singleFileTar } from "./rollback-helpers.mjs";

const candidate = "sha256:" + "1".repeat(64), previous = "sha256:" + "2".repeat(64);
test("rollback arguments require distinct complete immutable images and reject shifting or injected inputs", () => {
  assert.deepEqual(parseArguments(["--candidate-image", candidate, "--previous-image", previous]), { candidate, previous });
  assert.equal(parseArguments(["--help"]).help, true);
  assert.equal(parseArguments(["--candidate-image", "registry.invalid/archive@" + candidate,
    "--previous-image", previous]).candidate, "registry.invalid/archive@" + candidate);
  for (const args of [[], ["--candidate-image", "archive:latest", "--previous-image", previous],
    ["--candidate-image", candidate, "--previous-image", candidate], ["--candidate-image", "1234", "--previous-image", previous],
    ["--candidate-image", candidate, "--previous-image", previous, "--pull"],
    ["--candidate-image", candidate, "--previous-image", previous, "toString", candidate],
    ["--candidate-image", candidate, "--previous-image", previous, "__proto__", candidate],
    ["--candidate-image", candidate, "--candidate-image", candidate, "--previous-image", previous],
    ["--candidate-image", candidate, "--previous-image", previous, "--incompatible-image", candidate]]) {
    assert.throws(() => parseArguments(args));
  }
});
test("remote Docker endpoints cannot admit a rollback rehearsal", () => {
  for (const value of ["unix:///var/run/docker.sock", "npipe:////./pipe/docker_engine", "tcp://127.0.0.1:2375", "tcp://[::1]:2375"]) {
    assert.equal(localDockerEndpoint(value), true);
  }
  for (const value of ["ssh://operator@host", "tcp://192.0.2.1:2375", "tcp://localhost.remote.invalid:2375", "https://docker.invalid"]) {
    assert.equal(localDockerEndpoint(value), false);
  }
});
test("JAR copying accepts only a bounded regular app.jar and rejects corruption, truncation and extra files", () => {
  const bytes = Buffer.from("synthetic JAR fixture");
  const archive = singleFileTar("app.jar", bytes);
  assert.deepEqual(readJarTar(archive), bytes);
  const corrupt = Buffer.from(archive); corrupt[0] ^= 1;
  assert.throws(() => readJarTar(corrupt));
  assert.throws(() => readJarTar(archive.subarray(0, 514)));
  assert.throws(() => readJarTar(singleFileTar("other.jar", bytes)));
  assert.throws(() => readJarTar(Buffer.concat([archive.subarray(0, 1024), archive])));
  for (const name of ["../app.jar", "/app.jar", "folder/app.jar", "--app.jar"]) assert.throws(() => singleFileTar(name, bytes));
});
