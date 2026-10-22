[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ConfigPath,
    [switch]$ValidateOnly
)

# Coordinator only. The privately reviewed producer remains a required adapter;
# this script does not implement database capture, media replication, or crypto.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:OperatorSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$script:FailureCategories = @('capture_failed', 'encryption_failed', 'verification_failed', 'publication_failed',
    'media_copy_failed', 'ledger_copy_failed', 'expiry_failed', 'storage_unavailable', 'access_unavailable',
    'runtime_unavailable', 'adapter_unavailable', 'no_accepted_backup')

function Stop-BackupJob([string]$Category) {
    throw [System.InvalidOperationException]::new($Category)
}

function Assert-AbsoluteLocalPath([string]$Candidate) {
    if ([string]::IsNullOrWhiteSpace($Candidate) -or $Candidate -notmatch '^[A-Za-z]:\\' -or
        -not [System.IO.Path]::IsPathFullyQualified($Candidate)) { Stop-BackupJob 'invalid_configuration' }
    return [System.IO.Path]::GetFullPath($Candidate)
}

function Assert-NotLinked([string]$Candidate, [bool]$MustExist = $true) {
    $full = Assert-AbsoluteLocalPath $Candidate
    if (-not [System.IO.File]::Exists($full) -and -not [System.IO.Directory]::Exists($full)) {
        if ($MustExist) { Stop-BackupJob 'configuration_unavailable' }
        $full = [System.IO.Path]::GetDirectoryName($full)
    }
    while (-not [string]::IsNullOrEmpty($full)) {
        $item = Get-Item -LiteralPath $full -Force
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { Stop-BackupJob 'linked_path_refused' }
        $parent = [System.IO.Path]::GetDirectoryName($full)
        if ($parent -eq $full) { break }
        $full = $parent
    }
}

function Assert-PrivatePath([string]$Candidate, [bool]$Directory = $false, [bool]$AllowMissing = $false) {
    $full = Assert-AbsoluteLocalPath $Candidate
    Assert-NotLinked $full (-not $AllowMissing)
    if (-not (Test-Path -LiteralPath $full)) {
        if (-not $AllowMissing) { Stop-BackupJob 'configuration_unavailable' }
        $full = [System.IO.Path]::GetDirectoryName($full)
        $Directory = $true
    }
    $item = Get-Item -LiteralPath $full -Force
    if ($item.PSIsContainer -ne $Directory) { Stop-BackupJob 'invalid_configuration' }
    $acl = Get-Acl -LiteralPath $full
    if ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $script:OperatorSid) {
        Stop-BackupJob 'private_configuration_required'
    }
    foreach ($rule in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
            $rule.IdentityReference.Value -notin @($script:OperatorSid, 'S-1-5-18', 'S-1-5-32-544')) {
            Stop-BackupJob 'private_configuration_required'
        }
    }
}

function Assert-JsonKeys($Value, [string[]]$Names) {
    if ($Value -isnot [System.Collections.IDictionary] -or $Value.Count -ne $Names.Count) {
        Stop-BackupJob 'invalid_configuration'
    }
    foreach ($name in $Names) { if (-not $Value.Contains($name)) { Stop-BackupJob 'invalid_configuration' } }
}

function Assert-NoDuplicateJsonKeys([System.Text.Json.JsonElement]$Element) {
    if ($Element.ValueKind -eq [System.Text.Json.JsonValueKind]::Object) {
        $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
        foreach ($property in $Element.EnumerateObject()) {
            if (-not $seen.Add($property.Name)) { Stop-BackupJob 'invalid_configuration' }
            Assert-NoDuplicateJsonKeys $property.Value
        }
    } elseif ($Element.ValueKind -eq [System.Text.Json.JsonValueKind]::Array) {
        foreach ($entry in $Element.EnumerateArray()) { Assert-NoDuplicateJsonKeys $entry }
    }
}

function Read-PrivateJson([string]$File, [int]$MaximumBytes = 32768) {
    Assert-PrivatePath $File
    $item = Get-Item -LiteralPath $File -Force
    if ($item.Length -lt 1 -or $item.Length -gt $MaximumBytes) { Stop-BackupJob 'invalid_configuration' }
    $stream = [System.IO.FileStream]::new($item.FullName, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
    try {
        $bytes = [byte[]]::new($MaximumBytes + 1)
        $count = 0
        while ($count -lt $bytes.Length) {
            $read = $stream.Read($bytes, $count, $bytes.Length - $count)
            if ($read -eq 0) { break }
            $count += $read
        }
        if ($count -lt 1 -or $count -gt $MaximumBytes) { Stop-BackupJob 'invalid_configuration' }
        $text = [System.Text.UTF8Encoding]::new($false, $true).GetString($bytes, 0, $count)
    } finally { $stream.Dispose() }
    $document = [System.Text.Json.JsonDocument]::Parse($text)
    try { Assert-NoDuplicateJsonKeys $document.RootElement } finally { $document.Dispose() }
    # Preserve protocol UTC strings. Automatic DateTime conversion followed by
    # implicit string coercion would reinterpret them in the machine timezone.
    return ConvertFrom-Json -InputObject $text -AsHashtable -Depth 16 -DateKind String
}

function Assert-Pin($Pin, [string]$Extension) {
    Assert-JsonKeys $Pin @('path', 'sha256')
    if ($Pin.path -isnot [string] -or $Pin.sha256 -isnot [string] -or $Pin.sha256 -cnotmatch '^[0-9a-f]{64}$' -or
        [System.IO.Path]::GetExtension($Pin.path) -ine $Extension) { Stop-BackupJob 'invalid_configuration' }
    Assert-NotLinked $Pin.path
    $item = Get-Item -LiteralPath $Pin.path -Force
    if ($item.PSIsContainer -or (Get-FileHash -LiteralPath $Pin.path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $Pin.sha256) {
        Stop-BackupJob 'pin_mismatch'
    }
}

function Read-BackupConfiguration {
    if (-not $IsWindows) { Stop-BackupJob 'windows_required' }
    $configuration = Read-PrivateJson $ConfigPath
    Assert-JsonKeys $configuration @('schemaVersion', 'operatorSid', 'driveRoot', 'privateWorkDirectory',
        'repositoryDirectory', 'receiptPath', 'statePath', 'lockPath', 'runtime', 'node', 'producerAdapter',
        'publisher', 'runner', 'producerConfigurationPath', 'timeoutSeconds', 'taskName')
    if ($configuration.schemaVersion -ne 1 -or $configuration.operatorSid -cne $script:OperatorSid -or
        $configuration.taskName -cne 'KevinMelBackupCapture' -or $configuration.driveRoot -isnot [string] -or
        $configuration.driveRoot -cnotmatch '^[A-Z]:\\$' -or $configuration.timeoutSeconds -isnot [long] -and
        $configuration.timeoutSeconds -isnot [int]) { Stop-BackupJob 'invalid_configuration' }
    if ($configuration.timeoutSeconds -lt 30 -or $configuration.timeoutSeconds -gt 240) { Stop-BackupJob 'invalid_configuration' }
    if (-not [System.IO.Directory]::Exists($configuration.driveRoot)) { Stop-BackupJob 'storage_unavailable' }
    $work = Assert-AbsoluteLocalPath $configuration.privateWorkDirectory
    if (-not $work.StartsWith($configuration.driveRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        Stop-BackupJob 'invalid_configuration'
    }
    Assert-PrivatePath $work $true
    foreach ($entry in @(@('receiptPath', 'producer-receipt.json'), @('statePath', 'last-accepted-receipt.json'), @('lockPath', 'capture.lock'))) {
        $actual = Assert-AbsoluteLocalPath $configuration[$entry[0]]
        if (-not $actual.Equals([System.IO.Path]::Combine($work, $entry[1]), [System.StringComparison]::OrdinalIgnoreCase)) {
            Stop-BackupJob 'invalid_configuration'
        }
        Assert-PrivatePath $actual $false $true
    }
    $repository = Assert-AbsoluteLocalPath $configuration.repositoryDirectory
    Assert-NotLinked $repository
    if (-not [System.IO.Directory]::Exists($repository)) { Stop-BackupJob 'invalid_configuration' }
    foreach ($pair in @(@('runtime', '.exe'), @('node', '.exe'), @('producerAdapter', '.ps1'), @('publisher', '.mjs'), @('runner', '.ps1'))) {
        Assert-Pin $configuration[$pair[0]] $pair[1]
    }
    Assert-PrivatePath $configuration.producerAdapter.path
    Assert-PrivatePath $configuration.producerConfigurationPath
    $runtimePath = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
    if (-not $runtimePath.Equals($configuration.runtime.path, [System.StringComparison]::OrdinalIgnoreCase) -or
        -not $PSCommandPath.Equals($configuration.runner.path, [System.StringComparison]::OrdinalIgnoreCase)) {
        Stop-BackupJob 'pin_mismatch'
    }
    if ([System.IO.Path]::GetFileName($configuration.runtime.path) -ine 'pwsh.exe' -or
        [System.IO.Path]::GetFileName($configuration.node.path) -ine 'node.exe' -or
        [System.IO.Path]::GetFileName($configuration.publisher.path) -cne 'backup-status.mjs' -or
        [System.IO.Path]::GetFileName($configuration.runner.path) -cne 'run-backup-job.ps1') { Stop-BackupJob 'invalid_configuration' }
    return $configuration
}

function Invoke-BackupChild([string]$Executable, [string[]]$Arguments, [int]$TimeoutSeconds) {
    $info = [System.Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $Executable
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.RedirectStandardInput = $true
    $info.Environment.Clear()
    foreach ($name in @('PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
        'ProgramData', 'HOMEDRIVE', 'HOMEPATH', 'HOME', 'COMSPEC', 'PATHEXT')) {
        $value = [System.Environment]::GetEnvironmentVariable($name)
        if ($null -ne $value) { $info.Environment[$name] = $value }
    }
    $info.Environment['GIT_TERMINAL_PROMPT'] = '0'
    $info.Environment['GCM_INTERACTIVE'] = 'Never'
    foreach ($argument in $Arguments) { [void]$info.ArgumentList.Add($argument) }
    $child = [System.Diagnostics.Process]::new()
    $child.StartInfo = $info
    $ownedChild = $false
    try {
        if (-not $child.Start()) { Stop-BackupJob 'runtime_unavailable' }
        $ownedChild = $true
        $child.StandardInput.Close()
        $stdout = $child.StandardOutput.BaseStream.CopyToAsync([System.IO.Stream]::Null)
        $stderr = $child.StandardError.BaseStream.CopyToAsync([System.IO.Stream]::Null)
        if (-not $child.WaitForExit($TimeoutSeconds * 1000)) {
            $child.Kill($true)
            [void]$child.WaitForExit(5000)
            Stop-BackupJob 'capture_failed'
        }
        if (-not [System.Threading.Tasks.Task]::WhenAll([System.Threading.Tasks.Task[]]@($stdout, $stderr)).Wait(5000)) { Stop-BackupJob 'capture_failed' }
        return $child.ExitCode
    } finally {
        if ($ownedChild -and -not $child.HasExited) { $child.Kill($true); [void]$child.WaitForExit(5000) }
        $child.Dispose()
    }
}

function Assert-Receipt($Configuration, [string]$Receipt) {
    Assert-PrivatePath $Receipt
    Assert-Pin $Configuration.node '.exe'
    Assert-Pin $Configuration.publisher '.mjs'
    $code = Invoke-BackupChild $Configuration.node.path @($Configuration.publisher.path, '--validate-receipt', $Receipt) 30
    if ($code -ne 0) { Stop-BackupJob 'verification_failed' }
    return Read-PrivateJson $Receipt 16384
}

function Write-PrivateReceipt([string]$Destination, $Receipt) {
    Assert-PrivatePath $Destination $false $true
    $parent = [System.IO.Path]::GetDirectoryName($Destination)
    $temporary = [System.IO.Path]::Combine($parent, 'receipt-' + [guid]::NewGuid().ToString('N') + '.tmp')
    $bytes = [System.Text.UTF8Encoding]::new($false, $true).GetBytes(($Receipt | ConvertTo-Json -Depth 8 -Compress) + "`n")
    if ($bytes.Length -gt 16384) { Stop-BackupJob 'verification_failed' }
    try {
        $stream = [System.IO.FileStream]::new($temporary, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::None, 4096, [System.IO.FileOptions]::WriteThrough)
        try { $stream.Write($bytes); $stream.Flush($true) } finally { $stream.Dispose() }
        Assert-PrivatePath $temporary
        [System.IO.File]::Move($temporary, $Destination, $true)
    } finally {
        if ([System.IO.File]::Exists($temporary)) { [System.IO.File]::Delete($temporary) }
    }
}

function Publish-Receipt($Configuration, [string]$Receipt) {
    Assert-Pin $Configuration.node '.exe'
    Assert-Pin $Configuration.publisher '.mjs'
    $code = Invoke-BackupChild $Configuration.node.path @($Configuration.publisher.path, '--publish', '--receipt', $Receipt,
        '--repository', $Configuration.repositoryDirectory, '--private-work-directory', $Configuration.privateWorkDirectory) 180
    if ($code -ne 0) { Stop-BackupJob 'publication_failed' }
}

function Publish-Failure($Configuration, [string]$Category) {
    if ($Category -notin $script:FailureCategories) { $Category = 'capture_failed' }
    $previous = $null
    if ([System.IO.File]::Exists($Configuration.statePath)) {
        try {
            $candidate = Assert-Receipt $Configuration $Configuration.statePath
            if ($candidate.state -ceq 'accepted') { $previous = $candidate }
        } catch { $previous = $null }
    }
    $observed = [DateTimeOffset]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ', [System.Globalization.CultureInfo]::InvariantCulture)
    if ($null -eq $previous) {
        $previous = [ordered]@{ schemaVersion = 1; kind = 'kevin-mel-backup-receipt'; state = 'unavailable'; observedAt = $observed
            database = [ordered]@{ recoveryPointAt = $null; verifiedAt = $null }; media = @{ verifiedAt = $null }
            ledger = @{ verifiedAt = $null }; expiry = @{ checkedAt = $null; healthy = $null }; failure = $Category }
    } else { $previous.observedAt = $observed; $previous.failure = $Category }
    $failureReceipt = [System.IO.Path]::Combine($Configuration.privateWorkDirectory, 'failure-receipt.json')
    Write-PrivateReceipt $failureReceipt $previous
    Publish-Receipt $Configuration $failureReceipt
}

$configuration = $null
$captureLock = $null
$failure = 'capture_failed'
try {
    $configuration = Read-BackupConfiguration
    if ($ValidateOnly) { Write-Output 'BACKUP_JOB_CONFIGURATION_VALID'; exit 0 }
    try {
        $captureLock = [System.IO.FileStream]::new($configuration.lockPath, [System.IO.FileMode]::OpenOrCreate,
            [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    } catch [System.IO.IOException] { Write-Output 'BACKUP_JOB_SKIPPED_BUSY'; exit 0 }
    $started = [DateTimeOffset]::UtcNow
    Assert-Pin $configuration.runtime '.exe'
    Assert-Pin $configuration.producerAdapter '.ps1'
    # New adapter contract: one private configuration-path argument. No existing
    # home capture command or receipt format is assumed by this coordinator.
    $producerCode = Invoke-BackupChild $configuration.runtime.path @('-NoLogo', '-NoProfile', '-NonInteractive', '-File',
        $configuration.producerAdapter.path, $configuration.producerConfigurationPath) $configuration.timeoutSeconds
    if ($producerCode -ne 0) { Stop-BackupJob 'capture_failed' }
    $receipt = Assert-Receipt $configuration $configuration.receiptPath
    if ($receipt.failure -in $script:FailureCategories) { Stop-BackupJob $receipt.failure }
    if ($receipt.expiry.healthy -eq $false) { Stop-BackupJob 'expiry_failed' }
    if ($receipt.state -cne 'accepted' -or
        [DateTimeOffset]::Parse($receipt.database.verifiedAt, [System.Globalization.CultureInfo]::InvariantCulture) -lt $started -or
        [DateTimeOffset]::Parse($receipt.observedAt, [System.Globalization.CultureInfo]::InvariantCulture) -lt $started) {
        Stop-BackupJob 'verification_failed'
    }
    if ([System.IO.File]::Exists($configuration.statePath)) {
        $previous = Assert-Receipt $configuration $configuration.statePath
        if ($previous.state -ceq 'accepted') {
            foreach ($times in @(@($previous.database.recoveryPointAt, $receipt.database.recoveryPointAt),
                @($previous.database.verifiedAt, $receipt.database.verifiedAt), @($previous.media.verifiedAt, $receipt.media.verifiedAt),
                @($previous.ledger.verifiedAt, $receipt.ledger.verifiedAt), @($previous.expiry.checkedAt, $receipt.expiry.checkedAt))) {
                if ([DateTimeOffset]::Parse($times[1]) -lt [DateTimeOffset]::Parse($times[0])) { Stop-BackupJob 'verification_failed' }
            }
        }
    }
    # Only a fresh validated accepted receipt becomes the retained last-good
    # evidence. A producer exit code alone can never reach this write.
    Write-PrivateReceipt $configuration.statePath $receipt
    Publish-Receipt $configuration $configuration.statePath
    Write-Output 'BACKUP_JOB_ACCEPTED_AND_PUBLISHED'
    exit 0
} catch {
    if ($_.Exception.Message -in $script:FailureCategories) { $failure = $_.Exception.Message }
    if ($null -ne $configuration -and -not $ValidateOnly -and $null -ne $captureLock) {
        try { Publish-Failure $configuration $failure } catch { }
    }
    [Console]::Error.WriteLine('BACKUP_JOB_FAILED:' + $failure)
    exit 1
} finally {
    if ($null -ne $captureLock) { $captureLock.Dispose() }
}
