/* Story segment timeline — Jetson-style cut stack (render + emit). */
window.QNC = window.QNC || {};

(function (QNC) {
  const PANEL_ID = 'story-segment-timeline';
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

  function partWindows(parts) {
    let cursor = 0;
    return (parts || []).map((part) => {
      const span = partSpan(part);
      const win = {
        part_id: part.part_id,
        start_sec: cursor,
        end_sec: cursor + span,
        span,
      };
      cursor += span;
      return win;
    });
  }

  function slotOnPart(win, slot) {
    if (!win || !slot) return null;
    if (slot.end_sec <= win.start_sec + EPS || slot.start_sec >= win.end_sec - EPS) return null;
    const start = Math.max(slot.start_sec, win.start_sec);
    const end = Math.min(slot.end_sec, win.end_sec);
    return {
      leftPct: ((start - win.start_sec) / win.span) * 100,
      widthPct: ((end - start) / win.span) * 100,
    };
  }

  function slotHasCover(slot, covers) {
    return (covers || []).some(
      (c) =>
        c.slot_signature === slot.slot_signature ||
        (Math.abs(Number(c.timeline_start_sec) - slot.start_sec) < EPS &&
          Math.abs(Number(c.timeline_end_sec) - slot.end_sec) < EPS)
    );
  }

  function coversOnPart(win, covers) {
    const out = [];
    for (const cover of covers || []) {
      const g0 = Number(cover.timeline_start_sec);
      const g1 = Number(cover.timeline_end_sec);
      if (g1 <= win.start_sec + EPS || g0 >= win.end_sec - EPS) continue;
      const localStart = Math.max(0, g0 - win.start_sec);
      const localEnd = Math.min(win.span, g1 - win.start_sec);
      out.push({ cover, localStart, localEnd });
    }
    return out;
  }

  function partLabel(part, index) {
    const type = part.kind === 'offovi' ? 'Off' : 'Izjava';
    const clip = part.clip_id ? ': ' + part.clip_id : '';
    return type + clip + ' · dio ' + (index + 1);
  }

  function cutPartHtml(part, index, model) {
    const typeCls = part.kind === 'offovi' ? 'type-offovi' : 'type-tonovi';
    const selected = part.part_id === model.selected_part_id ? ' is-focused' : '';
    const ratio = Number(model.playhead_by_part?.[part.part_id] ?? 0);
    const playPct = Math.max(0, Math.min(100, ratio * 100));
    const win = (model.part_windows || []).find((w) => w.part_id === part.part_id);
    let slotsHtml = '';
    if (win) {
      for (const slot of model.marker_slots || []) {
        const hit = slotOnPart(win, slot);
        if (!hit) continue;
        const covered = slotHasCover(slot, model.covers);
        const sel = slot.slot_id === model.selected_slot_id ? ' is-selected' : '';
        slotsHtml +=
          '<button type="button" class="story-marker-slot' +
          (covered ? ' has-cover' : '') +
          sel +
          '" data-slot-id="' +
          esc(slot.slot_id) +
          '" style="left:' +
          hit.leftPct +
          '%;width:' +
          hit.widthPct +
          '%">' +
          '<span class="story-marker-slot-label">' +
          (covered ? 'pokriveno' : 'odsječak ' + (Number(slot.slot_index) + 1)) +
          '</span></button>';
      }
    }
    let coversHtml = '';
    if (win) {
      for (const slice of coversOnPart(win, model.covers)) {
        const left = (slice.localStart / win.span) * 100;
        const width = ((slice.localEnd - slice.localStart) / win.span) * 100;
        coversHtml +=
          '<div class="story-cover-segment" style="left:' +
          left +
          '%;width:' +
          width +
          '%" title="Pokrivanje"></div>';
      }
    }
    const bodyCls = part.kind === 'offovi' ? 'story-cut-off' : 'story-cut-izjava';
    return (
      '<div class="story-cut-part ' +
      typeCls +
      selected +
      '" data-part-id="' +
      esc(part.part_id) +
      '" title="' +
      esc(partLabel(part, index)) +
      '">' +
      '<button type="button" class="story-cut-delete" data-part-id="' +
      esc(part.part_id) +
      '" title="Obriši segment">×</button>' +
      '<div class="story-cut-part-inner">' +
      '<div class="story-cut-labels" aria-hidden="true">' +
      '<span class="story-track-badge story-track-badge-v" title="Video">V</span>' +
      '</div>' +
      '<div class="story-cut-timeline">' +
      '<div class="story-cut-progress" style="width:' +
      playPct +
      '%"></div>' +
      '<div class="story-cut-playhead" style="left:' +
      playPct +
      '%"></div>' +
      '<div class="story-cut-body ' +
      bodyCls +
      '">' +
      '<div class="story-track-stack story-track-stack-video-only">' +
      '<div class="story-track-row story-track-v">' +
      '<div class="story-video-block' +
      (coversHtml ? ' has-covers' : '') +
      '">' +
      '<div class="story-video-area">' +
      '<div class="story-marker-slots">' +
      slotsHtml +
      '</div>' +
      '<div class="story-cover-layer">' +
      coversHtml +
      '</div>' +
      '<div class="story-video-strip">' +
      (part.clip_id ? esc(part.clip_id) : 'Odaberi kadar lijevo') +
      '</div></div></div></div></div></div></div></div></div>'
    );
  }

  function bindPanel(panel, pluginId) {
    if (panel._qncStorySegBound) return;
    panel._qncStorySegBound = true;
    panel.addEventListener('click', (ev) => {
      const btn = ev.target.closest?.('[data-action]');
      if (btn && !btn.disabled) {
        const action = btn.getAttribute('data-action') || '';
        if (action === 'add-tonovi') {
          ev.preventDefault();
          emit(pluginId, 'story.part.create', { kind: 'tonovi' });
          return;
        }
        if (action === 'add-offovi') {
          ev.preventDefault();
          emit(pluginId, 'story.part.create', { kind: 'offovi' });
          return;
        }
        if (action === 'overwrite') {
          ev.preventDefault();
          emit(pluginId, 'story.cover.create', {});
          return;
        }
        if (action === 'test') {
          ev.preventDefault();
          emit(pluginId, 'story.test', {});
          return;
        }
        if (action === 'commit') {
          ev.preventDefault();
          emit(pluginId, 'story.commit', {});
          return;
        }
      }
      const del = ev.target.closest?.('.story-cut-delete');
      if (del) {
        ev.preventDefault();
        ev.stopPropagation();
        const partId = del.getAttribute('data-part-id') || '';
        if (partId) emit(pluginId, 'story.part.delete', { part_id: partId });
        return;
      }
      const slotBtn = ev.target.closest?.('.story-marker-slot');
      if (slotBtn) {
        ev.preventDefault();
        ev.stopPropagation();
        const slotId = slotBtn.getAttribute('data-slot-id') || '';
        if (slotId) emit(pluginId, 'story.marker_slot.select', { slot_id: slotId });
        return;
      }
      const partEl = ev.target.closest?.('.story-cut-part');
      if (partEl) {
        const partId = partEl.getAttribute('data-part-id') || '';
        if (!partId) return;
        const rect = partEl.querySelector('.story-cut-timeline')?.getBoundingClientRect();
        let ratio = 0;
        if (rect && rect.width > 0) {
          ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        }
        emit(pluginId, 'story.part.select', { part_id: partId, playhead_ratio: ratio });
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
    model.part_windows = partWindows(model.parts);
    const busy = !!model.busy;
    panel.querySelectorAll('[data-action]').forEach((b) => {
      b.toggleAttribute('disabled', busy);
    });
    const board = panel.querySelector('[data-qnc-slot="segment-items"]');
    if (!board) return;
    const parts = Array.isArray(model.parts) ? model.parts : [];
    if (!parts.length) {
      board.innerHTML =
        '<div class="story-cut-stack"><p class="story-cut-empty">Odaberi kadar lijevo, zatim klikni TONOVI ili OFFOVI.</p></div>';
      return;
    }
    board.innerHTML =
      '<div class="story-cut-stack">' +
      parts.map((p, i) => cutPartHtml(p, i, model)).join('') +
      '</div>';
  }

  QNC.components.register(PANEL_ID, { mount, update });
})(window.QNC);
