# QNC Shell Specification v1

**Status:** ratificirano (korak 1)  
**Verzija ugovora:** `shell_api_version: 1`  
**Referentni host:** QNC v2 (Python + FastAPI) — budući Rust host mora implementirati isti ugovor.

---

## 1. Svrha

Shell ljuska je **jedina stabilna jedinica** QNC aplikacije. Sve ostalo (Project, ingest, AI, …) su **plugini** koji se smiju mijenjati bez lomljenja jezgre.

Ovaj dokument definira:

- što shell radi i **ne smije** raditi;
- redoslijed boota;
- stabilne HTTP API-je;
- manifest plugina i pravila komponenti;
- granice storagea;
- semver pravila za kompatibilnost.

**Izvan scopea v1:** poslovna logika tabova, FFmpeg, AI, installer, Rust port.

---

## 2. Granice odgovornosti

### 2.1 Shell radi

| Područje | Opis |
|----------|------|
| Boot | lifespan, učitavanje plugina, sync globalnih komponenti |
| UI host | `/app` HTML, footer tabovi, panel host `#qnc-plugin-panels` |
| Tab manifesti | sken `plugins/*/plugin.json`, sort, enable/disable |
| Komponente | resolve `data-qnc-component`, global registry |
| Runtime | OS info, port, capabilities (bez teških probe) |
| Module prefs | SQLite (`module_state` in global DB) — **target**; see §10 |
| Statički mount | `/static`, `/plugins`, `/components` |
| Plugin backend loader | `plugins/*/backend/routes.py` → `register(app)` |
| Process log modal | zajednički UI za log (shell chrome) |
| Health | `/api/health` |

### 2.2 Shell ne radi

- Projekti, templatei, ingest, media pool, story, export, AI
- Poslovni SQLite (`project_store.db`, per-project `qnc_project.db`) — owned by plugins via Rust host, not shell JS
- Hardver-specifične pretpostavke u shellu (Jetson/CUDA kao default)
- Ručna gradnja plugin DOM-a izvan component resolve mehanizma

Ako nova funkcionalnost zahtijeva izmjenu `server.py` ili `APP_HTML` izvan tablice u §4 — **to je bug dizajna**, ne feature.

---

## 3. Struktura referentnog hosta (informativno)

```
quick_news_cutter/
  server.py                 # lifespan + register_app_routes + register_plugin_backends
  server_app_web.py         # /app, /api/shell/*, /api/modules, static mount
  shell/
    tab_loader.py
    module_registry.py      # shell_runtime.db samo
    runtime_db.py
    component_registry.py
    platform.py
    plugin_backend.py
  static/
    app.js                  # boot orchestrator
    qnc-core.js             # API, bus, shell chrome
    shell/qnc-shell.js      # tab footer
  components/               # global portable komponente
  plugins/                  # tab plugini (jedan folder = jedan plugin)
  data/
    shell_config.json
    shell_runtime.db
```

Plugin **ne smije** očekivati datoteke izvan svog `plugins/<id>/` i shell `data/` ugovora.

---

## 4. Boot redoslijed (obavezno)

Redoslijed mora biti isti u svim host implementacijama:

```
1. Host start
   └─ lifespan: bootstrap_builtin_components()
   └─ lifespan: sync_all_plugins()

2. Klijent učita /app
   └─ qnc-core.js, qnc-shell.js, qnc-bus.js, app.js

3. app.js boot()
   a. GET /api/shell/runtime     → QNC.runtime, presets, port
   b. GET /api/shell/tabs        → lista enabled tab manifesta
   c. GET /api/shell/components  → global component catalog
   d. Učitaj global component runtime JS (ako ima)
   e. Za svaki plugin (redom manifesta):
      - učitaj panel_html
      - resolve [data-qnc-component] (rekurzivno)
      - učitaj entry_css, entry_js
   f. QNC.shell.installTabs(plugins)
   g. initServerHostCombo(), refreshHealth(), bindTabs()
```

**Pravilo:** plugin `entry_js` se izvršava **nakon** što je njegov panel i komponente u DOM-u.

---

## 5. Shell API v1

Svi odgovori uključuju `"status": "ok"` osim grešaka HTTP.

### 5.1 `GET /api/health`

```json
{ "status": "ok" }
```

Koristi se za connectivity check (footer host combo).

### 5.2 `GET /api/shell/runtime`

```json
{
  "status": "ok",
  "shell_api_version": 1,
  "app_version": "v2",
  "deployment": "portable",
  "platform": {
    "system": "Linux",
    "release": "...",
    "machine": "aarch64",
    "python": "3.10.12"
  },
  "host": { "hostname": "..." },
  "api_port": 8001,
  "capabilities": {
    "core": true,
    "ingest_local": true,
    "ingest_remote_client": false,
    "ai_asr": false,
    "ai_gpu_encode": false,
    "deployment": "portable"
  },
  "network_presets": [
    { "label": "Studio", "host": "192.168.1.10" }
  ],
  "labels": { "server": "QNC server" }
}
```

- `shell_api_version` — **obavezno od implementacije koraka 2**
- `capabilities` — informativno; plugini ne smiju crashati ako je sve `false` osim `core`
- Teška detekcija (GPU, ASR) **nije** u shell API v1

### 5.3 `GET /api/shell/tabs`

```json
{
  "status": "ok",
  "tabs": [ /* plugin manifest objekti, enabled only */ ]
}
```

### 5.4 `GET /api/shell/components`

```json
{
  "status": "ok",
  "version": 1,
  "components": {
    "filmstrip-viewer": {
      "global_id": "filmstrip-viewer",
      "version": "1.1.0",
      "path": "/components/filmstrip-viewer/component.html",
      "assets": { "js": [...], "css": [...] }
    }
  }
}
```

### 5.5 `POST /api/shell/components/sync`

Ručna sinkronizacija portable komponenti iz plugin manifesta u `components/`.

```json
{ "status": "ok", "installed": ["filmstrip-viewer"] }
```

### 5.6 `GET /api/modules`

```json
{
  "status": "ok",
  "modules": [
    {
      "module_id": "project",
      "tab_id": "project",
      "label": "Project",
      "enabled": true,
      "system": true,
      "removable": false
    }
  ]
}
```

### 5.7 `POST /api/modules/{module_id}/enable`

Body: `{ "enabled": true }`  
Odgovor: `{ "status": "ok", "module": { ... } }`

Sistemski moduli (`removable: false`) ne smiju se isključiti — HTTP 403 ili ekvivalent.

---

## 6. Plugin manifest (`plugins/<id>/plugin.json`)

### 6.1 Obavezna polja

| Polje | Tip | Opis |
|-------|-----|------|
| `plugin_id` | string | Jedinstveni ID (folder name) |
| `tab_id` | string | ID taba u footeru (obično = plugin_id) |
| `label` | string | Prikaz u footeru |
| `entry_js` | string | URL (`/plugins/.../static/....js`) |
| `panel_html` | string | URL root panela (obično workspace component.html) |

### 6.2 Preporučena polja

| Polje | Tip | Opis |
|-------|-----|------|
| `entry_css` | string | Plugin CSS |
| `asset_version` | int/string | Cache bust za static |
| `priority` | int | Sort u footeru |
| `position` | `"first"` \| `"normal"` \| `"last"` | Fiksni rubni tabovi |
| `enabled` | bool | Default true |
| `system` | bool | Shell tretira kao core tab |
| `removable` | bool | Može li se disableati |
| `components` | array | Plugin-local komponente (vidi §7) |
| `backend.routes` | string | Relativno: `backend/routes.py` |

### 6.3 Primjer minimalnog plugina (shell-plugin-tab)

```json
{
  "plugin_id": "my-plugin",
  "tab_id": "my-plugin",
  "label": "My plugin",
  "priority": 100,
  "position": "normal",
  "entry_js": "/plugins/my-plugin/static/qnc-my-plugin.js",
  "asset_version": 1,
  "panel_html": "/app/components/shell-plugin-tab/component.html",
  "enabled": true,
  "uses_components": ["shell-plugin-tab"]
}
```

Plugin u `entry_js` montira layout u slot `content` (`resolveComponents`) i piše orchestrator.

Primjer (Project tab):

```json
{
  "plugin_id": "project",
  "panel_html": "/app/components/shell-plugin-tab/component.html",
  "uses_components": [
    "shell-plugin-tab",
    "workspace-split",
    "project-list",
    "project-template-settings"
  ],
  "entry_js": "/plugins/project/static/qnc-project.js"
}
```

### 6.4 Sort pravilo tabova

1. `position: first` ili `tab_id: project` → lijevo  
2. `position: last` ili `tab_id` in `preview`, `export` → desno  
3. Inače po `priority` asc, zatim `label` asc  

---

## 7. Komponente

### 7.1 Dva scopea

| Scope | ID format | Primjer | Put |
|-------|-----------|---------|-----|
| **Global (portable)** | `global_id` bez točke | `filmstrip-viewer` | `/components/<id>/` |
| **Plugin-local** | `<plugin_id>.<name>` | `project.editor` | `/plugins/<id>/components/` |

### 7.2 Embed u HTML

```html
<div data-qnc-component="project.editor"></div>
<div data-qnc-slot="project-list"
     data-qnc-component="project.project-list"></div>
<div data-qnc-component="filmstrip-viewer" data-qnc-variant="inline"></div>
```

**Resolve pravilo:**

1. Pronađi sve `[data-qnc-component]` u podstablu
2. Lookup: global catalog → plugin manifest
3. `fetch(path)` → zamijeni čvor s HTML sadržajem
4. Ponovi dok ima neresolved komponenti (komponente u komponentama)

Host **ne smije** imati hardcoded poznate `component_id` vrijednosti.

### 7.3 Global portable instalacija

Plugin u manifestu može deklarirati:

```json
{
  "global_id": "filmstrip-viewer",
  "portable": true,
  "version": "1.1.0",
  "package": "/plugins/media_pool/components/filmstrip-viewer"
}
```

Shell pri syncu instalira u `components/` **samo ako** nova verzija > postojeća. Nikad ne prepisuje stariju (zaštita paralelnih instalacija).

### 7.4 Component contract (preporuka za plugin autore)

Svaka komponenta u `plugin.json` može imati `contract`:

- `inputs` — što host/plugin šalje u UI
- `events` — što komponenta emitira na bus
- `slots` — ugniježđene komponente
- `requires_components` — ovisnosti

Shell ne validira contract u v1 — to je dokumentacija i budući SDK.

---

## 8. Plugin backend

Put: `plugins/<plugin_id>/backend/routes.py`

```python
def register(app: FastAPI) -> None:
    @app.get("/api/my-plugin/...")
    def ...:
        ...
```

- Loader dodaje `plugins/<id>/` na `sys.path`
- Plugin koristi vlastiti `storage/` paket
- **Zabranjeno:** import iz `shell/` osim javnog runtime API-ja (kasniji SDK)

Shell globalni `server.py` **ne smije** definirati plugin rute.

---

## 9. Frontend ugovor (plugin JS smije oslanjati se na)

| API | Opis |
|-----|------|
| `QNC.api(method, path, body?, timeout?)` | JSON fetch prema hostu |
| `QNC.componentBus.on / emit` | Eventi između komponenti |
| `QNC.emitComponent(...)` | Strukturirani component event |
| `QNC.resolveComponents(root)` | Re-resolve (plugin interno) |
| `QNC.shell.installTabs / applyWorkspace` | Tab footer |
| `QNC.switchTab(tab_id)` | Aktivacija panela |
| `QNC.setBox(msg, kind)` | Status bar |
| `QNC.getProjectId()` | **Deprecated u shellu** — project plugin može postaviti; shell samo drži placeholder |
| `QNC.runtime` | Objekt s `/api/shell/runtime` |

**Bus imena:** preporuka `<plugin_id>.<action>` npr. `project.open`.

---

## 10. Storage granice

**Policy:** [architecture-db-first.md](architecture-db-first.md) — SQLite is truth; JSON is declarative config only.

| Podaci | Lokacija (target / current) | Vlasnik |
|--------|----------------------------|---------|
| Module enable | `data/project_store.db` (`module_state` table) | shell |
| Shell config (port, presets) | `data/shell_config.json` (static config; minimal runtime patches) | shell |
| Global component registry | `app/components/registry.json` | shell |
| Project lista, templatei, UI state | `data/project_store.db` | **project plugin** (Rust) |
| Per-project workflow | `{project_dir}/qnc_project.db` | **plugin APIs** (ingest, media_pool, …) |
| Per-project files | `{projects_root}/{id}/` (proxy, thumbs, filmstrip JPEGs) | filesystem blobs; **metadata in SQLite** |

**Forbidden as workflow truth:** `data/projects.json` (export/migration mirror only), `data/design_overrides/*.json` for runtime lab/theme state, plugin JS objects (`pool`, `state`), DOM, `localStorage` for workflow.

Plugin **ne piše** u shell module storage. Shell **ne piše** u per-project business tables.

### 10.1 Implementation note (Rust host v2)

Module enable flags are stored in `project_store.db` (`module_state`). On first start after upgrade, `data/shell_module_state.json` (if present) is imported and renamed to `shell_module_state.json.migrated`.

---

## 11. UI chrome (shell HTML)

Fiksni elementi u `/app`:

- `#qnc-plugin-panels` — jedini mount za plugin panele
- `.qtab-footer-tabs` — tab gumbi (generira `qnc-shell.js`)
- `#qnc-server-host` — opcionalni server selector (multi-host setup)
- `#active-project-label` — chrome; tekst postavlja project plugin
- `#log-modal` — process log

Novi poslovni modali idu u **plugin komponente**, ne u `APP_HTML`.

---

## 12. Verzioniranje i kompatibilnost

### 12.1 `shell_api_version`

- Trenutno: **1**
- Minor host update: ista verzija, nova polja u JSON (plugini ignoriraju)
- Major: promjena boot redoslijeda, uklonjen endpoint, drugačiji resolve → `shell_api_version: 2`

### 12.2 Breaking promjene (zahtijevaju major)

- Uklanjanje ili preimenovanje `/api/shell/*` endpointa
- Promjena `data-qnc-component` resolve semantike
- Premještanje module DB iz shell storagea
- Obavezna nova polja u `plugin.json` bez defaulta

### 12.3 Non-breaking

- Novi capability ključevi u runtime
- Novi opcionalni manifest ključevi
- Nova globalna komponenta
- Novi plugin bez izmjene shella

---

## 13. Compliance checklist (korak 2)

Shell je **usklađen s v1** kad:

- [x] `GET /api/shell/runtime` vraća `shell_api_version: 1`
- [x] `server.py` nema plugin poslovnih ruta
- [x] `APP_HTML` nema plugin modale
- [x] Novi tab zahtijeva samo `plugins/<id>/` + `shell-plugin-tab` (ili composition panel)
- [x] Integration test: `shell-plugin-tab` u component registry
- [x] Integration test: disable modula sakrije tab
- [x] README upućuje na ovaj dokument kao izvor istine

---

## 14. Sljedeći koraci (izvan ovog dokumenta)

| Korak | Opis |
|-------|------|
| **2** | Implementacijska usklađenost v2 s ovim specifikacijama | **gotovo** |
| **3** | `shell-plugin-tab` komponenta | **gotovo** (`app/components/shell-plugin-tab/`) |
| **4** | Project plugin audit prema §7 |
| **5** | Capability spec (proširuje §5.2) |

---

*Dokument: `docs/shell-spec-v1.md` — izmjene shell ugovora samo kroz reviziju ovog fajla i bump `shell_api_version`.*
