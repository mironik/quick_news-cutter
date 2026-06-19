/* Story tab layout — render model only; no backend calls (Phase A). */
window.QNC = window.QNC || {};

(function (QNC) {
  const PANEL_ID = 'story-tab-layout';

  function panelRoot(root) {
    if (!root) return null;
    if (root.matches?.('[data-qnc-panel="' + PANEL_ID + '"]')) return root;
    return root.querySelector?.('[data-qnc-panel="' + PANEL_ID + '"]') || null;
  }

  function setSlot(panel, name, text) {
    const el = panel.querySelector('[data-qnc-slot="' + name + '"]');
    if (el) el.textContent = text == null ? '' : String(text);
  }

  function mount(root) {
    const panel = panelRoot(root);
    if (!panel || panel.dataset.qncComponentMounted === '1') return panel;
    panel.dataset.qncComponentMounted = '1';
    return panel;
  }

  function update(root, model) {
    const panel = panelRoot(root);
    if (!panel) return;
    const m = model || {};
    setSlot(panel, 'part-count', m.part_count ?? 0);
    setSlot(panel, 'duration-sec', m.duration_sec ?? 0);
    setSlot(panel, 'project-id', m.project_id || '—');
    setSlot(panel, 'status-note', m.status_note || '');
  }

  QNC.components = QNC.components || { _registry: new Map() };
  QNC.components.register?.({
    id: PANEL_ID,
    mount,
    update,
  });
})(window.QNC);
