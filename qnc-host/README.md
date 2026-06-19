# QNC Host (Rust)

Multiplatform **shell** server — Shell API v1, bez Pythona.

## Zahtjevi

- [Rust](https://rustup.rs) (rustup)

## Pokretanje (Linux / macOS)

```bash
cd /path/to/QNC_v2/quick_news_cutter
chmod +x run_host.sh
./run_host.sh
```

GUI: **http://127.0.0.1:8001/app**

## Windows

```powershell
cd quick_news_cutter
.\run_host.bat
```

Ili: `.\run_host.ps1` / `.\test.ps1` za integracijski test. **Python nije potreban.**

## Linux / macOS (ručno)

## Env

| Varijabla | Default | Opis |
|-----------|---------|------|
| `QNC_ROOT` | auto-detect | Korijen s `app/shell/`, `plugins/` |
| `QNC_API_PORT` | `8001` | Port (ili `data/shell_config.json`) |
| `QNC_BIND_HOST` | `127.0.0.1` | HTTP bind; `0.0.0.0` za LAN |
| `QNC_PROJECTS_ROOT` | OS user data dir | Globalni fallback za projektne foldere ako template nema `storage.projects_root` |
| `QNC_APP_VERSION` | `host-0.1` | Vidljivo u runtime API |
| `QNC_DEPLOYMENT` | `portable` | Label okruženja |

## Shell API (v1)

- `GET /api/health`
- `GET /api/shell/runtime`
- `GET /api/shell/diagnostics`
- `GET /api/shell/tabs`
- `GET /api/shell/components`
- `POST /api/shell/components/sync` (MVP no-op)
- `GET /api/modules`
- `POST /api/modules/{id}/enable`
- `GET/POST /api/projects`, `/api/projects/ui-state`, `/api/projects/from-template`, …
- `GET/POST /api/project-templates`
- `GET /api/projects/{id}/settings`, `/workspace`
- `POST /api/collab/session`, `/api/collab/touch`
- `POST /api/shell/pick-directory`

SQLite: `data/project_store.db` (globalni indeks/templatei i fizički `project_dir`), `<template storage.projects_root>/<id>/qnc_project.db` po projektu. Ako template nema `storage.projects_root`, koristi se `QNC_PROJECTS_ROOT` ili OS default.

Default projektni root:

- Windows: `%LOCALAPPDATA%\QNC\Projects`
- macOS: `~/Library/Application Support/QNC/Projects`
- Linux: `$XDG_DATA_HOME/qnc/projects` ili `~/.local/share/qnc/projects`

Za shared/multiuser instalaciju `QNC_PROJECTS_ROOT` ostaje fallback, a konkretne novinarske/studio lokacije se spremaju u project template. Export lokacija je template postavka `export.directory`.

Statički: `/app/shell`, `/app/shared`, `/app/components`, `/plugins`

## Izvor hosta (`qnc-host/src/`)

| Modul | Uloga |
|-------|--------|
| `main.rs` | Boot, shell rute, static serve |
| `routes/design_tools.rs` | HTTP rute za Design add-on |
| `project/`, `ingest/`, `media_pool/` | Plugin API routeri |
| `design.rs` | Design poslovna logika (bez HTTP handlera) |
| `tabs.rs` | Učitavanje `plugin.json` + manifest dijagnostika |

Test (Windows): `.\test.ps1` — `cargo check`, release build, integracija uključujući `/api/shell/diagnostics`.

## Što još nije u hostu

- AI, FFmpeg jobs
- Portable component sync iz plugina

Vidi [docs/shell-spec-v1.md](../docs/shell-spec-v1.md) i [docs/development-policy.md](../docs/development-policy.md).
