param(
  [int]$ApiPort = 8000,
  [int]$WebPort = 4173,
  [string]$WorkerId = "v1-lite-worker"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$runtimeDir = Join-Path $root ".scratch\runtime"
$pidFile = Join-Path $runtimeDir "v1-lite-pids.json"
$apiPython = Join-Path $root "apps\api\.venv\Scripts\python.exe"
$npmCommand = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
if ($null -eq $npmCommand) {
  $npmCommand = Get-Command "npm" -ErrorAction SilentlyContinue
}

if (-not (Test-Path $runtimeDir)) {
  New-Item -ItemType Directory -Force $runtimeDir | Out-Null
}

if (-not (Test-Path $apiPython)) {
  throw "API Python runtime not found: $apiPython. Run the setup commands in README.md first."
}

if ($null -eq $npmCommand) {
  throw "npm runtime not found. Install Node.js and run npm install first."
}

function Start-ArcProcess {
  param(
    [string]$Name,
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory
  )

  $stdoutLogPath = Join-Path $runtimeDir "$Name.out.log"
  $stderrLogPath = Join-Path $runtimeDir "$Name.err.log"
  $process = Start-Process `
    -FilePath $FilePath `
    -ArgumentList $Arguments `
    -WorkingDirectory $WorkingDirectory `
    -RedirectStandardOutput $stdoutLogPath `
    -RedirectStandardError $stderrLogPath `
    -PassThru `
    -WindowStyle Hidden

  [PSCustomObject]@{
    name = $Name
    pid = $process.Id
    stdoutLog = $stdoutLogPath
    stderrLog = $stderrLogPath
  }
}

function Stop-StartedProcesses {
  param(
    [object[]]$Entries
  )

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

  foreach ($entry in $Entries) {
    Stop-ProcessTree -ProcessId $entry.pid
  }
}

$processes = @()
try {
  $processes += Start-ArcProcess `
    -Name "api" `
    -FilePath $apiPython `
    -Arguments @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "$ApiPort") `
    -WorkingDirectory (Join-Path $root "apps\api")

  $processes += Start-ArcProcess `
    -Name "web" `
    -FilePath $npmCommand.Source `
    -Arguments @("run", "dev", "--", "--host", "127.0.0.1", "--port", "$WebPort", "--strictPort") `
    -WorkingDirectory $root

  $processes += Start-ArcProcess `
    -Name "execution-worker" `
    -FilePath $apiPython `
    -Arguments @("-m", "app.worker", "--worker-id", $WorkerId, "--poll-interval", "2") `
    -WorkingDirectory (Join-Path $root "apps\api")

  $processes += Start-ArcProcess `
    -Name "notification-worker" `
    -FilePath $apiPython `
    -Arguments @("-m", "app.notification_worker", "--poll-interval", "2") `
    -WorkingDirectory (Join-Path $root "apps\api")

  $processes | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 $pidFile
} catch {
  Stop-StartedProcesses -Entries $processes
  throw
}

Write-Host "ARC.ONE V1.0 Lite started."
Write-Host "Web: http://127.0.0.1:$WebPort"
Write-Host "API: http://127.0.0.1:$ApiPort/docs"
Write-Host "PID file: $pidFile"
Write-Host "Logs: $runtimeDir"
