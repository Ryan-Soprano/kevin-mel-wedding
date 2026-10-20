import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Local installed artifacts only. This tool neither starts services nor downloads dependencies.
const configFile = path.resolve(process.argv[2] ?? '');
if (!process.argv[2] || process.argv.length !== 3) throw new Error('Usage: node scripts/check-backend-sonar.mjs <explicit-config.json>');
const config = JSON.parse(fs.readFileSync(configFile, 'utf8').replace(/^\uFEFF/, ''));
if (config === null || Array.isArray(config) || typeof config !== 'object') throw new Error('Config must be an object');
const required = ['repositoryDir', 'backendDir', 'outputDir', 'extensionDir', 'javaHome', 'classpathFile'];
for (const key of required) if (typeof config[key] !== 'string' || !config[key]) throw new Error(`Missing ${key}`);
for (const key of Object.keys(config)) if (![...required, 'adapterPath', 'controlsOnly'].includes(key)) throw new Error(`Unknown config key: ${key}`);
if (config.controlsOnly !== undefined && typeof config.controlsOnly !== 'boolean') throw new Error('Invalid controlsOnly');
if (config.adapterPath !== undefined && (typeof config.adapterPath !== 'string' || !config.adapterPath)) throw new Error('Invalid adapterPath');
const resolved = key => {
  if (/[\r\n]/.test(config[key])) throw new Error(`Unsupported newline in path: ${key}`);
  return path.resolve(path.dirname(configFile), config[key]);
};
const repository = fs.realpathSync(resolved('repositoryDir'));
const backend = fs.realpathSync(resolved('backendDir'));
const extension = fs.realpathSync(resolved('extensionDir'));
const javaHome = fs.realpathSync(resolved('javaHome'));
const adapter = fs.realpathSync(config.adapterPath ? resolved('adapterPath') : fileURLToPath(new URL('./sonar/OfflineSonarJava.java', import.meta.url)));
const java = path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
const engine = path.join(extension, 'server', 'sonarlint-ls.jar');
const plugin = path.join(extension, 'analyzers', 'sonarjava.jar');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const slash = file => file.replaceAll('\\', '/');
const inside = (file, root) => {
  const relative = path.relative(root, file);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};
function realDestination(file) {
  if (fs.existsSync(file)) return fs.realpathSync(file);
  return path.join(realDestination(path.dirname(file)), path.basename(file));
}
function noLinkedAncestors(file, root) {
  let current = root;
  for (const component of path.relative(root, file).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error(`Linked input/output path: ${current}`);
  }
}
const suppliedOutput = resolved('outputDir');
const suppliedRepository = resolved('repositoryDir');
const outputRoot = inside(suppliedOutput, suppliedRepository) ? suppliedRepository : repository;
if (!inside(suppliedOutput, outputRoot)) throw new Error('Output must be beneath the repository logs directory');
noLinkedAncestors(suppliedOutput, outputRoot);
const output = realDestination(suppliedOutput);
const logs = path.join(repository, 'logs');
if (output === logs || !inside(output, logs)) throw new Error('Output must be beneath the repository logs directory');
noLinkedAncestors(output, repository);
const ignored = spawnSync('git', ['-C', repository, 'check-ignore', '--quiet', '--no-index', '--', slash(path.relative(repository, output))], { encoding: 'utf8' });
if (ignored.status !== 0) throw new Error('Output must be ignored by Git');
function filesUnder(root) {
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error(`Symbolic link in analyzed/compiled input: ${root}`);
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic link in analyzed/compiled input: ${file}`);
    return entry.isDirectory() ? filesUnder(file) : [file];
  }).sort();
}
function manifest(files) {
  return files.map(file => ({ file, sha256: hash(file) }));
}
function unchanged(before) {
  for (const input of before) if (hash(input.file) !== input.sha256) throw new Error(`Input changed: ${input.file}`);
}
for (const file of [java, adapter, engine, plugin]) if (!fs.statSync(file).isFile()) throw new Error(`Missing installed input: ${file}`);
const classpathFile = fs.realpathSync(resolved('classpathFile'));
const libraries = fs.readFileSync(classpathFile, 'utf8').replace(/^\uFEFF/, '')
  .split(/\r?\n/).flatMap(line => line.split(path.delimiter)).map(value => value.trim()).filter(Boolean)
  .map(value => fs.realpathSync(path.resolve(path.dirname(classpathFile), value)));
if (!libraries.length || new Set(libraries).size !== libraries.length) throw new Error('Classpath must contain unique explicit local JAR paths');
for (const file of libraries) {
  if (/[\r\n,]/.test(file)) throw new Error(`Unsupported properties/list character in library path: ${file}`);
  if (!file.endsWith('.jar') || !fs.statSync(file).isFile()) throw new Error(`Invalid library: ${file}`);
}
if (/[\r\n,]/.test(backend)) throw new Error('Unsupported properties/list character in backend path');
for (const inputTree of [backend, extension, javaHome, path.dirname(adapter), ...libraries.map(file => path.dirname(file))]) {
  if (inside(output, inputTree) || inside(inputTree, output)) throw new Error(`Output overlaps an analyzed/runtime input tree: ${inputTree}`);
}
for (const input of [classpathFile, configFile, fileURLToPath(import.meta.url)]) {
  if (inside(fs.realpathSync(input), output)) throw new Error(`Output contains a launcher/configuration input: ${input}`);
}
fs.mkdirSync(output, { recursive: true });
const run = fs.mkdtempSync(path.join(output, 'run-'));
writeJson(path.join(output, 'status.json'), { state: 'RUNNING', run });
const git = spawnSync('git', ['-C', repository, 'ls-files', '-z', '--', 'backend/src/main/java', 'backend/src/test/java'], { encoding: 'utf8' });
if (git.status !== 0) throw new Error(`Tracked source inventory failed: ${git.stderr}`);
const sources = git.stdout.split('\0').filter(file => file.endsWith('.java')).sort().map(file => file.slice('backend/'.length));
if (!sources.length || new Set(sources).size !== sources.length) throw new Error('Empty or duplicate tracked Java inventory');
if (sources.some(file => /[\r\n]/.test(file))) throw new Error('Unsupported newline in Java source path');
const sourceInventory = () => [...filesUnder(path.join(backend, 'src/main/java')), ...filesUnder(path.join(backend, 'src/test/java'))]
  .filter(file => file.endsWith('.java')).map(file => slash(path.relative(backend, file))).sort();
const present = sourceInventory();
if (JSON.stringify(present) !== JSON.stringify(sources)) throw new Error('Missing or untracked/unlisted Java sources; stage intended sources before the final scan');
const head = spawnSync('git', ['-C', repository, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
const status = spawnSync('git', ['-C', repository, 'status', '--porcelain=v1', '-z', '--',
  'backend/src/main/java', 'backend/src/test/java', 'backend/pom.xml', 'scripts/check-backend-sonar.mjs', 'scripts/sonar/OfflineSonarJava.java'], { encoding: 'utf8' });
if (head.status !== 0 || status.status !== 0) throw new Error('Git source identity/status unavailable');
const classes = path.join(backend, 'target', 'classes');
const testClasses = path.join(backend, 'target', 'test-classes');
for (const relative of sources) {
  const source = path.join(backend, relative);
  const test = relative.startsWith('src/test/java/');
  const prefix = test ? 'src/test/java/' : 'src/main/java/';
  const compiled = path.join(test ? testClasses : classes, relative.slice(prefix.length).replace(/\.java$/, '.class'));
  if (fs.lstatSync(source).isSymbolicLink() || !fs.statSync(source).isFile()) throw new Error(`Missing/linked source: ${source}`);
  if (!fs.statSync(compiled).isFile() || fs.statSync(compiled).mtimeMs < fs.statSync(source).mtimeMs) {
    throw new Error(`Missing or older primary compiled class; compile this exact snapshot first: ${compiled}`);
  }
}
const sourceManifest = manifest(sources.map(relative => path.join(backend, relative)));
const classInventory = () => [...filesUnder(classes), ...filesUnder(testClasses)].filter(file => file.endsWith('.class')).sort();
const compiledInputs = classInventory();
const compiledManifest = manifest(compiledInputs);
const libraryManifest = manifest(libraries);
const toolManifest = manifest([adapter, engine, plugin, java, classpathFile, configFile, fileURLToPath(import.meta.url)]);
writeJson(path.join(run, 'inputs.json'), { repositoryHead: head.stdout.trim(), relevantWorkingStatus: status.stdout.split('\0').filter(Boolean),
  sourceManifest, compiledManifest, libraryManifest, toolManifest,
  compiledInputLimit: 'Fresh exact-snapshot compilation and its separate build/hash fence are required; timestamps/digests alone do not prove compilation origin' });
function invoke(name, base, inputs, extra = {}, expectedFailure = false) {
  const list = path.join(run, `${name}-inputs.txt`);
  const properties = path.join(run, `${name}.properties`);
  const report = path.join(run, `${name}.json`);
  const log = path.join(run, `${name}.log`);
  fs.writeFileSync(list, `${inputs.join('\n')}\n`);
  fs.writeFileSync(properties, `${Object.entries(extra).map(([key, value]) => {
    if (/[\r\n]/.test(String(value))) throw new Error(`Unsupported newline in property: ${key}`);
    const escaped = process.platform === 'win32' ? slash(String(value)) : String(value).replaceAll('\\', '\\\\');
    return `${key}=${escaped}`;
  }).join('\n')}\n`);
  const logFd = fs.openSync(log, 'w');
  let completion;
  try {
    completion = spawnSync(java, ['-Xmx1536m', '-cp', engine, adapter, extension, base, list, report, properties], {
      cwd: repository, stdio: ['ignore', logFd, logFd], timeout: 600_000,
      env: { ...process.env, SONAR_HOST_URL: '', SONAR_TOKEN: '', SONAR_SCANNER_OPTS: '' },
    });
  } finally { fs.closeSync(logFd); }
  writeJson(path.join(run, `${name}-process.json`), { exitCode: completion.status, signal: completion.signal, error: completion.error?.message ?? null });
  const result = fs.existsSync(report) ? json(report) : null;
  if (expectedFailure) {
    if (completion.error || completion.status === 0 || !result || JSON.stringify(result.files) !== JSON.stringify(inputs)
      || JSON.stringify(result.failedFiles) !== JSON.stringify(inputs)
      || result.inputManifest.length !== inputs.length || result.inputManifest.some(input => input.sha256 !== hash(path.join(base, input.file)))
      || !result.diagnostics.some(event => event.message === 'Execute Sensor: JavaSensor')) throw new Error(`Malformed-source control did not fail closed: ${log}`);
    return result;
  }
  if (completion.error || completion.status !== 0 || !result) throw new Error(`Analysis failed; inspect ${log}`);
  if (result.failedFiles.length || result.languageFileCount !== inputs.length) throw new Error(`Incomplete analysis: ${report}`);
  if (JSON.stringify(result.files) !== JSON.stringify(inputs) || result.recognizedMainCount !== inputs.filter(file => !file.startsWith('src/test/')).length
    || result.recognizedTestCount !== inputs.filter(file => file.startsWith('src/test/')).length) throw new Error(`Incorrect MAIN/TEST recognition: ${report}`);
  const unexpected = result.diagnostics.filter(event => event.level === 'ERROR' || (event.level === 'WARN' && event.message !== 'No workDir in SonarLint'));
  if (unexpected.length) throw new Error(`Unexpected analyzer warnings/errors; retained in ${report}`);
  return result;
}
const controlBase = path.join(run, 'controls');
const positive = `class RuleProbe { String exercise(int x) { int y=0;
if(x>0){if(x>1){if(x>2){if(x>3){if(x>4){if(x>5){y++;}}}}}}
if(x>6)y++;if(x>7)y++;if(x>8)y++;if(x>9)y++;if(x>10)y++;if(x>11)y++;
String a="synthetic-repeated-literal",b="synthetic-repeated-literal",c="synthetic-repeated-literal";return a+b+c+y;} }\n`;
fs.mkdirSync(path.join(controlBase, 'src/main/java'), { recursive: true });
fs.mkdirSync(path.join(controlBase, 'src/test/java'), { recursive: true });
fs.writeFileSync(path.join(controlBase, 'src/main/java/RuleProbe.java'), positive);
fs.writeFileSync(path.join(controlBase, 'src/test/java/RuleProbeTest.java'), positive.replace('class RuleProbe ', 'class RuleProbeTest '));
const controlInputs = ['src/main/java/RuleProbe.java', 'src/test/java/RuleProbeTest.java'];
const control = invoke('control-positive', controlBase, controlInputs);
if (control.issues.length !== 3 || control.issues.some(issue => issue.file.startsWith('src/test/'))
  || !control.issues.some(issue => issue.rule === 'java:S3776' && issue.message.includes('from 27 to the 15 allowed'))
  || !control.issues.some(issue => issue.rule === 'java:S1541' && issue.message.includes('is 13 which is greater than 10'))
  || !control.issues.some(issue => issue.rule === 'java:S1192' && issue.message.includes('3 times'))
  || !control.issues.find(issue => issue.rule === 'java:S3776')?.flows?.length) throw new Error('Actual rule score/location/MAIN-TEST control mismatch');
const boundary = invoke('control-boundary', controlBase, controlInputs, {
  'offline.profile.cognitiveThreshold': '27', 'offline.profile.cyclomaticThreshold': '13', 'offline.profile.literalThreshold': '4',
});
if (boundary.issues.length) throw new Error('Rule parameters did not suppress exact-boundary scores/three literals');
fs.writeFileSync(path.join(controlBase, 'src/main/java/Malformed.java'), 'class Malformed { void broken( }\n');
invoke('control-malformed', controlBase, ['src/main/java/Malformed.java'], {}, true);
if (config.controlsOnly === true) {
  verifyInputs();
  writeJson(path.join(output, 'status.json'), { state: 'PASS', controlsOnly: true, run });
  console.log('PASS actual score/parameter/MAIN-TEST/secondary-location/parse-failure controls');
  process.exit(0);
}
const analysis = invoke('analysis', backend, sources, {
  'sonar.java.binaries': classes, 'sonar.java.test.binaries': testClasses,
  'sonar.java.libraries': libraries.join(','), 'sonar.java.test.libraries': libraries.join(','),
});
verifyInputs();
writeJson(path.join(run, 'summary.json'), {
  mainInputs: analysis.mainInputCount, testInputs: analysis.testInputCount, recognized: analysis.languageFileCount,
  failed: analysis.failedFiles.length, issues: analysis.issues.length,
  recognizedMain: analysis.recognizedMainCount, recognizedTest: analysis.recognizedTestCount,
  analysisCoverageLimit: analysis.analysisCoverageLimit,
  rules: Object.fromEntries(['java:S3776', 'java:S1541', 'java:S1192'].map(rule => [rule, analysis.issues.filter(issue => issue.rule === rule).length])),
  controls: 'Exact cognitive=27/cyclomatic=13/literal=3; boundary parameters suppress; TEST rules excluded; malformed source fails closed',
  scope: 'Three selected MAIN-source rules only; no full quality profile, CPD, coverage or SonarQube-server clean claim',
});
writeJson(path.join(output, 'status.json'), { state: 'PASS', run, summaryFile: path.join(run, 'summary.json') });
console.log(fs.readFileSync(path.join(run, 'summary.json'), 'utf8'));
function verifyInputs() {
  for (const before of [sourceManifest, compiledManifest, libraryManifest, toolManifest]) unchanged(before);
  if (JSON.stringify(sourceInventory()) !== JSON.stringify(present)) throw new Error('Java source inventory changed during analysis');
  if (JSON.stringify(classInventory()) !== JSON.stringify(compiledInputs)) throw new Error('Compiled class inventory changed during analysis');
  const currentGit = spawnSync('git', ['-C', repository, 'ls-files', '-z', '--', 'backend/src/main/java', 'backend/src/test/java'], { encoding: 'utf8' });
  if (currentGit.status !== 0 || currentGit.stdout !== git.stdout) throw new Error('Tracked Java source inventory changed during analysis');
}
