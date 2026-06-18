/* Ingest source picker — emituje source.change; orchestrator piše u ingest.db. */
window.QNC = window.QNC || {};

(function (QNC) {
  const PANEL_ID = 'ingest-source-picker';

  function panelRoot(root) {
    if (!root) return null;
    if (root.matches?.('[data-qnc-panel="' + PANEL_ID + '"]')) return root;
    return root.querySelector?.('[data-qnc-panel="' + PANEL_ID + '"]') || null;
  }

  function slot(name, root) {
    const panel = panelRoot(root);
    return panel?.querySelector('[data-qnc-slot="' + name + '"]') || null;
  }

  function emit(pluginId, action, payload) {
    if (QNC.emitComponent) {
      return QNC.emitComponent(pluginId || 'ingest', PANEL_ID, action, payload || {});
    }
    return Promise.resolve();
  }

  function bindSelect(panel, pluginId) {
    const select = slot('source-select', panel);
    if (!select || select.dataset.qncBound === '1') return;
    select.dataset.qncBound = '1';
    select.addEventListener('change', () => {
      const sourceId = select.value || '';
      if (!sourceId) return;
      emit(pluginId, 'source.change', { source_id: sourceId });
    });
  }

  function mount(root, options) {
    const panel = panelRoot(root);
    if (!panel || panel.dataset.qncComponentMounted === '1') return panel;
    panel.dataset.qncComponentMounted = '1';
    const pluginId = options?.pluginId || panel.dataset.hostPluginId || 'ingest';
    panel.dataset.hostPluginId = pluginId;
    bindSelect(panel, pluginId);
    return panel;
  }

  function update(root, data, options) {
    const panel = panelRoot(root);
    if (!panel) return;
    const pluginId = options?.pluginId || panel.dataset.hostPluginId || 'ingest';
    if (panel.dataset.qncComponentMounted !== '1') mount(panel, options);
    bindSelect(panel, pluginId);

    const sources = Array.isArray(data?.sources) ? data.sources : [];
    const activeId = String(data?.active_source_id || '');
    const select = slot('source-select', panel);
    if (select) {
      select.innerHTML = '<option value="">— odaberi —</option>';
      sources.forEach((src) => {
        const opt = document.createElement('option');
        opt.value = src.source_id || '';
        opt.textContent = src.name || src.source_id || '';
        if (opt.value === activeId) opt.selected = true;
        select.appendChild(opt);
      });
    }

    const pathEl = slot('source-path', panel);
    if (pathEl) {
      const browsePath = String(data?.browse_path || '').trim();
      const active = sources.find((s) => s.source_id === activeId);
      const fallback = active?.path ? 'Projekti/…/' + active.path : '';
      pathEl.textContent = browsePath || fallback;
      pathEl.title = browsePath || fallback;
    }
  }

  QNC.components.register(PANEL_ID, { PANEL_ID, mount, update });
})(window.QNC);
