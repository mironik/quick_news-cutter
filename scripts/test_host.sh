#!/usr/bin/env bash
# Integration test — Rust qnc-host (Shell API v1)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST_BIN="${ROOT}/qnc-host/target/release/qnc-host"
PORT="${QNC_API_PORT:-18081}"
BASE="http://127.0.0.1:${PORT}"
export QNC_ROOT="${ROOT}"
export QNC_API_PORT="${PORT}"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "OK: $*"; }

if [[ ! -x "${HOST_BIN}" ]]; then
  echo "Building qnc-host..."
  (cd "${ROOT}/qnc-host" && cargo build --release)
fi

"${HOST_BIN}" &
PID=$!
trap 'kill ${PID} 2>/dev/null || true' EXIT
sleep 0.4

curl -sf "${BASE}/api/health" | grep -q '"ok"' || fail "health"
pass "GET /api/health"

RUNTIME="$(curl -sf "${BASE}/api/shell/runtime")"
echo "${RUNTIME}" | grep -q '"shell_api_version":1' || fail "shell_api_version"
echo "${RUNTIME}" | grep -q '"deployment":"portable"' || fail "deployment portable"
echo "${RUNTIME}" | grep -q 'design_editor' || fail "design_editor capability"
pass "GET /api/shell/runtime"

curl -sf "${BASE}/api/design-tools/status" | grep -q '"mode":"open"' || fail "design status"
pass "GET /api/design-tools/status"

TABS="$(curl -sf "${BASE}/api/shell/tabs")"
echo "${TABS}" | grep -q '"project"' || fail "project tab"
echo "${TABS}" | grep -q '"ingest"' || fail "ingest tab"
echo "${TABS}" | grep -q '"design-tools"' || fail "design-tools tab"
pass "GET /api/shell/tabs"

curl -sf "${BASE}/api/shell/components" | grep -q 'shell-plugin-tab' || fail "shell-plugin-tab component"
curl -sf "${BASE}/api/shell/components" | grep -q 'filmstrip-viewer' || fail "components"
pass "GET /api/shell/components"

curl -sf "${BASE}/app" | grep -q 'qnc-plugin-panels' || fail "/app html"
pass "GET /app"

curl -sf "${BASE}/app/shell/app.js" | grep -q 'boot' || fail "app shell mount"
pass "GET /app/shell/app.js"

curl -sf "${BASE}/app/components/registry.json" | grep -q 'shell-plugin-tab' || fail "shell-plugin-tab in registry"
curl -sf "${BASE}/app/components/registry.json" | grep -q 'ingest-clip-grid' || fail "ingest-clip-grid in registry"
curl -sf "${BASE}/app/components/registry.json" | grep -q 'filmstrip-viewer' || fail "app components mount"
pass "GET /app/components/registry.json"

curl -sf "${BASE}/app/components/shell-plugin-tab/component.html" | grep -q 'shell-plugin-tab' || fail "shell-plugin-tab html"
pass "GET /app/components/shell-plugin-tab/component.html"

curl -sf -X POST "${BASE}/api/modules/design-tools/enable" \
  -H 'Content-Type: application/json' \
  -d '{"enabled":false}' | grep -q '"enabled":false' || fail "disable design-tools"
TABS_OFF="$(curl -sf "${BASE}/api/shell/tabs")"
echo "${TABS_OFF}" | grep -q '"design-tools"' && fail "design-tools still visible after disable"
curl -sf -X POST "${BASE}/api/modules/design-tools/enable" \
  -H 'Content-Type: application/json' \
  -d '{"enabled":true}' >/dev/null
pass "POST /api/modules/design-tools/enable"

CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/modules/project/enable" \
  -H 'Content-Type: application/json' \
  -d '{"enabled":false}')"
[[ "${CODE}" == "403" ]] || fail "project disable expected 403 got ${CODE}"
pass "project not removable (403)"

INGEST="$(curl -sf "${BASE}/api/ingest/state?project_id=default")"
echo "${INGEST}" | grep -q '"status":"ok"' || fail "ingest state"
echo "${INGEST}" | grep -q '"clips"' || fail "ingest clips"
pass "GET /api/ingest/state"

curl -sf -X POST "${BASE}/api/ingest/selection/select-all" \
  -H 'Content-Type: application/json' \
  -d '{"project_id":"default"}' | grep -q '"selected_clip_ids"' || fail "ingest select-all"
pass "POST /api/ingest/selection/select-all"

curl -sf -X POST "${BASE}/api/ingest/discover" \
  -H 'Content-Type: application/json' \
  -d '{"project_id":"default"}' | grep -q '"clips"' || fail "ingest discover"
pass "POST /api/ingest/discover"

curl -sf "${BASE}/plugins/ingest/static/qnc-ingest.js" | grep -q 'syncFromDb' || fail "ingest orchestrator"
pass "GET /plugins/ingest/static/qnc-ingest.js"

echo ""
echo "All host integration tests passed."
