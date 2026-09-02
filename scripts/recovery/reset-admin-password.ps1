<#
.SYNOPSIS
    Resets a locked-out WhiteVanOps admin password on a customer's machine.

.DESCRIPTION
    Use when NOBODY can log in to the dashboard. If any other admin or
    superuser account still works, use Manage Users inside the app instead —
    that's a two-click fix and doesn't need this.

    A customer's PC has no Node.js and no copy of the repo, so this borrows the
    Node runtime inside the installed Electron binary (ELECTRON_RUN_AS_NODE=1)
    to run reset-admin-password.js against the app's own bundled PostgreSQL.
    Nothing has to be installed on the machine.

    The bundled database only runs while WhiteVanOps is open. Start the app and
    leave it sitting at the login screen before running this.

    Copy BOTH files in this folder (the .ps1 and the .js) to the machine — a
    USB stick is fine. They can live anywhere; they do not need to be inside
    the install directory.

.PARAMETER InstallDir
    The WhiteVanOps install folder. Auto-detected in the usual locations; pass
    it explicitly if the customer installed somewhere unusual.

.PARAMETER Username
    Account to reset. Defaults to 'admin'.

.PARAMETER List
    Show which admin/superuser accounts exist, and change nothing. Start here
    if you're unsure what the owner's account is called.

.PARAMETER Create
    Recreate the account as a superuser if it no longer exists.

.EXAMPLE
    .\reset-admin-password.ps1 -List

.EXAMPLE
    .\reset-admin-password.ps1

.EXAMPLE
    .\reset-admin-password.ps1 -InstallDir "D:\Apps\WhiteVanOps" -Username owner

.NOTES
    If PowerShell refuses to run this ("running scripts is disabled"), use:
      powershell -ExecutionPolicy Bypass -File .\reset-admin-password.ps1
#>
[CmdletBinding()]
param(
    [string]$InstallDir,
    [string]$Username = "admin",
    [switch]$List,
    [switch]$Create
)

$ErrorActionPreference = "Stop"

$scriptJs = Join-Path $PSScriptRoot "reset-admin-password.js"
if (-not (Test-Path $scriptJs)) {
    Write-Host ""
    Write-Host "ERROR: reset-admin-password.js is not next to this script." -ForegroundColor Red
    Write-Host "       Copy BOTH files from scripts\recovery\ to this machine." -ForegroundColor Red
    Write-Host ""
    exit 1
}

# --- Find the installed app -------------------------------------------------
function Find-WvoExe {
    param([string]$Dir)

    $candidates = @()
    if ($Dir) {
        $candidates += (Join-Path $Dir "WhiteVanOps.exe")
    }
    $candidates += @(
        (Join-Path $env:LOCALAPPDATA "Programs\WhiteVanOps\WhiteVanOps.exe"),
        (Join-Path ${env:ProgramFiles} "WhiteVanOps\WhiteVanOps.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "WhiteVanOps\WhiteVanOps.exe")
    )

    foreach ($c in $candidates) {
        if ($c -and (Test-Path $c)) { return $c }
    }
    return $null
}

$exe = Find-WvoExe -Dir $InstallDir
if (-not $exe) {
    Write-Host ""
    Write-Host "ERROR: Could not find WhiteVanOps.exe." -ForegroundColor Red
    Write-Host "       Looked in the standard install locations." -ForegroundColor Red
    Write-Host "       Find the folder containing WhiteVanOps.exe and pass it:" -ForegroundColor Red
    Write-Host '         .\reset-admin-password.ps1 -InstallDir "C:\Path\To\WhiteVanOps"' -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

$resolvedInstallDir = Split-Path -Parent $exe
Write-Host ""
Write-Host "Found WhiteVanOps at: $resolvedInstallDir" -ForegroundColor Cyan

# --- Build args for the Node script -----------------------------------------
$jsArgs = @($scriptJs, "--install-dir", $resolvedInstallDir, "--username", $Username)
if ($List)   { $jsArgs += "--list" }
if ($Create) { $jsArgs += "--create" }

# --- Run it as plain Node inside the Electron binary -------------------------
# Electron's main process IS Node; ELECTRON_RUN_AS_NODE makes the packaged exe
# behave as a bare Node interpreter. This is what lets a machine with no Node
# installed run this at all.
#
# Start-Process -Wait, not the call operator. WhiteVanOps.exe is a Windows-
# subsystem (GUI) binary, so `& $exe` does not block and never populates
# $LASTEXITCODE: $code came back $null, `$null -ne 0` is true, and the script
# printed "Password reset did not complete" on every run — including runs that
# had in fact just reset the password. The child's output also raced the
# parent's, so the account listing frequently never appeared at all.
# -NoNewWindow keeps that output in this console; -PassThru gives a real exit code.
$env:ELECTRON_RUN_AS_NODE = "1"
try {
    $quoted = $jsArgs | ForEach-Object { '"' + $_ + '"' }
    $proc = Start-Process -FilePath $exe -ArgumentList $quoted -NoNewWindow -Wait -PassThru
    $code = $proc.ExitCode
} finally {
    Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
}

if ($code -ne 0) {
    Write-Host "Password reset did not complete. See the error above." -ForegroundColor Red
    Write-Host "Most common cause: WhiteVanOps isn't running, so its database is stopped." -ForegroundColor Yellow
    Write-Host "Start the app, leave it at the login screen, and try again." -ForegroundColor Yellow
    Write-Host ""
}
exit $code
