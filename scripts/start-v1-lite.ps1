param(
  [int]$ApiPort = 8000,
  [int]$WebPort = 4173,
  [string]$WorkerId = "v1-lite-worker",
  [string]$NotificationWorkerId = "v1-lite-notification-worker"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$runtimeDir = Join-Path $root ".scratch\runtime"
$pidFile = Join-Path $runtimeDir "v1-lite-pids.json"
$apiPython = Join-Path $root "apps\api\.venv\Scripts\python.exe"

if (-not (Test-Path $runtimeDir)) {
  New-Item -ItemType Directory -Force $runtimeDir | Out-Null
}

if (-not (Test-Path $apiPython)) {
  throw "API Python runtime not found: $apiPython. Run the setup commands in README.md first."
}

function Start-ArcProcess {
  param(
    [string]$Name,
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory
  )

  $logPath = Join-Path $runtimeDir "$Name.log"
  $process = Start-Process `
    -FilePath $FilePath `
    -ArgumentList $Arguments `
    -WorkingDirectory $WorkingDirectory `
    -RedirectStandardOutput $logPath `
    -RedirectStandardError $logPath `
    -PassThru `
    -WindowStyle Hidden

  [PSCustomObject]@{
    name = $Name
    pid = $process.Id
    log = $logPath
  }
}

$processes = @()
$processes += Start-ArcProcess `
  -Name "api" `
  -FilePath $apiPython `
  -Arguments @("-m", "uvicorn", "app.main:app", "--reload", "--host", "127.0.0.1", "--port", "$ApiPort") `
  -WorkingDirectory (Join-Path $root "apps\api")

$processes += Start-ArcProcess `
  -Name "web" `
  -FilePath "npm" `
  -Arguments @("run", "dev", "--", "--host", "127.0.0.1", "--port", "$WebPort") `
  -WorkingDirectory $root

$processes += Start-ArcProcess `
  -Name "execution-worker" `
  -FilePath $apiPython `
  -Arguments @("-m", "app.worker", "--worker-id", $WorkerId, "--poll-interval", "2") `
  -WorkingDirectory (Join-Path $root "apps\api")

$processes += Start-ArcProcess `
  -Name "notification-worker" `
  -FilePath $apiPython `
  -Arguments @("-m", "app.notification_worker", "--worker-id", $NotificationWorkerId, "--poll-interval", "2") `
  -WorkingDirectory (Join-Path $root "apps\api")

$processes | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 $pidFile

Write-Host "ARC.ONE V1.0 Lite started."
Write-Host "Web: http://127.0.0.1:$WebPort"
Write-Host "API: http://127.0.0.1:$ApiPort/docs"
Write-Host "PID file: $pidFile"
Write-Host "Logs: $runtimeDir"
