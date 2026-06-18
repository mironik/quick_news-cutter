/* Ingest actions — emituje ingest.* događaje preko component busa. */
window.QNC = window.QNC || {};

(function (QNC) {
  const PANEL_ID = 'ingest-actions';

  const ACTION_MAP = {
    browse: 'ingest.browse',
    discover: 'ingest.discover',
    import: 'ingest.import',
    'select-all': 'ingest.select-all',
  };

  function panelRoot(root) {
    if (!root) return null;
    if (root.matches?.('[data-qnc-panel="' + PANEL_ID + '"]')) return root;
    return root.querySelector?.('[data-qnc-panel="' + PANEL_ID + '"]') || null;
  }

  function emit(pluginId, action, payload) {
    if (QNC.emitComponent) {
      return QNC.emitComponent(pluginId || 'ingest', PANEL_ID, action, payload || {});
    }
    return Promise.resolve();
  }

  function bindActions(panel, pluginId) {
    if (panel._qncIngestActionsBound) return;
    panel._qncIngestActionsBound = true;
    panel.addEventListener('click', (ev) => {
      const btn = ev.target.closest?.('[data-action]');
      if (!btn || btn.disabled) return;
      const raw = btn.getAttribute('data-action') || '';
      const busAction = ACTION_MAP[raw];
      if (!busAction) return;
      ev.preventDefault();
      emit(pluginId, busAction, {});
    });
  }

  function setBusy(panel, busy) {
    panel.querySelectorAll('[data-action]').forEach((el) => {
      if (el.tagName === 'BUTTON') el.disabled = !!busy;
    });
  }

  function updateSelectAllLabel(panel, data) {
    const btn = panel.querySelector('[data-action="select-all"]');
    if (!btn) return;
    const n = Number(data?.clip_count) || 0;
    const sel = Number(data?.selected_count) || 0;
    const allSelected =
      data?.all_selected != null ? !!data.all_selected : n > 0 && sel >= n;
    btn.textContent = allSelected ? 'Poništi odabir' : 'Odaberi sve';
    btn.disabled = !!data?.busy || n === 0;
  }

  function mount(root, options) {
    const panel = panelRoot(root);
    if (!panel || panel.dataset.qncComponentMounted === '1') return panel;
    panel.dataset.qncComponentMounted = '1';
    const pluginId = options?.pluginId || panel.dataset.hostPluginId || 'ingest';
    panel.dataset.hostPluginId = pluginId;
    bindActions(panel, pluginId);
    return panel;
  }

  function update(root, data, options) {
    const panel = panelRoot(root);
    if (!panel) return;
    const pluginId = options?.pluginId || panel.dataset.hostPluginId || 'ingest';
    if (panel.dataset.qncComponentMounted !== '1') mount(panel, options);
    bindActions(panel, pluginId);
    setBusy(panel, !!data?.busy);
    updateSelectAllLabel(panel, data);
  }

  QNC.components.register(PANEL_ID, { PANEL_ID, mount, update });
})(window.QNC);
