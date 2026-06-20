/* Story virtual shots — left media strip (render + select intent). */
window.QNC = window.QNC || {};

(function (QNC) {
  const PANEL_ID = 'story-virtual-shots';

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

  function esc(v) {
    return String(v || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function mount(root, options) {
    const panel = panelRoot(root);
    if (!panel || panel.dataset.qncComponentMounted === '1') return panel;
    panel.dataset.qncComponentMounted = '1';
    const pluginId = options?.pluginId || panel.dataset.hostPluginId || 'story';
    panel.dataset.hostPluginId = pluginId;
    panel.addEventListener('click', (ev) => {
      const card = ev.target.closest?.('.story-shot-card');
      if (!card) return;
      const shotId = card.getAttribute('data-shot-id') || '';
      if (shotId) emit(pluginId, 'story.shot.select', { virtual_shot_id: shotId });
    });
    return panel;
  }

  function update(root, data, options) {
    const panel = panelRoot(root);
    if (!panel) return;
    if (panel.dataset.qncComponentMounted !== '1') mount(panel, options);
    const list = panel.querySelector('[data-qnc-slot="virtual-shot-items"]');
    if (!list) return;
    const shots = Array.isArray(data?.virtual_shots) ? data.virtual_shots : [];
    if (!shots.length) {
      list.innerHTML = '<p class="grid-empty">Nema virtualnih kadrova u projektu.</p>';
      return;
    }
    const selected = String(data?.selected_shot_id || '');
    list.innerHTML = shots
      .map(
        (shot) =>
          '<article class="story-shot-card' +
          (shot.id === selected || shot.virtual_shot_id === selected
            ? ' story-shot-selected'
            : '') +
          '" data-shot-id="' +
          esc(shot.id || shot.virtual_shot_id) +
          '">' +
          '<div class="story-shot-thumb-wrap"><div class="story-shot-thumb placeholder">thumb</div></div>' +
          '<div class="story-shot-meta"><span class="story-shot-clip">' +
          esc(shot.clip_id || '') +
          '</span></div></article>'
      )
      .join('');
  }

  QNC.components.register(PANEL_ID, { mount, update });
})(window.QNC);
