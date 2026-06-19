# QNC v2 — upute za agenta (obavezno)

For agent execution rules, git hygiene, runtime data cleanup, and stash safety, see [docs/agent-workflow.md](docs/agent-workflow.md).

## Prije bilo kakvog koda

1. Provjeri **workspace root** — mora biti developer `quick_news_cutter` na **Windows / macOS / Linux**.
2. Ako si na Jetsonu, edge serveru ili pogrešnom folderu → **stani** i reci korisniku da otvori pravi projekt.
3. **Ne** predlaži `scp` s Jetsona. **Ne** piši na putanje tipa `/home/mironik/...` u kodu.

## Produkt

- **Rust `qnc-host`** = jedini server i dev runtime.
- **Python legacy stack uklonjen** iz repoa (FastAPI server, `shell/*.py`, pytest). Ne vraćati u aktivni path.
- **Windows:** **nikad Python** — ni dev, ni test, ni runtime. Sve u Rust hostu.
- **Multiplatform** — bez CUDA/Jetson defaulta.

## Fokus platforma (Win / Linux / macOS)

- **Razvoj:** primarno Windows; kod mora biti kompatibilan s **Linux** i **macOS** bez posebnih forkova.
- **Runtime:** svaki OS builda **svoj** `qnc-host` binary (`cargo build --release`). Ne kopirati `.exe` / binary s drugog stroja.
- **UI** (`app/`, `plugins/`, `data/`) je zajednički; platforma je host + native dialogs.
- **Rust:** OS-specifično samo uz `cfg(windows)` / `cfg(not(windows))` (npr. `shell_dialog.rs`). Zajednički kod bez hardcodiranih putanja (`C:\...`, `/home/...`).
- **Test na ovom stroju:** Windows `.\test.ps1` — PowerShell + Rust host, bez Pythona.
- **Jetson** = aarch64 Linux referenca / kasniji AI — **nije** četvrti produkt target; core ne ovisi o njemu.

## Arhitektura (dogovoreno)

```
quick_news_cutter/
  app/           ← UI (shell, shared, components, design)
  plugins/       ← moduli (orchestrator + backend), BEZ UI komponenti unutra
  qnc-host/      ← Rust host
  data/          ← runtime
```

Redoslijed: Shell → **app komponente** → plugin moduli. Design add-on = samo `plugins/design-tools` (+ Rust `qnc-host/src/design.rs`).

## Princip: jednom kodiraš, koristiš svugdje

**Komponenta** (`app/components/<id>/`) = jedan put — HTML, CSS, `component.js`, contract u `registry.json`.  
**Plugin** (`plugins/<id>/`) = samo **orchestrator** (`qnc-*.js`) + manifest; **ne** duplicira UI.

| Sloj | Gdje | Mijenja se po modulu? |
|------|------|------------------------|
| Komponenta | `app/components/` | **ne** — ista u ingest, project, budućim tabovima |
| Layout | `shell-plugin-tab`, `workspace-split`, `ingest-workspace`, … | **ne** — slaganje slotova |
| Orchestrator | `plugins/*/static/qnc-*.js` | **da** — bus, API pozivi, sync iz baze |
| Backend | `qnc-host/src/<modul>/` | **da** — SQLite, rute |

Pravila:

1. **Novi UI panel** → nova komponenta u `app/components/`, ne HTML u `plugins/`.
2. **Ista komponenta u više konteksta** → `embeddable: true` + orchestrator šalje `update(data)` iz baze.
3. **Stanje** → baza (SQLite preko Rust API-ja); orchestrator samo čita/zapisuje API, ne drži poslovni cache.
4. **Dogadjaji** → komponenta emituje na bus (`ingest.discover`, `clip.toggle`); orchestrator mapira na `/api/...`.
5. **Zajedničke komponente** (`filmstrip-viewer`, `template-picker`, …) — isti princip, bez forkova po pluginu.

Primjer ingest: `ingest-clip-grid` je isti widget; `qnc-ingest.js` je jedini ingest-specific kod.

## Pokretanje: uvijek preko Project taba

1. **Boot** → samo **Project** tab u footeru (`showProjectOnly`).
2. Korisnik **otvara ili kreira projekt** na Project pluginu → `POST /api/projects/open` (baza) → `project:opened` → **shell** učita `GET /api/projects/{id}/workspace` i prebaci na prvi workflow tab (npr. Ingest).
3. **Ingest / ingest worker** koristi `active_project_id` postavljen pri otvaranju projekta — ne samostalni boot bez Project taba.
4. Direktan `#/ingest` ili klik na ingest **bez** otvorenog projekta → redirect na Project + poruka.

Orchestrator ingest taba učitava podatke na `onShow` kad je ingest u footeru (workspace iz baze).

## Zabranjeno bez eksplicitnog „kreni”

- Velike migracije direktorija
- Novi feature rush (npr. Project API) prije dogovorenog koraka
- Jetson/v1 prepisivanje

## Jetson / v1

Samo **referenca za čitanje** — ne write target. Template ide u `reference/` na developer stroju ako treba.
