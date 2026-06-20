/* Story marker slots list — render + emit story.marker_slot.select. */
window.QNC = window.QNC || {};

(function (QNC) {
  const PANEL_ID = 'story-marker-slots-list';

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

  function bindList(panel, pluginId) {
    if (panel._qncStorySlotsBound) return;
    panel._qncStorySlotsBound = true;
    panel.addEventListener('click', (ev) => {
      const row = ev.target.closest?.('[data-slot-id]');
      if (!row || row.disabled) return;
      const slotId = row.getAttribute('data-slot-id') || '';
      if (!slotId) return;
      ev.preventDefault();
      emit(pluginId, 'story.marker_slot.select', { slot_id: slotId });
    });
  }

  function mount(root, options) {
    const panel = panelRoot(root);
    if (!panel || panel.dataset.qncComponentMounted === '1') return panel;
    panel.dataset.qncComponentMounted = '1';
    const pluginId = options?.pluginId || panel.dataset.hostPluginId || 'story';
    panel.dataset.hostPluginId = pluginId;
    bindList(panel, pluginId);
    return panel;
  }

  function update(root, data, options) {
    const panel = panelRoot(root);
    if (!panel) return;
    const pluginId = options?.pluginId || panel.dataset.hostPluginId || 'story';
    if (panel.dataset.qncComponentMounted !== '1') mount(panel, options);
    bindList(panel, pluginId);
    const slots = Array.isArray(data?.marker_slots) ? data.marker_slots : [];
    const selected = String(data?.selected_slot_id || '');
    const busy = !!data?.busy;
    const list = panel.querySelector('[data-qnc-slot="slots"]');
    const empty = panel.querySelector('[data-qnc-slot="empty"]');
    if (empty) empty.hidden = slots.length > 0;
    if (!list) return;
    list.innerHTML = slots
      .map((slot) => {
        const id = esc(slot.slot_id);
        const partCount = Array.isArray(slot.part_ids) ? slot.part_ids.length : 0;
        const sel = slot.slot_id === selected ? ' selected' : '';
        return (
          '<li><button type="button" class="qnc-story-marker-slot-row' +
          sel +
          '" data-slot-id="' +
          id +
          '"' +
          (busy ? ' disabled' : '') +
          '>' +
          '<span class="qnc-story-marker-slot-label">Slot ' +
          (Number(slot.slot_index) + 1) +
          '</span>' +
          '<span class="qnc-story-marker-slot-meta">' +
          partCount +
          ' dijelova</span>' +
          '</button></li>'
        );
      })
      .join('');
  }

  QNC.components.register(PANEL_ID, { mount, update });
})(window.QNC);
