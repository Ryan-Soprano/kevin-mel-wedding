import { createHash } from "node:crypto";

export class RollbackFailure extends Error {}
export const check = (condition, message) => { if (!condition) throw new RollbackFailure(message); };
const immutableImage = /^(?:sha256:[0-9a-f]{64}|[a-zA-Z0-9][a-zA-Z0-9._:/-]*@sha256:[0-9a-f]{64})$/;

export function parseArguments(args) {
  if (args.length === 1 && args[0] === "--help") return { help: true };
  const result = {};
  const names = { "--candidate-image": "candidate", "--previous-image": "previous", "--incompatible-image": "incompatible" };
  for (let index = 0; index < args.length; index += 2) {
    const name = Object.hasOwn(names, args[index]) ? names[args[index]] : null, value = args[index + 1];
    check(name && !result[name] && typeof value === "string" && immutableImage.test(value),
      "Supply each supported image flag once with a complete immutable local image ID or digest; tags are refused.");
    result[name] = value;
  }
  check(result.candidate && result.previous && result.candidate !== result.previous,
    "Distinct existing candidate and previous immutable images are required.");
  check(!result.incompatible || ![result.candidate, result.previous].includes(result.incompatible),
    "The optional incompatible image must be a distinct immutable artifact.");
  return result;
}

export const localDockerEndpoint = value => /^unix:\/\/\//.test(value)
  || /^npipe:\/\/\/\/(?:\.|localhost)\/pipe\//i.test(value)
  || /^tcp:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\/?$/i.test(value);
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

// Copy a single bounded regular file through Docker's tar stream. No extraction,
// host temporary directory or shell is involved, and no archive path is trusted.
export function readJarTar(bytes) {
  check(Buffer.isBuffer(bytes) && bytes.length <= 128 * 1024 * 1024, "The image JAR archive is invalid or too large.");
  let found;
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const text = (start, end) => header.subarray(start, end).toString("utf8").split("\0", 1)[0];
    const name = text(0, 100), prefix = text(345, 500), type = text(156, 157);
    const rawSize = text(124, 136).trim();
    check(/^[0-7]+$/.test(rawSize), "The image JAR archive has an unsupported file size.");
    const size = Number.parseInt(rawSize, 8);
    let sum = 0;
    for (let index = 0; index < 512; index++) sum += index >= 148 && index < 156 ? 32 : header[index];
    check(Number.parseInt(text(148, 156).trim(), 8) === sum && Number.isSafeInteger(size)
      && size >= 0 && offset + 512 + size <= bytes.length, "The image JAR archive is malformed.");
    const path = prefix ? prefix + "/" + name : name;
    // Docker may include extended metadata. It cannot rename the sole regular
    // file we accept; the guard receives a fresh tar with our own fixed filename.
    if (type === "0" || type === "") {
      check(path === "app.jar" && !found && size > 0, "The image copy must contain only its regular app.jar.");
      found = bytes.subarray(offset + 512, offset + 512 + size);
    } else check(type === "x" || type === "g", "The image JAR copy contains an unsupported archive entry.");
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  check(found && found.length <= 100 * 1024 * 1024, "The image must contain one bounded readable application JAR.");
  return found;
}

export function singleFileTar(name, bytes) {
  check(/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,90}$/.test(name) && Buffer.isBuffer(bytes)
    && bytes.length <= 100 * 1024 * 1024, "The temporary fixture file is invalid.");
  const header = Buffer.alloc(512);
  const write = (value, offset, length) => header.write(value, offset, length, "ascii");
  const octal = (value, length) => value.toString(8).padStart(length - 1, "0") + "\0";
  write(name, 0, 100); write(octal(0o444, 8), 100, 8);
  write(octal(10001, 8), 108, 8); write(octal(10001, 8), 116, 8);
  write(octal(bytes.length, 12), 124, 12); write(octal(0, 12), 136, 12);
  write("        ", 148, 8); write("0", 156, 1); write("ustar\0", 257, 6); write("00", 263, 2);
  const sum = header.reduce((total, byte) => total + byte, 0);
  write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return Buffer.concat([header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512 + 1024)]);
}
