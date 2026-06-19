/* Story tab — Plugin SDK v1 orchestrator. Stanje samo iz SQLite snapshota. */
window.QNC = window.QNC || {};

(function (QNC) {
  if (!QNC.createPluginApp) {
    console.error('[Story] QNC.createPluginApp nije učitan (qnc-plugin-sdk.js)');
    return;
  }

  const runtime = { mounted: false, busy: false };
  const PLUGIN_CTX = { pluginId: 'story' };

  function panel() {
    return document.getElementById('panel-storyboard');
  }

  function q(selector) {
    return (panel() || document).querySelector(selector);
  }

  function comp(id) {
    return QNC.components?.get?.(id);
  }

  function snap(ctx) {
    return ctx.store.get('story.state') || {};
  }

  function hasProject(ctx) {
    return !!String(ctx.projectId || '').trim();
  }

  function storyModel(ctx) {
    const db = snap(ctx);
    const open = hasProject(ctx);
    return {
      project_id: db.project_id || ctx.projectId || '',
      selected_part_id: db.selected_part_id || '',
      selected_shot_id: db.selected_shot_id || '',
      parts: Array.isArray(db.parts) ? db.parts : [],
      part_count: db.summary?.part_count ?? (Array.isArray(db.parts) ? db.parts.length : 0),
      duration_sec: db.summary?.duration_sec ?? 0,
      draft_updated_at: db.draft_updated_at,
      committed_at: db.committed_at,
      busy: runtime.busy,
      status_note: open
        ? 'Story — dijelovi u projektnoj bazi (SQLite).'
        : 'Prvo otvori projekt na Project tabu.',
    };
  }

  async function writeAndReload(ctx, actionId, body) {
    await ctx.action(actionId, { project_id: ctx.projectId, ...(body || {}) });
    return ctx.store.reload('story.state');
  }

  function mountComponents() {
    comp('story-tab-layout')?.mount?.(q('[data-qnc-panel="story-tab-layout"]'), PLUGIN_CTX);
    comp('story-toolbar')?.mount?.(q('[data-qnc-panel="story-toolbar"]'), PLUGIN_CTX);
    comp('story-parts-list')?.mount?.(q('[data-qnc-panel="story-parts-list"]'), PLUGIN_CTX);
    comp('story-part-editor')?.mount?.(q('[data-qnc-panel="story-part-editor"]'), PLUGIN_CTX);
    runtime.mounted = true;
  }

  function ensureMounted() {
    if (!q('[data-qnc-panel="story-tab-layout"]')) return;
    if (runtime.mounted) return;
    mountComponents();
  }

  function renderAll(ctx) {
    const model = storyModel(ctx);
    comp('story-tab-layout')?.update?.(q('[data-qnc-panel="story-tab-layout"]'), model, PLUGIN_CTX);
    comp('story-toolbar')?.update?.(q('[data-qnc-panel="story-toolbar"]'), model, PLUGIN_CTX);
    comp('story-parts-list')?.update?.(q('[data-qnc-panel="story-parts-list"]'), model, PLUGIN_CTX);
    comp('story-part-editor')?.update?.(q('[data-qnc-panel="story-part-editor"]'), model, PLUGIN_CTX);
  }

  async function runMutation(ctx, actionId, body) {
    if (!hasProject(ctx)) {
      ctx.setStatus('Story: prvo otvori projekt.', 'err');
      return;
    }
    if (runtime.busy) return;
    runtime.busy = true;
    renderAll(ctx);
    try {
      await writeAndReload(ctx, actionId, body);
      renderAll(ctx);
    } catch (e) {
      ctx.setStatus('Story: ' + e.message, 'err');
    } finally {
      runtime.busy = false;
      renderAll(ctx);
    }
  }

  const app = QNC.createPluginApp({
    pluginId: 'story',
    tabId: 'storyboard',
    apiNamespace: '/api/story',
    snapshots: ['story.state'],
    snapshotLoaders: {
      'story.state': { path: '/api/story/state', projectScoped: true },
    },
    listens: ['project:changed'],
  });

  app.lifecycle({
    onInit(ctx) {
      mountComponents();

      ctx.onShell('project:changed', () => {
        ctx.store.invalidate('story.state');
      });

      ctx.on('story.part.create', async (ev) => {
        const kind = String(ev.payload?.kind || 'tonovi').trim();
        await runMutation(ctx, 'story.part.create', { kind });
      });

      ctx.on('story.part.update', async (ev) => {
        const partId = String(ev.payload?.part_id || '').trim();
        if (!partId) return;
        await runMutation(ctx, 'story.part.update', {
          part_id: partId,
          title: ev.payload?.title,
          text: ev.payload?.text,
          kind: ev.payload?.kind,
        });
      });

      ctx.on('story.part.delete', async (ev) => {
        const db = snap(ctx);
        const partId = String(ev.payload?.part_id || db.selected_part_id || '').trim();
        if (!partId) return;
        await runMutation(ctx, 'story.part.delete', { part_id: partId });
      });

      ctx.on('story.part.reorder', async (ev) => {
        const db = snap(ctx);
        const partId = String(ev.payload?.part_id || db.selected_part_id || '').trim();
        const direction = String(ev.payload?.direction || '').trim();
        if (!partId || !direction) return;
        await runMutation(ctx, 'story.part.reorder', { part_id: partId, direction });
      });

      ctx.on('story.part.select', async (ev) => {
        const partId = String(ev.payload?.part_id || '').trim();
        if (!partId) return;
        await runMutation(ctx, 'story.part.select', { part_id: partId });
      });

      QNC.log('[Story] SDK parts CRUD spreman', 'ok');
    },

    async onShow(ctx) {
      if (!QNC.shell?.footerHasTab?.('storyboard')) {
        ctx.setStatus('Prvo otvori projekt na Project tabu.', 'err');
        renderAll(ctx);
        return;
      }
      if (!hasProject(ctx)) {
        ctx.setStatus('Prvo otvori projekt na Project tabu.', 'err');
        renderAll(ctx);
        return;
      }
      ensureMounted();
      try {
        await ctx.store.reload('story.state');
        renderAll(ctx);
      } catch (e) {
        ctx.setStatus('Story: ' + e.message, 'err');
      }
    },

    onDestroy(ctx) {
      runtime.mounted = false;
      ctx.teardown();
    },
  });

  app.register();
})(window.QNC);
