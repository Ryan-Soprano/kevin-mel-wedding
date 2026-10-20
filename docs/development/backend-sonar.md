# Local backend complexity and duplication checks

Use these checks during every backend directory review, following
[the directory review process](directory-review.md#sonarqube-complexity-and-duplication).
Review the actual findings and duplicated-block endpoints. Successful execution
means that analysis completed; it does not mean that no findings remain.

The tools run locally and do not upload application source or start a server.
They do not establish a hosted SonarQube quality gate, full quality profile,
coverage, new-code metrics or release acceptance. The selected rule checks and
the duplicated-block check are separate operations.

## Fresh compilation and installed Java analyzer

Use Java 25, Node from `.nvmrc`, and the checked-in Maven wrapper. Install the
official SonarQube for IDE VS Code extension separately. The October 20 review
used extension **6.1.1**, analysis engine **12.1.1.87771**, and SonarJava
**8.44.0.48651**. A different installed version needs a new recorded baseline;
the adapter uses internal installed APIs and may need adjustment after updates.

Compile the exact source tree being reviewed, including existing tests, and
export its dependency classpath. From the repository root in PowerShell:

```powershell
$sonarRepo = (Get-Location).Path
$sonarClasspath = Join-Path $sonarRepo 'backend/target/sonar-classpath.txt'
.\backend\mvnw.cmd -f backend/pom.xml -B '-DskipTests' test-compile dependency:build-classpath "-Dmdep.outputFile=$sonarClasspath"
if ($LASTEXITCODE -ne 0) { throw 'Compilation/classpath export failed' }
```

Use a fresh build directory or an immutable intended-source snapshot for a final
review. Class timestamps and hashes alone cannot establish which source compiled
them. Retain the successful build result and a before/after source manifest.
Run the appropriate existing tests and package checks separately. Docker and
verified FFmpeg/ffprobe binaries are needed for the full backend test suite.

Create an ignored JSON configuration, for example
`logs/backend-sonar.local/rules-config.json`. Paths resolve relative to that
configuration file; substitute your actual installed extension and JDK paths:

```json
{
  "repositoryDir": "../..",
  "backendDir": "../../backend",
  "outputDir": "./rules-results",
  "extensionDir": "C:/Users/YOUR_USER/.vscode/extensions/sonarsource.sonarlint-vscode-6.1.1-win32-x64",
  "javaHome": "C:/YOUR_JDK_25",
  "classpathFile": "../../backend/target/sonar-classpath.txt"
}
```

```powershell
node scripts/check-backend-sonar.mjs logs/backend-sonar.local/rules-config.json
if ($LASTEXITCODE -ne 0) { throw 'Java analysis failed; inspect retained output' }
```

The launcher checks the tracked production and test Java inventory, installed
engine/plugin, compiled classes and library inputs before and after execution.
New Java files must be staged or committed so that they enter the intended
inventory. Output belongs under the ignored repository `logs/` directory. Use a
new output directory for each retained baseline or final run.

The actual installed rules run with their recorded defaults:

| Rule | Check | Parameters used October 20 |
|---|---|---|
| `java:S3776` | Function cognitive complexity | `Threshold=15` |
| `java:S1541` | Function cyclomatic complexity | `Threshold=10` |
| `java:S1192` | Repeated string literals | `threshold=3`, `minimalLength=5`, `excludePatterns=""` |

All three installed rules have **MAIN** scope. Tests are indexed as **TEST**
inputs; this does not apply those MAIN rules to test methods or prove that tests
are free of other issues. Read `status.json`, then its fresh run directory's
`analysis.json`, `inputs.json`, `summary.json`, process results and logs. Keep
primary and secondary locations. The installed result API reports recognized
MAIN/TEST identities and failed files; it does not expose a separate completed
per-file rule count. Diagnostics and the controls supplement that stated limit.
The controls
exercise actual scores, parameter boundaries, MAIN/TEST classification and
failure on malformed Java. The known exact `No workDir in SonarLint` warning is
retained; other warnings/errors fail the launcher.

## Actual Java duplicated blocks

`S1192` is a literal rule; it does not detect duplicated blocks. The separate
checker uses the unmodified SonarQube duplication module pinned in
`scripts/sonar/cpd-runtime-manifest.json`: release **26.4.0.121862**, commit
**ab253503cc54df4bdfefd11eb783997d402b5147**. It reproduces the official Java
tokenizer, statement builder, ten-statement block chunker and suffix-tree
detector. It does not substitute a text search or change the Java threshold.

Prepare its local runtime explicitly. This bootstrap downloads only the pinned
official GitHub sources and Maven artifacts in the tracked manifest, checks
SHA-256 before publishing each file, and reuses matching cached files. It
preserves mismatching existing files and fails rather than overwriting them.
The downloaded sources retain their original license headers. No application
source is sent by this download step.

```powershell
node scripts/prepare-backend-sonar-cpd.mjs logs/backend-sonar.local/cpd-runtime
if ($LASTEXITCODE -ne 0) { throw 'Pinned CPD runtime preparation failed' }
```

Create `logs/backend-sonar.local/cpd-config.json`:

```json
{
  "repositoryDir": "../..",
  "backendDir": "../../backend",
  "outputDir": "./cpd-results",
  "javaHome": "C:/YOUR_JDK_25",
  "runtimeDir": "./cpd-runtime"
}
```

```powershell
node scripts/check-backend-duplication.mjs logs/backend-sonar.local/cpd-config.json
if ($LASTEXITCODE -ne 0) { throw 'Duplicated-block analysis failed' }
```

The checker itself is download-free. It verifies pinned runtime hashes, compiles
the module and adapter in a new run directory, runs five synthetic boundary and
normalization controls, and scans every production Java file. It rejects linked
inputs and source-inventory drift. Read `status.json` and its run directory:
`cpd.json` retains raw groups and endpoints; the summary also counts unique
complete endpoint sets. Deduplication removes only identical endpoint sets,
without merging overlapping fragments. A `PASS` status is an execution result,
not a zero-duplication assertion. This local module run does not establish the
server's density or new-code measures.

## Record and transfer evidence

Freeze a baseline before editing. For each selected finding or duplicated block,
record the file/function or endpoints, rule parameters, disposition, reason and
verification. Extract cohesive phases and shared concepts while preserving
authorization order, error precedence, transaction/lock boundaries, resource
ownership, SQL and wire/archive formats. Do not suppress findings or weaken
thresholds simply to obtain zero counts.

Recompile and rerun against final source. Report whole-backend findings as well
as the formal review scope, including unresolved findings in other packages.
Bind reports to source, compiled inputs, library and tool hashes. Obtain an
independent review and retain execution/package/cleanup evidence. A later code
change invalidates affected proof until rechecked.

Ignored `logs/` output and downloaded runtimes do not travel with Git. Put the
essential results, remaining work, runtime versions and reproduction commands in
the tracked directory guide and handoff. Recreate local runtime/output on the
next machine; copy raw evidence separately only when needed.
