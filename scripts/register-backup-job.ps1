param(
    [Parameter(Mandatory = $true)]
    [string]$ConfigPath,
    [switch]$ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# This helper creates only the capture task after the pinned runner's read-only
# configuration check. It never replaces an existing task or touches expiry.
function Assert-RegistrationCondition {
    param([bool]$Condition)
    if (-not $Condition) { throw 'BACKUP_JOB_TASK_REFUSED' }
}

function Get-AbsoluteRegistrationPath {
    param([object]$Value)
    Assert-RegistrationCondition ($Value -is [string] -and $Value.Length -gt 0 -and
        $Value -notmatch '[\x00\r\n"]' -and [System.IO.Path]::IsPathFullyQualified($Value))
    $fullPath = [System.IO.Path]::GetFullPath($Value)
    Assert-RegistrationCondition ($fullPath -ceq $Value)
    return $fullPath
}

function Assert-NoRegistrationReparsePoint {
    param([string]$Path)
    $cursor = $Path
    while ($cursor) {
        $item = Get-Item -LiteralPath $cursor -Force
        Assert-RegistrationCondition (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0)
        $parent = [System.IO.Path]::GetDirectoryName($cursor)
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }
}

function Assert-PrivateRegistrationConfiguration {
    param([string]$Path, [string]$OperatorSid)
    Assert-NoRegistrationReparsePoint $Path
    $item = Get-Item -LiteralPath $Path -Force
    Assert-RegistrationCondition (-not $item.PSIsContainer -and $item.Length -gt 0 -and $item.Length -le 65536)
    $acl = Get-Acl -LiteralPath $Path
    Assert-RegistrationCondition ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -eq $OperatorSid)
    Assert-RegistrationCondition $acl.AreAccessRulesProtected
    foreach ($rule in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow) {
            Assert-RegistrationCondition ($rule.IdentityReference.Value -in @($OperatorSid, 'S-1-5-18', 'S-1-5-32-544'))
        }
    }
}

function Get-RegistrationPin {
    param([object]$Pin)
    Assert-RegistrationCondition ($Pin -is [System.Collections.IDictionary] -and
        $Pin.Count -eq 2 -and $Pin.Contains('path') -and $Pin.Contains('sha256'))
    $filePath = Get-AbsoluteRegistrationPath $Pin.path
    Assert-NoRegistrationReparsePoint $filePath
    $item = Get-Item -LiteralPath $filePath -Force
    Assert-RegistrationCondition (-not $item.PSIsContainer -and
        $Pin.sha256 -is [string] -and $Pin.sha256 -cmatch '^[0-9a-f]{64}$')
    $actualHash = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-RegistrationCondition ($actualHash -ceq $Pin.sha256)
    return $filePath
}

function Get-RegistrationContext {
    param([string]$Path, [string]$OperatorSid)
    Assert-PrivateRegistrationConfiguration $Path $OperatorSid
    $encoding = [System.Text.UTF8Encoding]::new($false, $true)
    $json = [System.IO.File]::ReadAllText($Path, $encoding)
    $configuration = ConvertFrom-Json -InputObject $json -AsHashtable -Depth 16
    Assert-RegistrationCondition ($configuration -is [System.Collections.IDictionary] -and
        $configuration.operatorSid -ceq $OperatorSid -and $configuration.taskName -ceq 'KevinMelBackupCapture')
    # The runner owns the complete strict schema/duplicate-key/private-path
    # validation. Only launch enough configuration here to reach that check.
    $runtimePath = Get-RegistrationPin $configuration.runtime
    $runnerPath = Get-RegistrationPin $configuration.runner
    Assert-RegistrationCondition ([System.IO.Path]::GetFileName($runtimePath) -ieq 'pwsh.exe')
    Assert-RegistrationCondition ([System.IO.Path]::GetExtension($runnerPath) -ieq '.ps1')
    $repositoryPath = Get-AbsoluteRegistrationPath $configuration.repositoryDirectory
    return @{
        ConfigurationHash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
        RuntimePath = $runtimePath
        RunnerPath = $runnerPath
        RepositoryPath = $repositoryPath
        TimeoutSeconds = $configuration.timeoutSeconds
    }
}

function Invoke-PinnedRegistrationValidation {
    param([hashtable]$Context, [string]$Path)
    if (-not ('KevinMelBackupRegistration.BoundedOutput' -as [type])) {
        Add-Type -TypeDefinition @'
namespace KevinMelBackupRegistration {
    public sealed class BoundedOutput : System.IO.Stream {
        private readonly byte[] bytes = new byte[256];
        private int size;
        private bool overflow;
        public override bool CanRead { get { return false; } }
        public override bool CanSeek { get { return false; } }
        public override bool CanWrite { get { return true; } }
        public override long Length { get { return size; } }
        public override long Position { get { return size; } set { throw new System.NotSupportedException(); } }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count) { throw new System.NotSupportedException(); }
        public override long Seek(long offset, System.IO.SeekOrigin origin) { throw new System.NotSupportedException(); }
        public override void SetLength(long value) { throw new System.NotSupportedException(); }
        public override void Write(byte[] buffer, int offset, int count) {
            int keep = System.Math.Min(count, bytes.Length - size);
            if (keep > 0) { System.Array.Copy(buffer, offset, bytes, size, keep); size += keep; }
            if (keep != count) { overflow = true; }
        }
        public string Text() {
            if (overflow) { throw new System.InvalidOperationException(); }
            return new System.Text.UTF8Encoding(false, true).GetString(bytes, 0, size);
        }
    }
}
'@
    }
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $Context.RuntimePath
    $startInfo.WorkingDirectory = $Context.RepositoryPath
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.RedirectStandardInput = $true
    $startInfo.Environment.Clear()
    foreach ($name in @('PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE',
        'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'HOMEDRIVE', 'HOMEPATH', 'COMSPEC', 'PATHEXT')) {
        $value = [System.Environment]::GetEnvironmentVariable($name)
        if ($null -ne $value) { $startInfo.Environment[$name] = $value }
    }
    foreach ($argument in @('-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
        '-File', $Context.RunnerPath, '-ConfigPath', $Path, '-ValidateOnly')) {
        $startInfo.ArgumentList.Add($argument)
    }
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    $capturedOutput = [KevinMelBackupRegistration.BoundedOutput]::new()
    $started = $false
    try {
        Assert-RegistrationCondition ($process.Start())
        $started = $true
        $process.StandardInput.Close()
        $stdout = $process.StandardOutput.BaseStream.CopyToAsync($capturedOutput)
        $stderr = $process.StandardError.BaseStream.CopyToAsync([System.IO.Stream]::Null)
        if (-not $process.WaitForExit(30000)) {
            $process.Kill($true)
            [void]$process.WaitForExit(5000)
            throw 'BACKUP_JOB_TASK_REFUSED'
        }
        Assert-RegistrationCondition ([System.Threading.Tasks.Task]::WhenAll([System.Threading.Tasks.Task[]]@($stdout, $stderr)).Wait(5000))
        $outputText = $capturedOutput.Text()
        Assert-RegistrationCondition ($process.ExitCode -eq 0 -and
            $outputText.Trim() -ceq 'BACKUP_JOB_CONFIGURATION_VALID')
    }
    finally {
        if ($started -and -not $process.HasExited) {
            $process.Kill($true)
            [void]$process.WaitForExit(5000)
        }
        $capturedOutput.Dispose()
        $process.Dispose()
    }
}

try {
    Assert-RegistrationCondition ($PSVersionTable.PSVersion.Major -ge 7 -and $IsWindows)
    $operatorSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $configurationPath = Get-AbsoluteRegistrationPath $ConfigPath
    $context = Get-RegistrationContext $configurationPath $operatorSid
    Invoke-PinnedRegistrationValidation $context $configurationPath
    # Refuse a configuration/runtime/runner change between inspection and task
    # creation. The runner validates its complete pins again on every run.
    $confirmed = Get-RegistrationContext $configurationPath $operatorSid
    Assert-RegistrationCondition ($confirmed.ConfigurationHash -ceq $context.ConfigurationHash -and
        $confirmed.RuntimePath -ceq $context.RuntimePath -and $confirmed.RunnerPath -ceq $context.RunnerPath)

    if ($ValidateOnly) {
        [Console]::Out.WriteLine('BACKUP_JOB_CONFIGURATION_VALID')
        exit 0
    }

    $existing = Get-ScheduledTask -TaskPath '\' -TaskName 'KevinMelBackupCapture' -ErrorAction SilentlyContinue
    Assert-RegistrationCondition ($null -eq $existing)
    $arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -File "' +
        $context.RunnerPath + '" -ConfigPath "' + $configurationPath + '"'
    $action = New-ScheduledTaskAction -Execute $context.RuntimePath -Argument $arguments -WorkingDirectory $context.RepositoryPath
    $trigger = New-ScheduledTaskTrigger -Once -At ([DateTime]::Now.AddMinutes(1)) -RepetitionInterval ([TimeSpan]::FromMinutes(2))
    $principal = New-ScheduledTaskPrincipal -UserId $operatorSid -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -WakeToRun -Hidden `
        -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit ([TimeSpan]::FromSeconds([int]$context.TimeoutSeconds + 480))
    $definition = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
        -Description 'Kevin and Melanie private backup capture; validated configuration required.'
    Register-ScheduledTask -TaskPath '\' -TaskName 'KevinMelBackupCapture' -InputObject $definition | Out-Null
    [Console]::Out.WriteLine('BACKUP_JOB_TASK_REGISTERED')
    exit 0
}
catch {
    [Console]::Error.WriteLine('BACKUP_JOB_TASK_REFUSED')
    exit 1
}
