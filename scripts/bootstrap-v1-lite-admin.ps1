param(
  [string]$Email = "",
  [string]$Password = "",
  [string]$DisplayName = "V1 Lite Acceptance Admin",
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

$effectiveEmail = if ($Email.Trim()) { $Email } else { $env:ARC_ONE_ADMIN_EMAIL }
$effectivePassword = if ($Password.Trim()) { $Password } else { $env:ARC_ONE_ADMIN_PASSWORD }
if (-not $effectiveEmail -or -not $effectivePassword) {
  throw "Missing admin credentials. Set ARC_ONE_ADMIN_EMAIL and ARC_ONE_ADMIN_PASSWORD, or pass -Email and -Password."
}

$envSnapshot = Import-ProcessEnvFile -Path $EnvFile
$previousAdminEmail = $env:ARC_ONE_ADMIN_EMAIL
$previousAdminPassword = $env:ARC_ONE_ADMIN_PASSWORD
$previousAdminDisplayName = $env:ARC_ONE_ADMIN_DISPLAY_NAME
$env:ARC_ONE_ADMIN_EMAIL = $effectiveEmail
$env:ARC_ONE_ADMIN_PASSWORD = $effectivePassword
$env:ARC_ONE_ADMIN_DISPLAY_NAME = $DisplayName

Push-Location $apiDir
try {
  & $apiPython -c "from app.bootstrap import main; main()"
  if ($LASTEXITCODE -ne 0) {
    throw "V1 Lite admin bootstrap failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
  if ($null -eq $previousAdminEmail) { Remove-Item Env:\ARC_ONE_ADMIN_EMAIL -ErrorAction SilentlyContinue } else { $env:ARC_ONE_ADMIN_EMAIL = $previousAdminEmail }
  if ($null -eq $previousAdminPassword) { Remove-Item Env:\ARC_ONE_ADMIN_PASSWORD -ErrorAction SilentlyContinue } else { $env:ARC_ONE_ADMIN_PASSWORD = $previousAdminPassword }
  if ($null -eq $previousAdminDisplayName) { Remove-Item Env:\ARC_ONE_ADMIN_DISPLAY_NAME -ErrorAction SilentlyContinue } else { $env:ARC_ONE_ADMIN_DISPLAY_NAME = $previousAdminDisplayName }
  Restore-ProcessEnvironment -Snapshot $envSnapshot
}
