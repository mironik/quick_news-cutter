/* Story toolbar — Jetson header (render + refresh intent). */
window.QNC = window.QNC || {};

(function (QNC) {
  const PANEL_ID = 'story-toolbar';

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
      const btn = ev.target.closest?.('[data-action="refresh"]');
      if (!btn || btn.disabled) return;
      ev.preventDefault();
      emit(pluginId, 'story.refresh', {});
    });
    return panel;
  }

  function update(root, data, options) {
    const panel = panelRoot(root);
    if (!panel) return;
    if (panel.dataset.qncComponentMounted !== '1') mount(panel, options);
    const m = data || {};
    const shots = Array.isArray(m.virtual_shots) ? m.virtual_shots.length : 0;
    const shotEl = panel.querySelector('[data-qnc-slot="shot-count"]');
    if (shotEl) {
      shotEl.textContent = shots + (shots === 1 ? ' kadar' : ' kadrova');
      shotEl.classList.toggle('muted', shots === 0);
    }
    const draftEl = panel.querySelector('[data-qnc-slot="draft-status"]');
    if (draftEl) {
      if (m.committed_at) {
        draftEl.textContent = 'Montaža spremljena · ' + m.committed_at;
        draftEl.className = 'story-draft-status ok';
      } else if (m.draft_updated_at) {
        draftEl.textContent = 'Radna verzija · ' + m.draft_updated_at;
        draftEl.className = 'story-draft-status muted';
      } else {
        draftEl.textContent = 'Radna verzija';
        draftEl.className = 'story-draft-status muted';
      }
    }
    panel.querySelector('[data-action="refresh"]')?.toggleAttribute('disabled', !!m.busy);
  }

  QNC.components.register(PANEL_ID, { mount, update });
})(window.QNC);
