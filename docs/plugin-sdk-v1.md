# QNC Plugin SDK v1

## Status

| Item | Detail |
|------|--------|
| **Phase** | A — experimental but usable in production ingest tab |
| **Script** | `/app/shell/qnc-plugin-sdk.js` (loaded before plugin `entry_js`, after `qnc-tab-registry.js`) |
| **Source of truth** | **SQLite / API snapshots** — not component-local state, not helper JSON files, not orchestrator JS objects. See [architecture-db-first.md](architecture-db-first.md) |
| **Reference implementation** | [`plugins/ingest/static/qnc-ingest.js`](../plugins/ingest/static/qnc-ingest.js) + [`plugins/ingest/plugin.json`](../plugins/ingest/plugin.json) |
| **Minimal runnable reference** | [`plugins/sdk_demo`](../plugins/sdk_demo/) — single panel, project DB-backed minimal SDK reference (`sdk_demo_state` in `qnc_project.db`); tab disabled by default (`enabled: false`). **How to clone:** [create-plugin-from-sdk-demo.md](create-plugin-from-sdk-demo.md) |
| **Partial reference** | [`plugins/media_pool`](../plugins/media_pool/) — SDK lifecycle + DB workflow snapshots; orchestrator may keep **technical handles only** (see [architecture-db-first.md](architecture-db-first.md) §2.2) |
| **Not SDK yet** | `design-tools` — legacy orchestrators; do not migrate them in the same pass |
| **SDK v1 (project)** | [`plugins/project`](../plugins/project/) — multi-snapshot orchestrator; collab session id is a technical handle only |

SDK v1 helps plugin authors build tabs as **lego compositions** of `app/components`, with a thin orchestrator file. The host does not enforce manifest schemas beyond loading tabs; the SDK reads `plugin.json` `state.snapshots` and `backend.actions` when present.

---

## Architecture rules

- **Components:** model in, user-intent events out (`QNC.componentBus`).
- **Orchestrator:** listen → call **own** plugin API → reload snapshot → re-render.
- **No** direct plugin-to-plugin JS imports or API calls.
- **Cross-tab coordination:** shell bus (`QNC.bus`), shared project id, DB reads, snapshot invalidation.

`ctx.store` is a **cache** of GET snapshots only. After `ctx.action` writes, always `ctx.store.reload` before render. Do not mirror snapshot fields in parallel JS objects — see [architecture-db-first.md](architecture-db-first.md).

See also [architecture-db-first.md](architecture-db-first.md), [developer-components.md](developer-components.md), [create-plugin-from-sdk-demo.md](create-plugin-from-sdk-demo.md) for cloning sdk_demo into a new tab, and [shell-spec-v1.md](shell-spec-v1.md) for shell behavior.

---

## Golden path checklist

Use this order when building a new SDK v1 tab:

1. **Create plugin folder** — `plugins/<name>/` with `static/qnc-<name>.js`, optional CSS, and `plugin.json`.
2. **Define `plugin.json` with `sdk_version: 1`** — marks intent; host does not block older tabs without it.
3. **Declare `api_namespace`** — e.g. `/api/ingest`; used by SDK path resolution and documentation.
4. **Declare `panel_html` and `uses_components`** — layout HTML plus every component id the tab embeds (must exist in `app/components/registry.json`).
5. **Declare `state.snapshots`** — snapshot keys, HTTP method, path, and `query` (typically `project_id`).
6. **Declare `backend.actions`** — action ids, methods, paths, and `reads`/`writes` hints for `ctx.action`.
7. **Implement Rust API routes** — host module under `qnc-host/src/<module>/`; routes match manifest paths.
8. **Implement JS orchestrator with `QNC.createPluginApp`** — register lifecycle hooks, then `app.register()`.
9. **Mount components once, update from snapshots** — `mount` in `onInit`; `update` in `render(ctx)` after each reload.
10. **Handle component events with `ctx.on`** — map `registry.json` `contract.events` actions to handlers.
11. **Call `ctx.action` for writes** — POST (and declared) actions that mutate DB state.
12. **Reload `ctx.store` snapshot after writes** — then re-render; UI reflects DB truth.

---

## Quick start (primary pattern — manual mount/update)

This matches the **ingest** reference: mount once, update on every render, `writeAndReload` for mutations.

```javascript
(function (QNC) {
  if (!QNC.createPluginApp) {
    console.error('[MyPlugin] QNC.createPluginApp nije učitan (qnc-plugin-sdk.js)');
    return;
  }

  const PLUGIN_CTX = { pluginId: 'ingest' };
  let mounted = false;

  function panel() {
    return document.getElementById('panel-ingest');
  }

  function q(selector) {
    return (panel() || document).querySelector(selector);
  }

  function comp(id) {
    return QNC.components?.get?.(id);
  }

  function snap(ctx) {
    return ctx.store.get('ingest.state') || {};
  }

  async function writeAndReload(ctx, actionId, body) {
    await ctx.action(actionId, { project_id: ctx.projectId, ...(body || {}) });
    return ctx.store.reload('ingest.state');
  }

  function renderAll(ctx) {
    const db = snap(ctx);
    comp('ingest-clip-grid')?.update?.(
      q('[data-qnc-panel="ingest-clip-grid"]'),
      {
        clips: db.clips || [],
        selected_clip_ids: db.selected_clip_ids || [],
        features: { selection: true, footer: true },
      },
      PLUGIN_CTX
    );
    // ... update other panels similarly
  }

  const app = QNC.createPluginApp({
    pluginId: 'ingest',
    tabId: 'ingest',
    apiNamespace: '/api/ingest',
    snapshots: ['ingest.state'],
    snapshotLoaders: {
      'ingest.state': { path: '/api/ingest/state', projectScoped: true },
    },
  });

  app.lifecycle({
    onInit(ctx) {
      if (!mounted) {
        comp('ingest-clip-grid')?.mount?.(q('[data-qnc-panel="ingest-clip-grid"]'), PLUGIN_CTX);
        mounted = true;
      }

      ctx.on('clip.toggle', async (ev) => {
        await writeAndReload(ctx, 'clip.toggle', { clip_id: ev.payload?.clip_id || '' });
        renderAll(ctx);
      });
      ctx.on('ingest.discover', async () => {
        await writeAndReload(ctx, 'ingest.discover', {
          source_id: snap(ctx).active_source_id || '',
        });
        renderAll(ctx);
      });
    },

    async onShow(ctx) {
      await ctx.store.reload('ingest.state');
      renderAll(ctx);
    },

    onDestroy(ctx) {
      mounted = false;
      ctx.teardown();
    },
  });

  app.register();
})(window.QNC);
```

**Flow:** `onShow` → `store.reload` → `renderAll` reads `store.get` → user clicks component → `ctx.on` → `writeAndReload` (`action` + `reload`) → `renderAll` again.

---

## Alternative: `bindComponent` for simple panels

For a single-component tab, SDK `bindComponent` avoids manual mount/update bookkeeping:

```javascript
function render(ctx) {
  const snap = ctx.store.get('ingest.state');
  ctx.bindComponent('ingest-clip-grid', '[data-qnc-panel="ingest-clip-grid"]', {
    mapModel: () => ({
      clips: snap?.clips || [],
      selected_clip_ids: snap?.selected_clip_ids || [],
    }),
  });
}
```

**When to use:** one or two panels, simple `mapModel`, no custom mount flags. **When not to use:** multi-panel tabs like ingest or media pool — prefer manual mount/update (Pattern A below).

---

## `pluginId` vs `tabId`

| Field | Used for |
|-------|----------|
| **`pluginId`** | Plugin identity, `QNC.componentBus` routing, `bindComponent` / mount context `{ pluginId }` |
| **`tabId`** | Tab registration, `QNC.tabs`, manifest lookup via `QNC.pluginLoader.manifest(tabId)`, panel hash `#/<tabId>` |

They are **often the same** (`ingest` / `ingest`) but **not always**.

**Example — media pool:**

| Field | Value |
|-------|-------|
| `plugin_id` | `media_pool` |
| `tab_id` | `pool` |

```javascript
QNC.createPluginApp({
  pluginId: 'media_pool',  // bus + component context
  tabId: 'pool',             // footer tab + manifest lookup
  // ...
});
```

**Warning:** mixing these breaks manifest action resolution, tab switching, and component event routing. Use `pluginId` in `PLUGIN_CTX` and `ctx.on`; use `tabId` only where the shell expects tab id (e.g. `QNC.switchTab('pool')`).

---

## Snapshot path rules

Snapshots are loaded by `ctx.store` from HTTP GET (by default).

| Path form | Example | Resolves to |
|-----------|---------|-------------|
| **Absolute** | `/api/ingest/state` | Used as-is (must start with `/api/` or be full path) |
| **Relative to `apiNamespace`** | `/clips` with `apiNamespace: '/api/media-pool'` | `/api/media-pool/clips` |

**`projectScoped: true`** (in `snapshotLoaders`) adds `?project_id=<active>` from `ctx.projectId`. If project id is empty, load throws — handle in `onShow` (e.g. redirect to project tab).

**Manifest vs config overlap:**

- `plugin.json` → `state.snapshots[]` — documents contract; SDK can read method/path/query/`pick`.
- `createPluginApp({ snapshotLoaders: { ... } })` — explicit loader map in orchestrator.

Authors may use **both** (ingest declares manifest snapshots and `snapshotLoaders`) or **one**. Prefer **one clear source**:

- **Manifest-only** when paths are stable and shared with tooling/docs.
- **`snapshotLoaders` only** when orchestrator needs overrides (relative paths, custom `pick`).

If both exist, `snapshotLoaders` entries override manifest defs for the same key.

Optional manifest field **`pick`**: extract nested property from JSON response (e.g. `"pick": "clips"`).

---

## Store cookbook

| API | Purpose |
|-----|---------|
| `await ctx.store.load(key)` | Return cached snapshot or fetch if missing/invalid |
| `await ctx.store.reload(key)` | Always fetch; update cache; notify subscribers |
| `ctx.store.get(key)` | Synchronous read of cached value (after load/reload) |
| `ctx.store.invalidate(key)` | Mark stale; next `onShow` calls `refreshInvalidated` |
| `await ctx.store.refreshInvalidated()` | Reload all invalidated keys (SDK calls this in `onShow`) |
| `ctx.store.subscribe(key, fn)` | React to cache updates (optional; most tabs just re-render) |

**`writeAndReload` pattern** (recommended after mutations):

```javascript
async function writeAndReload(ctx, actionId, body) {
  await ctx.action(actionId, { project_id: ctx.projectId, ...(body || {}) });
  return ctx.store.reload('ingest.state');
}
```

Always re-render after `reload`. Do not treat component internal state as authoritative for clips, selection, or project data.

---

## Action cookbook

### `ctx.action(actionId, body)`

- Resolves action from `plugin.json` → `backend.actions` (or top-level `actions`).
- Default method **POST**; body sent as JSON.
- When `method` is **GET**, `body` is merged into the URL as **query parameters** (via `mergeQuery`); **no request body** is sent.
- `null`, `undefined`, and empty string values are omitted from the query string.
- Existing query params on `spec.path` are preserved.
- Auto-injects `project_id` when action `reads`/`writes` contain `"project"`.
- Use for **writes** (POST) and declared **read** actions (GET).

```javascript
await ctx.action('ingest.discover', { source_id: 'local' });
await ctx.action('clip.toggle', { clip_id: 'abc123' });
await ctx.action('filmstrip.build', { clip_id: 'abc123', frames: 10 });
await ctx.action('transcript.get', { project_id: ctx.projectId, clip_id: 'qa-pool-clip' });
// → GET /api/media-pool/transcript?project_id=...&clip_id=qa-pool-clip
```

### `ctx.api.get` / `ctx.api.post`

- Paths prefixed with `apiNamespace` when relative.
- **`ctx.api.get(path, query)`** — ad-hoc GET when you need query params **without** a declared `backend.actions` entry (same merge rules as GET `ctx.action`).

```javascript
const data = await ctx.api.get('/clips', { project_id: ctx.projectId });
```

Media pool reads clips via `ctx.store.reload('media_pool.clips')`. Use store snapshots for all authoritative list reads; use declared GET actions (e.g. `transcript.get`) or `ctx.api.get` for one-off reads. Do not treat local JS caches as workflow state.

### GET actions and query parameters

Declared actions with `"method": "GET"` call:

```text
GET {apiNamespace}{path}?{body as query}
```

Example (`plugins/media_pool/plugin.json`):

```json
{ "action": "transcript.get", "method": "GET", "path": "/transcript" }
```

```javascript
const data = await ctx.action('transcript.get', {
  project_id: ctx.projectId,
  clip_id: 'qa-pool-clip',
});
// GET /api/media-pool/transcript?project_id=...&clip_id=qa-pool-clip
```

Prefer **`ctx.store.reload(snapshotKey)`** for list/index reads already declared under `state.snapshots`. Use **GET `ctx.action`** for manifest-declared single-resource reads (e.g. transcript by `clip_id`).

---

## Bus and lifecycle

### Component bus — `ctx.on(eventName, handler)`

- Listens on `QNC.componentBus` scoped to **`pluginId`**.
- Event names match component `contract.events[].action` in `registry.json` (e.g. `clip.toggle`, `ingest.discover`).
- Handler receives event object with `payload` (and optionally `root` / `target` from emit).

### Shell bus — `ctx.onShell(eventName, handler)`

- Listens on `QNC.bus` for cross-tab / shell lifecycle (e.g. `project:changed`, `project:deleting`).
- Use for custom reload logic beyond auto-invalidation.

### `listens: ['project:changed', ...]` in `createPluginApp`

When declared, SDK **automatically** registers `onShell` handlers that **`invalidate` all configured `snapshots`** on those events. On next **`onShow`**, `refreshInvalidated` reloads them.

**Manual `onShell`** (ingest pattern) is also valid — e.g. reload immediately, show status, poll thumbnails. Use intentionally when auto-invalidate is not enough.

### Lifecycle hooks

| Hook | Typical use |
|------|-------------|
| `onInit(ctx)` | Mount components once; register `ctx.on` / `ctx.onShell` |
| `onShow(ctx)` | `store.reload` + render; start polling if needed |
| `onHide(ctx)` | Stop timers, release media |
| `onDestroy(ctx)` | `ctx.teardown()` — disposes bus listeners and component bindings |

Call **`ctx.teardown()`** in `onDestroy` to unregister listeners installed via `ctx.on` / `ctx.onShell` / `bindComponent`.

---

## Component binding patterns

### Pattern A — Manual mount/update (recommended for multi-panel tabs)

Reference: **ingest**.

```javascript
// once
comp('ingest-toolbar')?.mount?.(q('[data-qnc-panel="ingest-toolbar"]'), { pluginId: 'ingest' });

// every render after snapshot reload
comp('ingest-toolbar')?.update?.(q('[data-qnc-panel="ingest-toolbar"]'), { clip_count: n }, { pluginId: 'ingest' });
```

Read component **inputs** and **events** from `app/components/registry.json` → `contract`.

### Pattern B — `ctx.bindComponent` (simple / single-panel)

See [Alternative: bindComponent](#alternative-bindcomponent-for-simple-panels) above. SDK manages mount/update/dispose on teardown.

### Pattern C — `data-qnc-action` bridge (media pool)

Reference: **media_pool** uses `QNC.installComponentActions(panelRoot(), 'media_pool')` so HTML elements with `data-qnc-action="..."` emit component bus events without per-button JS.

Available in shell (`qnc-core.js`); less documented than Patterns A/B. Useful for declarative toolbars; still requires `ctx.on` handlers in orchestrator.

---

## SDK adoption guidance

Migrate one plugin at a time. Legacy orchestrators without SDK continue to work.

| Phase | Goal |
|-------|------|
| **1 — Lifecycle + actions** | Replace `QNC.tabs.register` with `createPluginApp`; use `ctx.action` for writes |
| **2 — Store snapshots** | Move API reads into `ctx.store.load/reload`; remove duplicate fetch helpers |
| **3 — bindComponent** | Simplify single-panel bindings where manual mount/update is noisy |

**DB-first rule:** SQLite / Rust API is the only source of truth. `ctx.store` is a short-lived cache of API snapshots. Plugin JS, component JS, DOM, and runtime JSON objects must not own workflow state.

**Allowed locally (technical handles only):** timer handles, `AbortController`, DOM/media element refs, listener cleanup, in-flight request dedup / live-stream session tokens.

**Forbidden locally (workflow — DB/API only):** transcript results/status, ASR state, row status, selected/current clip, marks, active virtual shot, filmstrip status. Recompute or reload from snapshots; do not mirror these in parallel JS objects.

| Plugin | SDK status |
|--------|------------|
| `ingest` | Full production reference |
| `sdk_demo` | Minimal golden-path demo — `sdk_demo_state` in `qnc_project.db` (project DB-backed; enable via Modules API) |
| `media_pool` | SDK v1 — workflow via SQLite snapshots; technical handles only in orchestrator JS (see architecture doc) |
| `project` | SDK v1 multi-snapshot orchestrator |
| `design-tools` | Not SDK — standalone add-on (`non_production`) |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `QNC.createPluginApp nije učitan` | SDK script missing or load order wrong | Ensure `qnc-plugin-sdk.js` loads before plugin `entry_js` (host `app_html.rs`) |
| Snapshot load throws `project_id nije postavljen` | No active project | Guard in `onShow`; prompt user to open project tab first |
| Snapshot empty / 404 | Wrong path or namespace | Check absolute vs relative path rules; verify Rust route exists |
| Component not visible | Not in `uses_components` or not mounted | Add to `plugin.json`; call `mount` once on correct `[data-qnc-panel="..."]` selector |
| Component not in registry | Missing `registry.json` entry | Add component under `app/components/` and register |
| `Nepoznata action: ...` | Action id not in `plugin.json` `backend.actions` | Declare action with matching `action` string |
| GET action returns wrong / empty data | Missing query keys in `body`, wrong action id, or no active project | Pass required params (e.g. `clip_id`, `project_id`); verify `backend.actions` entry; for list reads prefer `ctx.store.reload` |
| Shell event does not refresh tab | `listens` not configured and no manual `onShell` | Add `listens: ['project:changed']` or handle in `onInit` |
| Component events ignored | Wrong `pluginId` in emit vs listen | Match `PLUGIN_CTX.pluginId` with `createPluginApp({ pluginId })` |
| Tab does not switch / wrong manifest | `tabId` vs `plugin_id` mismatch | Use `tabId: 'pool'` for media pool footer tab, not `media_pool` |
| `bindComponent` silent failure | Selector not found | Check `panel_html` layout; use `onMissing` callback in options |

---

## Public API reference

| API | Description |
|-----|-------------|
| `QNC.createPluginApp(config)` | Factory; config: `pluginId`, `tabId`, `apiNamespace`, `snapshots`, `listens`, `snapshotLoaders` |
| `app.lifecycle(hooks)` | `onInit`, `onShow`, `onHide`, `onDestroy` |
| `app.register()` | Registers tab via `QNC.tabs.register` |
| `ctx.api.get/post(path, …)` | HTTP with namespace prefix |
| `ctx.action(id, body)` | Manifest-declared actions (POST body JSON; GET body → query string, no body sent) |
| `ctx.bindComponent(id, root, { mapModel, mountCtx, onMissing })` | Mount/update component |
| `ctx.store.load/reload/get/invalidate/subscribe/refreshInvalidated` | Snapshot cache |
| `ctx.on(event, fn)` | Component bus (`pluginId` scope) |
| `ctx.onShell(event, fn)` | Shell bus |
| `ctx.emitShell(event, payload)` | Emit shell event |
| `ctx.projectId` | Active project id from shell |
| `ctx.setStatus(msg, kind)` | Status bar |
| `ctx.teardown()` | Bus + binding cleanup |

---

## Manifest fields the SDK reads (v1)

Host does not validate these in v1; SDK uses them when present:

- `state.snapshots[]` — `key`, `method`, `path`, `query`, optional `pick`
- `backend.actions[]` — `action`, `method`, `path`, `reads`, `writes`
- `api_namespace` — fallback namespace if not passed in `createPluginApp`

Informational only in v1 (document for future tooling): `consumes`, `events`, `provides`, `jobs`.

---

## References

- [developer-components.md](developer-components.md) — component contracts, registry, lego rules
- [shell-spec-v1.md](shell-spec-v1.md) — shell tabs, buses, project context
- Reference code: `plugins/ingest/static/qnc-ingest.js`, `plugins/ingest/plugin.json`
- Minimal demo: `plugins/sdk_demo/static/qnc-sdk-demo.js`, `plugins/sdk_demo/plugin.json`
- Clone guide: [create-plugin-from-sdk-demo.md](create-plugin-from-sdk-demo.md)
- Partial reference: `plugins/media_pool/static/qnc-media-pool.js`, `plugins/media_pool/plugin.json`
