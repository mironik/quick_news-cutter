/* Story tab — Plugin SDK v1 skeleton. Stanje samo iz SQLite snapshota. */
window.QNC = window.QNC || {};

(function (QNC) {
  if (!QNC.createPluginApp) {
    console.error('[Story] QNC.createPluginApp nije učitan (qnc-plugin-sdk.js)');
    return;
  }

  const runtime = { mounted: false };
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

  function mountComponents() {
    if (runtime.mounted) return;
    comp('story-tab-layout')?.mount?.(q('[data-qnc-panel="story-tab-layout"]'), PLUGIN_CTX);
    runtime.mounted = true;
  }

  function renderAll(ctx) {
    const db = snap(ctx);
    const open = hasProject(ctx);
    comp('story-tab-layout')?.update?.(
      q('[data-qnc-panel="story-tab-layout"]'),
      {
        project_id: db.project_id || ctx.projectId || '',
        selected_part_id: db.selected_part_id || '',
        selected_shot_id: db.selected_shot_id || '',
        part_count: db.summary?.part_count ?? (db.parts || []).length,
        duration_sec: db.summary?.duration_sec ?? 0,
        draft_updated_at: db.draft_updated_at,
        committed_at: db.committed_at,
        status_note: open
          ? 'Story skeleton — stanje iz projektne baze (SQLite).'
          : 'Prvo otvori projekt na Project tabu.',
      },
      PLUGIN_CTX
    );
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
      QNC.log('[Story] SDK skeleton spreman — čeka projekt', 'ok');
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
