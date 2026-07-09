param(
  [string]$WebUrl = "http://127.0.0.1:4173",
  [string]$WorkspaceSlug = "ai-capability-center",
  [string]$Email = "",
  [string]$Password = "",
  [string]$RunId = "",
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

$effectiveEmail = if ($Email.Trim()) { $Email } else { $env:ARC_ONE_BROWSER_SMOKE_EMAIL }
$effectivePassword = if ($Password.Trim()) { $Password } else { $env:ARC_ONE_BROWSER_SMOKE_PASSWORD }
if (-not $effectiveEmail -or -not $effectivePassword) {
  throw "Missing browser smoke credentials. Set ARC_ONE_BROWSER_SMOKE_EMAIL and ARC_ONE_BROWSER_SMOKE_PASSWORD, or pass -Email and -Password."
}

$arguments = @(
  (Join-Path $PSScriptRoot "smoke-v1-lite-browser.mjs"),
  "--web-url",
  $WebUrl,
  "--workspace-slug",
  $WorkspaceSlug
)
if ($RunId.Trim()) {
  $arguments += @("--run-id", $RunId)
}

Push-Location $root
try {
  $previousWebUrl = $env:ARC_ONE_WEB_URL
  $previousWorkspaceSlug = $env:ARC_ONE_WORKSPACE_SLUG
  $previousEmail = $env:ARC_ONE_BROWSER_SMOKE_EMAIL
  $previousPassword = $env:ARC_ONE_BROWSER_SMOKE_PASSWORD
  $env:ARC_ONE_WEB_URL = $WebUrl
  $env:ARC_ONE_WORKSPACE_SLUG = $WorkspaceSlug
  $env:ARC_ONE_BROWSER_SMOKE_EMAIL = $effectiveEmail
  $env:ARC_ONE_BROWSER_SMOKE_PASSWORD = $effectivePassword
  try {
    $result = & $nodeCommand.Source @arguments
    if ($LASTEXITCODE -ne 0) {
      throw "V1 Lite browser smoke failed with exit code $LASTEXITCODE"
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
      Write-Host "V1.0 Lite browser smoke evidence written to $resolvedOutput"
    } else {
      $result
    }
  } finally {
    if ($null -eq $previousWebUrl) { Remove-Item Env:\ARC_ONE_WEB_URL -ErrorAction SilentlyContinue } else { $env:ARC_ONE_WEB_URL = $previousWebUrl }
    if ($null -eq $previousWorkspaceSlug) { Remove-Item Env:\ARC_ONE_WORKSPACE_SLUG -ErrorAction SilentlyContinue } else { $env:ARC_ONE_WORKSPACE_SLUG = $previousWorkspaceSlug }
    if ($null -eq $previousEmail) { Remove-Item Env:\ARC_ONE_BROWSER_SMOKE_EMAIL -ErrorAction SilentlyContinue } else { $env:ARC_ONE_BROWSER_SMOKE_EMAIL = $previousEmail }
    if ($null -eq $previousPassword) { Remove-Item Env:\ARC_ONE_BROWSER_SMOKE_PASSWORD -ErrorAction SilentlyContinue } else { $env:ARC_ONE_BROWSER_SMOKE_PASSWORD = $previousPassword }
  }
} finally {
  Pop-Location
}
