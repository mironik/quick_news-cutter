#!/usr/bin/env bash
# QNC v2 — component-first shell (port 8001, ne dira v1 na 8000)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
export PYTHONPATH="${ROOT}:${PYTHONPATH:-}"
export QNC_APP_VERSION=v2
export QNC_API_PORT="${QNC_API_PORT:-8001}"

echo "=== Quick News Cutter v2 ==="
echo "Radni direktorij: $ROOT"
echo "v1 ostaje na :8000 — v2 koristi :8001"

if ! command -v python3 >/dev/null 2>&1; then
  echo "GREŠKA: python3 nije instaliran." >&2
  exit 1
fi

if ! python3 -c "import fastapi, uvicorn" 2>/dev/null; then
  echo "GREŠKA: pip install -r requirements-core.txt" >&2
  exit 1
fi

if ! python3 -c "import server" 2>/dev/null; then
  echo "GREŠKA: import server ne prolazi:" >&2
  python3 -c "import server" 2>&1 || true
  exit 1
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo "Pokrećem: http://${IP:-127.0.0.1}:${QNC_API_PORT}/app"
exec python3 -m uvicorn server:app --host 0.0.0.0 --port "${QNC_API_PORT}"
