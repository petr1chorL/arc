param(
  [string]$RuntimeEvidence = ".scratch\runtime\v1-lite-runtime-acceptance.json",
  [string]$BrowserEvidence = ".scratch\runtime\v1-lite-browser-smoke.json",
  [string]$IssueLog = "docs\V1_LITE_PILOT_ISSUE_LOG.md",
  [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$nodeCommand = Get-Command "node.exe" -ErrorAction SilentlyContinue
if ($null -eq $nodeCommand) {
  $nodeCommand = Get-Command "node" -ErrorAction SilentlyContinue
}
if ($null -eq $nodeCommand) {
  throw "Node.js runtime not found. Install Node.js and run npm install first."
}

$arguments = @(
  (Join-Path $PSScriptRoot "audit-v1-lite-signoff.mjs"),
  "--runtime-evidence",
  $RuntimeEvidence,
  "--browser-evidence",
  $BrowserEvidence,
  "--issue-log",
  $IssueLog
)

Push-Location $root
try {
  $result = & $nodeCommand.Source @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "V1 Lite signoff audit failed with exit code $LASTEXITCODE"
  }
  if ($OutputPath.Trim()) {
    $resolvedOutput = if ([System.IO.Path]::IsPathRooted($OutputPath)) {
      $OutputPath
    } else {
      Join-Path $root $OutputPath
    }
    $outputDir = Split-Path -Parent $resolvedOutput
    if ($outputDir -and -not (Test-Path $outputDir)) {
      New-Item -ItemType Directory -Force $outputDir | Out-Null
    }
    $result | Set-Content -Encoding utf8 $resolvedOutput
    Write-Host "V1.0 Lite signoff audit written to $resolvedOutput"
  } else {
    $result
  }
} finally {
  Pop-Location
}
