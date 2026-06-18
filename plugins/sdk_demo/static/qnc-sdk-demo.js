/* SDK Demo tab — minimal Plugin SDK v1 golden path (in-memory Rust state). */
window.QNC = window.QNC || {};

(function (QNC) {
  if (!QNC.createPluginApp) {
    console.error('[SDK Demo] QNC.createPluginApp nije učitan (qnc-plugin-sdk.js)');
    return;
  }

  const runtime = { mounted: false, busy: false };
  const PLUGIN_CTX = { pluginId: 'sdk_demo' };

  function panel() {
    return document.getElementById('panel-sdk-demo');
  }

  function q(selector) {
    return (panel() || document).querySelector(selector);
  }

  function comp(id) {
    return QNC.components?.get?.(id);
  }

  function snap(ctx) {
    return ctx.store.get('sdk_demo.state') || {};
  }

  function hasProject(ctx) {
    return !!String(ctx.projectId || '').trim();
  }

  async function writeAndReload(ctx, actionId, body) {
    await ctx.action(actionId, { project_id: ctx.projectId, ...(body || {}) });
    return ctx.store.reload('sdk_demo.state');
  }

  function mountComponents() {
    if (runtime.mounted) return;
    comp('sdk-demo-panel')?.mount?.(q('[data-qnc-panel="sdk-demo-panel"]'), PLUGIN_CTX);
    runtime.mounted = true;
  }

  function renderAll(ctx) {
    const db = snap(ctx);
    const open = hasProject(ctx);
    comp('sdk-demo-panel')?.update?.(
      q('[data-qnc-panel="sdk-demo-panel"]'),
      {
        counter: db.counter ?? 0,
        project_id: db.project_id || ctx.projectId || '',
        persistence: db.persistence || 'in_memory_demo',
        updated_at: db.updated_at || '—',
        busy: runtime.busy,
        status_note: open
          ? 'Stanje je u Rust hostu (in_memory_demo). Restart hosta resetira brojač.'
          : 'Otvori projekt na Project tabu da koristiš SDK Demo.',
      },
      PLUGIN_CTX
    );
  }

  async function runIncrement(ctx, step) {
    if (!hasProject(ctx)) {
      ctx.setStatus('SDK Demo: prvo otvori projekt.', 'err');
      return;
    }
    if (runtime.busy) return;
    runtime.busy = true;
    renderAll(ctx);
    try {
      await writeAndReload(ctx, 'sdk_demo.increment', { step: step || 1 });
      renderAll(ctx);
      ctx.setStatus('SDK Demo: counter +' + (step || 1), 'ok');
    } catch (e) {
      ctx.setStatus('SDK Demo: ' + e.message, 'err');
    } finally {
      runtime.busy = false;
      renderAll(ctx);
    }
  }

  async function runReset(ctx) {
    if (!hasProject(ctx)) {
      ctx.setStatus('SDK Demo: prvo otvori projekt.', 'err');
      return;
    }
    if (runtime.busy) return;
    runtime.busy = true;
    renderAll(ctx);
    try {
      await writeAndReload(ctx, 'sdk_demo.reset', {});
      renderAll(ctx);
      ctx.setStatus('SDK Demo: reset.', 'ok');
    } catch (e) {
      ctx.setStatus('SDK Demo: ' + e.message, 'err');
    } finally {
      runtime.busy = false;
      renderAll(ctx);
    }
  }

  const app = QNC.createPluginApp({
    pluginId: 'sdk_demo',
    tabId: 'sdk_demo',
    apiNamespace: '/api/sdk-demo',
    snapshots: ['sdk_demo.state'],
    snapshotLoaders: {
      'sdk_demo.state': { path: '/api/sdk-demo/state', projectScoped: true },
    },
    listens: ['project:changed'],
  });

  app.lifecycle({
    onInit(ctx) {
      mountComponents();

      ctx.on('sdk_demo.increment', async (ev) => {
        const step = Number(ev.payload?.step) || 1;
        await runIncrement(ctx, step);
      });

      ctx.on('sdk_demo.reset', async () => {
        await runReset(ctx);
      });

      QNC.log('[SDK Demo] modul spreman — uključi tab u Modules ako treba', 'ok');
    },

    async onShow(ctx) {
      if (!hasProject(ctx)) {
        ctx.setStatus('SDK Demo: prvo otvori projekt na Project tabu.', 'err');
        renderAll(ctx);
        return;
      }
      try {
        await ctx.store.reload('sdk_demo.state');
        renderAll(ctx);
      } catch (e) {
        ctx.setStatus('SDK Demo: ' + e.message, 'err');
      }
    },

    onDestroy(ctx) {
      runtime.mounted = false;
      ctx.teardown();
    },
  });

  app.register();
})(window.QNC);
