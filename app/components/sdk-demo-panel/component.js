/* SDK Demo panel — emit sdk_demo.* via component bus. */
window.QNC = window.QNC || {};

(function (QNC) {
  const PANEL_ID = 'sdk-demo-panel';

  const ACTION_MAP = {
    increment: 'sdk_demo.increment',
    reset: 'sdk_demo.reset',
  };

  function panelRoot(root) {
    if (!root) return null;
    if (root.matches?.('[data-qnc-panel="' + PANEL_ID + '"]')) return root;
    return root.querySelector?.('[data-qnc-panel="' + PANEL_ID + '"]') || null;
  }

  function emit(pluginId, action, payload) {
    if (QNC.emitComponent) {
      return QNC.emitComponent(pluginId || 'sdk_demo', PANEL_ID, action, payload || {});
    }
    return Promise.resolve();
  }

  function bindActions(panel, pluginId) {
    if (panel._qncSdkDemoBound) return;
    panel._qncSdkDemoBound = true;
    panel.addEventListener('click', (ev) => {
      const btn = ev.target.closest?.('[data-action]');
      if (!btn || btn.disabled) return;
      const raw = btn.getAttribute('data-action') || '';
      const busAction = ACTION_MAP[raw];
      if (!busAction) return;
      ev.preventDefault();
      const payload = raw === 'increment' ? { step: 1 } : {};
      emit(pluginId, busAction, payload);
    });
  }

  function setBusy(panel, busy) {
    panel.querySelectorAll('[data-action]').forEach((el) => {
      if (el.tagName === 'BUTTON') el.disabled = !!busy;
    });
  }

  function setSlot(panel, name, text) {
    const el = panel.querySelector('[data-qnc-slot="' + name + '"]');
    if (el) el.textContent = text == null ? '' : String(text);
  }

  function mount(root, options) {
    const panel = panelRoot(root);
    if (!panel || panel.dataset.qncComponentMounted === '1') return panel;
    panel.dataset.qncComponentMounted = '1';
    const pluginId = options?.pluginId || panel.dataset.hostPluginId || 'sdk_demo';
    panel.dataset.hostPluginId = pluginId;
    bindActions(panel, pluginId);
    return panel;
  }

  function update(root, data, options) {
    const panel = panelRoot(root);
    if (!panel) return;
    const pluginId = options?.pluginId || panel.dataset.hostPluginId || 'sdk_demo';
    if (panel.dataset.qncComponentMounted !== '1') mount(panel, options);
    bindActions(panel, pluginId);
    setBusy(panel, !!data?.busy);
    setSlot(panel, 'counter', data?.counter ?? 0);
    setSlot(panel, 'project-id', data?.project_id || '—');
    setSlot(panel, 'persistence', data?.persistence || '—');
    setSlot(panel, 'updated-at', data?.updated_at || '—');
    setSlot(panel, 'status-note', data?.status_note || '');
  }

  QNC.components.register(PANEL_ID, { PANEL_ID, mount, update });
})(window.QNC);
