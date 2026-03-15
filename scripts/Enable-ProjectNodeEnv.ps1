param(
  [switch]$PersistUserPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$nodeDir = 'C:\Program Files\nodejs'
$nodeExe = Join-Path $nodeDir 'node.exe'
$npmCmd = Join-Path $nodeDir 'npm.cmd'

if (-not (Test-Path $nodeExe) -or -not (Test-Path $npmCmd)) {
  throw "Node.js not found at '$nodeDir'. Install Node.js from https://nodejs.org/en"
}

# Session-only fix (immediate)
$env:Path = "$nodeDir;$env:Path"
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force | Out-Null

if ($PersistUserPath) {
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ([string]::IsNullOrWhiteSpace($userPath)) {
    $newPath = $nodeDir
  }
  elseif ($userPath.Split(';') -contains $nodeDir) {
    $newPath = $userPath
  }
  else {
    $newPath = "$userPath;$nodeDir"
  }

  [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
  Write-Host 'User PATH updated. Reopen terminal/VS Code to apply globally.' -ForegroundColor Yellow
}

Write-Host "node: $(node --version)" -ForegroundColor Green
Write-Host "npm:  $(npm.cmd --version)" -ForegroundColor Green
Write-Host 'This shell is now ready for npm/node commands.' -ForegroundColor Green