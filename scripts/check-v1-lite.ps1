param(
  [int]$ApiPort = 8000,
  [int]$WebPort = 4173
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$runtimeDir = Join-Path $root ".scratch\runtime"
$pidFile = Join-Path $runtimeDir "v1-lite-pids.json"

function Test-HttpEndpoint {
  param(
    [string]$Name,
    [string]$Url
  )

  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5
    [PSCustomObject]@{
      name = $Name
      ok = $response.StatusCode -ge 200 -and $response.StatusCode -lt 400
      detail = "HTTP $($response.StatusCode)"
    }
  } catch {
    [PSCustomObject]@{
      name = $Name
      ok = $false
      detail = $_.Exception.Message
    }
  }
}

function Test-ManagedProcesses {
  if (-not (Test-Path $pidFile)) {
    return @([PSCustomObject]@{
      name = "managed-processes"
      ok = $false
      detail = "PID file not found: $pidFile"
    })
  }

  $entries = Get-Content -Encoding utf8 $pidFile | ConvertFrom-Json
  return @($entries | ForEach-Object {
    $process = Get-Process -Id $_.pid -ErrorAction SilentlyContinue
    [PSCustomObject]@{
      name = $_.name
      ok = $null -ne $process
      detail = if ($null -eq $process) { "pid $($_.pid) not running" } else { "pid $($_.pid) running" }
    }
  })
}

$checks = @()
$checks += Test-HttpEndpoint -Name "frontend" -Url "http://127.0.0.1:$WebPort"
$checks += Test-HttpEndpoint -Name "api-docs" -Url "http://127.0.0.1:$ApiPort/docs"
$checks += Test-ManagedProcesses

$checks | Format-Table -AutoSize

$failed = @($checks | Where-Object { -not $_.ok })
if ($failed.Count -gt 0) {
  Write-Error "V1.0 Lite self-check failed: $($failed.Count) check(s) failed."
  exit 1
}

Write-Host "V1.0 Lite self-check passed."
