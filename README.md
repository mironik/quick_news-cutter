# Quick News Cutter v2

Čista **component-first** linija razvoja. **QNC_v1** ostaje netaknut na portu **8000**.

## Gdje se razvija aplikacija

| | |
|--|--|
| **Kod** | **Tvoj PC / Mac / Linux** — `Projects/quick_news_cutter` |
| **Jetson / v1** | samo **referenca za čitanje** — ne write target |
| **AI** | **kasnije** (uključujući Jetson AI); core bez AI sada |

Pravila: [docs/development-policy.md](docs/development-policy.md) · DB-first: [docs/architecture-db-first.md](docs/architecture-db-first.md)

## Testiranje (Windows — bez Pythona)

```powershell
.\test.ps1         # Windows
```

Vodič: [docs/testing-multiplatform.md](docs/testing-multiplatform.md)

Svaki stroj **sam builda** `qnc-host` — ne kopiraj binary s Jetsona.

## Pokretanje (Windows — bez Pythona)

```powershell
cd C:\Users\<user>\Projects\quick_news_cutter
.\run_host.bat
```

Instalacija Rusta (jednom): [https://rustup.rs](https://rustup.rs)

GUI: **http://127.0.0.1:8001/app** (default bind localhost; LAN: `QNC_BIND_HOST=0.0.0.0`)

Detalji: [qnc-host/README.md](qnc-host/README.md)

## Legacy Python dev server (referenca — ne produkt)

| | |
|--|--|
| **Produkt runtime** | Rust `qnc-host` — `run_host.bat` / `run_host.sh` |
| **Python stack** | samo **dev referenca** za usporedbu / stari workflow |

Datoteke u repou koje **ne koristi** Windows produkt:

- `server.py`, `server_app_web.py` — FastAPI shell (djelomično zastarjeli API)
- `run_server.sh` — pokreće `uvicorn server:app` na `:8001`, bind `0.0.0.0`
- `requirements-core.txt`, `requirements-server.txt`, `requirements-ai.txt`
- `shell/` — Python registry/loader (paralelan starijem modelu)

**Pravilo:** novi backend ide u `qnc-host/` (Rust). Python datoteke **ne brišemo** bez posebnog odobrenja; ne pokrećemo ih na Windowsu. Vidi [docs/development-policy.md](docs/development-policy.md).

Na Linux/macOS/Jetson (samo ako treba usporediti staro ponašanje):

```bash
pip install -r requirements-core.txt
./run_server.sh
```

Za svakodnevni rad uvijek: `./run_host.sh` (Rust).

Projektni folderi nisu unutar aplikacije. Project template može definirati `storage.projects_root` za projekte koji se kreiraju iz tog templatea. Ako template nema putanju, koristi se default:

- Windows: `%LOCALAPPDATA%\QNC\Projects`
- macOS: `~/Library/Application Support/QNC/Projects`
- Linux: `$XDG_DATA_HOME/qnc/projects` ili `~/.local/share/qnc/projects`

Za shared/multiuser produkciju `QNC_PROJECTS_ROOT` je globalni fallback, a konkretne novinarske/studio putanje postavljaju se u project templateu. Export putanja je također template postavka (`export.directory`).

## Arhitektura

**Shell ugovor (korak 1):** [docs/shell-spec-v1.md](docs/shell-spec-v1.md) — `shell_api_version: 1`

```
QNC_v2/quick_news_cutter/
  qnc-host/              ← Rust shell (produkt na laptopu)
  shell/                 ← tab_loader, component_registry, module_registry, runtime_db
  app/                   ← cijela aplikacijska UI ljuska
    shell/               ← boot, core JS, tab footer
    shared/              ← theme, qnc-ui CSS, contract
    components/          ← sve UI komponente + registry.json
    assets/              ← ikone, fontovi
  plugins/
    project/             ← Project modul (orchestrator + Rust API storage)
      storage/
      static/
    …                    ← budući moduli (ingest, media_pool, …)
  data/                  ← shell_runtime.db, project_store.db, projects.json
```

### Pravilo: shell vs app vs plugin modul

| Sloj | Odgovornost | Ne smije sadržavati |
|------|-------------|---------------------|
| **Shell (host)** | boot API, tab manifesti, mount `/app/*` | Project API, UI komponente |
| **App UI** | shell JS, shared stilovi, sve komponente | poslovnu logiku modula |
| **Plugin modul** | vlastiti `/api/...`, storage, tanak orchestrator JS | UI komponente u `plugins/` |

### Komponente (app/components)

Sve embeddable komponente žive u `app/components/<id>/`. Plugin ih referencira preko `panel_html` i `uses_components`, ne drži vlastiti `components/` folder.
Developerski ugovor i javni core set: [docs/developer-components.md](docs/developer-components.md).

| Primjer ID | Putanja |
|------------|---------|
| `filmstrip-viewer` | `/app/components/filmstrip-viewer/` |
| `project-list` | `/app/components/project-list/` |
| `workspace-split` | `/app/components/workspace-split/` |

## Multiplatform

QNC radi na **Windows, macOS i Linux** — bilo koje računalo.  
**Jetson** (ili drugi NVIDIA edge) je samo **jedna od opcija**, kao i CUDA, lokalni AI na Macu ili Studio server u mreži.

| Sloj | Default (svi OS) | Opcija (env / plugin) |
|------|------------------|------------------------|
| Shell + project + komponente | ✓ | — |
| Lokalni ingest (folder) | ✓ | — |
| Remote ingest | — | `QNC_INGEST_REMOTE=1` |
| AI (ASR, …) | — | `QNC_AI_ENABLED=1` + plugin |
| HW video encode | — | `QNC_HW_ENCODE=1` + plugin |

**Runtime** (`GET /api/shell/runtime`):

- `deployment` — default `portable`; eksplicitno `QNC_DEPLOYMENT=studio|jetson|…` samo ako želiš label
- `hardware_hints` — informativno (npr. `nvidia_tegra`), **ne mijenja** ponašanje
- `data/shell_config.json` — port, mrežni preseti (primjer: `shell_config.network-presets.example.json`)

```powershell
# Više hostova u mreži (opcionalno)
cp data/shell_config.network-presets.example.json data/shell_config.json
```

AI i GPU se **ne učitavaju** pri startu.

## API

| Endpoint | Vlasnik | Opis |
|----------|---------|------|
| `GET /api/health` | shell | Health check |
| `GET /api/shell/runtime` | shell | Platforma, port, capabilities, mreža |
| `GET /api/shell/diagnostics` | shell | Bind, putanje, učitani plugini, manifest greške |
| `GET /api/shell/components` | shell | Globalni component catalog |
| Plugin SDK v1 | shell JS | `QNC.createPluginApp` — vidi [docs/plugin-sdk-v1.md](docs/plugin-sdk-v1.md) |
| `POST /api/shell/components/sync` | shell | Ručna sinkronizacija iz plugina |
| `GET /api/modules` | shell | Module enable/disable |
| `GET/POST /api/projects*` | **project plugin** | Projekti, templatei, settings |

## Sljedeći koraci

1. Dodati `media_pool` plugin u v2 s `portable: true` filmstrip exportom
2. Migrirati Story/OFF tabove kao orkestratore (bez DOM-a)
3. Ukloniti duplikate iz v1 kad v2 pokrije workflow
