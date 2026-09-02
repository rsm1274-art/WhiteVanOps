<#
.SYNOPSIS
  Opens the Windows Firewall so field techs' phones can reach the field module.

.DESCRIPTION
  Base serves /field over the office LAN, so the office PC has to accept inbound
  connections on the app's port. Windows Firewall blocks inbound TCP by default
  unless a rule exists, and it does so by DROPPING the packet - so the phone
  shows a white screen that never finishes loading rather than an error. That
  reads to a customer as "the app is broken."

  The NSIS installer runs per-user and cannot create firewall rules (that needs
  admin), so this is a deliberate post-install step. See
  MANUAL_Setup_Installation.md section 7.

  The rule is scoped to the Private profile only: the office WiFi, never a public
  network the machine might join later. Run this in an ADMIN PowerShell.

.PARAMETER Port
  The port WhiteVanOps is serving on. Defaults to 3000. If port 3000 was already
  held at launch the app scans upward (3001, 3002...) - check the desktop
  window's address, or run:
    netstat -ano | findstr LISTENING | findstr :300

.PARAMETER Remove
  Delete the rule instead of creating it.

.EXAMPLE
  .\allow-field-access.ps1
.EXAMPLE
  .\allow-field-access.ps1 -Port 3001
.EXAMPLE
  .\allow-field-access.ps1 -Remove
#>
[CmdletBinding()]
param(
    [int]$Port = 3000,
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$RuleName = "WhiteVanOps Field Access (TCP $Port)"

$identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "This script must run as Administrator." -ForegroundColor Red
    Write-Host "Right-click PowerShell -> 'Run as administrator', then run it again."
    exit 1
}

if ($Remove) {
    try {
        Remove-NetFirewallRule -DisplayName $RuleName -ErrorAction Stop
        Write-Host "Removed firewall rule: $RuleName" -ForegroundColor Green
    } catch {
        Write-Host "No rule named '$RuleName' was found - nothing to remove." -ForegroundColor Yellow
    }
    exit 0
}

# Idempotent: drop any previous copy so re-running never stacks duplicates.
try { Remove-NetFirewallRule -DisplayName $RuleName -ErrorAction Stop } catch {}

New-NetFirewallRule `
    -DisplayName $RuleName `
    -Description 'Lets field technicians on the office WiFi reach the WhiteVanOps field module.' `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort $Port `
    -Profile Private `
    -Enabled True | Out-Null

Write-Host "Created firewall rule: $RuleName (inbound TCP $Port, Private profile)" -ForegroundColor Green

# A Private-profile rule does nothing on a network Windows has classified as
# Public - the most common reason this script "succeeds" and phones still cannot
# connect.
$public = Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq 'Public' }
if ($public) {
    Write-Host ""
    Write-Host "WARNING: these networks are classified 'Public', so the rule above does NOT apply to them:" -ForegroundColor Yellow
    $public | ForEach-Object { Write-Host "  - $($_.Name)" -ForegroundColor Yellow }
    Write-Host "If the office WiFi is listed, set it to Private:" -ForegroundColor Yellow
    Write-Host "  Settings > Network & Internet > WiFi > (your network) > Network profile type > Private"
    Write-Host "Or from this admin prompt:" -ForegroundColor Yellow
    Write-Host "  Set-NetConnectionProfile -Name '<network name>' -NetworkCategory Private"
}

Write-Host ""
Write-Host "Verify from another device on the same WiFi: http://<office-pc-ip>:$Port/field"
