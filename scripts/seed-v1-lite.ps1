param(
  [string]$DatabaseUrl = "",
  [string]$WorkspaceSlug = "ai-capability-center",
  [string]$EnvFile = ""
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$apiPython = Join-Path $root "apps\api\.venv\Scripts\python.exe"
$apiDir = Join-Path $root "apps\api"

if (-not (Test-Path $apiPython)) {
  throw "API Python runtime not found: $apiPython. Run the setup commands in README.md first."
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

$arguments = @("-m", "app.v1_lite_seed", "--json", "--workspace-slug", $WorkspaceSlug)
if ($DatabaseUrl.Trim()) {
  $arguments += @("--database-url", $DatabaseUrl)
}

$envSnapshot = Import-ProcessEnvFile -Path $EnvFile
Push-Location $apiDir
try {
  & $apiPython @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "V1 Lite seed command failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
  Restore-ProcessEnvironment -Snapshot $envSnapshot
}
