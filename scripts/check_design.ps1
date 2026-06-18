# Provjera Design add-ona — samostalan plugins/design-tools (Rust, bez Pythona)
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Write-Host "Korijen: $Root"
Write-Host ""

$checks = @(
  @{ Path = "plugins\design-tools\plugin.json"; Label = "design-tools plugin" },
  @{ Path = "plugins\design-tools\static\panel.html"; Label = "design panel" },
  @{ Path = "plugins\design-tools\design\tokens.json"; Label = "design tokens" },
  @{ Path = "plugins\design-tools\static\qnc-design.js"; Label = "design JS" },
  @{ Path = "data\shell_config.json"; Label = "shell_config" }
)
$ok = $true
foreach ($c in $checks) {
  $p = Join-Path $Root $c.Path
  if (Test-Path $p) { Write-Host "OK       $($c.Label)" } else { Write-Host "MISSING  $($c.Label)"; Write-Host "         $p"; $ok = $false }
}
if (-not $ok) {
  Write-Host ""
  Write-Host "Rebuild: cd qnc-host; cargo build --release; cd ..; .\run_host.bat"
  exit 1
}
$cfg = Get-Content (Join-Path $Root "data\shell_config.json") -Raw | ConvertFrom-Json
if (-not $cfg.design_editor -or $cfg.design_editor.mode -ne "open") {
  Write-Host ""
  Write-Host "WARN  design_editor.mode treba biti 'open' za test"
}
Write-Host ""
Write-Host "API (host pokrenut):"
Write-Host "  http://127.0.0.1:8001/api/design-tools/status"
Write-Host "  http://127.0.0.1:8001/api/shell/tabs  (design-tools)"
