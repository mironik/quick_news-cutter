/* Story markers list — render + emit story.marker.* intents. */
window.QNC = window.QNC || {};

(function (QNC) {
  const PANEL_ID = 'story-markers-list';

  const ACTION_MAP = {
    'add-marker': 'story.marker.create',
    'marker-delete': 'story.marker.delete',
    'marker-up': 'story.marker.move',
    'marker-down': 'story.marker.move',
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

  function esc(v) {
    return String(v || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatSec(sec) {
    const n = Number(sec);
    if (!Number.isFinite(n)) return '0';
    return n.toFixed(3).replace(/\.?0+$/, '');
  }

  function bindPanel(panel, pluginId) {
    if (panel._qncStoryMarkersBound) return;
    panel._qncStoryMarkersBound = true;
    panel.addEventListener('click', (ev) => {
      const btn = ev.target.closest?.('[data-action]');
      if (!btn || btn.disabled) return;
      const raw = btn.getAttribute('data-action') || '';
      const busAction = ACTION_MAP[raw];
      if (!busAction) return;
      ev.preventDefault();
      if (raw === 'add-marker') {
        const input = panel.querySelector('[data-qnc-slot="timeline-sec"]');
        const timelineSec = Number(input?.value);
        if (!Number.isFinite(timelineSec) || timelineSec < 0) return;
        emit(pluginId, busAction, { timeline_sec: timelineSec });
        return;
      }
      const markerId = btn.getAttribute('data-marker-id') || '';
      if (!markerId) return;
      if (raw === 'marker-delete') {
        emit(pluginId, busAction, { marker_id: markerId });
      } else if (raw === 'marker-up') {
        emit(pluginId, busAction, { marker_id: markerId, direction: 'up' });
      } else if (raw === 'marker-down') {
        emit(pluginId, busAction, { marker_id: markerId, direction: 'down' });
      }
    });
  }

  function mount(root, options) {
    const panel = panelRoot(root);
    if (!panel || panel.dataset.qncComponentMounted === '1') return panel;
    panel.dataset.qncComponentMounted = '1';
    const pluginId = options?.pluginId || panel.dataset.hostPluginId || 'story';
    panel.dataset.hostPluginId = pluginId;
    bindPanel(panel, pluginId);
    return panel;
  }

  function update(root, data, options) {
    const panel = panelRoot(root);
    if (!panel) return;
    const pluginId = options?.pluginId || panel.dataset.hostPluginId || 'story';
    if (panel.dataset.qncComponentMounted !== '1') mount(panel, options);
    bindPanel(panel, pluginId);
    const busy = !!data?.busy;
    const markers = Array.isArray(data?.markers) ? data.markers : [];
    panel.querySelector('[data-action="add-marker"]')?.toggleAttribute('disabled', busy);
    panel.querySelector('[data-qnc-slot="timeline-sec"]')?.toggleAttribute('disabled', busy);
    const list = panel.querySelector('[data-qnc-slot="markers"]');
    const empty = panel.querySelector('[data-qnc-slot="empty"]');
    if (empty) empty.hidden = markers.length > 0;
    if (!list) return;
    list.innerHTML = markers
      .map((marker, idx) => {
        const id = esc(marker.marker_id);
        const sec = formatSec(marker.timeline_sec);
        const tc = String(marker.tc || '').trim();
        const label = String(marker.label || '').trim();
        const labelText = label ? esc(label) : tc ? esc(tc) : sec + ' s';
        return (
          '<li class="qnc-story-marker-row">' +
          '<span class="qnc-story-marker-label">' +
          (idx + 1) +
          '. ' +
          labelText +
          ' <span class="muted">@ ' +
          sec +
          's</span></span>' +
          '<span class="qnc-story-marker-actions">' +
          '<button type="button" data-action="marker-up" data-marker-id="' +
          id +
          '"' +
          (busy || idx === 0 ? ' disabled' : '') +
          '>↑</button>' +
          '<button type="button" data-action="marker-down" data-marker-id="' +
          id +
          '"' +
          (busy || idx === markers.length - 1 ? ' disabled' : '') +
          '>↓</button>' +
          '<button type="button" data-action="marker-delete" data-marker-id="' +
          id +
          '"' +
          (busy ? ' disabled' : '') +
          '>×</button>' +
          '</span></li>'
        );
      })
      .join('');
  }

  QNC.components.register(PANEL_ID, { mount, update });
})(window.QNC);
