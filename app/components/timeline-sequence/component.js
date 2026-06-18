window.QNC = window.QNC || {};

(function (QNC) {
  const PANEL_ID = 'timeline-sequence';
  const FILMSTRIP_ID = 'filmstrip-viewer';
  const THUMB_MAX_FRAMES = 24;

  function panelRoot(root) {
    if (!root) return null;
    if (root.matches?.('[data-qnc-panel="' + PANEL_ID + '"]')) return root;
    return root.querySelector?.('[data-qnc-panel="' + PANEL_ID + '"]') || null;
  }

  function slot(root, name) {
    return panelRoot(root)?.querySelector?.('[data-qnc-slot="' + name + '"]') || null;
  }

  function esc(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDuration(seconds) {
    const v = Number(seconds || 0);
    if (!v) return '0:00';
    const m = Math.floor(v / 60);
    const s = Math.floor(v % 60).toString().padStart(2, '0');
    return m + ':' + s;
  }

  function clipDuration(clip) {
    if (clip?.timeline_duration_sec) return Number(clip.timeline_duration_sec);
    if (clip?.duration_sec) return Number(clip.duration_sec);
    return 0;
  }

  function clipNote(clip) {
    const parts = [];
    if (clip.transferred) parts.push('u projektu');
    else if (clip.discovered) parts.push('detektiran');
    if (clip.has_transcript) parts.push('transkript');
    const fs = String(clip.filmstrip_status || 'missing');
    if (fs === 'building') parts.push('filmstrip');
    if (fs === 'error') parts.push('filmstrip greška');
    return parts.join(' · ') || '-';
  }

  function filmstripHtml() {
    return (
      '<section class="qnc-component qnc-filmstrip-viewer qnc-filmstrip-inline" data-qnc-panel="' +
      FILMSTRIP_ID +
      '">' +
      '<div class="thumbnail-strip" data-qnc-slot="frames"></div>' +
      '</section>'
    );
  }

  function timelineOverlayHtml() {
    return (
      '<div class="qnc-timeline-sequence__virtual" aria-hidden="true">' +
      '<div class="qnc-timeline-sequence__range"></div>' +
      '<div class="qnc-timeline-sequence__mark qnc-timeline-sequence__mark--in">IN</div>' +
      '<div class="qnc-timeline-sequence__mark qnc-timeline-sequence__mark--out">OUT</div>' +
      '<div class="qnc-timeline-sequence__playhead"></div>' +
      '</div>'
    );
  }

  function rowHtml(clip, data) {
    const id = clip.clip_id || '';
    const selected = (data.selected_ids || []).includes(id);
    const active = data.current_clip_id === id;
    const duration = clipDuration(clip);
    return (
      '<div class="qnc-timeline-sequence__row timeline-row' +
      (active ? ' is-active pool-row-active' : '') +
      '" data-clip-id="' +
      esc(id) +
      '">' +
      '<div class="qnc-timeline-sequence__label timeline-label">' +
      '<div class="qnc-timeline-sequence__main timeline-title">' +
      '<input type="checkbox" class="qnc-timeline-sequence__check pool-row-chk" data-id="' +
      esc(id) +
      '"' +
      (selected ? ' checked' : '') +
      '>' +
      '<span class="qnc-timeline-sequence__name timeline-filename">' +
      esc(clip.name || id) +
      '</span>' +
      '</div>' +
      '<div class="qnc-timeline-sequence__meta timeline-meta">' +
      esc(formatDuration(duration)) +
      ' | ' +
      esc(clipNote(clip)) +
      '</div>' +
      '</div>' +
      '<div class="qnc-timeline-sequence__track">' +
      filmstripHtml() +
      timelineOverlayHtml() +
      '</div>' +
      '<button type="button" class="qnc-timeline-sequence__edge clip-edge-btn" data-id="' +
      esc(id) +
      '">' +
      esc(formatDuration(duration)) +
      '</button>' +
      '</div>'
    );
  }

  function emit(pluginId, action, payload) {
    if (!QNC.emitComponent) return Promise.resolve();
    return QNC.emitComponent(pluginId || 'media_pool', PANEL_ID, action, payload || {});
  }

  function bind(panel, pluginId) {
    if (!panel || panel.dataset.qncTimelineSequenceBound === '1') return;
    panel.dataset.qncTimelineSequenceBound = '1';
    panel.addEventListener('change', (event) => {
      const chk = event.target.closest?.('.pool-row-chk[data-id]');
      if (!chk) return;
      emit(pluginId, 'clip.toggle', {
        clip_id: chk.getAttribute('data-id') || '',
        checked: chk.checked,
      });
    });
    panel.addEventListener('click', (event) => {
      const edge = event.target.closest?.('.clip-edge-btn[data-id]');
      if (edge) {
        emit(pluginId, 'clip.play', { clip_id: edge.getAttribute('data-id') || '', edge: true });
        return;
      }
      if (event.target.closest?.('.pool-row-chk, .thumb-btn, .qnc-media-thumb-btn')) return;
      const row = event.target.closest?.('.timeline-row[data-clip-id]');
      if (row) emit(pluginId, 'clip.play', { clip_id: row.getAttribute('data-clip-id') || '' });
    });
  }

  function updateFilmstrip(panel, clip, data, ctx) {
    if (!panel || !QNC.filmstrip?.update) return;
    const status = String(clip.filmstrip_status || 'missing');
    const seeks = Array.isArray(clip.timeline_seeks) ? clip.timeline_seeks : [];
    const slots = Math.max(2, Math.min(seeks.length || 6, THUMB_MAX_FRAMES));
    const list = status === 'ready' && QNC.filmstrip.seeksFromTimeline
      ? QNC.filmstrip.seeksFromTimeline(seeks, slots)
      : status === 'ready'
        ? seeks.slice(0, slots)
        : null;
    QNC.filmstrip.mountPanel(panel, ctx.pluginId);
    QNC.filmstrip.update(panel, {
      hostPluginId: ctx.pluginId,
      clip,
      filmstrip: {
        status,
        seeks,
        error: clip.filmstrip_error || '',
      },
      seeks: list,
      loading: list === null,
      slots,
      durationSec: clip.timeline_duration_sec || clipDuration(clip),
      thumbRev: data.thumb_rev || 0,
      thumbUrl: data.thumbUrl,
      formatDuration,
      placeholder: status === 'building' ? 'Filmstrip se generira...' : 'Sličice se generiraju...',
    });
  }

  function pct(seconds, duration) {
    const d = Number(duration || 0);
    const s = Number(seconds || 0);
    if (!d || !Number.isFinite(s)) return 0;
    return Math.max(0, Math.min(100, (s / d) * 100));
  }

  function clipById(clips, clipId) {
    return (clips || []).find((clip) => clip.clip_id === clipId) || null;
  }

  function paintPlayback(root, data) {
    const panel = panelRoot(root);
    if (!panel) return;
    const currentId = String(data?.current_clip_id || '');
    const clips = Array.isArray(data?.clips) ? data.clips : [];
    const activeClip = clipById(clips, currentId);
    const duration = Number(data?.duration_sec || clipDuration(activeClip) || 0);
    const playheadPct = pct(data?.playhead_sec, duration);
    const inSec = data?.mark_in_sec == null ? null : Number(data.mark_in_sec);
    const outSec = data?.mark_out_sec == null ? null : Number(data.mark_out_sec);
    const hasIn = inSec != null && Number.isFinite(inSec);
    const hasOut = outSec != null && Number.isFinite(outSec);
    const rangeStart = hasIn ? pct(inSec, duration) : 0;
    const rangeEnd = hasOut ? pct(outSec, duration) : 100;
    const rangeLeft = Math.min(rangeStart, rangeEnd);
    const rangeWidth = Math.max(0, Math.abs(rangeEnd - rangeStart));

    panel.querySelectorAll('.qnc-timeline-sequence__row[data-clip-id]').forEach((row) => {
      const isActive = currentId && row.getAttribute('data-clip-id') === currentId;
      row.classList.toggle('is-active', !!isActive);
      row.classList.toggle('pool-row-active', !!isActive);
      const virtual = row.querySelector('.qnc-timeline-sequence__virtual');
      if (!virtual) return;
      virtual.classList.toggle('is-active', !!isActive);
      virtual.classList.toggle('has-in', !!(isActive && hasIn));
      virtual.classList.toggle('has-out', !!(isActive && hasOut));
      virtual.classList.toggle('has-range', !!(isActive && hasIn && hasOut && outSec > inSec));
      virtual.style.setProperty('--qnc-seq-playhead', playheadPct + '%');
      virtual.style.setProperty('--qnc-seq-in', rangeStart + '%');
      virtual.style.setProperty('--qnc-seq-out', rangeEnd + '%');
      virtual.style.setProperty('--qnc-seq-range-left', rangeLeft + '%');
      virtual.style.setProperty('--qnc-seq-range-width', rangeWidth + '%');
    });
  }

  function update(root, data, ctx) {
    const panel = panelRoot(root);
    if (!panel) return;
    const pluginId = ctx?.pluginId || 'media_pool';
    bind(panel, pluginId);
    const rows = slot(panel, 'rows');
    const summary = slot(panel, 'summary');
    const clips = Array.isArray(data?.clips) ? data.clips : [];
    if (summary) summary.textContent = clips.length ? clips.length + ' clipova' : '';
    if (!rows) return;
    if (!clips.length) {
      rows.innerHTML = '<div class="qnc-timeline-sequence__empty">Nema uvezenih klipova.</div>';
      return;
    }
    rows.innerHTML = clips.map((clip) => rowHtml(clip, data || {})).join('');
    rows.querySelectorAll('[data-qnc-panel="' + FILMSTRIP_ID + '"]').forEach((fsPanel) => {
      const row = fsPanel.closest('.timeline-row[data-clip-id]');
      const clipId = row?.getAttribute('data-clip-id') || '';
      const clip = clips.find((item) => item.clip_id === clipId);
      if (clip) updateFilmstrip(fsPanel, clip, data || {}, { pluginId });
    });
    paintPlayback(panel, data || {});
  }

  function updatePlayback(root, data) {
    paintPlayback(root, data || {});
  }

  function mount(root, ctx) {
    const panel = panelRoot(root);
    if (!panel) return;
    bind(panel, ctx?.pluginId || 'media_pool');
    update(panel, { clips: [] }, ctx);
  }

  QNC.components = QNC.components || { registry: new Map() };
  if (QNC.components.register) {
    QNC.components.register(PANEL_ID, { PANEL_ID, mount, update, updatePlayback });
  }
})(window.QNC);
