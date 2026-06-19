/* Story toolbar — emit story.part.* intent events only. */
window.QNC = window.QNC || {};

(function (QNC) {
  const PANEL_ID = 'story-toolbar';

  const ACTION_MAP = {
    'add-tonovi': 'story.part.create',
    'add-offovi': 'story.part.create',
    'move-up': 'story.part.reorder',
    'move-down': 'story.part.reorder',
    delete: 'story.part.delete',
  };

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

  function bindActions(panel, pluginId) {
    if (panel._qncStoryToolbarBound) return;
    panel._qncStoryToolbarBound = true;
    panel.addEventListener('click', (ev) => {
      const btn = ev.target.closest?.('[data-action]');
      if (!btn || btn.disabled) return;
      const raw = btn.getAttribute('data-action') || '';
      const busAction = ACTION_MAP[raw];
      if (!busAction) return;
      ev.preventDefault();
      let payload = {};
      if (raw === 'add-tonovi') payload = { kind: 'tonovi' };
      else if (raw === 'add-offovi') payload = { kind: 'offovi' };
      else if (raw === 'move-up') payload = { direction: 'up' };
      else if (raw === 'move-down') payload = { direction: 'down' };
      emit(pluginId, busAction, payload);
    });
  }

  function setBusy(panel, busy) {
    panel.querySelectorAll('[data-action]').forEach((el) => {
      if (el.tagName === 'BUTTON') el.disabled = !!busy;
    });
  }

  function mount(root, options) {
    const panel = panelRoot(root);
    if (!panel || panel.dataset.qncComponentMounted === '1') return panel;
    panel.dataset.qncComponentMounted = '1';
    const pluginId = options?.pluginId || panel.dataset.hostPluginId || 'story';
    panel.dataset.hostPluginId = pluginId;
    bindActions(panel, pluginId);
    return panel;
  }

  function update(root, data, options) {
    const panel = panelRoot(root);
    if (!panel) return;
    const pluginId = options?.pluginId || panel.dataset.hostPluginId || 'story';
    if (panel.dataset.qncComponentMounted !== '1') mount(panel, options);
    bindActions(panel, pluginId);
    const busy = !!data?.busy;
    const hasSelection = !!String(data?.selected_part_id || '').trim();
    setBusy(panel, busy);
    panel.querySelector('[data-action="delete"]')?.toggleAttribute('disabled', busy || !hasSelection);
    panel.querySelector('[data-action="move-up"]')?.toggleAttribute('disabled', busy || !hasSelection);
    panel.querySelector('[data-action="move-down"]')?.toggleAttribute('disabled', busy || !hasSelection);
  }

  QNC.components.register(PANEL_ID, { mount, update });
})(window.QNC);
