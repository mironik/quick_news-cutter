/* Ingest tab — Plugin SDK v1 orchestrator. Stanje samo u bazi; UI = snapshot. */
window.QNC = window.QNC || {};

(function (QNC) {
  if (!QNC.createPluginApp) {
    console.error('[Ingest] QNC.createPluginApp nije učitan (qnc-plugin-sdk.js)');
    return;
  }

  const runtime = {
    busy: false,
    thumbPollTimer: null,
    mounted: false,
  };

  const PLUGIN_CTX = { pluginId: 'ingest' };

  const GRID_FEATURES = {
    density: 'comfortable',
    duration: true,
    status: true,
    meta: true,
    selection: true,
    footer: true,
    empty: true,
    import_chip: false,
  };

  function panel() {
    return document.getElementById('panel-ingest');
  }

  function q(selector, root) {
    return (root || panel() || document).querySelector(selector);
  }

  function comp(id) {
    return QNC.components?.get?.(id);
  }

  function snap(ctx) {
    return ctx.store.get('ingest.state') || {};
  }

  function clips(ctx) {
    return snap(ctx).clips || [];
  }

  function selectedClipIds(ctx) {
    return (snap(ctx).selected_clip_ids || []).map(String);
  }

  function hasPendingThumbs(ctx) {
    return clips(ctx).some((c) => {
      const st = String(c.thumb_status || '').toLowerCase();
      return st === 'pending' || st === 'processing';
    });
  }

  function maybePollThumbnails(ctx) {
    if (!hasPendingThumbs(ctx)) {
      stopThumbPoll();
      return;
    }
    if (runtime.thumbPollTimer) return;
    runtime.thumbPollTimer = setInterval(() => {
      ctx.store.reload('ingest.state').then(() => renderAll(ctx)).catch(() => {});
      if (!hasPendingThumbs(ctx)) stopThumbPoll();
    }, 2000);
  }

  function stopThumbPoll() {
    if (runtime.thumbPollTimer) {
      clearInterval(runtime.thumbPollTimer);
      runtime.thumbPollTimer = null;
    }
  }

  async function writeAndReload(ctx, actionId, body) {
    await ctx.action(actionId, { project_id: ctx.projectId, ...(body || {}) });
    return ctx.store.reload('ingest.state');
  }

  function mountComponents() {
    if (runtime.mounted) return;
    comp('ingest-toolbar')?.mount?.(q('[data-qnc-panel="ingest-toolbar"]'), PLUGIN_CTX);
    comp('ingest-source-picker')?.mount?.(q('[data-qnc-panel="ingest-source-picker"]'), PLUGIN_CTX);
    comp('ingest-actions')?.mount?.(q('[data-qnc-panel="ingest-actions"]'), PLUGIN_CTX);
    comp('ingest-clip-grid')?.mount?.(q('[data-qnc-panel="ingest-clip-grid"]'), PLUGIN_CTX);
    runtime.mounted = true;
  }

  function renderAll(ctx) {
    const db = snap(ctx);
    const n = clips(ctx).length;
    const sel = selectedClipIds(ctx).length;

    comp('ingest-toolbar')?.update?.(
      q('[data-qnc-panel="ingest-toolbar"]'),
      {
        project_id: db.project_id || ctx.projectId,
        project_name: db.project_name || db.project_id || '',
        clip_count: n,
        selected_count: sel,
      },
      PLUGIN_CTX
    );

    comp('ingest-source-picker')?.update?.(
      q('[data-qnc-panel="ingest-source-picker"]'),
      {
        sources: db.sources || [],
        active_source_id: db.active_source_id || '',
        browse_path: db.browse_path || '',
      },
      PLUGIN_CTX
    );

    comp('ingest-actions')?.update?.(
      q('[data-qnc-panel="ingest-actions"]'),
      {
        busy: runtime.busy,
        clip_count: n,
        selected_count: sel,
        all_selected: n > 0 && sel >= n,
      },
      PLUGIN_CTX
    );

    comp('ingest-clip-grid')?.update?.(
      q('[data-qnc-panel="ingest-clip-grid"]'),
      {
        clips: clips(ctx),
        selected_clip_ids: selectedClipIds(ctx),
        features: GRID_FEATURES,
        status_text: n ? sel + ' od ' + n + ' odabrano' : 'Nema klipova — Otkrij materijal.',
      },
      PLUGIN_CTX
    );
  }

  function folderPicker() {
    return QNC.components?.get?.('folder-picker') || QNC.folderPicker || null;
  }

  async function toggleClip(ctx, clipId) {
    const id = String(clipId || '').trim();
    if (!id) return;
    try {
      await writeAndReload(ctx, 'clip.toggle', { clip_id: id });
      renderAll(ctx);
      maybePollThumbnails(ctx);
    } catch (e) {
      ctx.setStatus('Odabir: ' + e.message, 'err');
    }
  }

  async function selectAll(ctx) {
    try {
      await writeAndReload(ctx, 'ingest.select-all', {});
      renderAll(ctx);
    } catch (e) {
      ctx.setStatus('Odabir: ' + e.message, 'err');
    }
  }

  async function runDiscover(ctx) {
    if (runtime.busy) return;
    runtime.busy = true;
    renderAll(ctx);
    ctx.setStatus('Otkrivam materijal...', 'busy');
    try {
      const d = await writeAndReload(ctx, 'ingest.discover', {
        source_id: snap(ctx).active_source_id || '',
      });
      renderAll(ctx);
      maybePollThumbnails(ctx);
      const n = (d?.clips || []).length;
      ctx.setStatus(
        n ? 'Otkriveno ' + n + ' klipova.' : 'Nema klipova u mapi (mxf, mov, mp4…). Odaberi mapu.',
        n ? 'ok' : 'err'
      );
    } catch (e) {
      ctx.setStatus('Otkrij: ' + e.message, 'err');
    } finally {
      runtime.busy = false;
      renderAll(ctx);
    }
  }

  async function runImport(ctx) {
    if (runtime.busy) return;
    const ids = selectedClipIds(ctx);
    if (!ids.length) {
      ctx.setStatus('Odaberi klipove za uvoz.', 'err');
      return;
    }
    runtime.busy = true;
    renderAll(ctx);
    try {
      await writeAndReload(ctx, 'ingest.import', { clip_ids: ids });
      ctx.setStatus('Uvoz pokrenut u pozadini (' + ids.length + ' klipova).', 'ok');
      QNC.bus?.emit?.('ingest:import-queued', {
        project_id: ctx.projectId || QNC.getProjectId?.() || '',
        clip_ids: ids,
        count: ids.length,
      });
      QNC.switchTab?.('pool');
    } catch (e) {
      ctx.setStatus('Uvoz: ' + e.message, 'err');
    } finally {
      runtime.busy = false;
      renderAll(ctx);
    }
  }

  async function pickBrowse(ctx) {
    const initial = snap(ctx).browse_path || '';
    try {
      const fp = folderPicker();
      let path = null;
      if (fp?.pickDirectoryOrCancel) {
        path = await fp.pickDirectoryOrCancel({ initial_dir: initial });
      } else {
        const d = await QNC.api('POST', '/api/shell/pick-directory', { initial_dir: initial });
        path = String(d?.path || '').trim() || null;
      }
      if (!path) return;
      await saveBrowsePath(ctx, path);
    } catch (e) {
      if (String(e.message || '').includes('cancelled')) return;
      ctx.setStatus('Odaberi mapu: ' + e.message, 'err');
    }
  }

  async function saveBrowsePath(ctx, path) {
    ctx.setStatus('Otkrivam materijal...', 'busy');
    try {
      const d = await writeAndReload(ctx, 'ingest.browse', { path });
      renderAll(ctx);
      maybePollThumbnails(ctx);
      const n = (d?.clips || []).length;
      ctx.setStatus(
        n ? 'Otkriveno ' + n + ' klipova.' : 'Nema klipova u odabranoj mapi (mxf, mov, mp4…).',
        n ? 'ok' : 'err'
      );
    } catch (e) {
      ctx.setStatus('Odaberi mapu: ' + e.message, 'err');
    }
  }

  async function changeSource(ctx, sourceId) {
    const sid = String(sourceId || '').trim();
    if (!sid || sid === snap(ctx).active_source_id) return;
    ctx.setStatus('Mijenjam izvor...', 'busy');
    try {
      await writeAndReload(ctx, 'source.change', { source_id: sid });
      renderAll(ctx);
      ctx.setStatus('Izvor promijenjen.', 'ok');
    } catch (e) {
      ctx.setStatus('Izvor: ' + e.message, 'err');
    }
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
      mountComponents();

      ctx.on('clip.toggle', async (ev) => {
        await toggleClip(ctx, ev.payload?.clip_id || '');
      });
      ctx.on('ingest.discover', () => runDiscover(ctx));
      ctx.on('ingest.import', () => runImport(ctx));
      ctx.on('ingest.select-all', () => selectAll(ctx));
      ctx.on('ingest.browse', () => pickBrowse(ctx));
      ctx.on('source.change', async (ev) => {
        await changeSource(ctx, ev.payload?.source_id || '');
      });

      ctx.onShell('project:changed', async () => {
        ctx.store.invalidate('ingest.state');
        renderAll(ctx);
        if (!QNC.shell?.footerHasTab?.('ingest')) return;
        try {
          await ctx.store.reload('ingest.state');
          renderAll(ctx);
          maybePollThumbnails(ctx);
        } catch (e) {
          ctx.setStatus('Ingest: ' + e.message, 'err');
        }
      });

      QNC.log('[Ingest] SDK modul spreman — čeka otvoreni projekt', 'ok');
    },

    async onShow(ctx) {
      if (!QNC.shell?.footerHasTab?.('ingest')) {
        ctx.setStatus('Prvo otvori projekt na Project tabu.', 'err');
        QNC.switchTab?.('project');
        return;
      }
      try {
        await ctx.store.reload('ingest.state');
        renderAll(ctx);
        maybePollThumbnails(ctx);
      } catch (e) {
        ctx.setStatus('Ingest: ' + e.message, 'err');
      }
    },

    onDestroy(ctx) {
      stopThumbPoll();
      runtime.mounted = false;
      ctx.teardown();
    },
  });

  app.register();
})(window.QNC);
