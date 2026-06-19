/* Story part editor — read form at event time, emit story.part.update. */
window.QNC = window.QNC || {};

(function (QNC) {
  const PANEL_ID = 'story-part-editor';

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
    const kind = form.querySelector('[data-field="kind"]')?.value || '';
    const title = form.querySelector('[data-field="title"]')?.value || '';
    const text = form.querySelector('[data-field="text"]')?.value || '';
    return { kind, title, text };
  }

  function bindEditor(panel, pluginId) {
    if (panel._qncStoryEditorBound) return;
    panel._qncStoryEditorBound = true;
    panel.addEventListener('click', (ev) => {
      const btn = ev.target.closest?.('[data-action="save"]');
      if (!btn || btn.disabled) return;
      ev.preventDefault();
      const partId = panel.dataset.selectedPartId || '';
      if (!partId) return;
      const fields = readForm(panel);
      if (!fields) return;
      emit(pluginId, 'story.part.update', {
        part_id: partId,
        title: fields.title,
        text: fields.text,
        kind: fields.kind,
      });
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
    const selectedId = String(data?.selected_part_id || '');
    const parts = Array.isArray(data?.parts) ? data.parts : [];
    const selected = parts.find((p) => p.part_id === selectedId) || null;
    const busy = !!data?.busy;
    if (!selected) {
      panel.dataset.selectedPartId = '';
      if (empty) empty.hidden = false;
      if (form) form.hidden = true;
      return;
    }
    panel.dataset.selectedPartId = selected.part_id;
    if (empty) empty.hidden = true;
    if (form) {
      form.hidden = false;
      const kindEl = form.querySelector('[data-field="kind"]');
      const titleEl = form.querySelector('[data-field="title"]');
      const textEl = form.querySelector('[data-field="text"]');
      if (kindEl && document.activeElement !== kindEl) kindEl.value = selected.kind || 'tonovi';
      if (titleEl && document.activeElement !== titleEl) titleEl.value = selected.title || '';
      if (textEl && document.activeElement !== textEl) textEl.value = selected.text || '';
      form.querySelector('[data-action="save"]')?.toggleAttribute('disabled', busy);
    }
  }

  QNC.components.register(PANEL_ID, { mount, update });
})(window.QNC);
