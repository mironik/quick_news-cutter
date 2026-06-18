/* Ingest tab — orchestrator. Stanje samo u ingest.db (SQLite); UI čita/zapisuje preko API-ja. */
window.QNC = window.QNC || {};

(function (QNC) {
  const runtime = {
    busy: false,
    orchestratorReady: false,
    busDisposers: [],
    /** Zadnji snapshot iz baze — samo reloadFromDb() → syncFromDb(), nikad lokalna mutacija. */
    db: null,
    thumbPollTimer: null,
  };

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

  function toolbarApi() {
    return QNC.components?.get?.('ingest-toolbar');
  }

  function sourceApi() {
    return QNC.components?.get?.('ingest-source-picker');
  }

  function actionsApi() {
    return QNC.components?.get?.('ingest-actions');
  }

  function gridApi() {
    return QNC.components?.get?.('ingest-clip-grid');
  }

  function toolbarRoot() {
    return q('[data-qnc-panel="ingest-toolbar"]');
  }

  function sourceRoot() {
    return q('[data-qnc-panel="ingest-source-picker"]');
  }

  function actionsRoot() {
    return q('[data-qnc-panel="ingest-actions"]');
  }

  function gridRoot() {
    return q('[data-qnc-panel="ingest-clip-grid"]');
  }

  function ingestProjectId() {
    return QNC.getProjectId?.() || '';
  }

  function clips() {
    return runtime.db?.clips || [];
  }

  function selectedClipIds() {
    return (runtime.db?.selected_clip_ids || []).map(String);
  }

  function syncFromDb(d) {
    if (d && typeof d === 'object') {
      runtime.db = d;
    }
    renderAll();
    maybePollThumbnails();
  }

  function hasPendingThumbs() {
    return (runtime.db?.clips || []).some((c) => {
      const st = String(c.thumb_status || '').toLowerCase();
      return st === 'pending' || st === 'processing';
    });
  }

  function maybePollThumbnails() {
    if (!hasPendingThumbs()) {
      if (runtime.thumbPollTimer) {
        clearInterval(runtime.thumbPollTimer);
        runtime.thumbPollTimer = null;
      }
      return;
    }
    if (runtime.thumbPollTimer) return;
    runtime.thumbPollTimer = setInterval(() => {
      reloadFromDb().catch(() => {});
      if (!hasPendingThumbs()) {
        clearInterval(runtime.thumbPollTimer);
        runtime.thumbPollTimer = null;
      }
    }, 2000);
  }

  async function reloadFromDb() {
    const d = await QNC.api(
      'GET',
      '/api/ingest/state?project_id=' + encodeURIComponent(ingestProjectId())
    );
    syncFromDb(d);
    return d;
  }

  /** Zapis u bazu preko API-ja, zatim uvijek puni snapshot iz GET /state. */
  async function writeIngest(method, path, body) {
    await QNC.api(method, path, body);
    return reloadFromDb();
  }

  function renderToolbar() {
    const db = runtime.db || {};
    toolbarApi()?.update?.(toolbarRoot(), {
      project_id: db.project_id || ingestProjectId(),
      project_name: db.project_name || db.project_id || '',
      clip_count: clips().length,
      selected_count: selectedClipIds().length,
    }, { pluginId: 'ingest' });
  }

  function renderSourcePicker() {
    const db = runtime.db || {};
    sourceApi()?.update?.(sourceRoot(), {
      sources: db.sources || [],
      active_source_id: db.active_source_id || '',
      browse_path: db.browse_path || '',
    }, { pluginId: 'ingest' });
  }

  function renderActions() {
    const n = clips().length;
    const sel = selectedClipIds().length;
    actionsApi()?.update?.(actionsRoot(), {
      busy: runtime.busy,
      clip_count: n,
      selected_count: sel,
      all_selected: n > 0 && sel >= n,
    }, { pluginId: 'ingest' });
  }

  function renderGrid() {
    const api = gridApi();
    const root = gridRoot();
    if (!api || !root) return;
    const n = clips().length;
    const sel = selectedClipIds().length;
    api.update(
      root,
      {
        clips: clips(),
        selected_clip_ids: selectedClipIds(),
        features: GRID_FEATURES,
        status_text: n
          ? sel + ' od ' + n + ' odabrano'
          : 'Nema klipova — Otkrij materijal.',
      },
      { pluginId: 'ingest' }
    );
  }

  function renderAll() {
    renderGrid();
    renderToolbar();
    renderSourcePicker();
    renderActions();
  }

  async function refreshAll() {
    await reloadFromDb();
  }

  async function toggleClip(clipId) {
    const id = String(clipId || '').trim();
    if (!id) return;
    try {
      await writeIngest('POST', '/api/ingest/selection/toggle', {
        project_id: ingestProjectId(),
        clip_id: id,
      });
    } catch (e) {
      QNC.setBox('Odabir: ' + e.message, 'err');
    }
  }

  async function selectAll() {
    try {
      await writeIngest('POST', '/api/ingest/selection/select-all', {
        project_id: ingestProjectId(),
      });
    } catch (e) {
      QNC.setBox('Odabir: ' + e.message, 'err');
    }
  }

  async function runDiscover() {
    if (runtime.busy) return;
    runtime.busy = true;
    renderActions();
    QNC.setBox('Otkrivam materijal...', 'busy');
    try {
      const d = await writeIngest('POST', '/api/ingest/discover', {
        project_id: ingestProjectId(),
        source_id: runtime.db?.active_source_id || '',
      });
      maybePollThumbnails();
      const n = (d?.clips || []).length;
      QNC.setBox(
        n ? 'Otkriveno ' + n + ' klipova.' : 'Nema klipova u mapi (mxf, mov, mp4…). Odaberi mapu.',
        n ? 'ok' : 'err'
      );
    } catch (e) {
      QNC.setBox('Otkrij: ' + e.message, 'err');
    } finally {
      runtime.busy = false;
      renderActions();
    }
  }

  async function runImport() {
    if (runtime.busy) return;
    const ids = selectedClipIds();
    if (!ids.length) {
      QNC.setBox('Odaberi klipove za uvoz.', 'err');
      return;
    }
    runtime.busy = true;
    renderActions();
    try {
      await writeIngest('POST', '/api/ingest/import', {
        project_id: ingestProjectId(),
        clip_ids: ids,
      });
      QNC.setBox('Uvoz u pozadini: ' + ids.length + ' klip(ova).', 'busy');
      await QNC.nextTab?.('ingest');
    } catch (e) {
      QNC.setBox('Uvoz: ' + e.message, 'err');
    } finally {
      runtime.busy = false;
      renderActions();
    }
  }

  function folderPicker() {
    return QNC.components?.get?.('folder-picker') || QNC.folderPicker || null;
  }

  async function pickBrowse() {
    const initial = runtime.db?.browse_path || '';
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
      await saveBrowsePath(path);
    } catch (e) {
      if (String(e.message || '').includes('cancelled')) return;
      QNC.setBox('Odaberi mapu: ' + e.message, 'err');
    }
  }

  async function saveBrowsePath(path) {
    QNC.setBox('Otkrivam materijal...', 'busy');
    try {
      const d = await writeIngest('POST', '/api/ingest/browse', {
        project_id: ingestProjectId(),
        path,
      });
      maybePollThumbnails();
      const n = (d?.clips || []).length;
      QNC.setBox(
        n ? 'Otkriveno ' + n + ' klipova.' : 'Nema klipova u odabranoj mapi (mxf, mov, mp4…).',
        n ? 'ok' : 'err'
      );
    } catch (e) {
      QNC.setBox('Odaberi mapu: ' + e.message, 'err');
    }
  }

  async function changeSource(sourceId) {
    const sid = String(sourceId || '').trim();
    if (!sid || sid === runtime.db?.active_source_id) return;
    QNC.setBox('Mijenjam izvor...', 'busy');
    try {
      await writeIngest('POST', '/api/ingest/source', {
        project_id: ingestProjectId(),
        source_id: sid,
      });
      QNC.setBox('Izvor promijenjen.', 'ok');
    } catch (e) {
      QNC.setBox('Izvor: ' + e.message, 'err');
    }
  }

  function installComponentOrchestrator() {
    if (runtime.orchestratorReady || !QNC.componentBus) return;
    runtime.orchestratorReady = true;
    const on = (event, handler) => {
      runtime.busDisposers.push(QNC.componentBus.on('ingest', event, handler));
    };
    on('clip.toggle', async (ev) => {
      await toggleClip(ev.payload?.clip_id || '');
    });
    on('ingest.discover', runDiscover);
    on('ingest.import', runImport);
    on('ingest.select-all', selectAll);
    on('ingest.browse', pickBrowse);
    on('source.change', async (ev) => {
      await changeSource(ev.payload?.source_id || '');
    });
  }

  function mountComponents() {
    const ctx = { pluginId: 'ingest' };
    toolbarApi()?.mount?.(toolbarRoot(), ctx);
    sourceApi()?.mount?.(sourceRoot(), ctx);
    actionsApi()?.mount?.(actionsRoot(), ctx);
    gridApi()?.mount?.(gridRoot(), ctx);
  }

  function teardownIngest() {
    if (runtime.thumbPollTimer) {
      clearInterval(runtime.thumbPollTimer);
      runtime.thumbPollTimer = null;
    }
    runtime.busDisposers.forEach((off) => {
      try {
        if (typeof off === 'function') off();
      } catch (_) {}
    });
    runtime.busDisposers = [];
    runtime.orchestratorReady = false;
    runtime.db = null;
    QNC.componentBus?.offPlugin?.('ingest');
  }

  async function bootIngest() {
    installComponentOrchestrator();
    mountComponents();
    if (QNC.bus) {
      QNC.bus.on('project:changed', () => {
        runtime.db = null;
        renderAll();
        if (QNC.shell?.footerHasTab?.('ingest')) {
          refreshAll().catch((e) => QNC.setBox('Ingest: ' + e.message, 'err'));
        }
      });
    }
    QNC.log('[Ingest] modul spreman — čeka Project tab (otvoreni projekt)', 'ok');
  }

  async function onShowIngest() {
    if (!QNC.shell?.footerHasTab?.('ingest')) {
      QNC.setBox('Prvo otvori projekt na Project tabu.', 'err');
      QNC.switchTab?.('project');
      return;
    }
    try {
      await refreshAll();
    } catch (e) {
      QNC.setBox('Ingest: ' + e.message, 'err');
    }
  }

  if (QNC.tabs && QNC.tabs.register) {
    QNC.tabs.register({
      id: 'ingest',
      init: bootIngest,
      destroy: teardownIngest,
      onShow: onShowIngest,
    });
  }
})(window.QNC);
