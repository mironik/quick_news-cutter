/* Story tab layout — Jetson workspace shell (render-only). */
window.QNC = window.QNC || {};

(function (QNC) {
  const PANEL_ID = 'story-tab-layout';

  function panelRoot(root) {
    if (!root) return null;
    if (root.matches?.('[data-qnc-panel="' + PANEL_ID + '"]')) return root;
    return root.querySelector?.('[data-qnc-panel="' + PANEL_ID + '"]') || null;
  }

  function mount(root) {
    const panel = panelRoot(root);
    if (!panel || panel.dataset.qncComponentMounted === '1') return panel;
    panel.dataset.qncComponentMounted = '1';
    return panel;
  }

  function update(root) {
    panelRoot(root);
  }

  QNC.components.register(PANEL_ID, { mount, update });
})(window.QNC);
