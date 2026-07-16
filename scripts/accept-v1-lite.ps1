param(
  [string]$ApiUrl = "http://127.0.0.1:8000",
  [string]$WorkspaceSlug = "ai-capability-center",
  [string]$Email = "",
  [string]$Password = "",
  [string]$OutputPath = "",
  [switch]$SkipReviewerGrant,
  [switch]$ResumeLatest
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

$effectiveEmail = if ($Email.Trim()) { $Email } else { $env:ARC_ONE_ACCEPTANCE_EMAIL }
$effectivePassword = if ($Password.Trim()) { $Password } else { $env:ARC_ONE_ACCEPTANCE_PASSWORD }
if (-not $effectiveEmail -or -not $effectivePassword) {
  throw "Missing acceptance credentials. Set ARC_ONE_ACCEPTANCE_EMAIL and ARC_ONE_ACCEPTANCE_PASSWORD, or pass -Email and -Password."
}

$arguments = @(
  (Join-Path $PSScriptRoot "v1-lite-acceptance.mjs")
)
if ($SkipReviewerGrant) {
  $arguments += @("--ensure-reviewer", "false")
}
if ($ResumeLatest) {
  $arguments += @("--resume-latest", "true")
}

Push-Location $root
try {
  $previousApiUrl = $env:ARC_ONE_API_URL
  $previousWorkspaceSlug = $env:ARC_ONE_WORKSPACE_SLUG
  $previousEmail = $env:ARC_ONE_ACCEPTANCE_EMAIL
  $previousPassword = $env:ARC_ONE_ACCEPTANCE_PASSWORD
  $env:ARC_ONE_API_URL = $ApiUrl
  $env:ARC_ONE_WORKSPACE_SLUG = $WorkspaceSlug
  $env:ARC_ONE_ACCEPTANCE_EMAIL = $effectiveEmail
  $env:ARC_ONE_ACCEPTANCE_PASSWORD = $effectivePassword
  try {
    $result = & $nodeCommand.Source @arguments
    if ($LASTEXITCODE -ne 0) {
      throw "V1 Lite runtime acceptance failed with exit code $LASTEXITCODE"
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
      Write-Host "V1.0 Lite runtime acceptance evidence written to $resolvedOutput"
    } else {
      $result
    }
  } finally {
    if ($null -eq $previousApiUrl) { Remove-Item Env:\ARC_ONE_API_URL -ErrorAction SilentlyContinue } else { $env:ARC_ONE_API_URL = $previousApiUrl }
    if ($null -eq $previousWorkspaceSlug) { Remove-Item Env:\ARC_ONE_WORKSPACE_SLUG -ErrorAction SilentlyContinue } else { $env:ARC_ONE_WORKSPACE_SLUG = $previousWorkspaceSlug }
    if ($null -eq $previousEmail) { Remove-Item Env:\ARC_ONE_ACCEPTANCE_EMAIL -ErrorAction SilentlyContinue } else { $env:ARC_ONE_ACCEPTANCE_EMAIL = $previousEmail }
    if ($null -eq $previousPassword) { Remove-Item Env:\ARC_ONE_ACCEPTANCE_PASSWORD -ErrorAction SilentlyContinue } else { $env:ARC_ONE_ACCEPTANCE_PASSWORD = $previousPassword }
  }
} finally {
  Pop-Location
}
