/* Story covers list — render + emit cover create/select/delete intents. */
window.QNC = window.QNC || {};

(function (QNC) {
  const PANEL_ID = 'story-covers-list';

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

  function coverLabel(cover) {
    const title = String(cover?.title || '').trim();
    if (title) return title;
    return 'Pokrivanje';
  }

  function formatSec(sec) {
    const n = Number(sec);
    if (!Number.isFinite(n)) return '0';
    return n.toFixed(3).replace(/\.?0+$/, '');
  }

  function bindList(panel, pluginId) {
    if (panel._qncStoryCoversBound) return;
    panel._qncStoryCoversBound = true;
    panel.addEventListener('click', (ev) => {
      const createBtn = ev.target.closest?.('[data-action="create-cover"]');
      if (createBtn) {
        if (createBtn.disabled) return;
        ev.preventDefault();
        const slotId = panel.dataset.selectedSlotId || '';
        if (!slotId) return;
        emit(pluginId, 'story.cover.create', { slot_id: slotId });
        return;
      }
      const delBtn = ev.target.closest?.('[data-action="delete-cover"]');
      if (delBtn) {
        if (delBtn.disabled) return;
        ev.preventDefault();
        ev.stopPropagation();
        const coverId = delBtn.getAttribute('data-cover-id') || '';
        if (!coverId) return;
        emit(pluginId, 'story.cover.delete', { cover_id: coverId });
        return;
      }
      const row = ev.target.closest?.('[data-cover-id]');
      if (!row || row.disabled) return;
      const coverId = row.getAttribute('data-cover-id') || '';
      if (!coverId) return;
      ev.preventDefault();
      emit(pluginId, 'story.cover.select', { cover_id: coverId });
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
    const slotId = String(data?.selected_slot_id || '');
    panel.dataset.selectedSlotId = slotId;
    const covers = Array.isArray(data?.covers) ? data.covers : [];
    const slots = Array.isArray(data?.marker_slots) ? data.marker_slots : [];
    const selectedSlot = slots.find((s) => s.slot_id === slotId);
    const slotCovers = selectedSlot
      ? covers.filter(
          (c) =>
            c.slot_signature === selectedSlot.slot_signature ||
            (Math.abs(Number(c.timeline_start_sec) - Number(selectedSlot.start_sec)) < 0.002 &&
              Math.abs(Number(c.timeline_end_sec) - Number(selectedSlot.end_sec)) < 0.002)
        )
      : [];
    const selected = String(data?.selected_cover_id || '');
    const busy = !!data?.busy;
    const list = panel.querySelector('[data-qnc-slot="covers"]');
    const empty = panel.querySelector('[data-qnc-slot="empty"]');
    const createBtn = panel.querySelector('[data-action="create-cover"]');
    if (createBtn) createBtn.disabled = busy || !slotId;
    if (empty) {
      empty.hidden = slotCovers.length > 0;
      empty.textContent = slotId
        ? 'Nema pokrivanja za odabrani slot.'
        : 'Odaberi slot i dodaj pokrivanje.';
    }
    if (!list) return;
    list.innerHTML = slotCovers
      .map((cover) => {
        const id = esc(cover.cover_id);
        const label = esc(coverLabel(cover));
        const sel = cover.cover_id === selected ? ' selected' : '';
        return (
          '<li><button type="button" class="qnc-story-cover-row' +
          sel +
          '" data-cover-id="' +
          id +
          '"' +
          (busy ? ' disabled' : '') +
          '>' +
          '<span class="qnc-story-cover-label">' +
          label +
          '</span>' +
          '<span class="qnc-story-cover-meta">' +
          esc(formatSec(cover.timeline_start_sec)) +
          '–' +
          esc(formatSec(cover.timeline_end_sec)) +
          ' s</span>' +
          '</button>' +
          '<button type="button" class="qnc-story-cover-delete" data-action="delete-cover" data-cover-id="' +
          id +
          '"' +
          (busy ? ' disabled' : '') +
          '>×</button></li>'
        );
      })
      .join('');
  }

  QNC.components.register(PANEL_ID, { mount, update });
})(window.QNC);
