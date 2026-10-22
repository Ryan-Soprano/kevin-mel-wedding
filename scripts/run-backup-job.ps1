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

function Initialize-BackupChildRuntime {
    if ('KevinMelBackup.ContainedChild' -as [type]) { return }
    # Keep this implementation inside the pinned runner. Windows assigns the
    # job during CreateProcess, before the suspended child can execute. Only a
    # NUL handle is inherited: output is discarded without pipes or buffers,
    # and neither the capture lock nor the kill-on-close job can escape.
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace KevinMelBackup {
    public sealed class ChildResult {
        public int ExitCode { get; internal set; }
        public string Failure { get; internal set; }
        public bool CleanupConfirmed { get; internal set; }
    }

    public static class ContainedChild {
        const uint KillOnClose = 0x2000;
        const uint Suspended = 0x4, NoWindow = 0x08000000, UnicodeEnvironment = 0x400, ExtendedStartup = 0x80000;
        const uint WaitObject = 0, WaitTimeout = 258, InvalidResult = 0xffffffff;
        static readonly IntPtr InvalidHandle = new IntPtr(-1);

        [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes {
            public uint Length; public IntPtr Descriptor; public int Inherit;
        }
        [StructLayout(LayoutKind.Sequential)] struct StartupInfo {
            public uint Size; public IntPtr Reserved, Desktop, Title;
            public uint X, Y, XSize, YSize, XChars, YChars, Fill, Flags;
            public ushort Show, ReservedSize; public IntPtr ReservedBytes, Input, Output, Error;
        }
        [StructLayout(LayoutKind.Sequential)] struct StartupInfoEx {
            public StartupInfo Startup; public IntPtr Attributes;
        }
        [StructLayout(LayoutKind.Sequential)] struct ProcessInformation {
            public IntPtr Process, Thread; public uint ProcessId, ThreadId;
        }
        [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
            public long ProcessTime, JobTime; public uint Flags;
            public UIntPtr MinimumWorkingSet, MaximumWorkingSet;
            public uint ActiveProcessLimit; public UIntPtr Affinity; public uint Priority, Scheduling;
        }
        [StructLayout(LayoutKind.Sequential)] struct IoCounters {
            public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes;
        }
        [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
            public BasicLimits Basic; public IoCounters Io;
            public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
        }
        [StructLayout(LayoutKind.Sequential)] struct Accounting {
            public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime;
            public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
        }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits limits, uint length);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool QueryInformationJobObject(IntPtr job, int kind, out Accounting accounting, uint length, IntPtr returned);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool TerminateJobObject(IntPtr job, uint exitCode);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool InitializeProcThreadAttributeList(IntPtr attributes, int count, uint flags, ref IntPtr size);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool UpdateProcThreadAttribute(IntPtr attributes, uint flags, IntPtr attribute, IntPtr value,
            IntPtr size, IntPtr previous, IntPtr returned);
        [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr attributes);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern IntPtr CreateFileW(string name, uint access, uint sharing, ref SecurityAttributes attributes,
            uint creation, uint flags, IntPtr template);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool CreateProcessW(string application, StringBuilder commandLine, IntPtr processAttributes,
            IntPtr threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint flags,
            IntPtr environment, string directory, ref StartupInfoEx startup, out ProcessInformation process);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool IsProcessInJob(IntPtr process, IntPtr job, [MarshalAs(UnmanagedType.Bool)] out bool member);
        [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
        [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool CloseHandle(IntPtr handle);

        // Windows argv quoting, including embedded quotes and trailing slashes.
        // No shell is involved; the separately supplied application is exact.
        static string Quote(string value) {
            if (value == null || value.IndexOf('\0') >= 0) throw new InvalidOperationException();
            var result = new StringBuilder("\"");
            int slashes = 0;
            foreach (char character in value) {
                if (character == '\\') { slashes++; continue; }
                result.Append('\\', character == '"' ? slashes * 2 + 1 : slashes);
                result.Append(character); slashes = 0;
            }
            return result.Append('\\', slashes * 2).Append('"').ToString();
        }
        static bool ActiveProcesses(IntPtr job, out uint active) {
            Accounting accounting;
            bool valid = QueryInformationJobObject(job, 1, out accounting, (uint)Marshal.SizeOf<Accounting>(), IntPtr.Zero);
            active = accounting.ActiveProcesses;
            return valid;
        }
        static bool WaitForEmptyJob(IntPtr job, int milliseconds) {
            var deadline = Stopwatch.StartNew();
            do {
                uint active;
                if (!ActiveProcesses(job, out active)) return false;
                if (active == 0) return true;
                Thread.Sleep(10);
            } while (deadline.ElapsedMilliseconds < milliseconds);
            return false;
        }
        public static ChildResult Run(string executable, string[] arguments,
                IDictionary<string, string> environment, int timeoutSeconds) {
            var result = new ChildResult { Failure = "runtime_unavailable", CleanupConfirmed = true };
            IntPtr job = IntPtr.Zero, nul = InvalidHandle, attributes = IntPtr.Zero;
            IntPtr jobList = IntPtr.Zero, handleList = IntPtr.Zero, environmentBlock = IntPtr.Zero;
            bool initialized = false, created = false;
            var process = new ProcessInformation();
            try {
                if (timeoutSeconds < 1 || timeoutSeconds > 240 || !System.IO.Path.IsPathFullyQualified(executable))
                    return result;
                var command = new StringBuilder(Quote(executable));
                foreach (string argument in arguments) command.Append(' ').Append(Quote(argument));
                if (command.Length >= 32767) return result;
                var entries = environment.OrderBy(pair => pair.Key, StringComparer.OrdinalIgnoreCase)
                    .Select(pair => pair.Key + "=" + pair.Value);
                environmentBlock = Marshal.StringToHGlobalUni(string.Join("\0", entries) + "\0\0");
                job = CreateJobObjectW(IntPtr.Zero, null);
                if (job == IntPtr.Zero) return result;
                var limits = new ExtendedLimits();
                limits.Basic.Flags = KillOnClose; // Neither normal nor silent breakaway is permitted.
                if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf<ExtendedLimits>())) return result;
                var security = new SecurityAttributes { Length = (uint)Marshal.SizeOf<SecurityAttributes>(), Inherit = 1 };
                nul = CreateFileW("NUL", 0xc0000000, 3, ref security, 3, 0x80, IntPtr.Zero);
                if (nul == InvalidHandle) return result;
                IntPtr size = IntPtr.Zero;
                InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size);
                if (size == IntPtr.Zero) return result;
                attributes = Marshal.AllocHGlobal(size);
                if (!InitializeProcThreadAttributeList(attributes, 2, 0, ref size)) return result;
                initialized = true;
                jobList = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobList, job);
                handleList = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(handleList, nul);
                // PROC_THREAD_ATTRIBUTE_JOB_LIST assigns containment atomically
                // at creation, including if the coordinator dies before resume.
                if (!UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x2000d), jobList, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero)
                    || !UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x20002), handleList, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero))
                    return result;
                var startup = new StartupInfoEx();
                startup.Startup.Size = (uint)Marshal.SizeOf<StartupInfoEx>();
                startup.Startup.Flags = 0x101; // STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW; SW_HIDE = 0.
                startup.Startup.Input = startup.Startup.Output = startup.Startup.Error = nul;
                startup.Attributes = attributes;
                if (!CreateProcessW(executable, command, IntPtr.Zero, IntPtr.Zero, true,
                    Suspended | NoWindow | UnicodeEnvironment | ExtendedStartup, environmentBlock,
                    null, ref startup, out process)) return result;
                created = true;
                bool member;
                if (!IsProcessInJob(process.Process, job, out member) || !member) return result;
                if (ResumeThread(process.Thread) == InvalidResult) return result;
                result.Failure = "capture_failed";
                uint wait = WaitForSingleObject(process.Process, checked((uint)timeoutSeconds * 1000));
                if (wait == WaitTimeout || wait != WaitObject) return result;
                uint exitCode;
                // An exited leader with surviving descendants is a failed run,
                // even if those descendants closed every output handle. Allow
                // the kernel's asynchronous exit accounting to settle first.
                if (!WaitForEmptyJob(job, 250) || !GetExitCodeProcess(process.Process, out exitCode)) return result;
                result.ExitCode = unchecked((int)exitCode);
                result.Failure = null;
                return result;
            } catch {
                return result; // Never expose native diagnostics, arguments, paths or child output.
            } finally {
                if (job != IntPtr.Zero) {
                    uint active;
                    bool empty = ActiveProcesses(job, out active) && active == 0;
                    if (!empty) {
                        result.Failure = "capture_failed";
                        result.CleanupConfirmed = TerminateJobObject(job, 1) && WaitForEmptyJob(job, 5000);
                    }
                    CloseHandle(job); // Last, noninherited handle; kill-on-close remains a backstop.
                } else if (created) {
                    result.Failure = "capture_failed";
                    result.CleanupConfirmed = false;
                }
                if (process.Thread != IntPtr.Zero) CloseHandle(process.Thread);
                if (process.Process != IntPtr.Zero) CloseHandle(process.Process);
                if (nul != InvalidHandle) CloseHandle(nul);
                if (initialized) DeleteProcThreadAttributeList(attributes);
                foreach (IntPtr allocation in new[] { attributes, jobList, handleList, environmentBlock })
                    if (allocation != IntPtr.Zero) Marshal.FreeHGlobal(allocation);
            }
        }
    }
}
'@
}

function Invoke-BackupChild([string]$Executable, [string[]]$Arguments, [int]$TimeoutSeconds) {
    if ($script:CleanupUnconfirmed) { Stop-BackupJob 'capture_failed' }
    Initialize-BackupChildRuntime
    $info = [System.Diagnostics.ProcessStartInfo]::new()
    $info.Environment.Clear()
    foreach ($name in @('PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
        'ProgramData', 'HOMEDRIVE', 'HOMEPATH', 'HOME', 'COMSPEC', 'PATHEXT')) {
        $value = [System.Environment]::GetEnvironmentVariable($name)
        if ($null -ne $value) { $info.Environment[$name] = $value }
    }
    $info.Environment['GIT_TERMINAL_PROMPT'] = '0'
    $info.Environment['GCM_INTERACTIVE'] = 'Never'
    $result = [KevinMelBackup.ContainedChild]::Run($Executable, $Arguments, $info.Environment, $TimeoutSeconds)
    if (-not $result.CleanupConfirmed) {
        # The write-ahead marker already exists durably. Never replace or clear
        # it after uncertain cleanup: a later run must refuse this lock.
        $script:CleanupUnconfirmed = $true
    }
    if ($null -ne $result.Failure) { Stop-BackupJob $result.Failure }
    return $result.ExitCode
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
$script:CleanupUnconfirmed = $false
$inFlightMarked = $false
$failure = 'capture_failed'
try {
    $configuration = Read-BackupConfiguration
    if ($ValidateOnly) { Write-Output 'BACKUP_JOB_CONFIGURATION_VALID'; exit 0 }
    try {
        $captureLock = [System.IO.FileStream]::new($configuration.lockPath, [System.IO.FileMode]::OpenOrCreate,
            [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    } catch [System.IO.IOException] { Write-Output 'BACKUP_JOB_SKIPPED_BUSY'; exit 0 }
    if ($captureLock.Length -ne 0) {
        $script:CleanupUnconfirmed = $true
        Stop-BackupJob 'capture_failed'
    }
    # Persist uncertainty before launching any child, including publication.
    # A crash or failed flush leaves a marker and cannot silently admit a new
    # capture. Only this run's fully flushed marker may be cleared below.
    $marker = [System.Text.Encoding]::ASCII.GetBytes('BACKUP_JOB_INFLIGHT')
    $captureLock.Write($marker, 0, $marker.Length)
    $captureLock.Flush($true)
    $inFlightMarked = $true
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
    if ($null -ne $configuration -and -not $ValidateOnly -and $inFlightMarked -and -not $script:CleanupUnconfirmed) {
        try { Publish-Failure $configuration $failure } catch { }
    }
    [Console]::Error.WriteLine('BACKUP_JOB_FAILED:' + $failure)
    exit 1
} finally {
    if ($null -ne $captureLock) {
        $clearFailed = $false
        try {
            if ($inFlightMarked -and -not $script:CleanupUnconfirmed) {
                # Invoke-BackupChild confirms an empty job before it returns or
                # leaves CleanupUnconfirmed set. Preserve all other markers.
                $captureLock.SetLength(0)
                $captureLock.Flush($true)
            }
        } catch {
            $clearFailed = $true
            [Console]::Error.WriteLine('BACKUP_JOB_FAILED:capture_failed')
        } finally { $captureLock.Dispose() }
        if ($clearFailed) { exit 1 }
    }
}
