param(
  [string]$TargetPath = 'C:\Users\willi\Projects',
  [string]$User = "$env:USERDOMAIN\$env:USERNAME"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-IsAdmin {
  $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
}

if (-not (Test-IsAdmin)) {
  $argList = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', ('"' + $PSCommandPath + '"'),
    '-TargetPath', ('"' + $TargetPath + '"'),
    '-User', ('"' + $User + '"')
  ) -join ' '

  Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argList | Out-Null
  Write-Host 'Elevation requested (UAC). Approve the prompt to continue.' -ForegroundColor Yellow
  exit 0
}

if (-not (Test-Path $TargetPath)) {
  throw "Target path does not exist: $TargetPath"
}

Write-Host "Granting Full Control to '$User' on '$TargetPath' (recursive)..." -ForegroundColor Cyan

# (OI)(CI)F = object/container inherit + full control
& icacls $TargetPath /grant "${User}:(OI)(CI)F" /T /C | Out-Host

Write-Host 'Permissions updated successfully.' -ForegroundColor Green