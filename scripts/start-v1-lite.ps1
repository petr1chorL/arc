param(
  [int]$ApiPort = 8000,
  [int]$WebPort = 4173,
  [string]$WorkerId = "v1-lite-worker",
  [string]$EnvFile = ""
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$runtimeDir = Join-Path $root ".scratch\runtime"
$pidFile = Join-Path $runtimeDir "v1-lite-pids.json"
$apiRuntimePython = Join-Path $root "apps\api\.venv-runtime\Scripts\python.exe"
$apiPython = Join-Path $root "apps\api\.venv\Scripts\python.exe"
if (Test-Path $apiRuntimePython) {
  $apiPython = $apiRuntimePython
}
$webRunner = Join-Path $PSScriptRoot "run-web-only.ps1"
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

if (-not (Test-Path $webRunner)) {
  throw "Web runner not found: $webRunner."
}

function Import-ProcessEnvFile {
  param(
    [string]$Path
  )

  if (-not $Path.Trim()) {
    return [PSCustomObject]@{
      keys = @()
      previous = @{}
    }
  }

  $resolvedPath = (Resolve-Path $Path).Path
  $previous = @{}
  $keys = @()
  foreach ($rawLine in [System.IO.File]::ReadLines($resolvedPath)) {
    $line = $rawLine.Trim()
    if (-not $line -or $line.StartsWith("#")) {
      continue
    }
    if ($line.StartsWith("export ")) {
      $line = $line.Substring(7).Trim()
    }
    $separator = $line.IndexOf("=")
    if ($separator -le 0) {
      continue
    }
    $key = $line.Substring(0, $separator).Trim()
    if ($key -notmatch "^[A-Za-z_][A-Za-z0-9_]*$") {
      continue
    }
    $value = $line.Substring($separator + 1).Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    if (-not $previous.ContainsKey($key)) {
      $previous[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
      $keys += $key
    }
    [Environment]::SetEnvironmentVariable($key, $value, "Process")
  }

  [PSCustomObject]@{
    keys = $keys
    previous = $previous
  }
}

function Restore-ProcessEnvironment {
  param(
    [object]$Snapshot
  )

  foreach ($key in $Snapshot.keys) {
    [Environment]::SetEnvironmentVariable($key, $Snapshot.previous[$key], "Process")
  }
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

function Start-ArcProcess {
  param(
    [string]$Name,
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory
  )

  $stdoutLogPath = Join-Path $runtimeDir "$Name.out.log"
  $stderrLogPath = Join-Path $runtimeDir "$Name.err.log"
  Normalize-ProcessPathEnvironment
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
$envSnapshot = Import-ProcessEnvFile -Path $EnvFile
try {
  $previousAllowedOrigins = $env:ALLOWED_ORIGINS
  $allowedOrigins = @(
    "http://127.0.0.1:$WebPort",
    "http://localhost:$WebPort",
    "http://127.0.0.1:4173",
    "http://localhost:4173"
  )
  $env:ALLOWED_ORIGINS = ConvertTo-Json $allowedOrigins -Compress
  try {
    $processes += Start-ArcProcess `
      -Name "api" `
      -FilePath $apiPython `
      -Arguments @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "$ApiPort") `
      -WorkingDirectory (Join-Path $root "apps\api")
  } finally {
    if ($null -eq $previousAllowedOrigins) {
      Remove-Item Env:\ALLOWED_ORIGINS -ErrorAction SilentlyContinue
    } else {
      $env:ALLOWED_ORIGINS = $previousAllowedOrigins
    }
  }

  $previousProxyTarget = $env:ARC_ONE_API_PROXY_TARGET
  $env:ARC_ONE_API_PROXY_TARGET = "http://127.0.0.1:$ApiPort"
  try {
    $processes += Start-ArcProcess `
      -Name "web" `
      -FilePath "powershell.exe" `
      -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $webRunner, "-WebPort", "$WebPort") `
      -WorkingDirectory $root
  } finally {
    if ($null -eq $previousProxyTarget) {
      Remove-Item Env:\ARC_ONE_API_PROXY_TARGET -ErrorAction SilentlyContinue
    } else {
      $env:ARC_ONE_API_PROXY_TARGET = $previousProxyTarget
    }
  }

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
} finally {
  Restore-ProcessEnvironment -Snapshot $envSnapshot
}

Write-Host "ARC.ONE V1.0 Lite started."
Write-Host "Web: http://127.0.0.1:$WebPort"
Write-Host "API: http://127.0.0.1:$ApiPort/docs"
Write-Host "PID file: $pidFile"
Write-Host "Logs: $runtimeDir"
