import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Explicit local inputs only: this check never downloads artifacts or starts a service.
// Bootstrap URLs, hashes and an example config are in sonar/cpd-runtime-manifest.json.
const configFile = process.argv[2] && path.resolve(process.argv[2]);
if (!configFile || process.argv.length !== 3) {
  throw new Error('Usage: node scripts/check-backend-duplication.mjs <explicit-config.json>');
}
const json = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const slash = value => value.replaceAll('\\', '/');
const inside = (file, root) => {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};
const config = json(configFile);
const required = ['repositoryDir', 'backendDir', 'outputDir', 'javaHome', 'runtimeDir'];
for (const key of required) {
  if (typeof config[key] !== 'string' || !config[key]) throw new Error(`Missing ${key}`);
}
for (const key of Object.keys(config)) {
  if (![...required, 'controlsOnly'].includes(key)) throw new Error(`Unknown config key: ${key}`);
}
if (config.controlsOnly !== undefined && typeof config.controlsOnly !== 'boolean') throw new Error('Invalid controlsOnly');
const resolved = key => path.resolve(path.dirname(configFile), config[key]);
function realDestination(file) {
  if (fs.existsSync(file)) return fs.realpathSync(file);
  return path.join(realDestination(path.dirname(file)), path.basename(file));
}
const repository = fs.realpathSync(resolved('repositoryDir'));
const output = realDestination(resolved('outputDir'));
if (!inside(output, path.join(repository, 'logs'))) throw new Error('Output must be inside the repository logs directory');
noLinkedAncestors(output, repository);
fs.mkdirSync(output, { recursive: true });
const statusFile = path.join(output, 'status.json');
writeJson(statusFile, { state: 'VALIDATING' });
const backend = fs.realpathSync(resolved('backendDir'));
const runtime = fs.realpathSync(resolved('runtimeDir'));
if (!inside(backend, repository)) throw new Error('Backend must be inside the repository');
const manifestFile = fileURLToPath(new URL('./sonar/cpd-runtime-manifest.json', import.meta.url));
const adapter = fileURLToPath(new URL('./sonar/OfflineSonarCpd.java', import.meta.url));
const launcher = fileURLToPath(import.meta.url);
const pinned = json(manifestFile);
if (pinned.schemaVersion !== 1 || pinned.javaStatementBlockSize !== 10 || pinned.sources.length !== 61) {
  throw new Error('Unexpected official CPD manifest contract');
}
function filesUnder(root) {
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error(`Symbolic link in CPD input: ${root}`);
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic link in CPD input: ${file}`);
    return entry.isDirectory() ? filesUnder(file) : [file];
  }).sort();
}
function noLinkedAncestors(file, root) {
  let current = root;
  for (const component of path.relative(root, file).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Linked CPD path: ${current}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}
function regular(file) {
  if (fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile()) throw new Error(`Missing/linked input: ${file}`);
  return file;
}
function pinnedInput(relative, expected) {
  const file = path.resolve(runtime, relative);
  if (!inside(file, runtime) || !/^[0-9a-f]{64}$/i.test(expected)) throw new Error(`Invalid pinned runtime input: ${relative}`);
  noLinkedAncestors(file, runtime);
  regular(file);
  if (hash(file) !== expected.toLowerCase()) throw new Error(`Pinned runtime SHA-256 mismatch: ${file}`);
  return file;
}
const officialSources = pinned.sources.map(source => pinnedInput(`official-src/${source.path}`, source.sha256));
const actualOfficialSources = filesUnder(path.join(runtime, 'official-src')).filter(file => file.endsWith('.java'));
if (JSON.stringify(actualOfficialSources) !== JSON.stringify([...officialSources].sort())) {
  throw new Error('Official source inventory has missing or extra Java files');
}
const libraries = pinned.artifacts.map(artifact => pinnedInput(artifact.path, artifact.sha256));
if (!libraries.length || new Set(libraries).size !== libraries.length) throw new Error('Duplicate/empty pinned artifact list');
const javaHome = resolved('javaHome');
const executable = name => regular(path.join(javaHome, 'bin', process.platform === 'win32' ? `${name}.exe` : name));
const java = executable('java');
const javac = executable('javac');
regular(adapter);
noLinkedAncestors(path.join(backend, 'src/main/java'), backend);
noLinkedAncestors(output, repository);
const sources = filesUnder(path.join(backend, 'src/main/java')).filter(file => file.endsWith('.java'));
if (!sources.length) throw new Error('Empty backend production Java inventory');
const inputs = [...officialSources, ...libraries, ...sources, java, javac, adapter, launcher, manifestFile, configFile]
  .map(file => ({ file, sha256: hash(file) }));
const run = fs.mkdtempSync(path.join(output, 'run-'));
writeJson(statusFile, { state: 'RUNNING', run });
try {
  writeJson(path.join(run, 'inputs.json'), { inputs, officialRelease: pinned.release, officialCommit: pinned.commit });
  const classes = path.join(run, 'classes');
  fs.mkdirSync(classes);
  function invoke(name, command, args) {
    const log = path.join(run, `${name}.log`);
    const fd = fs.openSync(log, 'w');
    let result;
    try {
      result = spawnSync(command, args, { cwd: repository, stdio: ['ignore', fd, fd], timeout: 600_000, shell: false });
    } finally { fs.closeSync(fd); }
    writeJson(path.join(run, `${name}-process.json`), {
      exitCode: result.status, signal: result.signal, error: result.error?.message ?? null,
    });
    if (result.error || result.status !== 0) throw new Error(`${name} failed; inspect ${log}`);
  }
  const quote = value => {
    const normalized = slash(value);
    if (/["\r\n]/.test(normalized)) throw new Error('Unsupported quote/newline in compiler argument');
    return `"${normalized}"`;
  };
  for (const file of [classes, ...libraries]) {
    if (file.includes(path.delimiter)) throw new Error('Classpath input contains the platform path delimiter');
  }
  const argsFile = path.join(run, 'javac.args');
  const args = ['--release', String(pinned.compileRelease), '-proc:none', '-classpath', libraries.join(path.delimiter),
    '-d', classes, ...officialSources, adapter];
  fs.writeFileSync(argsFile, `${args.map(quote).join('\n')}\n`);
  invoke('compile-official-and-adapter', javac, [`@${argsFile}`]);
  const list = path.join(run, 'main-inputs.txt');
  const relativeSources = sources.map(file => slash(path.relative(backend, file)));
  fs.writeFileSync(list, `${relativeSources.join('\n')}\n`);
  const reportFile = path.join(run, 'cpd.json');
  invoke('actual-cpd', java, ['-Xmx1024m', '-cp', [classes, ...libraries].join(path.delimiter),
    'OfflineSonarCpd', backend, config.controlsOnly === true ? '-' : list, reportFile]);
  const result = json(reportFile);
  const controls = ['nineCommonStatementsRejected', 'tenCommonStatementsDetected',
    'differentStringLiteralsNormalized', 'middleIdentifierChangeRejected', 'whitespaceAndCommentsIgnored'];
  if (result.release !== pinned.release || result.officialCommit !== pinned.commit || result.javaStatementBlockSize !== 10
    || controls.some(control => result.controls[control] !== true)) throw new Error('Official CPD identity/control mismatch');
  const expectedFiles = config.controlsOnly === true ? [] : relativeSources;
  if (result.sourceFiles !== expectedFiles.length
    || JSON.stringify(result.files.map(file => file.file)) !== JSON.stringify(expectedFiles)) {
    throw new Error('Incomplete/incorrect production source coverage');
  }
  const before = new Map(inputs.map(input => [input.file, input.sha256]));
  for (const source of result.files) {
    if (source.sha256 !== before.get(path.join(backend, source.file))) throw new Error(`Analyzed source hash differs: ${source.file}`);
  }
  for (const input of inputs) if (hash(input.file) !== input.sha256) throw new Error(`Input changed during CPD: ${input.file}`);
  const currentSources = filesUnder(path.join(backend, 'src/main/java')).filter(file => file.endsWith('.java'));
  if (JSON.stringify(currentSources) !== JSON.stringify(sources)) throw new Error('Production source inventory changed during CPD');
  const summary = {
    state: 'PASS', run, reportFile, officialRelease: pinned.release, officialCommit: pinned.commit,
    productionInputs: result.sourceFiles, controls: controls.length,
    rawPerOriginGroups: result.rawPerOriginGroupCount, uniqueExactEndpointGroups: result.uniqueExactEndpointGroupCount,
    scope: 'Standalone official Java CPD core only; no server quality gate, new-code metrics or token/line threshold override',
    exclusions: 'Production Java only; no generated-source or duplication exclusions within that source tree',
  };
  writeJson(path.join(run, 'summary.json'), summary);
  writeJson(statusFile, summary);
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  writeJson(statusFile, { state: 'FAILED', run, error: error.message });
  throw error;
}
