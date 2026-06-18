# Windows — pokreni QNC Rust host (bez Pythona)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:QNC_ROOT = $Root
$env:QNC_API_PORT = if ($env:QNC_API_PORT) { $env:QNC_API_PORT } else { "8001" }
if (-not $env:QNC_FFMPEG) {
    $wingetFfmpeg = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages") -Filter "ffmpeg.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($wingetFfmpeg) {
        $env:QNC_FFMPEG = $wingetFfmpeg.FullName
        $ffprobeSibling = Join-Path (Split-Path -Parent $wingetFfmpeg.FullName) "ffprobe.exe"
        if (Test-Path $ffprobeSibling) {
            $env:QNC_FFPROBE = $ffprobeSibling
        }
    }
}
$HostDir = Join-Path $Root "qnc-host"
$Bin = Join-Path $HostDir "target\release\qnc-host.exe"

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Error "Instaliraj Rust: https://rustup.rs"
}
if (-not (Test-Path $Bin)) {
    Push-Location $HostDir
    cargo build --release
    Pop-Location
}
Write-Host "QNC: http://127.0.0.1:$($env:QNC_API_PORT)/app  (LAN: set QNC_BIND_HOST=0.0.0.0)"
& $Bin
