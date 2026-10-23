# Windows identity/definition regression only. Never registers or starts a task.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'REGISTRATION_TEST_REQUIRES_WINDOWS' }
$tokens = $null
$errors = $null
$source = [Management.Automation.Language.Parser]::ParseFile(
    (Join-Path $PSScriptRoot 'register-backup-job.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'REGISTRATION_TEST_PARSE_FAILED' }
foreach ($name in @('Assert-RegistrationCondition', 'Get-RegistrationAccountName')) {
    $matches = @($source.FindAll({param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
    }, $true))
    if ($matches.Count -ne 1) { throw 'REGISTRATION_TEST_FUNCTION_MISSING' }
    . ([scriptblock]::Create($matches[0].Extent.Text))
}
$operatorSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$accountName = Get-RegistrationAccountName $operatorSid
$expected = ([Security.Principal.SecurityIdentifier]::new($operatorSid)).Translate([Security.Principal.NTAccount])
if ($accountName -cne $expected.Value -or
    ([Security.Principal.NTAccount]::new($accountName)).Translate([Security.Principal.SecurityIdentifier]).Value -cne $operatorSid) {
    throw 'REGISTRATION_TEST_ACCOUNT_ROUND_TRIP_FAILED'
}
[Console]::Out.WriteLine('PASS account name resolves to the exact current operator SID')
foreach ($other in @('', 'not-a-sid', 'S-1-0-0')) {
    $refused = $false
    try { [void](Get-RegistrationAccountName $other) } catch { $refused = $true }
    if (-not $refused) { throw 'REGISTRATION_TEST_OTHER_IDENTITY_ACCEPTED' }
}
[Console]::Out.WriteLine('PASS missing malformed and different identities refuse')
$commands = @($source.FindAll({param($node)
    $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -ceq 'New-ScheduledTaskPrincipal'
}, $true))
if ($commands.Count -ne 1) { throw 'REGISTRATION_TEST_PRINCIPAL_MISSING' }
# Evaluate only the actual in-memory principal command, never the registrar body.
$principal = & ([scriptblock]::Create($commands[0].Extent.Text))
if ($principal.UserId -cne $accountName -or $principal.LogonType -ne 3 -or $principal.RunLevel -ne 0) {
    throw 'REGISTRATION_TEST_PRINCIPAL_AUTHORITY_CHANGED'
}
[Console]::Out.WriteLine('PASS actual task principal uses the resolved account with Interactive Limited authority')
[Console]::Out.WriteLine('BACKUP_REGISTRATION_TESTS_PASSED:3')
