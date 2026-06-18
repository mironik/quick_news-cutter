# QNC Plugin SDK v1

**Status:** introduced (Phase A)  
**Script:** `/app/shell/qnc-plugin-sdk.js`  
**Loaded:** before plugin `entry_js`, after `qnc-tab-registry.js`

## Purpose

Help plugin authors build tabs as **lego compositions** of `app/components`, with a small orchestrator file. Business state lives in **SQLite/API**, not in components or ad-hoc JS state.

## Rules (unchanged)

- Components: input model in, user-intent events out (`QNC.componentBus`).
- Orchestrator: listen → call **own** plugin API → reload snapshot → re-render.
- No direct plugin-to-plugin JS imports or API calls.
- Cross-tab coordination: shell bus (`QNC.bus`), shared project id, DB reads, declared invalidation.

## Quick start

```javascript
(function () {
  const app = QNC.createPluginApp({
    pluginId: 'ingest',
    tabId: 'ingest',
    apiNamespace: '/api/ingest',
    snapshots: ['ingest.state'],
    listens: ['project:changed'],
    snapshotLoaders: {
      'ingest.state': { path: '/api/ingest/state', projectScoped: true },
    },
  });

  app.lifecycle({
    async onInit(ctx) {
      ctx.on('ingest.discover', async () => {
        await ctx.action('ingest.discover', { source_id: ctx.store.get('ingest.state')?.active_source_id });
        await ctx.store.reload('ingest.state');
        render(ctx);
      });
    },
    async onShow(ctx) {
      await ctx.store.reload('ingest.state');
      render(ctx);
    },
    onDestroy(ctx) {
      ctx.teardown();
    },
  });

  function render(ctx) {
    const snap = ctx.store.get('ingest.state');
    ctx.bindComponent('ingest-clip-grid', '[data-qnc-panel="ingest-clip-grid"]', {
      mapModel: () => ({ clips: snap?.clips || [], selected_clip_ids: snap?.selected_clip_ids || [] }),
    });
  }

  app.register();
})();
```

## Public API

| API | Description |
|-----|-------------|
| `QNC.createPluginApp(config)` | Factory |
| `app.lifecycle(hooks)` | `onInit`, `onShow`, `onHide`, `onDestroy` |
| `app.register()` | Registers tab via `QNC.tabs.register` |
| `ctx.api.get/post(path, …)` | HTTP with namespace prefix |
| `ctx.action(id, body)` | Resolves `plugin.json` `backend.actions` |
| `ctx.bindComponent(id, root, { mapModel })` | Mount/update component |
| `ctx.store.load/reload/get/invalidate/subscribe` | Snapshot cache |
| `ctx.on(event, fn)` | Component bus for this plugin |
| `ctx.onShell(event, fn)` | Shell bus (declare in `listens`) |
| `ctx.emitShell(event, payload)` | Emit shell event |
| `ctx.projectId` | Active project id from shell |
| `ctx.setStatus(msg, kind)` | Status bar |
| `ctx.teardown()` | Bus + bindings cleanup |

## Manifest extensions (optional)

See design proposal — `provides`, `consumes`, `events`, `state.snapshots`, `actions` I/O schemas. Host does not enforce in v1; SDK reads `state.snapshots` and `backend.actions` when present.

## Migration

| Plugin | SDK | Notes |
|--------|-----|-------|
| `ingest` | ✓ | Reference orchestrator |
| `media_pool` | partial (WIP) | Lifecycle + API/actions; player UI state still local |
| `project` | — | Planned |

Existing orchestrators continue to work without SDK. Migrate one plugin at a time.

## References

- [developer-components.md](developer-components.md)
- [shell-spec-v1.md](shell-spec-v1.md)
