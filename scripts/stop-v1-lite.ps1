$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$runtimeDir = Join-Path $root ".scratch\runtime"
$pidFile = Join-Path $runtimeDir "v1-lite-pids.json"

if (-not (Test-Path $pidFile)) {
  Write-Host "No V1.0 Lite PID file found: $pidFile"
  exit 0
}

$processes = Get-Content -Encoding utf8 $pidFile | ConvertFrom-Json

function Stop-ProcessTree {
  param(
    [int]$ProcessId
  )

  $childProcesses = Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcessId" -ErrorAction SilentlyContinue
  foreach ($child in $childProcesses) {
    Stop-ProcessTree -ProcessId $child.ProcessId
  }

  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($null -ne $process) {
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
  }
}

foreach ($entry in $processes) {
  $process = Get-Process -Id $entry.pid -ErrorAction SilentlyContinue
  if ($null -eq $process) {
    Write-Host "$($entry.name) already stopped."
    continue
  }
  Write-Host "Stopping $($entry.name) pid=$($entry.pid)"
  Stop-ProcessTree -ProcessId $entry.pid
}

Remove-Item -LiteralPath $pidFile -Force
Write-Host "ARC.ONE V1.0 Lite stopped."
