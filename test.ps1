# QNC v2 — test na Windows (PowerShell)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$HostDir = Join-Path $Root "qnc-host"
$Bin = Join-Path $HostDir "target\release\qnc-host.exe"
$Port = if ($env:QNC_API_PORT) { $env:QNC_API_PORT } else { "18081" }
$Base = "http://127.0.0.1:$Port"

$env:QNC_ROOT = $Root
$env:QNC_API_PORT = $Port
$ProjectsRoot = Join-Path ([System.IO.Path]::GetTempPath()) "qnc-test-projects-$Port"
$env:QNC_PROJECTS_ROOT = $ProjectsRoot
if (Test-Path $ProjectsRoot) {
    Remove-Item -LiteralPath $ProjectsRoot -Recurse -Force
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Error "Instaliraj Rust: https://rustup.rs"
}

Write-Host "Checking qnc-host..."
Push-Location $HostDir
cargo check
if ($LASTEXITCODE -ne 0) { Pop-Location; exit $LASTEXITCODE }
Write-Host "Building qnc-host..."
cargo build --release
if ($LASTEXITCODE -ne 0) { Pop-Location; exit $LASTEXITCODE }
Pop-Location

$proc = Start-Process -FilePath $Bin -PassThru -NoNewWindow -WorkingDirectory $Root
Start-Sleep -Seconds 2

function Test-Get($url, $pattern, $name) {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing
    if ($r.Content -notmatch $pattern) { throw "FAIL: $name - $($r.Content)" }
    Write-Host "OK: $name"
}

function Test-GetJson($url, $pattern, $name) {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing
    if ($r.Content -notmatch $pattern) { throw "FAIL: $name - $($r.Content)" }
    Write-Host "OK: $name"
    return ($r.Content | ConvertFrom-Json)
}

function Test-PostJson($url, $body, $pattern, $name) {
    $json = if ($null -eq $body) { "{}" } else { ($body | ConvertTo-Json -Depth 20 -Compress) }
    $r = Invoke-WebRequest -Uri $url -Method POST -ContentType "application/json" -Body $json -UseBasicParsing
    if ($r.Content -notmatch $pattern) { throw "FAIL: $name - $($r.Content)" }
    Write-Host "OK: $name"
    return ($r.Content | ConvertFrom-Json)
}

try {
    $bootstrapProjectId = $null

    Test-Get "$Base/api/health" '"ok"' "GET /api/health"
    Test-Get "$Base/api/shell/runtime" 'shell_api_version' "GET /api/shell/runtime"
    $diag = Test-GetJson "$Base/api/shell/diagnostics" '"plugins_loaded"' "GET /api/shell/diagnostics"
    if ($diag.bind_host -ne "127.0.0.1") { throw "FAIL: diagnostics bind_host expected 127.0.0.1" }
    if ($diag.plugins_loaded_count -lt 1) { throw "FAIL: diagnostics plugins_loaded_count" }
    Test-Get "$Base/api/shell/tabs" 'project' "GET /api/shell/tabs"
    Test-Get "$Base/api/shell/tabs" 'ingest' "GET /api/shell/tabs (ingest)"
    Test-Get "$Base/api/design-tools/status" '"mode":"open"' "GET /api/design-tools/status"
    Test-Get "$Base/app" 'qnc-plugin-panels' "GET /app"

    $projects = Test-GetJson "$Base/api/projects" '"projects"' "GET /api/projects"
    if (-not $projects.active_project_id) {
        $bootstrap = Test-PostJson "$Base/api/projects" @{
            name = "QA bootstrap projekt"
        } '"active_project_id"' "POST /api/projects (bootstrap)"
        $bootstrapProjectId = $bootstrap.active_project_id
        if (-not $bootstrapProjectId) { throw "FAIL: bootstrap active_project_id missing" }
        $projects = Test-GetJson "$Base/api/projects" '"projects"' "GET /api/projects (after bootstrap)"
    }
    if (-not $projects.active_project_id) { throw "FAIL: active_project_id missing" }

    $templates = Test-GetJson "$Base/api/project-templates" 'tpl_breaking_news' "GET /api/project-templates"
    if (-not $templates.templates -or $templates.templates.Count -lt 1) {
        throw "FAIL: project templates not seeded"
    }

    $ui = Test-GetJson "$Base/api/projects/ui-state" '"ui_state"' "GET /api/projects/ui-state"
    if (-not $ui.ui_state) { throw "FAIL: ui_state missing" }

    $patched = Test-PostJson "$Base/api/projects/ui-state" @{
        project_name = "Test projekt QA"
        settings_override = @{ ai = @{ enabled = $true } }
    } '"ui_state"' "POST /api/projects/ui-state"
    if ($patched.ui_state.project_name -ne "Test projekt QA") {
        throw "FAIL: ui-state project_name not persisted"
    }

    $session = Test-PostJson "$Base/api/collab/session" @{
        display_name = "QA tester"
        role = "editor"
        station_id = "test-host"
        client_label = "test.ps1"
        project_id = $projects.active_project_id
    } '"session_id"' "POST /api/collab/session"
    if (-not $session.session.user_id) { throw "FAIL: collab session missing user_id" }

    $touched = Test-PostJson "$Base/api/collab/touch" @{
        session_id = $session.session.session_id
        project_id = $projects.active_project_id
    } '"session"' "POST /api/collab/touch"
    if (-not $touched.session.user_id) { throw "FAIL: collab touch missing user_id" }

    $created = Test-PostJson "$Base/api/projects/from-template" @{
        name = "QA test projekt"
        template_id = "tpl_breaking_news"
        settings_override = @{
            ai = @{ enabled = $false }
            storage = @{ projects_root = $ProjectsRoot }
            export = @{ directory = (Join-Path $ProjectsRoot "exports") }
        }
        user_id = $session.session.user_id
        session_id = $session.session.session_id
    } '"active_project_id"' "POST /api/projects/from-template"
    $newId = $created.active_project_id
    if (-not $newId) { throw "FAIL: from-template missing active_project_id" }

    $dbPath = Join-Path $ProjectsRoot "$newId\qnc_project.db"
    if (-not (Test-Path $dbPath)) {
        throw "FAIL: per-project db not created at $dbPath"
    }
    Write-Host "OK: qnc_project.db created ($dbPath)"

    $settings = Test-GetJson "$Base/api/projects/$([uri]::EscapeDataString($newId))/settings" '"settings"' "GET /api/projects/{id}/settings"
    if (-not $settings.settings.template_id) { throw "FAIL: project settings missing template_id" }

    $workspace = Test-GetJson "$Base/api/projects/$([uri]::EscapeDataString($newId))/workspace" '"tabs"' "GET /api/projects/{id}/workspace"
    if (-not $workspace.workspace.tabs) { throw "FAIL: workspace tabs missing" }

    $ingestState = Test-GetJson "$Base/api/ingest/state?project_id=$([uri]::EscapeDataString($newId))" '"clips"' "GET /api/ingest/state"
    if ($ingestState.project_id -ne $newId) { throw "FAIL: ingest state project_id mismatch" }
    if (-not $ingestState.sources) { throw "FAIL: ingest sources missing" }
    if ($null -eq $ingestState.clips) { throw "FAIL: ingest clips array missing" }

    $legacyIngestDb = Join-Path $ProjectsRoot "$newId\ingest\ingest.db"
    if (Test-Path $legacyIngestDb) {
        throw "FAIL: ingest created separate db at $legacyIngestDb"
    }
    Write-Host "OK: ingest uses qnc_project.db (no separate ingest.db)"

    $discovered = Test-PostJson "$Base/api/ingest/discover" @{
        project_id = $newId
        source_id = $ingestState.active_source_id
    } '"clips"' "POST /api/ingest/discover"
    if ($discovered.project_id -ne $newId) { throw "FAIL: discover project_id mismatch" }

    $selectAll = Test-PostJson "$Base/api/ingest/selection/select-all" @{
        project_id = $newId
    } '"selected_clip_ids"' "POST /api/ingest/selection/select-all"
    if ($selectAll.project_id -ne $newId) { throw "FAIL: select-all project_id mismatch" }

    $toggled = Test-PostJson "$Base/api/ingest/selection/toggle" @{
        project_id = $newId
        clip_id = "qa-test-clip"
    } '"clips"' "POST /api/ingest/selection/toggle"
    if ($toggled.status -ne "ok") { throw "FAIL: toggle status not ok" }

    Test-Get "$Base/app/components/registry.json" 'media-thumb' "GET registry (media-thumb)"
    Test-Get "$Base/app/components/registry.json" 'ingest-clip-grid' "GET registry (ingest-clip-grid)"
    Test-Get "$Base/plugins/ingest/static/qnc-ingest.js" 'syncFromDb' "GET qnc-ingest.js orchestrator"

    $deleted = Test-PostJson "$Base/api/projects/delete" @{
        project_ids = @($newId)
    } '"projects"' "POST /api/projects/delete"
    if ($deleted.removed -notcontains $newId) { throw "FAIL: project not deleted" }

    if ($bootstrapProjectId) {
        $deletedBootstrap = Test-PostJson "$Base/api/projects/delete" @{
            project_ids = @($bootstrapProjectId)
        } '"projects"' "POST /api/projects/delete (bootstrap)"
        if ($deletedBootstrap.removed -notcontains $bootstrapProjectId) { throw "FAIL: bootstrap project not deleted" }
    }

    Write-Host ""
    Write-Host "All host integration tests passed (project + ingest SQLite flow)."
}
finally {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    if (Test-Path $ProjectsRoot) {
        Remove-Item -LiteralPath $ProjectsRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
