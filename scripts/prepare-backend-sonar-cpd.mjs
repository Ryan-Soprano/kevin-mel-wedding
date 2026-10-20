import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Separate explicit bootstrap. The analysis command never downloads anything.
const scriptFile = fileURLToPath(import.meta.url);
const repository = fs.realpathSync(path.resolve(path.dirname(scriptFile), '..'));
const manifestFile = path.join(repository, 'scripts/sonar/cpd-runtime-manifest.json');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function noLinks(file, root) {
  let current = root;
  for (const component of path.relative(root, file).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Linked runtime path: ${current}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

export function runtimeDestination(repositoryDir, requested) {
  const root = fs.realpathSync(repositoryDir);
  const destination = path.resolve(requested);
  // Permit an existing workspace alias, but never links beneath that repository root.
  let alias = destination;
  while (!fs.existsSync(alias) || fs.realpathSync(alias) !== root) {
    const parent = path.dirname(alias);
    if (parent === alias) throw new Error('Runtime must be under this repository logs directory');
    alias = parent;
  }
  const relative = path.relative(alias, destination);
  const components = relative.split(path.sep);
  if (components.length < 2 || components[0] !== 'logs' || components.some(part => !part || part === '..' || part === '.')) {
    throw new Error('Runtime must be a child of this repository logs directory');
  }
  noLinks(destination, alias);
  return path.join(root, relative);
}

export function checkedInput(input, commit) {
  if (!/^[0-9a-f]{64}$/i.test(input.sha256) || !/^[A-Za-z0-9_./-]+$/.test(input.path)
    || input.path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Invalid pinned input path or SHA-256');
  }
  const url = new URL(input.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.href !== input.url) {
    throw new Error('Pinned input must use an exact official HTTPS URL');
  }
  if (input.path.startsWith('official-src/')) {
    const source = input.path.slice('official-src/'.length);
    const expected = `https://raw.githubusercontent.com/SonarSource/sonarqube/${commit}/sonar-duplications/src/main/java/${source}`;
    if (input.url !== expected) throw new Error('Unexpected official source host, commit or path');
  } else if (!input.path.startsWith('dependencies/') || !input.path.endsWith('.jar')
    || url.hostname !== 'repo.maven.apache.org' || !url.pathname.startsWith('/maven2/')
    || path.posix.basename(url.pathname) !== path.posix.basename(input.path)) {
    throw new Error('Unexpected official Maven artifact host or path');
  }
  return { ...input, sha256: input.sha256.toLowerCase() };
}

export async function acquire(runtime, input, fetcher = fetch) {
  if (fs.lstatSync(runtime).isSymbolicLink()) throw new Error('Linked runtime root');
  const destination = path.join(runtime, ...input.path.split('/'));
  const relative = path.relative(runtime, destination);
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) throw new Error('Runtime path escape');
  noLinks(destination, runtime);
  function reuse() {
    const stat = fs.lstatSync(destination);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Invalid existing runtime input: ${destination}`);
    if (digest(fs.readFileSync(destination)) !== input.sha256) throw new Error(`Existing input hash mismatch; preserved: ${destination}`);
    return { path: input.path, url: input.url, sha256: input.sha256, action: 'reused', fetched: false, bytes: stat.size };
  }
  if (fs.existsSync(destination)) return reuse();
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  noLinks(destination, runtime);
  const response = await fetcher(input.url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Official input returned HTTP ${response.status}: ${input.url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (digest(bytes) !== input.sha256) throw new Error(`Downloaded input SHA-256 mismatch: ${input.url}`);
  noLinks(destination, runtime);
  const temporary = `${destination}.download-${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, bytes, { flag: 'wx' });
  try {
    noLinks(destination, runtime);
    try {
      // Atomic publication of complete verified bytes; link fails rather than replacing an existing file.
      fs.linkSync(temporary, destination);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      return { ...reuse(), fetched: true };
    }
    return { path: input.path, url: input.url, sha256: input.sha256, action: 'downloaded', fetched: true, bytes: bytes.length };
  } finally {
    fs.unlinkSync(temporary);
  }
}

export async function main(args) {
  if (args.length !== 1) throw new Error('Usage: node scripts/prepare-backend-sonar-cpd.mjs <runtime-dir-under-logs>');
  const manifestBytes = fs.readFileSync(manifestFile);
  const manifest = JSON.parse(manifestBytes.toString('utf8').replace(/^\uFEFF/, ''));
  if (manifest.schemaVersion !== 1 || !/^[0-9a-f]{40}$/.test(manifest.commit)
    || manifest.sources.length !== 61 || manifest.artifacts.length !== 7) throw new Error('Unexpected pinned CPD manifest');
  const inputs = [
    ...manifest.sources.map(source => ({ path: `official-src/${source.path}`, url: source.url, sha256: source.sha256 })),
    ...manifest.artifacts,
  ].map(input => checkedInput(input, manifest.commit));
  if (new Set(inputs.map(input => input.path)).size !== inputs.length) throw new Error('Duplicate pinned runtime path');
  const runtime = runtimeDestination(repository, args[0]);
  fs.mkdirSync(runtime, { recursive: true });
  const proof = {
    state: 'RUNNING', manifestSha256: digest(manifestBytes), release: manifest.release,
    officialCommit: manifest.commit, runtime, inputs: [],
  };
  const provenance = path.join(runtime, `bootstrap-${Date.now()}-${crypto.randomUUID()}.json`);
  try {
    for (const input of inputs) proof.inputs.push(await acquire(runtime, input));
    if (digest(fs.readFileSync(manifestFile)) !== proof.manifestSha256) throw new Error('Pinned manifest changed during bootstrap');
    proof.state = 'PASS';
    proof.reused = proof.inputs.filter(input => input.action === 'reused').length;
    proof.downloaded = proof.inputs.filter(input => input.fetched).length;
  } catch (error) {
    proof.state = 'FAILED';
    proof.error = error.message;
    throw error;
  } finally {
    fs.writeFileSync(provenance, `${JSON.stringify(proof, null, 2)}\n`, { flag: 'wx' });
  }
  console.log(JSON.stringify({ state: proof.state, runtime, reused: proof.reused, downloaded: proof.downloaded, provenance }, null, 2));
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === scriptFile) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
