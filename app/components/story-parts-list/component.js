/* Story parts list — render + emit story.part.select. */
window.QNC = window.QNC || {};

(function (QNC) {
  const PANEL_ID = 'story-parts-list';

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

  function partLabel(part) {
    const title = String(part?.title || '').trim();
    if (title) return title;
    const kind = String(part?.kind || '').toUpperCase();
    return kind || 'Part';
  }

  function bindList(panel, pluginId) {
    if (panel._qncStoryPartsBound) return;
    panel._qncStoryPartsBound = true;
    panel.addEventListener('click', (ev) => {
      const row = ev.target.closest?.('[data-part-id]');
      if (!row) return;
      const partId = row.getAttribute('data-part-id') || '';
      if (!partId) return;
      ev.preventDefault();
      emit(pluginId, 'story.part.select', { part_id: partId });
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
    const list = panel.querySelector('[data-qnc-slot="parts"]');
    if (!list) return;
    const parts = Array.isArray(data?.parts) ? data.parts : [];
    const selected = String(data?.selected_part_id || '');
    list.innerHTML = parts
      .map((part) => {
        const id = esc(part.part_id);
        const kind = esc(String(part.kind || '').toUpperCase());
        const label = esc(partLabel(part));
        const sel = part.part_id === selected ? ' selected' : '';
        return (
          '<li><button type="button" class="qnc-story-part-row' +
          sel +
          '" data-part-id="' +
          id +
          '">' +
          '<span class="qnc-story-part-kind">' +
          kind +
          '</span>' +
          '<span class="qnc-story-part-label">' +
          label +
          '</span>' +
          '</button></li>'
        );
      })
      .join('');
  }

  QNC.components.register(PANEL_ID, { mount, update });
})(window.QNC);
