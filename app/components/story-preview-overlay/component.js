/* Story preview overlay — playback shell (UI handle only). */
window.QNC = window.QNC || {};

(function (QNC) {
  const PANEL_ID = 'story-preview-overlay';

  function panelRoot(root) {
    if (!root) return null;
    if (root.matches?.('[data-qnc-panel="' + PANEL_ID + '"]')) return root;
    return root.querySelector?.('[data-qnc-panel="' + PANEL_ID + '"]') || null;
  }

  function emit(pluginId, action, payload) {
    if (QNC.emitComponent) {
      return QNC.emitComponent(pluginId || 'story', PANEL_ID, action, payload || {});
    }
    return Promise.resolve();
  }

  function mount(root, options) {
    const panel = panelRoot(root);
    if (!panel || panel.dataset.qncComponentMounted === '1') return panel;
    panel.dataset.qncComponentMounted = '1';
    const pluginId = options?.pluginId || panel.dataset.hostPluginId || 'story';
    panel.dataset.hostPluginId = pluginId;
    panel.addEventListener('click', (ev) => {
      const btn = ev.target.closest?.('[data-action="preview-close"]');
      if (!btn) return;
      ev.preventDefault();
      emit(pluginId, 'story.preview.close', {});
    });
    return panel;
  }

  function update(root, data) {
    const panel = panelRoot(root);
    if (!panel) return;
    const visible = !!data?.preview_open;
    panel.hidden = !visible;
    const label = panel.querySelector('[data-qnc-slot="preview-label"]');
    if (label) label.textContent = data?.preview_label || '—';
  }

  QNC.components.register(PANEL_ID, { mount, update });
})(window.QNC);
