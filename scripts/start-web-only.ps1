param(
  [int]$WebPort = 54173
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$runtimeDir = Join-Path $root ".scratch\runtime"
$pidFile = Join-Path $runtimeDir "web-only-pid.json"
$runner = Join-Path $PSScriptRoot "run-web-only.ps1"

if (-not (Test-Path $runtimeDir)) {
  New-Item -ItemType Directory -Force $runtimeDir | Out-Null
}

if (-not (Test-Path $runner)) {
  throw "Web runner not found: $runner."
}

function Normalize-ProcessPathEnvironment {
  $pathValue = [Environment]::GetEnvironmentVariable("Path", "Process")
  if ($null -eq $pathValue) {
    $pathValue = [Environment]::GetEnvironmentVariable("PATH", "Process")
  }

  [Environment]::SetEnvironmentVariable("PATH", $null, "Process")
  if ($null -ne $pathValue) {
    [Environment]::SetEnvironmentVariable("Path", $pathValue, "Process")
  }
}

Normalize-ProcessPathEnvironment

$stdoutLogPath = Join-Path $runtimeDir "web-only.out.log"
$stderrLogPath = Join-Path $runtimeDir "web-only.err.log"
$existingListener = Get-NetTCPConnection -LocalPort $WebPort -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -ne $existingListener) {
  throw "Port $WebPort is already in use by process $($existingListener.OwningProcess)."
}

$process = Start-Process `
  -FilePath "powershell.exe" `
  -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $runner, "-WebPort", "$WebPort") `
  -WorkingDirectory $root `
  -RedirectStandardOutput $stdoutLogPath `
  -RedirectStandardError $stderrLogPath `
  -PassThru `
  -WindowStyle Hidden

[PSCustomObject]@{
  name = "web-only"
  pid = $process.Id
  stdoutLog = $stdoutLogPath
  stderrLog = $stderrLogPath
} | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 $pidFile

Write-Host "ARC.ONE frontend started."
Write-Host "Web: http://127.0.0.1:$WebPort"
Write-Host "PID file: $pidFile"
Write-Host "Logs: $runtimeDir"
