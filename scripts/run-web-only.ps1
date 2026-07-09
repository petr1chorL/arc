param(
  [int]$WebPort = 54173
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$nodeCommand = Get-Command "node.exe" -ErrorAction SilentlyContinue
$viteCli = Join-Path $root "node_modules\vite\bin\vite.js"

if ($null -eq $nodeCommand) {
  throw "node runtime not found. Install Node.js and run npm install first."
}

if (-not (Test-Path $viteCli)) {
  throw "Vite CLI not found: $viteCli. Run npm install first."
}

$pathValue = [Environment]::GetEnvironmentVariable("Path", "Process")
if ($null -eq $pathValue) {
  $pathValue = [Environment]::GetEnvironmentVariable("PATH", "Process")
}
[Environment]::SetEnvironmentVariable("PATH", $null, "Process")
if ($null -ne $pathValue) {
  [Environment]::SetEnvironmentVariable("Path", $pathValue, "Process")
}

Set-Location $root
& $nodeCommand.Source $viteCli --host 127.0.0.1 --port $WebPort --strictPort --clearScreen false
