# Static DB-first guard — no server required.
# Fails on patterns that indicate workflow state in plugin JS or stale sdk_demo manifest.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

function Fail($msg) {
    Write-Host "FAIL  $msg"
    exit 1
}

function Warn($msg) {
    Write-Host "WARN  $msg"
}

Write-Host "DB-first guard (static)"
Write-Host "Root: $Root"
Write-Host ""

$requiredDocs = @(
    "docs\architecture-db-first.md",
    "docs\plugin-sdk-v1.md"
)
foreach ($rel in $requiredDocs) {
    if (-not (Test-Path (Join-Path $Root $rel))) {
        Fail "missing doc: $rel"
    }
}
Write-Host "OK    required docs present"

$sdkDemo = Join-Path $Root "plugins\sdk_demo\plugin.json"
if (-not (Test-Path $sdkDemo)) { Fail "missing plugins/sdk_demo/plugin.json" }
$sdkRaw = Get-Content $sdkDemo -Raw
if ($sdkRaw -match 'in_memory_demo|"in_memory"') {
    Fail "sdk_demo plugin.json uses in_memory persistence"
}
if ($sdkRaw -match 'in-memory Rust state') {
    Fail "sdk_demo plugin.json description references in-memory Rust state"
}
if ($sdkRaw -notmatch 'project_db') {
    Fail "sdk_demo plugin.json missing project_db persistence"
}
Write-Host "OK    sdk_demo manifest"

$orchestrators = @(
    "plugins\ingest\static\qnc-ingest.js",
    "plugins\media_pool\static\qnc-media-pool.js",
    "plugins\project\static\qnc-project.js",
    "plugins\sdk_demo\static\qnc-sdk-demo.js",
    "plugins\story\static\qnc-story.js"
)
$forbidden = @(
    @{ Pattern = '\blet\s+pool\s*='; Label = "let pool = workflow store" },
    @{ Pattern = '\bconst\s+pool\s*='; Label = "const pool = workflow store" },
    @{ Pattern = '\btimelines\s*:\s*(\x7b\x7d|new\s)'; Label = "timelines object cache" },
    @{ Pattern = '\btranscripts\s*:\s*(\x7b\x7d|new\s)'; Label = "transcripts object cache" },
    @{ Pattern = 'QNC\.mediaPool\s*='; Label = "QNC.mediaPool global" }
)
foreach ($rel in $orchestrators) {
    $path = Join-Path $Root $rel
    if (-not (Test-Path $path)) { Fail "missing orchestrator: $rel" }
    $text = Get-Content $path -Raw
    foreach ($rule in $forbidden) {
        if ($text -match $rule.Pattern) {
            Fail "${rel}: $($rule.Label)"
        }
    }
}
Write-Host "OK    production orchestrators (no workflow object stores)"

$projectJs = Join-Path $Root "plugins\project\static\qnc-project.js"
$projRaw = Get-Content $projectJs -Raw
if ($projRaw -match 'async\s+onShow\s*\(\s*ctx\s*\)\s*\{[^}]*showProjectOnly') {
    Fail "project onShow must not call showProjectOnly (lifecycle re-entry loop)"
}
Write-Host "OK    project onShow lifecycle (no showProjectOnly re-entry)"

$mediaPool = Join-Path $Root "plugins\media_pool\static\qnc-media-pool.js"
$mp = Get-Content $mediaPool -Raw
if ($mp -match 'function\s+transcriptStatus\s*\([^)]*\)\s*\{[^}]*transcribingClips') {
    Fail "media_pool transcriptStatus uses transcribingClips for display status"
}
Write-Host "OK    media_pool transcriptStatus uses snapshot only"

$registry = Join-Path $Root "app\components\registry.json"
if (Test-Path $registry) {
    $regRaw = Get-Content $registry -Raw
    if ($regRaw -match '"owns_state"\s*:\s*true') {
        Fail "registry.json contains owns_state: true"
    }
    Write-Host "OK    component registry owns_state"
}

Write-Host ""
Write-Host "DB-first guard passed."
