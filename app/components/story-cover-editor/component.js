/* Story cover editor — read form at event time, emit story.cover.update/delete. */
window.QNC = window.QNC || {};

(function (QNC) {
  const PANEL_ID = 'story-cover-editor';

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

  function readForm(panel) {
    const form = panel.querySelector('[data-qnc-slot="form"]');
    if (!form) return null;
    const title = form.querySelector('[data-field="title"]')?.value || '';
    const note = form.querySelector('[data-field="note"]')?.value || '';
    return { title, note };
  }

  function bindEditor(panel, pluginId) {
    if (panel._qncStoryCoverEditorBound) return;
    panel._qncStoryCoverEditorBound = true;
    panel.addEventListener('click', (ev) => {
      const saveBtn = ev.target.closest?.('[data-action="save"]');
      if (saveBtn) {
        if (saveBtn.disabled) return;
        ev.preventDefault();
        const coverId = panel.dataset.selectedCoverId || '';
        if (!coverId) return;
        const fields = readForm(panel);
        if (!fields) return;
        emit(pluginId, 'story.cover.update', {
          cover_id: coverId,
          title: fields.title,
          note: fields.note,
        });
        return;
      }
      const delBtn = ev.target.closest?.('[data-action="delete"]');
      if (delBtn) {
        if (delBtn.disabled) return;
        ev.preventDefault();
        const coverId = panel.dataset.selectedCoverId || '';
        if (!coverId) return;
        emit(pluginId, 'story.cover.delete', { cover_id: coverId });
      }
    });
  }

  function mount(root, options) {
    const panel = panelRoot(root);
    if (!panel || panel.dataset.qncComponentMounted === '1') return panel;
    panel.dataset.qncComponentMounted = '1';
    const pluginId = options?.pluginId || panel.dataset.hostPluginId || 'story';
    panel.dataset.hostPluginId = pluginId;
    bindEditor(panel, pluginId);
    return panel;
  }

  function update(root, data, options) {
    const panel = panelRoot(root);
    if (!panel) return;
    const pluginId = options?.pluginId || panel.dataset.hostPluginId || 'story';
    if (panel.dataset.qncComponentMounted !== '1') mount(panel, options);
    bindEditor(panel, pluginId);
    const empty = panel.querySelector('[data-qnc-slot="empty"]');
    const form = panel.querySelector('[data-qnc-slot="form"]');
    const selectedId = String(data?.selected_cover_id || '');
    const covers = Array.isArray(data?.covers) ? data.covers : [];
    const selected = covers.find((c) => c.cover_id === selectedId) || null;
    const busy = !!data?.busy;
    if (!selected) {
      panel.dataset.selectedCoverId = '';
      if (empty) empty.hidden = false;
      if (form) form.hidden = true;
      return;
    }
    panel.dataset.selectedCoverId = selected.cover_id;
    if (empty) empty.hidden = true;
    if (form) {
      form.hidden = false;
      const titleEl = form.querySelector('[data-field="title"]');
      const noteEl = form.querySelector('[data-field="note"]');
      if (titleEl && document.activeElement !== titleEl) titleEl.value = selected.title || '';
      if (noteEl && document.activeElement !== noteEl) noteEl.value = selected.note || '';
      form.querySelector('[data-action="save"]')?.toggleAttribute('disabled', busy);
      form.querySelector('[data-action="delete"]')?.toggleAttribute('disabled', busy);
    }
  }

  QNC.components.register(PANEL_ID, { mount, update });
})(window.QNC);
