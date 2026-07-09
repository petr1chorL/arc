param(
  [switch]$SkipFrontend
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$apiPython = Join-Path $root "apps\api\.venv\Scripts\python.exe"
$npmCommand = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
if ($null -eq $npmCommand) {
  $npmCommand = Get-Command "npm" -ErrorAction SilentlyContinue
}

if (-not (Test-Path $apiPython)) {
  throw "API Python runtime not found: $apiPython. Run the setup commands in README.md first."
}

if (-not $SkipFrontend -and $null -eq $npmCommand) {
  throw "npm runtime not found. Install Node.js and run npm install first."
}

function Invoke-Step {
  param(
    [string]$Name,
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory
  )

  Write-Host ""
  Write-Host "==> $Name"
  Push-Location $WorkingDirectory
  try {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "$Name failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

$pytestTargets = @(
  "apps\api\tests\test_v1_lite_seed.py",
  "apps\api\tests\test_v1_lite_e2e_acceptance.py"
)
$pytestArguments = @("-m", "pytest") + $pytestTargets + @("-q")

Invoke-Step `
  -Name "V1 Lite backend acceptance tests" `
  -FilePath $apiPython `
  -Arguments $pytestArguments `
  -WorkingDirectory $root

if (-not $SkipFrontend) {
  Invoke-Step `
    -Name "Frontend lint" `
    -FilePath $npmCommand.Source `
    -Arguments @("run", "lint") `
    -WorkingDirectory $root

  Invoke-Step `
    -Name "Frontend production build" `
    -FilePath $npmCommand.Source `
    -Arguments @("run", "build") `
    -WorkingDirectory $root
}

Write-Host ""
Write-Host "V1.0 Lite automated acceptance passed."
