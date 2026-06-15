param(
  [switch]$SkipPythonDeps
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $ProjectRoot

function Test-Tool {
  param([string]$Name)
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

$missing = @()

if (-not (Test-Tool "node.exe")) { $missing += "Node.js 18+ (https://nodejs.org/en/download)" }
if (-not (Test-Tool "npm.cmd")) { $missing += "npm.cmd from Node.js" }
if (-not (Test-Tool "python.exe")) { $missing += "Python 3.10+ (https://www.python.org/downloads/windows/)" }
if (-not (Test-Tool "ffmpeg.exe")) { $missing += "FFmpeg on PATH (https://ffmpeg.org/download.html)" }
if (-not (Test-Tool "ffprobe.exe")) { $missing += "FFprobe on PATH (usually included with FFmpeg)" }
if (-not (Test-Tool "curl.exe")) { $missing += "curl.exe on PATH" }

if ($missing.Count -gt 0) {
  Write-Host "Missing prerequisites:"
  foreach ($item in $missing) {
    Write-Host " - $item"
  }
  exit 1
}

Write-Host "Creating project config and runtime folders..."
& npm.cmd run setup

$RuntimeDir = Join-Path $ProjectRoot ".runtime"
$VenvDir = Join-Path $RuntimeDir "transcript-venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"

if (-not (Test-Path $VenvPython)) {
  Write-Host "Creating Python virtual environment..."
  & python.exe -m venv $VenvDir
}

if (-not $SkipPythonDeps) {
  Write-Host "Installing transcription dependencies..."
  & $VenvPython -m pip install --upgrade pip
  & $VenvPython -m pip install faster-whisper ctranslate2
}

Write-Host ""
Write-Host "Bootstrap complete."
Write-Host ""
Write-Host "Next steps:"
Write-Host " 1. Install and log in to WeChat for Windows."
Write-Host " 2. Install and run wx_channel from https://github.com/nobiyou/wx_channel."
Write-Host " 3. Edit wechat.config.json with the target account name, slug, and v2_...@finder username."
Write-Host " 4. Set transcription.python to .runtime\transcript-venv\Scripts\python.exe."
Write-Host " 5. Run: npm.cmd run doctor"
Write-Host " 6. Run: npm.cmd run capture"
Write-Host " 7. Run: npm.cmd run run"

