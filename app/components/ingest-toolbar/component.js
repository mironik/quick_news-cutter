/* Ingest toolbar — prikaz snapshota iz baze (orchestrator šalje data iz /api/ingest/state). */
window.QNC = window.QNC || {};

(function (QNC) {
  const PANEL_ID = 'ingest-toolbar';

  function panelRoot(root) {
    if (!root) return null;
    if (root.matches?.('[data-qnc-panel="' + PANEL_ID + '"]')) return root;
    return root.querySelector?.('[data-qnc-panel="' + PANEL_ID + '"]') || null;
  }

  function slot(name, root) {
    const panel = panelRoot(root);
    return panel?.querySelector('[data-qnc-slot="' + name + '"]') || null;
  }

  function mount(root, options) {
    const panel = panelRoot(root);
    if (!panel || panel.dataset.qncComponentMounted === '1') return panel;
    panel.dataset.qncComponentMounted = '1';
    panel.dataset.hostPluginId = options?.pluginId || panel.dataset.hostPluginId || 'ingest';
    return panel;
  }

  function update(root, data, options) {
    const panel = panelRoot(root);
    if (!panel) return;
    if (panel.dataset.qncComponentMounted !== '1') mount(panel, options);

    const label = slot('project-label', panel);
    if (label) {
      label.textContent = data?.project_name || data?.project_id || '—';
    }

    const summary = slot('summary', panel);
    if (summary) {
      if (data?.summary != null) {
        summary.textContent = String(data.summary);
      } else {
        const n = Number(data?.clip_count) || 0;
        const sel = Number(data?.selected_count) || 0;
        summary.textContent = n ? n + ' klipova · ' + sel + ' odabrano' : '';
      }
    }
  }

  QNC.components.register(PANEL_ID, { PANEL_ID, mount, update });
})(window.QNC);
