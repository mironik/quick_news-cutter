# QNC DB-first architecture contract

**Status:** ratificirano (Phase 0)  
**Obvezno za:** sve izmjene u `QNC_v2/quick_news_cutter`  
**Supersedes:** implicitne “ephemeral/local state” iznimke u plugin JS-u

---

## 1. Core rule

**QNC is database-first from beginning to end.**

| Layer | Source of truth |
|-------|-----------------|
| Application / workflow / project / plugin state | **SQLite** via **Rust API** |
| UI | **Projections** of API snapshots — never the owner |
| `ctx.store` | **Short-lived cache** of GET snapshots — not truth |
| JSON on disk | **Declarative manifests and static config only** |

If a value affects workflow and is not in SQLite, **it is not application state**.

---

## 2. Allowed vs forbidden

### 2.1 SQLite / Rust API

| Allowed | Forbidden |
|---------|-----------|
| Read/write workflow state only through Axum routes | Business logic in plugin JS that mutates workflow without API |
| One global DB (`data/project_store.db`) + one per-project DB (`qnc_project.db`) | Separate plugin-local JSON/JS stores as truth |
| Snapshots returned as JSON from GET routes | Helper JSON files used at runtime for workflow |

### 2.2 Plugin orchestrator JS

| Allowed | Forbidden |
|---------|-----------|
| `QNC.createPluginApp`, lifecycle hooks | Workflow fields in `pool`, `state`, or ad-hoc globals |
| `ctx.on` → `ctx.action` → `ctx.store.reload` → render | Skipping reload after write |
| Map snapshot → `component.update(model)` | `fetch` / `QNC.api` for workflow reads that bypass declared snapshots (except one-off shell/system calls) |
| Shell bus for **invalidation** (`project:changed`) | Direct calls/imports between plugins; exposing mutable globals (`QNC.mediaPool = pool`) |

### 2.3 Component JS

| Allowed | Forbidden |
|---------|-----------|
| `mount` / `update(model)` from orchestrator | Owning business/workflow state |
| Emit user intent via `QNC.componentBus` | Calling plugin APIs, SQLite, or other tabs |
| Technical mount flags (`dataset.qncComponentMounted`) | Treating DOM as truth after navigation |

### 2.4 DOM

| Allowed | Forbidden |
|---------|-----------|
| Render model fields | Read checkbox/input/class as authoritative state after tab switch or reload |
| Emit click/change as **intent** | Persist workflow in attributes without DB round-trip |

### 2.5 JSON files

| Allowed (A — declarative) | Forbidden (B — runtime state) |
|---------------------------|-------------------------------|
| `plugins/*/plugin.json` | ~~`data/shell_module_state.json`~~ (migrated Phase 1 → `project_store.db`) |
| `app/components/registry.json`, `component.json` | `data/projects.json` as live mirror (export/migration only) |
| `plugins/project/storage/system_seed.json` | `data/design_overrides/*.json` for lab/theme runtime |
| `app/shell/keyboard-shortcuts.json` (defaults) | Any host-written JSON holding workflow state long-term |
| Design-tools demo/build-profile JSON under `plugins/design-tools/` | Using demo JSON in production workflow paths |

**Rule:** JSON may describe *what exists* (manifest). JSON must not *be* the running workflow.

---

## 3. Mandatory orchestrator flow

Every plugin tab must follow this loop for workflow data:

```
component event (user intent)
  → ctx.on handler
  → ctx.action(actionId, body)     // write path
  → Rust API
  → SQLite write
  → ctx.store.reload(snapshotKey)  // read path
  → render from snapshot (component.update)
```

Read-only tab show:

```
onShow
  → ctx.store.reload(snapshotKey)
  → render from snapshot
```

**No step may be skipped** for workflow-affecting operations.

---

## 4. Database ownership (current)

| Database | Scope | Owns |
|----------|-------|------|
| `data/project_store.db` | Global | Projects, active project, templates, collab users/sessions, project tab UI state (`app_settings`) |
| `{project_dir}/qnc_project.db` | Per project | Project settings, workflow steps, **ingest** assets/meta, **media_pool** pool_clips & virtual_shots, **filmstrip** tables |

Modules enable flags live in **`project_store.db` → `module_state`** (Phase 1). Legacy `data/shell_module_state.json` is imported once on host start and renamed to `.migrated`.

---

## 5. ctx.store contract

`ctx.store` is implemented in `app/shell/qnc-plugin-sdk.js`.

| API | Role |
|-----|------|
| `load` / `reload` | Fetch snapshot from Rust GET route; update in-memory cache |
| `get` | Read cache for **render only** — after load/reload |
| `invalidate` | Mark stale; refresh on next `onShow` |
| `subscribe` | Optional; most tabs re-render after reload |

**Requirements:**

1. After every **write** (`ctx.action`), call `ctx.store.reload` for affected snapshot keys.
2. Render functions read workflow fields from `ctx.store.get(...)`, not from parallel JS objects.
3. Cache may be discarded on tab hide/destroy without losing workflow (SQLite retains truth).

---

## 6. Known gaps (audit snapshot — do not treat as policy)

These violate this contract until migrated (see roadmap in audit / Phase 1–5):

| Area | Current | Target |
|------|---------|--------|
| Module enable | ~~`data/shell_module_state.json`~~ → **`project_store.db` `module_state`** (Phase 1 ✓) |
| media_pool | ~~`pool.selected`, marks, player context~~ → **Phase 3 ✓** `media_pool_workflow` in `qnc_project.db` |
| project tab | ~~Large `state` object cache~~ → **Phase 2 ✓** SDK snapshots (`project.index`, `project.templates`, `project.modules`, `project.ui`) |
| design-tools | **`non_production: true`** — theme/lab in `data/design_overrides/*.json` (isolated add-on, not workflow) |
| sdk_demo | ~~In-memory Rust map~~ → **Phase 4 ✓** `sdk_demo_state` in `qnc_project.db` (demo template only) |
| Shell | ~~`QNC.activeProjectId` in JS~~ → **Phase 4 ✓** boot sync from `GET /api/projects`; projection only |
| Keyboard shortcuts | ~~`localStorage`~~ → **Phase 4 ✓** `app_settings.keyboard_shortcuts_user` |

New features **must not** add rows to this gap list.

---

## 7. Cross-plugin communication

| Allowed | Forbidden |
|---------|-----------|
| Read shared data via **SQLite** (each plugin’s own API routes) | Import another plugin’s JS |
| Shell bus: `project:changed`, `project:deleting`, `project:opened` as **signals** | `QNC.mediaPool`, shared mutable globals |
| Shared `project_id` from shell context | Plugin A calling Plugin B HTTP namespace directly from orchestrator |

---

## 8. Reference plugins (strict reading)

| Plugin | DB-first status |
|--------|-----------------|
| **ingest** | **Reference** — workflow in SQLite; SDK snapshot + reload |
| **sdk_demo** | Minimal SDK template — counter in `qnc_project.db` (`sdk_demo_state`); tab disabled by default |
| **media_pool** | **SDK v1** — clips + workflow in snapshot (`media_pool_workflow` table); ephemeral: transcripts cache, ASR rowNote, player element |
| **project** | **SDK v1** — index/templates/modules/ui via `ctx.store`; ephemeral runtime only (`openingId`, collab session handle) |
| **design-tools** | **Non-production add-on** — JSON overrides only; not DB-first workflow |

---

## 9. Compliance checklist (for PRs)

- [ ] Workflow read comes from API snapshot (via `ctx.store` or equivalent reload-after-fetch).
- [ ] Workflow write goes through Rust API → SQLite.
- [ ] `ctx.store.reload` after every write action.
- [ ] No new runtime JSON state files.
- [ ] No new plugin-to-plugin JS coupling.
- [ ] Components receive model; emit events only.
- [ ] No DOM-as-state for workflow fields.
- [ ] DB schema changes documented and approved separately.

---

## 10. Related documents

- [development-policy.md](development-policy.md) — laptop-first, Rust host
- [shell-spec-v1.md](shell-spec-v1.md) — shell API, storage boundaries
- [plugin-sdk-v1.md](plugin-sdk-v1.md) — orchestrator golden path
- [developer-components.md](developer-components.md) — component contracts
- [create-plugin-from-sdk-demo.md](create-plugin-from-sdk-demo.md) — minimal plugin scaffold

---

*Izmjene ovog ugovora samo kroz reviziju ovog dokumenta i sinkronizaciju povezanih specifikacija.*
