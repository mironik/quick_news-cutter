/* Story virtual timeline — Jetson footer (render + emit). */
window.QNC = window.QNC || {};

(function (QNC) {
  const PANEL_ID = 'story-virtual-timeline';
  const EPS = 0.001;

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

  function partSpan(part) {
    const inS = Number(part.in_seconds);
    const outS = Number(part.out_seconds);
    if (Number.isFinite(inS) && Number.isFinite(outS) && outS > inS) {
      return Math.max(0.05, outS - inS);
    }
    return 3;
  }

  function formatDur(sec) {
    const s = Math.max(0, Number(sec) || 0);
    const m = Math.floor(s / 60);
    const r = (s - m * 60).toFixed(1);
    return m + ':' + (r.length < 4 ? '0' + r : r);
  }

  function formatTc(sec) {
    const s = Math.max(0, Number(sec) || 0);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const f = Math.floor(s % 60);
    const pad = (n) => String(n).padStart(2, '0');
    return pad(h) + ':' + pad(m) + ':' + pad(f) + ':00';
  }

  function slotHasCover(slot, covers) {
    return (covers || []).some(
      (c) =>
        c.slot_signature === slot.slot_signature ||
        (Math.abs(Number(c.timeline_start_sec) - slot.start_sec) < EPS &&
          Math.abs(Number(c.timeline_end_sec) - slot.end_sec) < EPS)
    );
  }

  function buildVtHtml(model) {
    const parts = Array.isArray(model.parts) ? model.parts : [];
    if (!parts.length) {
      return '<p class="story-vt-empty muted">Dodaj segmente (TONOVI / OFFOVI).</p>';
    }
    const dur = Math.max(
      0.05,
      Number(model.duration_sec) ||
        parts.reduce((sum, p) => sum + partSpan(p), 0)
    );
    let cursor = 0;
    let segHtml = '';
    let a1Html = '';
    parts.forEach((part, index) => {
      const span = partSpan(part);
      const left = (cursor / dur) * 100;
      const width = (span / dur) * 100;
      const typeCls = part.kind === 'offovi' ? 'type-offovi' : 'type-tonovi';
      const focused = part.part_id === model.selected_part_id ? ' is-focused' : '';
      const label = (part.kind === 'offovi' ? 'Off' : 'Ton') + ' ' + (index + 1);
      segHtml +=
        '<div class="story-vt-seg ' +
        typeCls +
        focused +
        '" style="left:' +
        left +
        '%;width:' +
        width +
        '%"><span class="story-vt-seg-label">' +
        esc(label) +
        '</span></div>';
      a1Html +=
        '<div class="story-vt-a1-seg story-audio-primary" style="left:' +
        left +
        '%;width:' +
        width +
        '%"><div class="story-audio-wave"></div></div>';
      cursor += span;
    });
    let coverHtml = '';
    for (const cover of model.covers || []) {
      const g0 = Number(cover.timeline_start_sec);
      const g1 = Number(cover.timeline_end_sec);
      if (!(g1 > g0)) continue;
      coverHtml +=
        '<div class="story-vt-cover" style="left:' +
        (g0 / dur) * 100 +
        '%;width:' +
        ((g1 - g0) / dur) * 100 +
        '%"></div>';
    }
    let slotHtml = '';
    for (const slot of model.marker_slots || []) {
      const left = (slot.start_sec / dur) * 100;
      const width = ((slot.end_sec - slot.start_sec) / dur) * 100;
      const covered = slotHasCover(slot, model.covers);
      const sel = slot.slot_id === model.selected_slot_id ? ' is-selected' : '';
      slotHtml +=
        '<button type="button" class="story-vt-slot' +
        (covered ? ' has-cover' : '') +
        sel +
        '" data-slot-id="' +
        esc(slot.slot_id) +
        '" style="left:' +
        left +
        '%;width:' +
        width +
        '%" title="' +
        esc(formatTc(slot.start_sec) + ' → ' + formatTc(slot.end_sec)) +
        '"></button>';
    }
    let markerHtml = '';
    for (const marker of model.markers || []) {
      const t = Number(marker.timeline_sec);
      const tc = marker.tc || formatTc(t);
      markerHtml +=
        '<span class="story-vt-marker" style="left:' +
        (t / dur) * 100 +
        '%"><span class="story-vt-marker-label">' +
        esc(tc) +
        '</span></span>';
    }
    const playSec =
      Number(model.global_playhead_sec) ||
      (model.selected_part_id && model.playhead_by_part
        ? (() => {
            let c = 0;
            for (const p of parts) {
              if (p.part_id === model.selected_part_id) {
                return c + partSpan(p) * (Number(model.playhead_by_part[p.part_id]) || 0);
              }
              c += partSpan(p);
            }
            return 0;
          })()
        : 0);
    const playPct = (playSec / dur) * 100;
    return (
      '<div class="story-vt-stack">' +
      '<div class="story-vt-labels" aria-hidden="true">' +
      '<span class="story-track-badge story-track-badge-a1">A1</span>' +
      '<span class="story-track-badge story-track-badge-v">V</span>' +
      '<span class="story-track-badge story-track-badge-a2">A2</span>' +
      '</div>' +
      '<div class="story-vt-scrub">' +
      '<div class="story-vt-rail story-vt-rail-a1">' +
      a1Html +
      '</div>' +
      '<div class="story-vt-rail story-vt-rail-v">' +
      '<div class="story-vt-segments">' +
      segHtml +
      '</div>' +
      '<div class="story-vt-covers">' +
      coverHtml +
      '</div>' +
      '<div class="story-vt-slots">' +
      slotHtml +
      '</div>' +
      '<div class="story-vt-markers">' +
      markerHtml +
      '</div>' +
      '<div class="story-vt-playhead" style="left:' +
      playPct +
      '%"></div>' +
      '</div>' +
      '<div class="story-vt-rail story-vt-rail-a2 has-segments"><div class="story-audio-wave story-audio-wave-secondary"></div></div>' +
      '</div>'
    );
  }

  function bindPanel(panel, pluginId) {
    if (panel._qncStoryVtBound) return;
    panel._qncStoryVtBound = true;
    panel.addEventListener('click', (ev) => {
      const slotBtn = ev.target.closest?.('.story-vt-slot');
      if (slotBtn) {
        ev.preventDefault();
        const slotId = slotBtn.getAttribute('data-slot-id') || '';
        if (slotId) emit(pluginId, 'story.marker_slot.select', { slot_id: slotId });
        return;
      }
      const scrub = ev.target.closest?.('.story-vt-scrub');
      if (scrub) {
        const rect = scrub.getBoundingClientRect();
        if (rect.width <= 0) return;
        const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        emit(pluginId, 'story.timeline.scrub', { ratio });
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
    const model = data || {};
    const parts = Array.isArray(model.parts) ? model.parts : [];
    const dur =
      Number(model.duration_sec) ||
      parts.reduce((sum, p) => sum + partSpan(p), 0);
    const durEl = panel.querySelector('[data-qnc-slot="vt-duration"]');
    const tcEl = panel.querySelector('[data-qnc-slot="vt-tc"]');
    if (durEl) durEl.textContent = formatDur(dur);
    const playSec = Number(model.global_playhead_sec) || 0;
    if (tcEl) tcEl.textContent = formatTc(playSec);
    const body = panel.querySelector('[data-qnc-slot="vt-body"]');
    if (body) body.innerHTML = buildVtHtml(model);
  }

  QNC.components.register(PANEL_ID, { mount, update });
})(window.QNC);
