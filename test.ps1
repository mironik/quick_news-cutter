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

Write-Host "DB-first guard (static)..."
& (Join-Path $Root "scripts\db-first-guard.ps1")
if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Checking qnc-host..."
Push-Location $HostDir
cargo check
if ($LASTEXITCODE -ne 0) { Pop-Location; exit $LASTEXITCODE }
Write-Host "Building qnc-host..."
cargo build --release
if ($LASTEXITCODE -ne 0) { Pop-Location; exit $LASTEXITCODE }
Write-Host "Legacy ingest migration (cargo test)..."
cargo test legacy_ingest --release -- --nocapture
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
    $dbFirst = Test-GetJson "$Base/api/shell/db-first" '"contract"' "GET /api/shell/db-first"
    if ($dbFirst.contract -ne "db-first-v1") { throw "FAIL: db-first contract mismatch" }
    if ($dbFirst.violations -and $dbFirst.violations.Count -gt 0) {
        throw "FAIL: db-first violations: $($dbFirst.violations -join '; ')"
    }
    if ($dbFirst.status -ne "ok") { throw "FAIL: db-first status expected ok" }
    Test-Get "$Base/api/shell/tabs" 'project' "GET /api/shell/tabs"
    Test-Get "$Base/api/shell/tabs" 'ingest' "GET /api/shell/tabs (ingest)"
    Test-Get "$Base/api/design-tools/status" '"mode":"open"' "GET /api/design-tools/status"
    Test-Get "$Base/app/shell/qnc-shell.js" 'resolveWorkspaceTabId' "GET qnc-shell.js (workspace tab resolver)"
    $shellJs = (Invoke-WebRequest -Uri "$Base/app/shell/qnc-shell.js" -UseBasicParsing).Content
    if ($shellJs -notmatch 'ingest_proxy"\)\s*return\s*"ingest"') {
        throw "FAIL: qnc-shell.js missing ingest_proxy -> ingest workspace alias"
    }
    Write-Host "OK: shell legacy ingest_proxy alias present"
    $appJs = (Invoke-WebRequest -Uri "$Base/app/shell/app.js" -UseBasicParsing).Content
    if ($appJs -notmatch 'function componentAssetDomId') {
        throw "FAIL: app.js missing componentAssetDomId helper"
    }
    if ($appJs -notmatch "componentAssetDomId\('qnc-component-css-'") {
        throw "FAIL: app.js component CSS ids not scoped per asset href"
    }
    Write-Host "OK: shell component asset loader uses per-href DOM ids"
    Test-Get "$Base/plugins/project/static/qnc-project.js" 'createPluginApp' "GET qnc-project.js (SDK orchestrator)"
    Test-Get "$Base/app/components/registry.json" 'project-list' "GET registry (project-list)"
    Test-Get "$Base/app/components/registry.json" 'project-template-settings' "GET registry (project-template-settings)"

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
    foreach ($tpl in $templates.templates) {
        $tplTabs = @($tpl.settings.workspace.tabs)
        if ($tplTabs -contains "ingest_proxy") {
            throw "FAIL: template $($tpl.template_id) workspace.tabs contains ingest_proxy"
        }
    }
    $newsTpl = $templates.templates | Where-Object { $_.template_id -eq "tpl_news_package" } | Select-Object -First 1
    if ($newsTpl) {
        $ingestCount = @($newsTpl.settings.workspace.tabs | Where-Object { $_ -eq "ingest" }).Count
        if ($ingestCount -gt 1) {
            throw "FAIL: tpl_news_package workspace.tabs has duplicate ingest"
        }
    }
    Write-Host "OK: system templates use ingest tab id (no ingest_proxy)"

    $ui = Test-GetJson "$Base/api/projects/ui-state" '"ui_state"' "GET /api/projects/ui-state"
    if (-not $ui.ui_state) { throw "FAIL: ui_state missing" }

    $patched = Test-PostJson "$Base/api/projects/ui-state" @{
        project_name = "Test projekt QA"
        settings_override = @{ ai = @{ enabled = $true } }
    } '"ui_state"' "POST /api/projects/ui-state"
    if ($patched.ui_state.project_name -ne "Test projekt QA") {
        throw "FAIL: ui-state project_name not persisted"
    }

    $tplPatch = Test-PostJson "$Base/api/projects/ui-state" @{
        selected_template_id = "tpl_news_package"
        reset_settings_override = $true
    } '"ui_state"' "POST /api/projects/ui-state (template select)"
    if ($tplPatch.ui_state.selected_template_id -ne "tpl_news_package") {
        throw "FAIL: ui-state selected_template_id not persisted"
    }
    $tplReload = Test-GetJson "$Base/api/projects/ui-state" '"ui_state"' "GET /api/projects/ui-state (template reload)"
    if ($tplReload.ui_state.selected_template_id -ne "tpl_news_package") {
        throw "FAIL: ui-state template reload mismatch"
    }
    Write-Host "OK: Project tab template selection round-trip"

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

    $projectsListed = Test-GetJson "$Base/api/projects" '"projects"' "GET /api/projects (list after create)"
    if (-not ($projectsListed.projects | Where-Object { $_.project_id -eq $newId })) {
        throw "FAIL: created project missing from project index"
    }

    $openTargetId = $null
    if ($bootstrapProjectId -and $bootstrapProjectId -ne $newId) {
        $openTargetId = $bootstrapProjectId
    } else {
        $otherListed = @($projectsListed.projects | Where-Object { $_.project_id -ne $newId })
        if ($otherListed.Count -ge 1) {
            $openTargetId = $otherListed[0].project_id
        }
    }
    if ($openTargetId) {
        $opened = Test-PostJson "$Base/api/projects/open" @{
            project_id = $openTargetId
        } '"active_project_id"' "POST /api/projects/open"
        if ($opened.active_project_id -ne $openTargetId) {
            throw "FAIL: open did not set active_project_id"
        }
        $reopened = Test-PostJson "$Base/api/projects/open" @{
            project_id = $newId
        } '"active_project_id"' "POST /api/projects/open (restore active)"
        if ($reopened.active_project_id -ne $newId) {
            throw "FAIL: open restore did not set active_project_id"
        }
        Write-Host "OK: Project tab open/switch regression"
    } else {
        Write-Host "OK: Project tab open/switch regression (skipped — single project in index)"
    }

    $settings = Test-GetJson "$Base/api/projects/$([uri]::EscapeDataString($newId))/settings" '"settings"' "GET /api/projects/{id}/settings"
    if (-not $settings.settings.template_id) { throw "FAIL: project settings missing template_id" }

    $workspace = Test-GetJson "$Base/api/projects/$([uri]::EscapeDataString($newId))/workspace" '"tabs"' "GET /api/projects/{id}/workspace"
    if (-not $workspace.workspace.tabs) { throw "FAIL: workspace tabs missing" }
    if ($workspace.workspace.tabs -contains "ingest_proxy") {
        throw "FAIL: new project workspace.tabs contains ingest_proxy"
    }
    if ($workspace.workspace.active_step_id -eq "step_ingest_proxy") {
        throw "FAIL: new project active_step_id is step_ingest_proxy"
    }
    if ($workspace.workspace.entry_step_id -eq "step_ingest_proxy") {
        throw "FAIL: new project entry_step_id is step_ingest_proxy"
    }
    $activeIngest = @($workspace.workspace.steps | Where-Object { $_.status -eq "active" -and $_.tab_id -eq "ingest" })
    if ($activeIngest.Count -lt 1) {
        throw "FAIL: new project has no active ingest workflow step"
    }
    Write-Host "OK: new project workspace uses ingest (step_ingest)"

    $storyPy = @(Get-ChildItem -Path (Join-Path $Root "plugins\story") -Filter "*.py" -Recurse -ErrorAction SilentlyContinue)
    if ($storyPy.Count -gt 0) { throw "FAIL: plugins/story must not contain .py files" }
    Write-Host "OK: story plugin has no Python files"

    $shellTabsStory = Test-GetJson "$Base/api/shell/tabs" '"tabs"' "GET /api/shell/tabs (story manifest)"
    $storyTab = $shellTabsStory.tabs | Where-Object { $_.tab_id -eq 'storyboard' } | Select-Object -First 1
    if (-not $storyTab) { throw "FAIL: storyboard tab missing from /api/shell/tabs" }
    if ($storyTab.plugin_id -ne 'story') { throw "FAIL: storyboard tab plugin_id expected story" }
    Write-Host "OK: /api/shell/tabs exposes storyboard/story"

    if ($workspace.workspace.tabs -notcontains 'storyboard') {
        throw "FAIL: tpl_breaking_news workspace missing storyboard tab"
    }
    Write-Host "OK: breaking news workspace includes storyboard"

    $storyState = Test-GetJson "$Base/api/story/state?project_id=$([uri]::EscapeDataString($newId))" '"project_id"' "GET /api/story/state"
    if ($storyState.project_id -ne $newId) { throw "FAIL: story state project_id mismatch" }
    if ($storyState.selected_part_id -ne '') { throw "FAIL: story selected_part_id should be empty" }
    if ($storyState.selected_shot_id -ne '') { throw "FAIL: story selected_shot_id should be empty" }
    if ($null -eq $storyState.parts -or @($storyState.parts).Count -ne 0) { throw "FAIL: story parts should be empty array" }
    if ($null -eq $storyState.markers -or @($storyState.markers).Count -ne 0) { throw "FAIL: story markers should be empty array" }
    if ($null -eq $storyState.marker_slots -or @($storyState.marker_slots).Count -ne 0) { throw "FAIL: story marker_slots should be empty array" }
    if ($storyState.selected_slot_id -ne '') { throw "FAIL: story selected_slot_id should be empty" }
    if ($storyState.selected_cover_id -ne '') { throw "FAIL: story selected_cover_id should be empty" }
    if ($null -eq $storyState.covers -or @($storyState.covers).Count -ne 0) { throw "FAIL: story covers should be empty array" }
    if ($storyState.summary.part_count -ne 0) { throw "FAIL: story summary.part_count should be 0" }
    if ($storyState.summary.duration_sec -ne 0) { throw "FAIL: story summary.duration_sec should be 0" }
    Write-Host "OK: story.state DB-backed empty snapshot"

    Test-Get "$Base/plugins/story/plugin.json" 'story.part.create' "GET story plugin.json (part actions)"
    Test-Get "$Base/app/components/registry.json" 'story-tab-layout' "GET registry (story-tab-layout)"
    Test-Get "$Base/app/components/registry.json" 'story-parts-list' "GET registry (story-parts-list)"
    Test-Get "$Base/plugins/story/static/qnc-story.js" 'QNC\.createPluginApp' "GET qnc-story.js (createPluginApp)"
    Test-Get "$Base/plugins/story/static/qnc-story.js" 'story\.part\.create' "GET qnc-story.js (part handlers)"

    $tonPart = Test-PostJson "$Base/api/story/part/create" @{
        project_id = $newId
        kind = "tonovi"
    } '"parts"' "POST /api/story/part/create (tonovi)"
    if (@($tonPart.parts).Count -ne 1) { throw "FAIL: story create tonovi parts count" }
    if ($tonPart.summary.part_count -ne 1) { throw "FAIL: story create tonovi summary.part_count" }
    $tonPartId = $tonPart.parts[0].part_id
    if (-not $tonPartId) { throw "FAIL: story tonovi part_id missing" }
    if ($tonPart.parts[0].kind -ne "tonovi") { throw "FAIL: story tonovi kind mismatch" }

    $offPart = Test-PostJson "$Base/api/story/part/create" @{
        project_id = $newId
        kind = "offovi"
    } '"parts"' "POST /api/story/part/create (offovi)"
    if (@($offPart.parts).Count -ne 2) { throw "FAIL: story create offovi parts count" }
    $offPartId = ($offPart.parts | Where-Object { $_.kind -eq 'offovi' } | Select-Object -First 1).part_id
    if (-not $offPartId) { throw "FAIL: story offovi part_id missing" }

    $selected = Test-PostJson "$Base/api/story/part/select" @{
        project_id = $newId
        part_id = $tonPartId
    } '"selected_part_id"' "POST /api/story/part/select"
    if ($selected.selected_part_id -ne $tonPartId) { throw "FAIL: story select selected_part_id" }

    $selectedReload = Test-GetJson "$Base/api/story/state?project_id=$([uri]::EscapeDataString($newId))" '"selected_part_id"' "GET /api/story/state (selected reload)"
    if ($selectedReload.selected_part_id -ne $tonPartId) { throw "FAIL: story selected_part_id reload" }

    $updated = Test-PostJson "$Base/api/story/part/update" @{
        project_id = $newId
        part_id = $tonPartId
        title = "QA ton headline"
        text = "QA ton body"
    } '"parts"' "POST /api/story/part/update"
    $updatedTon = $updated.parts | Where-Object { $_.part_id -eq $tonPartId } | Select-Object -First 1
    if ($updatedTon.title -ne "QA ton headline") { throw "FAIL: story update title" }
    if ($updatedTon.text -ne "QA ton body") { throw "FAIL: story update text" }

    $reordered = Test-PostJson "$Base/api/story/part/reorder" @{
        project_id = $newId
        part_id = $offPartId
        direction = "up"
    } '"parts"' "POST /api/story/part/reorder"
    if ($reordered.parts[0].part_id -ne $offPartId) { throw "FAIL: story reorder up" }

    $deleted = Test-PostJson "$Base/api/story/part/delete" @{
        project_id = $newId
        part_id = $tonPartId
    } '"parts"' "POST /api/story/part/delete"
    if (@($deleted.parts).Count -ne 1) { throw "FAIL: story delete parts count" }
    if ($deleted.parts | Where-Object { $_.part_id -eq $tonPartId }) { throw "FAIL: story deleted part still listed" }

    $finalStory = Test-GetJson "$Base/api/story/state?project_id=$([uri]::EscapeDataString($newId))" '"parts"' "GET /api/story/state (after CRUD)"
    if (@($finalStory.parts).Count -ne 1) { throw "FAIL: story final parts count" }
    if ($finalStory.summary.part_count -ne 1) { throw "FAIL: story final summary.part_count" }
    Write-Host "OK: story parts CRUD round-trip (SQLite)"

    $partsForMarkers = Test-PostJson "$Base/api/story/part/create" @{
        project_id = $newId
        kind = "tonovi"
    } '"parts"' "POST /api/story/part/create (marker setup tonovi)"
    if (@($partsForMarkers.parts).Count -lt 2) {
        $partsForMarkers = Test-PostJson "$Base/api/story/part/create" @{
            project_id = $newId
            kind = "offovi"
        } '"parts"' "POST /api/story/part/create (marker setup offovi)"
    }
    if (@($partsForMarkers.parts).Count -lt 2) { throw "FAIL: story marker setup needs 2 parts" }

    # Parts alone do not create cover slots (only implicit start marker => needs >=2 markers).
    $partsOnlyState = Test-GetJson "$Base/api/story/state?project_id=$([uri]::EscapeDataString($newId))" '"marker_slots"' "GET /api/story/state (parts only slots)"
    if (@($partsOnlyState.marker_slots).Count -ne 0) { throw "FAIL: parts alone must not materialize slots" }

    $partA = $partsForMarkers.parts[0].part_id
    $partB = $partsForMarkers.parts[1].part_id
    $fromPartLocal = Test-PostJson "$Base/api/story/marker/create" @{
        project_id = $newId
        part_id = $partB
        local_sec = 1.5
        label = "QA part-local"
    } '"markers"' "POST /api/story/marker/create (part_id + local_sec)"
    $localMarker = @($fromPartLocal.markers | Where-Object { $_.label -eq "QA part-local" } | Select-Object -First 1)
    if (-not $localMarker) { throw "FAIL: part-local marker missing" }
    if ([math]::Abs($localMarker.timeline_sec - 4.5) -gt 0.05) {
        throw "FAIL: part B local 1.5 should map to cumulative timeline_sec 4.5 (part A default span 3s)"
    }
    $null = Test-PostJson "$Base/api/story/marker/delete" @{
        project_id = $newId
        marker_id = $localMarker.marker_id
    } '"markers"' "POST delete part-local marker"

    $withMarker5 = Test-PostJson "$Base/api/story/marker/create" @{
        project_id = $newId
        timeline_sec = 5
        label = "QA cut 5"
    } '"markers"' "POST /api/story/marker/create at 5s"
    $userMarkers5 = @($withMarker5.markers | Where-Object { $_.timeline_sec -gt 0.001 })
    if (@($userMarkers5).Count -ne 1) { throw "FAIL: story marker create count at 5s" }
    if ([math]::Abs($withMarker5.markers[-1].timeline_sec - 5) -gt 0.01) { throw "FAIL: story marker timeline_sec not 5" }
    if (@($withMarker5.marker_slots).Count -ne 1) { throw "FAIL: implicit start + marker@5 => one slot [0,5]" }
    $slot05 = $withMarker5.marker_slots[0]
    if ([math]::Abs($slot05.start_sec - 0) -gt 0.01 -or [math]::Abs($slot05.end_sec - 5) -gt 0.01) {
        throw "FAIL: slot [0,5] boundaries"
    }

    $withTwoMarkers = Test-PostJson "$Base/api/story/marker/create" @{
        project_id = $newId
        timeline_sec = 12
        label = "QA cut 12"
    } '"markers"' "POST /api/story/marker/create at 12s"
    if (@($withTwoMarkers.markers).Count -lt 3) { throw "FAIL: story markers count with implicit start" }
    if (@($withTwoMarkers.marker_slots).Count -ne 2) { throw "FAIL: slots [0,5] and [5,12]" }
    $slot512 = @($withTwoMarkers.marker_slots | Where-Object {
        [math]::Abs($_.start_sec - 5) -lt 0.01 -and [math]::Abs($_.end_sec - 12) -lt 0.01
    } | Select-Object -First 1)
    if (-not $slot512) { throw "FAIL: slot [5,12] missing" }
    $markerAt5 = @($withTwoMarkers.markers | Where-Object { [math]::Abs($_.timeline_sec - 5) -lt 0.01 } | Select-Object -First 1).marker_id
    $markerAt12 = @($withTwoMarkers.markers | Where-Object { [math]::Abs($_.timeline_sec - 12) -lt 0.01 } | Select-Object -First 1).marker_id
    if (-not $markerAt5 -or -not $markerAt12) { throw "FAIL: marker ids at 5/12 missing" }

    $slotSelect = Test-PostJson "$Base/api/story/marker_slot/select" @{
        project_id = $newId
        slot_id = $slot512.slot_id
    } '"selected_slot_id"' "POST /api/story/marker_slot/select"
    if ($slotSelect.selected_slot_id -ne $slot512.slot_id) {
        throw "FAIL: story selected_slot_id after select"
    }

    $slotForCover = $slot512.slot_id
    $slot05Id = $slot05.slot_id
    if (-not $slotForCover -or -not $slot05Id) { throw "FAIL: story cover setup slot ids missing" }

    $withCover = Test-PostJson "$Base/api/story/cover/create" @{
        project_id = $newId
        slot_id = $slotForCover
        title = "QA cover"
        note = "QA cover note"
    } '"covers"' "POST /api/story/cover/create"
    if (@($withCover.covers).Count -ne 1) { throw "FAIL: story cover create count" }
    if ($withCover.selected_cover_id -ne $withCover.covers[0].cover_id) { throw "FAIL: story cover create selected_cover_id" }
    $coverId = $withCover.covers[0].cover_id
    if (-not $coverId) { throw "FAIL: story cover_id missing" }
    if ([math]::Abs($withCover.covers[0].timeline_start_sec - 5) -gt 0.01) { throw "FAIL: story cover timeline_start_sec" }
    if ([math]::Abs($withCover.covers[0].timeline_end_sec - 12) -gt 0.01) { throw "FAIL: story cover timeline_end_sec" }
    if (-not $withCover.covers[0].slot_signature) { throw "FAIL: story cover slot_signature missing" }
    if ($withCover.covers[0].title -ne "QA cover") { throw "FAIL: story cover title" }

    $coverSelect = Test-PostJson "$Base/api/story/cover/select" @{
        project_id = $newId
        cover_id = $coverId
    } '"selected_cover_id"' "POST /api/story/cover/select"
    if ($coverSelect.selected_cover_id -ne $coverId) { throw "FAIL: story selected_cover_id after select" }

    $coverUpdated = Test-PostJson "$Base/api/story/cover/update" @{
        project_id = $newId
        cover_id = $coverId
        title = "QA cover edited"
        note = "QA note edited"
    } '"covers"' "POST /api/story/cover/update"
    $coverRow = @($coverUpdated.covers | Where-Object { $_.cover_id -eq $coverId } | Select-Object -First 1)
    if (-not $coverRow) { throw "FAIL: story cover update row missing" }
    if ($coverRow.title -ne "QA cover edited") { throw "FAIL: story cover update title" }
    if ($coverRow.note -ne "QA note edited") { throw "FAIL: story cover update note" }

    $withCover2 = Test-PostJson "$Base/api/story/cover/create" @{
        project_id = $newId
        slot_id = $slot05Id
        title = "QA cover slot05"
    } '"covers"' "POST /api/story/cover/create (slot [0,5])"
    if (@($withCover2.covers).Count -ne 2) { throw "FAIL: story second cover count" }

    # Marker interval change 12 -> 15: cover on [5,12] must be normalized away.
    $deleted12 = Test-PostJson "$Base/api/story/marker/delete" @{
        project_id = $newId
        marker_id = $markerAt12
    } '"markers"' "POST delete marker at 12"
    $at15 = Test-PostJson "$Base/api/story/marker/create" @{
        project_id = $newId
        timeline_sec = 15
        label = "QA cut 15"
    } '"markers"' "POST /api/story/marker/create at 15s"
    $coverAfterMove = @($at15.covers | Where-Object { $_.cover_id -eq $coverId })
    if ($coverAfterMove.Count -ne 0) { throw "FAIL: cover on [5,12] should be deleted when interval gone" }

    $cover2Id = @($withCover2.covers | Where-Object { $_.title -eq "QA cover slot05" } | Select-Object -First 1).cover_id
    if (-not $cover2Id) { throw "FAIL: story cover2 id missing" }

    $afterDelM15 = Test-PostJson "$Base/api/story/marker/delete" @{
        project_id = $newId
        marker_id = ($at15.markers | Where-Object { [math]::Abs($_.timeline_sec - 15) -lt 0.01 } | Select-Object -First 1).marker_id
    } '"covers"' "POST /api/story/marker/delete (cover normalize m15)"
    if (@($afterDelM15.marker_slots).Count -ne 1) { throw "FAIL: one slot [0,5] after delete m15" }
    $keptAfter15 = @($afterDelM15.covers | Where-Object { $_.cover_id -eq $cover2Id })
    if ($keptAfter15.Count -ne 1) { throw "FAIL: cover on [0,5] should remain after delete m15" }

    $coverDeleted = Test-PostJson "$Base/api/story/cover/delete" @{
        project_id = $newId
        cover_id = $cover2Id
    } '"covers"' "POST /api/story/cover/delete"
    if (@($coverDeleted.covers).Count -ne 0) { throw "FAIL: story cover delete count" }

    $afterDelM5 = Test-PostJson "$Base/api/story/marker/delete" @{
        project_id = $newId
        marker_id = $markerAt5
    } '"markers"' "POST /api/story/marker/delete (cover normalize m5)"
    if (@($afterDelM5.marker_slots).Count -ne 0) { throw "FAIL: no slots with only implicit start marker" }
    if (@($afterDelM5.covers).Count -ne 0) { throw "FAIL: no covers after slots gone" }

    $coverReload = Test-GetJson "$Base/api/story/state?project_id=$([uri]::EscapeDataString($newId))" '"covers"' "GET /api/story/state (covers reload)"
    if ($null -eq $coverReload.covers) { throw "FAIL: story covers reload missing" }
    Write-Host "OK: story covers round-trip (SQLite)"

    Test-Get "$Base/plugins/story/plugin.json" 'story.cover.create' "GET story plugin.json (cover actions)"
    Test-Get "$Base/plugins/story/static/qnc-story.js" 'story\.cover\.create' "GET qnc-story.js (cover handlers)"
    Test-Get "$Base/app/components/registry.json" 'story-covers-list' "GET registry (story-covers-list)"
    Test-Get "$Base/app/components/registry.json" 'story-cover-editor' "GET registry (story-cover-editor)"

    $moveA = Test-PostJson "$Base/api/story/marker/create" @{
        project_id = $newId
        timeline_sec = 5
        label = "move A"
    } '"markers"' "POST marker create (move setup A)"
    $moveB = Test-PostJson "$Base/api/story/marker/create" @{
        project_id = $newId
        timeline_sec = 10
        label = "move B"
    } '"markers"' "POST marker create (move setup B)"
    $moveMarkerId = @($moveA.markers | Where-Object { [math]::Abs($_.timeline_sec - 5) -lt 0.01 } | Select-Object -First 1).marker_id
    $movedMarker = Test-PostJson "$Base/api/story/marker/move" @{
        project_id = $newId
        marker_id = $moveMarkerId
        direction = "down"
    } '"markers"' "POST /api/story/marker/move"
    $movedRow = @($movedMarker.markers | Where-Object { $_.marker_id -eq $moveMarkerId } | Select-Object -First 1)
    if (-not $movedRow) { throw "FAIL: story marker move row missing" }
    if ([math]::Abs($movedRow.timeline_sec - 10) -gt 0.01) { throw "FAIL: story marker move should swap timeline_sec to 10" }

    $markerReload = Test-GetJson "$Base/api/story/state?project_id=$([uri]::EscapeDataString($newId))" '"marker_slots"' "GET /api/story/state (markers reload)"
    if (@($markerReload.markers).Count -lt 1) { throw "FAIL: story markers reload count" }
    Write-Host "OK: story markers + slots round-trip (SQLite)"

    Test-Get "$Base/plugins/story/plugin.json" 'story.marker.create' "GET story plugin.json (marker actions)"
    Test-Get "$Base/plugins/story/static/qnc-story.js" 'story\.marker\.create' "GET qnc-story.js (marker handlers)"
    Test-Get "$Base/app/components/registry.json" 'story-markers-list' "GET registry (story-markers-list)"

    $env:QNC_TEST_PROJECT_DB = $dbPath
    $env:QNC_TEST_PROJECT_ID = $newId
    Push-Location $HostDir
    cargo test legacy_ingest_corrupt_and_migrate --release -- --nocapture 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) {
        Pop-Location
        Remove-Item Env:QNC_TEST_PROJECT_DB -ErrorAction SilentlyContinue
        Remove-Item Env:QNC_TEST_PROJECT_ID -ErrorAction SilentlyContinue
        throw "FAIL: legacy ingest_proxy corruption fixture"
    }
    Pop-Location
    Remove-Item Env:QNC_TEST_PROJECT_DB -ErrorAction SilentlyContinue
    Remove-Item Env:QNC_TEST_PROJECT_ID -ErrorAction SilentlyContinue

    $legacyWorkspace = Test-GetJson "$Base/api/projects/$([uri]::EscapeDataString($newId))/workspace" '"tabs"' "GET /api/projects/{id}/workspace (legacy ingest migration)"
    if ($legacyWorkspace.workspace.tabs -contains "ingest_proxy") {
        throw "FAIL: migrated workspace.tabs still contains ingest_proxy"
    }
    if ($legacyWorkspace.workspace.active_step_id -eq "step_ingest_proxy") {
        throw "FAIL: migrated active_step_id is step_ingest_proxy"
    }
    if ($legacyWorkspace.workspace.entry_step_id -eq "step_ingest_proxy") {
        throw "FAIL: migrated entry_step_id is step_ingest_proxy"
    }
    $ingestSteps = @($legacyWorkspace.workspace.steps | Where-Object { $_.tab_id -eq "ingest" })
    if ($ingestSteps.Count -ne 1) {
        throw "FAIL: migrated workspace has $($ingestSteps.Count) ingest steps (expected 1)"
    }
    if ($legacyWorkspace.workspace.active_step_id -ne "step_ingest") {
        throw "FAIL: migrated active_step_id is not step_ingest"
    }
    Write-Host "OK: legacy ingest_proxy migrated on workspace load"

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
    Test-Get "$Base/app/components/registry.json" 'sdk-demo-panel' "GET registry (sdk-demo-panel)"
    Test-Get "$Base/plugins/ingest/static/qnc-ingest.js" 'Plugin SDK v1 orchestrator' "GET qnc-ingest.js (SDK orchestrator)"
    Test-Get "$Base/plugins/ingest/static/qnc-ingest.js" 'QNC\.createPluginApp' "GET qnc-ingest.js (createPluginApp)"
    Test-Get "$Base/plugins/sdk_demo/static/qnc-sdk-demo.js" 'QNC\.createPluginApp' "GET qnc-sdk-demo.js (createPluginApp)"

    $modules = Test-GetJson "$Base/api/modules" '"modules"' "GET /api/modules"
    $sdkModule = $modules.modules | Where-Object { $_.module_id -eq 'sdk_demo' -or $_.tab_id -eq 'sdk_demo' } | Select-Object -First 1
    if (-not $sdkModule) { throw "FAIL: sdk_demo module missing from /api/modules" }
    if ($sdkModule.enabled -ne $false) { throw "FAIL: sdk_demo should be disabled by default" }
    Write-Host "OK: sdk_demo disabled by default"

    $tabsBefore = Test-GetJson "$Base/api/shell/tabs" '"tabs"' "GET /api/shell/tabs (before sdk_demo enable)"
    if ($tabsBefore.tabs | Where-Object { $_.tab_id -eq 'sdk_demo' }) {
        throw "FAIL: sdk_demo tab visible before enable"
    }
    Write-Host "OK: sdk_demo tab hidden until enabled"

    $sdkState = Test-GetJson "$Base/api/sdk-demo/state?project_id=$([uri]::EscapeDataString($newId))" '"counter"' "GET /api/sdk-demo/state"
    if ($sdkState.project_id -ne $newId) { throw "FAIL: sdk-demo state project_id mismatch" }
    if ($sdkState.counter -ne 0) { throw "FAIL: sdk-demo counter should start at 0" }
    if ($sdkState.persistence -ne 'project_db_demo') { throw "FAIL: sdk-demo persistence mismatch" }

    $sdkInc = Test-PostJson "$Base/api/sdk-demo/increment" @{
        project_id = $newId
        step = 2
    } '"counter"' "POST /api/sdk-demo/increment"
    if ($sdkInc.counter -lt 2) { throw "FAIL: sdk-demo increment counter" }

    $sdkReset = Test-PostJson "$Base/api/sdk-demo/reset" @{
        project_id = $newId
    } '"counter"' "POST /api/sdk-demo/reset"
    if ($sdkReset.counter -ne 0) { throw "FAIL: sdk-demo reset counter" }

    $enabled = Test-PostJson "$Base/api/modules/sdk_demo/enable" @{
        enabled = $true
    } '"status":"ok"' "POST /api/modules/sdk_demo/enable"
    if ($enabled.module.enabled -ne $true) { throw "FAIL: sdk_demo enable" }

    $tabsAfter = Test-GetJson "$Base/api/shell/tabs" '"tabs"' "GET /api/shell/tabs (after sdk_demo enable)"
    if (-not ($tabsAfter.tabs | Where-Object { $_.tab_id -eq 'sdk_demo' })) {
        throw "FAIL: sdk_demo tab missing after enable"
    }
    Write-Host "OK: sdk_demo tab visible after enable"

    $disabled = Test-PostJson "$Base/api/modules/sdk_demo/enable" @{
        enabled = $false
    } '"status":"ok"' "POST /api/modules/sdk_demo/enable (restore disabled)"
    if ($disabled.module.enabled -ne $false) { throw "FAIL: sdk_demo disable restore" }
    Write-Host "OK: sdk_demo disabled after enable test"

    $poolClips = Test-GetJson "$Base/api/media-pool/clips?project_id=$([uri]::EscapeDataString($newId))" '"workflow"' "GET /api/media-pool/clips"
    if ($poolClips.project_id -ne $newId) { throw "FAIL: media-pool clips project_id mismatch" }
    if ($null -eq $poolClips.clips) { throw "FAIL: media-pool clips array missing" }
    if (-not $poolClips.workflow) { throw "FAIL: media-pool workflow missing" }

    $testClipId = "qa-pool-clip"
    $poolPatch = Test-PostJson "$Base/api/media-pool/workflow" @{
        project_id = $newId
        current_clip_id = $testClipId
        selected_clip_ids = @($testClipId)
        mark_in_sec = 1.5
        mark_out_sec = 10.0
    } '"workflow"' "POST /api/media-pool/workflow"
    if ($poolPatch.workflow.current_clip_id -ne $testClipId) { throw "FAIL: workflow current_clip_id not persisted" }
    if ($poolPatch.workflow.selected_clip_ids -notcontains $testClipId) { throw "FAIL: workflow selection not persisted" }

    $poolReload = Test-GetJson "$Base/api/media-pool/clips?project_id=$([uri]::EscapeDataString($newId))" '"workflow"' "GET /api/media-pool/clips (workflow reload)"
    if ($poolReload.workflow.current_clip_id -ne $testClipId) { throw "FAIL: workflow reload current_clip_id mismatch" }
    if ($poolReload.workflow.selected_clip_ids -notcontains $testClipId) { throw "FAIL: workflow reload selection mismatch" }

    Test-PostJson "$Base/api/media-pool/transcript" @{
        project_id = $newId
        clip_id = $testClipId
        status = "pending"
        transcript = @{ text = "" }
    } '"status":"ok"' "POST /api/media-pool/transcript (pending)"

    $txComplete = Test-PostJson "$Base/api/media-pool/transcript" @{
        project_id = $newId
        clip_id = $testClipId
        status = "complete"
        transcript = @{
            text = "QA transcript line"
            segments = @(@{ start = 0.0; end = 1.2; text = "QA transcript line" })
        }
    } '"status":"ok"' "POST /api/media-pool/transcript (complete)"
    if ($txComplete.saved.status -ne "complete") { throw "FAIL: transcript save status not complete" }

    $txGet = Test-GetJson "$Base/api/media-pool/transcript?project_id=$([uri]::EscapeDataString($newId))&clip_id=$([uri]::EscapeDataString($testClipId))" '"transcript"' "GET /api/media-pool/transcript"
    if ($txGet.transcript.text -ne "QA transcript line") { throw "FAIL: transcript text mismatch after save" }
    Write-Host "OK: media_pool workflow + transcript round-trip"

    $beforeDelete = Test-GetJson "$Base/api/projects" '"projects"' "GET /api/projects (before delete)"
    $countBeforeDelete = @($beforeDelete.projects).Count

    $deleted = Test-PostJson "$Base/api/projects/delete" @{
        project_ids = @($newId)
    } '"projects"' "POST /api/projects/delete"
    if ($deleted.removed -notcontains $newId) { throw "FAIL: project not deleted" }
    if (@($deleted.projects).Count -ne ($countBeforeDelete - 1)) {
        throw "FAIL: delete response project count mismatch"
    }

    $afterDelete = Test-GetJson "$Base/api/projects" '"projects"' "GET /api/projects (after delete)"
    if (@($afterDelete.projects).Count -ne ($countBeforeDelete - 1)) {
        throw "FAIL: project index count after delete"
    }
    if ($afterDelete.projects | Where-Object { $_.project_id -eq $newId }) {
        throw "FAIL: deleted project still listed in index"
    }
    Write-Host "OK: Project tab delete regression"

    if ($bootstrapProjectId) {
        $deletedBootstrap = Test-PostJson "$Base/api/projects/delete" @{
            project_ids = @($bootstrapProjectId)
        } '"projects"' "POST /api/projects/delete (bootstrap)"
        if ($deletedBootstrap.removed -notcontains $bootstrapProjectId) { throw "FAIL: bootstrap project not deleted" }
    }

    Write-Host ""
    Write-Host "All host integration tests passed (project tab + ingest + media_pool + sdk_demo + story flow)."
}
finally {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    if (Test-Path $ProjectsRoot) {
        Remove-Item -LiteralPath $ProjectsRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
