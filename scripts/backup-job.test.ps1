[CmdletBinding()]
param([string]$NodePath)

# Offline Windows integration tests. Every receipt, process, lock and publisher
# is synthetic and belongs to a new private temporary directory. No scheduled
# task, Git remote, provider, backup location or production configuration is used.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or $PSVersionTable.PSVersion -lt [version]'7.5') {
    throw 'BACKUP_CHILD_TEST_REQUIRES_WINDOWS_POWERSHELL_7_5'
}

$runnerPath = Join-Path $PSScriptRoot 'run-backup-job.ps1'
$publisherPath = Join-Path $PSScriptRoot 'backup-status.mjs'
$runtimePath = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
if (-not $NodePath) {
    # Resolve nvm's junction before constructing a configuration that deliberately
    # rejects reparse ancestors. The resolved runtime is used only for fixtures.
    $NodePath = (& node -p 'require("node:fs").realpathSync(process.execPath)').Trim()
    if ($LASTEXITCODE -ne 0) { throw 'BACKUP_CHILD_TEST_NODE_UNAVAILABLE' }
}
$tokens = $null
$parseErrors = $null
$parsed = [System.Management.Automation.Language.Parser]::ParseFile($runnerPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'BACKUP_CHILD_TEST_RUNNER_PARSE_FAILED' }
foreach ($name in @('Stop-BackupJob', 'Initialize-BackupChildRuntime', 'Invoke-BackupChild')) {
    $definition = $parsed.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    . ([scriptblock]::Create($definition.Extent.Text))
}
$script:CleanupUnconfirmed = $false
$captureLock = $null
$script:Passed = 0
$script:Case = 'initialization'
$ownedProcesses = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()
$fixtureRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('kevin-mel-backup-test-' + [guid]::NewGuid().ToString('N'))
[void][System.IO.Directory]::CreateDirectory($fixtureRoot)
$fixtureRoot = [System.IO.Path]::GetFullPath($fixtureRoot)

function Assert-Test([bool]$Condition) {
    if (-not $Condition) { throw 'SYNTHETIC_ASSERTION_FAILED' }
}
function Complete-Test([string]$Name) {
    $script:Passed++
    [Console]::Out.WriteLine('PASS ' + $Name)
}
function Write-TestText([string]$Path, [string]$Text) {
    [System.IO.File]::WriteAllText($Path, $Text, [System.Text.UTF8Encoding]::new($false))
}
function Wait-TestFile([string]$Path) {
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    while (-not [System.IO.File]::Exists($Path) -and $timer.Elapsed.TotalSeconds -lt 12) { Start-Sleep -Milliseconds 20 }
    Assert-Test ([System.IO.File]::Exists($Path))
}
function Assert-ProcessGone([int]$OwnedId) {
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    do {
        $process = Get-Process -Id $OwnedId -ErrorAction SilentlyContinue
        if ($null -eq $process -or $process.HasExited) { return }
        Start-Sleep -Milliseconds 20
    } while ($timer.Elapsed.TotalSeconds -lt 5)
    throw 'SYNTHETIC_DESCENDANT_SURVIVED'
}
function Assert-CaptureFailure([scriptblock]$Action) {
    $caught = $null
    try { & $Action | Out-Null } catch { $caught = $_.Exception.Message }
    Assert-Test ($caught -ceq 'capture_failed')
    Assert-Test ($script:CleanupUnconfirmed)
}
function New-TestProcess([string[]]$Arguments) {
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $runtimePath
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    foreach ($argument in $Arguments) { [void]$startInfo.ArgumentList.Add($argument) }
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    Assert-Test ($process.Start())
    $ownedProcesses.Add($process)
    return $process
}
function Read-TestProcess($Process) {
    $output = $Process.StandardOutput.ReadToEndAsync()
    $errors = $Process.StandardError.ReadToEndAsync()
    Assert-Test ($Process.WaitForExit(20000))
    Assert-Test ([System.Threading.Tasks.Task]::WhenAll([System.Threading.Tasks.Task[]]@($output, $errors)).Wait(5000))
    return @{ Code = $Process.ExitCode; Output = $output.Result.Trim(); Error = $errors.Result.Trim() }
}
function Test-Pin([string]$Path) {
    return @{ path = $Path; sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
}

try {
    # The coordinator's private-path guards run for the full-script cases below.
    $operator = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = [System.Security.AccessControl.DirectorySecurity]::new()
    $acl.SetOwner($operator)
    $acl.SetAccessRuleProtection($true, $false)
    $inheritance = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    foreach ($sid in @($operator.Value, 'S-1-5-18', 'S-1-5-32-544')) {
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
            [System.Security.Principal.SecurityIdentifier]::new($sid),
            [System.Security.AccessControl.FileSystemRights]::FullControl, $inheritance,
            [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
        [void]$acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $fixtureRoot -AclObject $acl

    $leafPath = Join-Path $fixtureRoot 'leaf.cjs'
    Write-TestText $leafPath @'
const fs = require('node:fs');
fs.writeFileSync(process.argv[2], JSON.stringify({ leaf: process.pid, adapter: process.ppid }));
setTimeout(() => fs.writeFileSync(process.argv[3], 'synthetic delayed write'), 10000);
'@
    $adapterPath = Join-Path $fixtureRoot 'adapter.ps1'
    Write-TestText $adapterPath @'
param($Mode, $NodePath, $LeafPath, $ReadyPath, $MarkerPath)
$ErrorActionPreference = 'Stop'
$startInfo = [System.Diagnostics.ProcessStartInfo]::new()
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
if ($Mode -eq 'grandchild') {
    $startInfo.FileName = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
    foreach ($argument in @('-NoProfile', '-File', $PSCommandPath, 'inherited', $NodePath, $LeafPath, $ReadyPath, $MarkerPath)) {
        [void]$startInfo.ArgumentList.Add($argument)
    }
} else {
    $startInfo.FileName = $NodePath
    foreach ($argument in @($LeafPath, $ReadyPath, $MarkerPath)) { [void]$startInfo.ArgumentList.Add($argument) }
    if ($Mode -eq 'closed') {
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true
    }
}
$child = [System.Diagnostics.Process]::Start($startInfo)
$deadline = [System.Diagnostics.Stopwatch]::StartNew()
while (-not [System.IO.File]::Exists($ReadyPath) -and $deadline.Elapsed.TotalSeconds -lt 5) { Start-Sleep -Milliseconds 10 }
if (-not [System.IO.File]::Exists($ReadyPath)) { exit 2 }
if ($Mode -eq 'wait') { Start-Sleep -Seconds 20 }
exit 0
'@
    $script:Case = 'normal and nonzero completion'
    Assert-Test ((Invoke-BackupChild $NodePath @('-e', 'process.exit(0)') 5) -eq 0)
    Complete-Test 'normal exit'
    Assert-Test ((Invoke-BackupChild $NodePath @('-e', 'process.exit(42)') 5) -eq 42)
    Complete-Test 'nonzero exit is retained'

    $script:Case = 'argument boundary'
    $argumentsPath = Join-Path $fixtureRoot 'arguments.json'
    $expected = @('', 'two words', 'quote"inside', 'trailing\', 'two\\"slashes', 'emoji-💛', '$() & | % literal')
    $argumentProgram = 'require("node:fs").writeFileSync(process.argv[1],JSON.stringify(process.argv.slice(2)))'
    Assert-Test ((Invoke-BackupChild $NodePath (@('-e', $argumentProgram, $argumentsPath) + $expected) 5) -eq 0)
    $actual = Get-Content -LiteralPath $argumentsPath -Raw | ConvertFrom-Json
    Assert-Test ($actual.Count -eq $expected.Count)
    for ($index = 0; $index -lt $expected.Count; $index++) { Assert-Test ($actual[$index] -ceq $expected[$index]) }
    Complete-Test 'literal argv including empty Unicode quotes and trailing slashes'

    $script:Case = 'discarded output and EOF input'
    $outputProgram = 'const fs=require("node:fs"),b=Buffer.alloc(65536,120); for(let i=0;i<1024;i++){fs.writeSync(1,b);fs.writeSync(2,b)} process.exit(fs.readSync(0,b,0,1,null)===0?0:42)'
    $output = @(Invoke-BackupChild $NodePath @('-e', $outputProgram) 5)
    Assert-Test ($output.Count -eq 1 -and $output[0] -eq 0)
    Complete-Test '128 MiB output discarded and stdin EOF without pipes or buffers'

    $script:Case = 'environment boundary'
    $env:BACKUP_CHILD_SYNTHETIC_VALUE = 'fixture-only'
    try {
        $environmentProgram = 'process.exit(process.env.BACKUP_CHILD_SYNTHETIC_VALUE===undefined&&process.env.GIT_TERMINAL_PROMPT==="0"&&process.env.GCM_INTERACTIVE==="Never"?0:42)'
        Assert-Test ((Invoke-BackupChild $NodePath @('-e', $environmentProgram) 5) -eq 0)
    } finally { Remove-Item Env:BACKUP_CHILD_SYNTHETIC_VALUE }
    Complete-Test 'private environment not inherited'

    $script:Case = 'failed creation'
    $caught = $null
    try { Invoke-BackupChild (Join-Path $fixtureRoot 'missing.exe') @() 5 | Out-Null } catch { $caught = $_.Exception.Message }
    Assert-Test ($caught -ceq 'runtime_unavailable' -and -not $script:CleanupUnconfirmed)
    Complete-Test 'failed creation refuses uncontained fallback'

    foreach ($mode in @('inherited', 'closed', 'grandchild', 'wait')) {
        $script:Case = 'descendant cleanup ' + $mode
        $ready = Join-Path $fixtureRoot ($mode + '-ready.json')
        $marker = Join-Path $fixtureRoot ($mode + '-late.txt')
        $timeout = if ($mode -eq 'wait') { 2 } else { 8 }
        Assert-CaptureFailure { Invoke-BackupChild $runtimePath @('-NoProfile', '-File', $adapterPath, $mode, $NodePath, $leafPath, $ready, $marker) $timeout }
        Wait-TestFile $ready
        $identities = Get-Content -LiteralPath $ready -Raw | ConvertFrom-Json
        Assert-ProcessGone $identities.leaf
        Assert-ProcessGone $identities.adapter
        Assert-Test (-not [System.IO.File]::Exists($marker))
        Complete-Test ('descendants terminated before return: ' + $mode)
        # These isolated fixture processes perform no remote operations. Their
        # exact owned identities are gone, so reset only this test invocation.
        $script:CleanupUnconfirmed = $false
    }

    $script:Case = 'local drain does not establish remote completion'
    $nativeEnvironment = [Collections.Generic.Dictionary[string,string]]::new()
    $nativeEnvironment['SystemRoot'] = $env:SystemRoot
    $drained = [KevinMelBackup.ContainedChild]::Run($NodePath, @('-e', 'setTimeout(()=>{},10000)'),
        $nativeEnvironment, 1)
    Assert-Test ($drained.Failure -ceq 'capture_failed' -and $drained.ForcedTermination -and
        $drained.LocalCleanupConfirmed -and -not $drained.CleanupConfirmed)
    Complete-Test 'forced termination remains uncertain after confirmed local drain'

    # Full coordinator cases use a fixture publisher which validates the real
    # protocol then writes a local marker. It has no Git or network operation.
    $fakePublisher = Join-Path $fixtureRoot 'backup-status.mjs'
    $publisherUrl = [System.Uri]::new($publisherPath).AbsoluteUri | ConvertTo-Json -Compress
    Write-TestText $fakePublisher (@'
import fs from 'node:fs';
import path from 'node:path';
import { parseBackupReceiptJson } from PUBLISHER_URL;
const args = process.argv.slice(2);
const receiptPath = args[0] === '--validate-receipt' ? args[1] : args[2];
parseBackupReceiptJson(fs.readFileSync(receiptPath, 'utf8'));
if (args[0] === '--publish') fs.writeFileSync(path.join(path.dirname(receiptPath), 'fixture-publication.json'), fs.readFileSync(receiptPath));
'@).Replace('PUBLISHER_URL', $publisherUrl)
    $producerAdapter = Join-Path $fixtureRoot 'producer-adapter.ps1'
    Write-TestText $producerAdapter @'
param($ConfigurationPath)
$configuration = Get-Content -LiteralPath $ConfigurationPath -Raw | ConvertFrom-Json
$launches = if ([System.IO.File]::Exists($configuration.launchCounterPath)) {
    [int][System.IO.File]::ReadAllText($configuration.launchCounterPath)
} else { 0 }
[System.IO.File]::WriteAllText($configuration.launchCounterPath, [string]($launches + 1))
if ($configuration.mode -eq 'nonzero') { exit 42 }
if ($configuration.mode -eq 'nested-nonzero') {
    # Model a private adapter which kills its own native child, then exits
    # normally with failure. No network or actual backup operation is used.
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new($configuration.nodePath)
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $program = 'require("node:fs").writeFileSync(process.argv[1],JSON.stringify({pid:process.pid}));setTimeout(()=>{},15000)'
    foreach ($argument in @('-e', $program, $configuration.readyPath)) { [void]$startInfo.ArgumentList.Add($argument) }
    $nested = [System.Diagnostics.Process]::Start($startInfo)
    try {
        $nested.StandardInput.Close()
        $output = $nested.StandardOutput.ReadToEndAsync()
        $errors = $nested.StandardError.ReadToEndAsync()
        $deadline = [System.Diagnostics.Stopwatch]::StartNew()
        while (-not [System.IO.File]::Exists($configuration.readyPath) -and $deadline.Elapsed.TotalSeconds -lt 5) { Start-Sleep -Milliseconds 10 }
        if (-not [System.IO.File]::Exists($configuration.readyPath)) { exit 43 }
        $nested.Kill($true)
        if (-not $nested.WaitForExit(5000) -or -not [Threading.Tasks.Task]::WhenAll([Threading.Tasks.Task[]]@($output,$errors)).Wait(5000)) { exit 43 }
        $evidence = @{ pid = $nested.Id; childExited = $nested.HasExited; forcedTermination = $true
            diagnosticsEmpty = $output.Result.Length -eq 0 -and $errors.Result.Length -eq 0; remoteCompletionConfirmed = $false }
        [System.IO.File]::WriteAllText($configuration.readyPath, ($evidence | ConvertTo-Json))
    } finally {
        if (-not $nested.HasExited) { $nested.Kill($true); [void]$nested.WaitForExit(5000) }
        $nested.Dispose()
    }
    exit 42
}
if ($configuration.mode -eq 'accepted') {
    $now = [DateTimeOffset]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    $receipt = @{ schemaVersion = 1; kind = 'kevin-mel-backup-receipt'; state = 'accepted'; observedAt = $now
        database = @{ recoveryPointAt = $now; verifiedAt = $now }; media = @{ verifiedAt = $now }
        ledger = @{ verifiedAt = $now }; expiry = @{ checkedAt = $now; healthy = $true }; failure = $null }
    [System.IO.File]::WriteAllText($configuration.receiptPath, ($receipt | ConvertTo-Json -Depth 8))
    exit 0
}
& $configuration.adapterPath $configuration.mode $configuration.nodePath $configuration.leafPath $configuration.readyPath $configuration.markerPath
exit $LASTEXITCODE
'@
    $producerConfiguration = Join-Path $fixtureRoot 'producer-config.json'
    $launchCounterPath = Join-Path $fixtureRoot 'fixture-producer-launches.txt'
    $receiptPath = Join-Path $fixtureRoot 'producer-receipt.json'
    $statePath = Join-Path $fixtureRoot 'last-accepted-receipt.json'
    $lockPath = Join-Path $fixtureRoot 'capture.lock'
    $configurationPath = Join-Path $fixtureRoot 'coordinator-config.json'
    $configuration = [ordered]@{ schemaVersion = 1; operatorSid = $operator.Value
        driveRoot = [System.IO.Path]::GetPathRoot($fixtureRoot); privateWorkDirectory = $fixtureRoot
        repositoryDirectory = [System.IO.Path]::GetDirectoryName($PSScriptRoot)
        receiptPath = $receiptPath; statePath = $statePath; lockPath = $lockPath
        runtime = (Test-Pin $runtimePath); node = (Test-Pin $NodePath); producerAdapter = (Test-Pin $producerAdapter)
        publisher = (Test-Pin $fakePublisher); runner = (Test-Pin $runnerPath)
        producerConfigurationPath = $producerConfiguration; timeoutSeconds = 30; taskName = 'KevinMelBackupCapture' }
    Write-TestText $configurationPath ($configuration | ConvertTo-Json -Depth 8)
    $oldTime = [DateTimeOffset]::UtcNow.AddMinutes(-1).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    $lastGood = [ordered]@{ schemaVersion = 1; kind = 'kevin-mel-backup-receipt'; state = 'accepted'; observedAt = $oldTime
        database = @{ recoveryPointAt = $oldTime; verifiedAt = $oldTime }; media = @{ verifiedAt = $oldTime }
        ledger = @{ verifiedAt = $oldTime }; expiry = @{ checkedAt = $oldTime; healthy = $true }; failure = $null }
    $lastGoodJson = $lastGood | ConvertTo-Json -Depth 8

    function Set-TestProducer([string]$Mode, [string]$Name) {
        $script:ProducerReady = Join-Path $fixtureRoot ($Name + '-ready.json')
        $script:ProducerMarker = Join-Path $fixtureRoot ($Name + '-late.txt')
        Write-TestText $producerConfiguration (@{ mode = $Mode; receiptPath = $receiptPath; adapterPath = $adapterPath
            nodePath = $NodePath; leafPath = $leafPath; readyPath = $script:ProducerReady; markerPath = $script:ProducerMarker;
            launchCounterPath = $launchCounterPath } | ConvertTo-Json)
    }
    function Start-TestCoordinator {
        return New-TestProcess @('-NoProfile', '-NonInteractive', '-File', $runnerPath, '-ConfigPath', $configurationPath)
    }
    function Assert-TestLockAvailable {
        $lock = [System.IO.FileStream]::new($lockPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
        try { Assert-Test ($lock.Length -eq 0) } finally { $lock.Dispose() }
    }

    $script:Case = 'coordinator accepted receipt'
    Write-TestText $statePath $lastGoodJson
    Set-TestProducer 'accepted' 'accepted'
    $validation = Read-TestProcess (New-TestProcess @('-NoProfile', '-NonInteractive', '-File', $runnerPath, '-ConfigPath', $configurationPath, '-ValidateOnly'))
    Assert-Test ($validation.Code -eq 0 -and $validation.Output -ceq 'BACKUP_JOB_CONFIGURATION_VALID')
    Assert-Test (-not [System.IO.File]::Exists($lockPath) -and -not [System.IO.File]::Exists($receiptPath) -and
        -not [System.IO.File]::Exists((Join-Path $fixtureRoot 'fixture-publication.json')))
    Complete-Test 'validation creates no lock marker receipt or publication'
    $accepted = Read-TestProcess (Start-TestCoordinator)
    Assert-Test ($accepted.Code -eq 0 -and $accepted.Output -ceq 'BACKUP_JOB_ACCEPTED_AND_PUBLISHED' -and $accepted.Error -ceq '')
    $acceptedState = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json -DateKind String
    Assert-Test ([DateTimeOffset]::Parse($acceptedState.database.recoveryPointAt) -gt [DateTimeOffset]::Parse($oldTime))
    Assert-Test ([System.IO.File]::ReadAllText($statePath) -ceq [System.IO.File]::ReadAllText((Join-Path $fixtureRoot 'fixture-publication.json')))
    Assert-TestLockAvailable
    Complete-Test 'coordinator accepts only fresh receipt and releases lock'

    $script:Case = 'coordinator forced cleanup preserves remote uncertainty'
    Write-TestText $statePath $lastGoodJson
    Set-TestProducer 'inherited' 'coordinator-orphan'
    $publishedBefore = [System.IO.File]::ReadAllText((Join-Path $fixtureRoot 'fixture-publication.json'))
    $launchesBefore = [int][System.IO.File]::ReadAllText($launchCounterPath)
    $failure = Read-TestProcess (Start-TestCoordinator)
    Assert-Test ($failure.Code -eq 1 -and $failure.Error -ceq 'BACKUP_JOB_FAILED:capture_failed')
    Assert-Test ([System.IO.File]::ReadAllText($statePath) -ceq $lastGoodJson)
    Assert-Test ([System.IO.File]::ReadAllText((Join-Path $fixtureRoot 'fixture-publication.json')) -ceq $publishedBefore)
    Assert-Test ([System.IO.File]::ReadAllText($lockPath) -ceq 'BACKUP_JOB_INFLIGHT')
    Assert-Test ([int][System.IO.File]::ReadAllText($launchCounterPath) -eq $launchesBefore + 1)
    # A local fixture counter represents a potentially outstanding remote job.
    # No network is used, and no failure publisher or replacement may launch.
    Set-TestProducer 'accepted' 'blocked-replacement'
    $blockedReplacement = Read-TestProcess (Start-TestCoordinator)
    Assert-Test ($blockedReplacement.Code -eq 1 -and $blockedReplacement.Error -ceq 'BACKUP_JOB_FAILED:capture_failed')
    Assert-Test ([int][System.IO.File]::ReadAllText($launchCounterPath) -eq $launchesBefore + 1)
    Assert-Test ([System.IO.File]::ReadAllText((Join-Path $fixtureRoot 'fixture-publication.json')) -ceq $publishedBefore)
    $orphanReady = Join-Path $fixtureRoot 'coordinator-orphan-ready.json'
    $identities = Get-Content -LiteralPath $orphanReady -Raw | ConvertFrom-Json
    Assert-ProcessGone $identities.leaf
    Assert-ProcessGone $identities.adapter
    Assert-Test ([System.IO.File]::ReadAllText($lockPath) -ceq 'BACKUP_JOB_INFLIGHT')
    Complete-Test 'forced cleanup preserves marker and blocks failure publication and replacement capture'
    # Explicitly reconcile this synthetic no-network case before another case.
    Write-TestText $lockPath ''

    $script:Case = 'coordinator normal nonzero failure'
    Set-TestProducer 'nonzero' 'coordinator-nonzero'
    $publishedBefore = [System.IO.File]::ReadAllText((Join-Path $fixtureRoot 'fixture-publication.json'))
    $launchesBefore = [int][System.IO.File]::ReadAllText($launchCounterPath)
    $failure = Read-TestProcess (Start-TestCoordinator)
    Assert-Test ($failure.Code -eq 1 -and $failure.Error -ceq 'BACKUP_JOB_FAILED:capture_failed')
    Assert-Test ([System.IO.File]::ReadAllText($statePath) -ceq $lastGoodJson)
    Assert-Test ([System.IO.File]::ReadAllText((Join-Path $fixtureRoot 'fixture-publication.json')) -ceq $publishedBefore)
    Assert-Test ([System.IO.File]::ReadAllText($lockPath) -ceq 'BACKUP_JOB_INFLIGHT')
    Set-TestProducer 'accepted' 'nonzero-blocked-replacement'
    $blockedReplacement = Read-TestProcess (Start-TestCoordinator)
    Assert-Test ($blockedReplacement.Code -eq 1 -and $blockedReplacement.Error -ceq 'BACKUP_JOB_FAILED:capture_failed')
    Assert-Test ([int][System.IO.File]::ReadAllText($launchCounterPath) -eq $launchesBefore + 1)
    Assert-Test ([System.IO.File]::ReadAllText((Join-Path $fixtureRoot 'fixture-publication.json')) -ceq $publishedBefore)
    Assert-Test ([System.IO.File]::ReadAllText($lockPath) -ceq 'BACKUP_JOB_INFLIGHT')
    Complete-Test 'nonzero producer exit blocks failure publication and replacement capture'
    Write-TestText $lockPath '' # Explicit reconciliation of this no-network fixture.

    $script:Case = 'nested adapter failure with clean local native completion'
    Set-TestProducer 'nested-nonzero' 'coordinator-nested'
    $nestedEnvironment = [Collections.Generic.Dictionary[string,string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($name in @('SystemRoot','WINDIR','PATH','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','COMSPEC','PATHEXT')) {
        $value = [Environment]::GetEnvironmentVariable($name)
        if ($null -ne $value) { $nestedEnvironment[$name] = $value }
    }
    $nestedResult = [KevinMelBackup.ContainedChild]::Run($runtimePath,
        @('-NoProfile','-NonInteractive','-File',$producerAdapter,$producerConfiguration), $nestedEnvironment, 10)
    Assert-Test ($null -eq $nestedResult.Failure -and $nestedResult.ExitCode -eq 42 -and
        $nestedResult.LocalCleanupConfirmed -and $nestedResult.CleanupConfirmed -and -not $nestedResult.ForcedTermination)
    $nestedEvidence = Get-Content -LiteralPath $script:ProducerReady -Raw | ConvertFrom-Json
    Assert-Test ($nestedEvidence.childExited -and $nestedEvidence.forcedTermination -and
        $nestedEvidence.diagnosticsEmpty -and -not $nestedEvidence.remoteCompletionConfirmed)
    Assert-ProcessGone $nestedEvidence.pid
    Complete-Test 'inner forced termination can leave outer native cleanup confirmed'
    [System.IO.File]::Delete($script:ProducerReady)
    $launchesBefore = [int][System.IO.File]::ReadAllText($launchCounterPath)
    $failure = Read-TestProcess (Start-TestCoordinator)
    Assert-Test ($failure.Code -eq 1 -and $failure.Error -ceq 'BACKUP_JOB_FAILED:capture_failed')
    $nestedEvidence = Get-Content -LiteralPath $script:ProducerReady -Raw | ConvertFrom-Json
    Assert-Test ($nestedEvidence.childExited -and $nestedEvidence.forcedTermination -and
        $nestedEvidence.diagnosticsEmpty -and -not $nestedEvidence.remoteCompletionConfirmed)
    Assert-ProcessGone $nestedEvidence.pid
    Assert-Test ([System.IO.File]::ReadAllText($statePath) -ceq $lastGoodJson)
    Assert-Test ([System.IO.File]::ReadAllText((Join-Path $fixtureRoot 'fixture-publication.json')) -ceq $publishedBefore)
    Assert-Test ([System.IO.File]::ReadAllText($lockPath) -ceq 'BACKUP_JOB_INFLIGHT')
    Set-TestProducer 'accepted' 'nested-blocked-replacement'
    $blockedReplacement = Read-TestProcess (Start-TestCoordinator)
    Assert-Test ($blockedReplacement.Code -eq 1 -and $blockedReplacement.Error -ceq 'BACKUP_JOB_FAILED:capture_failed')
    Assert-Test ([int][System.IO.File]::ReadAllText($launchCounterPath) -eq $launchesBefore + 1)
    Assert-Test ([System.IO.File]::ReadAllText((Join-Path $fixtureRoot 'fixture-publication.json')) -ceq $publishedBefore)
    Assert-Test ([System.IO.File]::ReadAllText($lockPath) -ceq 'BACKUP_JOB_INFLIGHT')
    Complete-Test 'nested producer failure retains marker despite clean local completion'
    Write-TestText $lockPath '' # Exact synthetic child identity is gone; no remote operation was used.

    $script:Case = 'single flight and coordinator termination'
    Set-TestProducer 'wait' 'coordinator-killed'
    $running = Start-TestCoordinator
    Wait-TestFile $script:ProducerReady
    $identities = Get-Content -LiteralPath $script:ProducerReady -Raw | ConvertFrom-Json
    $busy = Read-TestProcess (Start-TestCoordinator)
    Assert-Test ($busy.Code -eq 0 -and $busy.Output -ceq 'BACKUP_JOB_SKIPPED_BUSY')
    # Kill only the owned coordinator, deliberately not Kill(true): job-handle
    # close must independently terminate its producer and every descendant.
    $running.Kill()
    Assert-Test ($running.WaitForExit(5000))
    # Attempt restart before inspecting or waiting for any descendant. The
    # write-ahead marker must independently prevent overlapping replacement.
    $restarted = Read-TestProcess (Start-TestCoordinator)
    Assert-Test ($restarted.Code -eq 1 -and $restarted.Error -ceq 'BACKUP_JOB_FAILED:capture_failed')
    Assert-Test ([System.IO.File]::ReadAllText($lockPath) -ceq 'BACKUP_JOB_INFLIGHT')
    Assert-ProcessGone $identities.leaf
    Assert-ProcessGone $identities.adapter
    $lock = [System.IO.FileStream]::new($lockPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    try { Assert-Test ($lock.Length -gt 0) } finally { $lock.Dispose() }
    Assert-Test ([System.IO.File]::ReadAllText($statePath) -ceq $lastGoodJson)
    Complete-Test 'coordinator death preserves write-ahead marker and refuses immediate restart'

    # Inject stream failures into a private copy, not the production runner or
    # live filesystem. This tests the complete catch/finally control flow: no
    # producer or failure-publisher may start if marker Write/Flush fails.
    $faultDirectory = Join-Path $fixtureRoot 'fault-injection'
    [void][System.IO.Directory]::CreateDirectory($faultDirectory)
    $faultRunner = Join-Path $faultDirectory 'run-backup-job.ps1'
    $runnerSource = [System.IO.File]::ReadAllText($runnerPath)
    $lockConstructor = [regex]::Match($runnerSource, '\$captureLock = \[System\.IO\.FileStream\]::new\(\$configuration\.lockPath, \[System\.IO\.FileMode\]::OpenOrCreate,\s*\[System\.IO\.FileAccess\]::ReadWrite, \[System\.IO\.FileShare\]::None\)')
    Assert-Test ($lockConstructor.Success)
    foreach ($fault in @('Write', 'Flush')) {
        $script:Case = 'write-ahead marker failure ' + $fault
        Write-TestText $lockPath '' # Prior synthetic descendants are confirmed gone above.
        [System.IO.File]::Delete($receiptPath)
        $publishedBefore = [System.IO.File]::ReadAllText((Join-Path $fixtureRoot 'fixture-publication.json'))
        $replacement = @"
Add-Type -TypeDefinition @'
namespace BackupChildFixture {
    public sealed class FailingLock : System.IO.FileStream {
        public FailingLock(string path) : base(path, System.IO.FileMode.OpenOrCreate,
            System.IO.FileAccess.ReadWrite, System.IO.FileShare.None) { }
        public override void Write(byte[] bytes, int offset, int count) {
            WRITE_FAILURE
            base.Write(bytes, offset, count);
        }
        public override void Flush(bool durable) {
            FLUSH_FAILURE
            base.Flush(durable);
        }
    }
}
'@
`$captureLock = [BackupChildFixture.FailingLock]::new(`$configuration.lockPath)
"@
        $replacement = $replacement.Replace('WRITE_FAILURE', $(if ($fault -eq 'Write') { 'if (count >= 0) throw new System.IO.IOException();' } else { '' }))
        $replacement = $replacement.Replace('FLUSH_FAILURE', $(if ($fault -eq 'Flush') { 'if (durable) throw new System.IO.IOException();' } else { '' }))
        Write-TestText $faultRunner ($runnerSource.Replace($lockConstructor.Value, $replacement))
        $configuration.runner = Test-Pin $faultRunner
        Write-TestText $configurationPath ($configuration | ConvertTo-Json -Depth 8)
        Set-TestProducer 'accepted' ('fault-' + $fault)
        $faulted = Read-TestProcess (New-TestProcess @('-NoProfile', '-NonInteractive', '-File', $faultRunner, '-ConfigPath', $configurationPath))
        Assert-Test ($faulted.Code -eq 1 -and $faulted.Error -ceq 'BACKUP_JOB_FAILED:capture_failed')
        Assert-Test (-not [System.IO.File]::Exists($receiptPath))
        Assert-Test ([System.IO.File]::ReadAllText((Join-Path $fixtureRoot 'fixture-publication.json')) -ceq $publishedBefore)
        Assert-Test ([System.IO.File]::ReadAllText($statePath) -ceq $lastGoodJson)
        if ($fault -eq 'Flush') { Assert-Test ([System.IO.File]::ReadAllText($lockPath) -ceq 'BACKUP_JOB_INFLIGHT') }
        Complete-Test ('failed marker ' + $fault + ' prevents producer and failure-publication launch')
    }
    $configuration.runner = Test-Pin $runnerPath
    Write-TestText $configurationPath ($configuration | ConvertTo-Json -Depth 8)

    $script:Case = 'persistent unconfirmed cleanup latch'
    $latch = 'BACKUP_JOB_CLEANUP_UNCONFIRMED'
    Write-TestText $lockPath $latch
    Set-TestProducer 'accepted' 'latched'
    $blocked = Read-TestProcess (Start-TestCoordinator)
    Assert-Test ($blocked.Code -eq 1 -and $blocked.Error -ceq 'BACKUP_JOB_FAILED:capture_failed')
    Assert-Test ([System.IO.File]::ReadAllText($statePath) -ceq $lastGoodJson -and [System.IO.File]::ReadAllText($lockPath) -ceq $latch)
    Complete-Test 'nonempty cleanup latch blocks subsequent producer launches'

    $script:Case = 'no delayed writes'
    Start-Sleep -Milliseconds 10200
    Assert-Test (@(Get-ChildItem -LiteralPath $fixtureRoot -Filter '*-late.txt').Count -eq 0)
    Complete-Test 'no descendant writes after any cleanup returns'
    [Console]::Out.WriteLine('BACKUP_CHILD_TESTS_PASSED:' + $script:Passed)
} catch {
    [Console]::Error.WriteLine('BACKUP_CHILD_TEST_FAILED:' + $script:Case)
    exit 1
} finally {
    foreach ($process in $ownedProcesses) {
        if (-not $process.HasExited) { $process.Kill($true); [void]$process.WaitForExit(5000) }
        $process.Dispose()
    }
    # Verify the exact disposable root before recursive cleanup. Every name is
    # generated above; no configuration or operator path can select this target.
    $temporaryParent = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\')
    if ([System.IO.Path]::GetDirectoryName($fixtureRoot) -ceq $temporaryParent -and
        [System.IO.Path]::GetFileName($fixtureRoot) -cmatch '^kevin-mel-backup-test-[0-9a-f]{32}$') {
        Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
    }
}
