/* Media pool clip list — prikaz klipova i filmstripa samo iz GET /clips (filmstrip.db + ingest.db). */
window.QNC = window.QNC || {};

(function (QNC) {
  const PANEL_ID = 'media-pool-clip-list';
  const FILMSTRIP_ID = 'filmstrip-viewer';
  const THUMB_W = 112;
  const THUMB_MAX_FRAMES = 24;

  function panelRoot(root) {
    if (!root) return null;
    if (root.matches?.('[data-qnc-panel="' + PANEL_ID + '"]')) return root;
    return root.querySelector?.('[data-qnc-panel="' + PANEL_ID + '"]') || null;
  }

  function slot(name, root) {
    const panel = panelRoot(root);
    if (!panel) return null;
    return panel.querySelector('[data-qnc-slot="' + String(name || '').replace(/"/g, '\\"') + '"]');
  }

  function emit(pluginId, action, payload) {
    if (QNC.emitComponent) {
      return QNC.emitComponent(pluginId || 'media_pool', PANEL_ID, action, payload || {});
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

  function formatDuration(seconds) {
    const v = Number(seconds || 0);
    if (!v) return '0:00';
    const m = Math.floor(v / 60);
    const s = Math.floor(v % 60)
      .toString()
      .padStart(2, '0');
    return m + ':' + s;
  }

  function clipDuration(c) {
    if (c?.timeline_duration_sec) return Number(c.timeline_duration_sec);
    const probe = c?.media_probe || {};
    if (probe.duration_sec) return Number(probe.duration_sec);
    if (c?.duration_sec) return Number(c.duration_sec);
    return 0;
  }

  function seeksForClip(clip, slots) {
    const seeks = Array.isArray(clip?.timeline_seeks) ? clip.timeline_seeks : [];
    if (!seeks.length) return null;
    const n = slots || Math.max(2, Math.min(seeks.length, THUMB_MAX_FRAMES));
    if (QNC.filmstrip?.seeksFromTimeline) {
      return QNC.filmstrip.seeksFromTimeline(seeks, n);
    }
    return seeks.slice(0, n);
  }

  function rowNote(id, c, rowNotes) {
    const note = rowNotes?.[id] || '';
    if (note) return note;
    const parts = [];
    if (c.transferred) parts.push('u projektu');
    else if (c.discovered) parts.push('na SD');
    if (c.has_transcript) parts.push('transkript');
    return parts.join(' · ') || '—';
  }

  function transcriptLabel(c, rowNotes) {
    if (rowNotes?.[c.clip_id]?.indexOf('greška') >= 0) return 'Transkript greška';
    if (c.has_transcript) return 'Transkript OK';
    if (rowNotes?.[c.clip_id]?.indexOf('ASR') >= 0) return 'Transkript…';
    return 'Transkript —';
  }

  function filmstripRowHtml() {
    return (
      '<section class="qnc-component qnc-filmstrip-viewer qnc-filmstrip-inline" data-qnc-panel="' +
      FILMSTRIP_ID +
      '">' +
      '<div class="thumbnail-strip" data-qnc-slot="frames"></div>' +
      '</section>'
    );
  }

  function renderRow(clip, data) {
    const id = clip.clip_id || '';
    const sel = (data?.selected_ids || []).includes(id);
    const current = data?.current_clip_id === id;
    const dur = clipDuration(clip);
    const rowCls =
      'timeline-row' +
      (current ? ' pool-row-active' : '') +
      (clip.has_transcript ? ' pool-row-ok' : '');
    const note = rowNote(id, clip, data?.row_notes);
    return (
      '<div class="' +
      rowCls +
      '" data-clip-id="' +
      esc(id) +
      '">' +
      '<div class="timeline-label">' +
      '<div class="timeline-title">' +
      '<input type="checkbox" class="pool-row-chk" data-id="' +
      esc(id) +
      '"' +
      (sel ? ' checked' : '') +
      '/>' +
      '<span class="timeline-filename">' +
      esc(id) +
      '</span></div>' +
      '<div class="timeline-meta">' +
      esc(formatDuration(dur)) +
      ' | ' +
      esc(transcriptLabel(clip, data?.row_notes)) +
      ' | ' +
      esc(note) +
      '</div></div>' +
      filmstripRowHtml() +
      '<button type="button" class="clip-edge-btn" data-id="' +
      esc(id) +
      '">' +
      esc(formatDuration(dur)) +
      '</button></div>'
    );
  }

  function updateFilmstrip(panel, clip, ctx) {
    if (!panel || !clip?.clip_id || !QNC.filmstrip?.update) return;
    QNC.filmstrip.mountPanel(panel, ctx?.pluginId || 'media_pool');
    const fsStatus = String(clip.filmstrip_status || 'missing');
    const slots = Math.max(
      2,
      Math.min((clip.timeline_seeks || []).length || 6, THUMB_MAX_FRAMES)
    );
    const list = fsStatus === 'ready' ? seeksForClip(clip, slots) : null;
    const loading = fsStatus === 'missing' || fsStatus === 'building' || !list;
    QNC.filmstrip.update(panel, {
      hostPluginId: ctx?.pluginId || 'media_pool',
      clip,
      filmstrip: {
        status: loading && fsStatus !== 'building' ? 'missing' : fsStatus,
        error: clip.filmstrip_error || '',
        seeks: clip.timeline_seeks || [],
      },
      seeks: list,
      loading,
      slots,
      durationSec: clip.timeline_duration_sec || clipDuration(clip),
      thumbRev: ctx?.thumb_rev || 0,
      thumbUrl: ctx?.thumbUrl,
      formatDuration,
      placeholder:
        fsStatus === 'building'
          ? 'Filmstrip se generira…'
          : fsStatus === 'error'
            ? clip.filmstrip_error || 'Greška filmstripa'
            : 'Sličice se generiraju…',
    });
  }

  function bindList(panel, pluginId) {
    if (panel._qncPoolListBound) return;
    panel._qncPoolListBound = true;
    const rows = slot('clip-rows', panel);
    if (!rows) return;
    rows.addEventListener('change', (ev) => {
      const chk = ev.target.closest?.('.pool-row-chk');
      if (!chk) return;
      const id = chk.getAttribute('data-id') || '';
      if (!id) return;
      emit(pluginId, 'clip.toggle', { clip_id: id, checked: chk.checked });
    });
    rows.addEventListener('click', (ev) => {
      const edge = ev.target.closest?.('.clip-edge-btn');
      if (edge) {
        const id = edge.getAttribute('data-id') || '';
        if (id) emit(pluginId, 'clip.play', { clip_id: id, edge: true });
        return;
      }
      const fsBtn = ev.target.closest?.('.qnc-media-thumb-btn, .thumb-btn');
      if (fsBtn) return;
      const row = ev.target.closest?.('.timeline-row[data-clip-id]');
      if (!row || ev.target.closest?.('.pool-row-chk')) return;
      const id = row.getAttribute('data-clip-id') || '';
      if (id) emit(pluginId, 'clip.play', { clip_id: id });
    });
  }

  function paintFilmstrips(rowsSlot, clips, ctx) {
    if (!rowsSlot || !clips.length) return;
    for (const clip of clips) {
      const id = clip.clip_id || '';
      if (!id) continue;
      const row = rowsSlot.querySelector('.timeline-row[data-clip-id="' + CSS.escape(id) + '"]');
      const fsPanel =
        row?.querySelector('[data-qnc-panel="' + FILMSTRIP_ID + '"]') ||
        row?.querySelector('[data-qnc-component="' + FILMSTRIP_ID + '"]');
      if (fsPanel) updateFilmstrip(fsPanel, clip, ctx);
    }
  }

  async function update(root, data, ctx) {
    const panel = panelRoot(root);
    if (!panel) return;
    const pluginId = ctx?.pluginId || 'media_pool';
    bindList(panel, pluginId);

    const clips = Array.isArray(data?.clips) ? data.clips : [];
    const rowsSlot = slot('clip-rows', panel);
    if (!rowsSlot) return;

    if (!clips.length) {
      rowsSlot.innerHTML =
        '<p class="grid-empty muted">Nema uvezenih klipova — prvo Uvezi na Ingest tabu, zatim Osvježi pool.</p>';
      return;
    }

    rowsSlot.innerHTML = clips.map((c) => renderRow(c, data)).join('');
    paintFilmstrips(rowsSlot, clips, {
      pluginId,
      thumb_rev: data?.thumb_rev || 0,
      thumbUrl: data?.thumbUrl,
    });
  }

  function mount(root, ctx) {
    const panel = panelRoot(root);
    if (!panel) return;
    bindList(panel, ctx?.pluginId || 'media_pool');
    update(root, { clips: [] }, ctx);
  }

  QNC.components = QNC.components || { registry: new Map() };
  if (QNC.components.register) {
    QNC.components.register(PANEL_ID, { PANEL_ID, mount, update });
  }
})(window.QNC);
