param(
  [string]$RuntimeEvidence = ".scratch\runtime\v1-lite-runtime-acceptance.json",
  [string]$BrowserEvidence = ".scratch\runtime\v1-lite-browser-smoke.json",
  [string]$SignoffAudit = ".scratch\runtime\v1-lite-signoff-audit.json",
  [string]$IssueLog = "docs\V1_LITE_PILOT_ISSUE_LOG.md",
  [string]$OutputPath = ".scratch\runtime\v1-lite-signoff-package.md"
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
  (Join-Path $PSScriptRoot "export-v1-lite-signoff-package.mjs"),
  "--runtime-evidence",
  $RuntimeEvidence,
  "--browser-evidence",
  $BrowserEvidence,
  "--signoff-audit",
  $SignoffAudit,
  "--issue-log",
  $IssueLog,
  "--output",
  $OutputPath
)

Push-Location $root
try {
  & $nodeCommand.Source @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "V1 Lite signoff package export failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}
