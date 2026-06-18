/* Media Pool — Plugin SDK v1 orchestrator (WIP). Pool snapshot iz API; UI state lokalno za player. */
window.QNC = window.QNC || {};

(function (QNC) {
  if (!QNC.createPluginApp) {
    console.error('[Media Pool] QNC.createPluginApp nije učitan (qnc-plugin-sdk.js)');
    return;
  }

  let sdkCtx = null;
  let actionsInstalled = false;
  let busInstalled = false;

  const ROWS_ID = 'pool-timeline-rows';
  const THUMB_W = 112;
  const THUMB_H = 64;
  const THUMB_GAP = 3;
  const THUMB_MAX_FRAMES = 24;

  const runtime = {
    lastVirtualSignature: '',
  };

  const pool = {
    clips: [],
    selected: new Set(),
    timelines: {},
    lastSignature: '',
    currentClipId: null,
    markIn: null,
    markOut: null,
    virtualShots: [],
    activeVirtualShotId: null,
    transcripts: {},
    rowNote: {},
    thumbRev: 0,
    pollTimer: null,
    buildingTimeline: new Set(),
  };

  /** Prazan project_id → host koristi aktivni projekt (ne šalji 'default'). */
  function poolProjectId() {
    return QNC.getProjectId?.() || '';
  }

  function panelRoot() {
    return document.getElementById('panel-pool');
  }

  function ref(name) {
    return panelRoot()?.querySelector('[data-qnc-ref="' + name + '"]') || null;
  }

  function timelineRowsEl() {
    return (
      document.querySelector('#panel-pool [data-qnc-panel="timeline-sequence"] [data-qnc-slot="rows"]') ||
      ref('timeline-rows') ||
      document.querySelector('#panel-pool [data-qnc-ref="timeline-rows"]') ||
      document.querySelector('#panel-pool [data-qnc-slot="clip-rows"]') ||
      document.querySelector('#panel-pool .timeline-view')
    );
  }

  function timelineSequencePanel() {
    return document.querySelector('#panel-pool [data-qnc-panel="timeline-sequence"]');
  }

  function updateTimelineSequence() {
    const panel = timelineSequencePanel();
    const api = QNC.components?.get?.('timeline-sequence');
    if (!panel || !api?.update) return false;
    const player = $('pool-player');
    api.update(
      panel,
      {
        clips: pool.clips,
        selected_ids: selectedIds(),
        current_clip_id: pool.currentClipId,
        playhead_sec: player && Number.isFinite(player.currentTime) ? player.currentTime : 0,
        duration_sec: player && Number.isFinite(player.duration) ? player.duration : 0,
        mark_in_sec: pool.markIn,
        mark_out_sec: pool.markOut,
        thumb_rev: pool.thumbRev,
        project_id: poolProjectId(),
        thumbUrl: (id, sec) => thumbUrl(id, sec),
      },
      { pluginId: 'media_pool' }
    );
    return true;
  }

  function updateTimelinePlayback() {
    const panel = timelineSequencePanel();
    const api = QNC.components?.get?.('timeline-sequence');
    if (!panel || !api?.updatePlayback) return;
    const player = $('pool-player');
    api.updatePlayback(panel, {
      clips: pool.clips,
      current_clip_id: pool.currentClipId,
      playhead_sec: player && Number.isFinite(player.currentTime) ? player.currentTime : 0,
      duration_sec: player && Number.isFinite(player.duration) ? player.duration : 0,
      mark_in_sec: pool.markIn,
      mark_out_sec: pool.markOut,
    });
  }

  function thumbUrl(clipId, seek) {
    if (QNC.filmstrip?.thumbUrl) {
      return QNC.filmstrip.thumbUrl(clipId, seek, {
        thumbRev: pool.thumbRev,
        thumbW: THUMB_W,
        projectId: poolProjectId(),
      });
    }
    return (
      '/api/media-pool/thumbnail?clip_id=' +
      encodeURIComponent(clipId) +
      '&seek=' +
      Number(seek).toFixed(3) +
      '&w=' +
      THUMB_W +
      '&project_id=' +
      encodeURIComponent(poolProjectId()) +
      '&r=' +
      pool.thumbRev
    );
  }

  function stripSlotCount() {
    const rows = timelineRowsEl();
    const panelId = QNC.filmstrip?.PANEL_ID || 'filmstrip-viewer';
    const strip =
      rows?.querySelector('[data-qnc-panel="' + panelId + '"] [data-qnc-slot="frames"]') ||
      rows?.querySelector('.thumbnail-strip');
    const ws = rows?.closest('.pool-workspace');
    const fallbackWidth = ws && ws.clientWidth > 0 ? ws.clientWidth - 220 - THUMB_W - 64 - 36 : 0;
    if (!QNC.filmstrip?.stripSlotCount) return 6;
    return QNC.filmstrip.stripSlotCount(strip || fallbackWidth, {
      thumbW: THUMB_W,
      thumbGap: THUMB_GAP,
      maxFrames: THUMB_MAX_FRAMES,
      fallbackWidth,
    });
  }

  function seeksForDisplay(clipId) {
    const slots = stripSlotCount();
    let seeks = pool.timelines[clipId];
    if (seeks === null || seeks === undefined) {
      const clip = clipById(clipId);
      if (clip?.timeline_seeks?.length) {
        seeks = clip.timeline_seeks;
        pool.timelines[clipId] = seeks;
      } else {
        return { slots, list: null };
      }
    }
    if (!QNC.filmstrip?.seeksFromTimeline) {
      return { slots, list: (seeks || []).slice(0, slots) };
    }
    return { slots, list: QNC.filmstrip.seeksFromTimeline(seeks || [], slots) };
  }

  function filmstripPanelForRow(row) {
    if (!row) return null;
    return (
      row.querySelector('[data-qnc-panel="filmstrip-viewer"]') ||
      row.querySelector('[data-qnc-component="filmstrip-viewer"]')
    );
  }

  function syncFilmstripForClip(clip, rowEl) {
    const row =
      rowEl ||
      document.querySelector('.timeline-row[data-clip-id="' + CSS.escape(clip.clip_id) + '"]');
    const panel = filmstripPanelForRow(row);
    if (!panel || !QNC.filmstrip?.update) return;
    QNC.filmstrip.mountPanel(panel, 'media_pool');
    const { slots, list } = seeksForDisplay(clip.clip_id);
    QNC.filmstrip.update(panel, {
      hostPluginId: 'media_pool',
      clip,
      filmstrip: {
        status: list === null ? 'missing' : 'ready',
        seeks: list || [],
        error: clip.filmstrip_error || '',
      },
      seeks: list,
      loading: list === null,
      slots,
      durationSec: clip.timeline_duration_sec || clipDuration(clip),
      thumbRev: pool.thumbRev,
      thumbUrl: (id, sec) => thumbUrl(id, sec),
      formatDuration,
      snapFn: (sec) => snapToFrame(sec, clip),
      placeholder: 'Sličice se generiraju…',
    });
  }

  async function mountFilmstripsIn(root) {
    if (!root || !QNC.resolveComponents) return;
    await QNC.resolveComponents(root);
  }

  async function syncAllFilmstrips(root) {
    const scope = root || timelineRowsEl();
    if (!scope) return;
    await mountFilmstripsIn(scope);
    pool.clips.forEach((clip) => {
      const row = scope.querySelector('.timeline-row[data-clip-id="' + CSS.escape(clip.clip_id) + '"]');
      syncFilmstripForClip(clip, row);
    });
  }

  function rowHtml(c) {
    const id = c.clip_id || '';
    const sel = pool.selected.has(id);
    const st = transcriptStatus(c);
    const dur = clipDuration(c);
    const rowCls =
      'timeline-row' +
      (pool.currentClipId === id ? ' pool-row-active' : '') +
      (st === 'complete' ? ' pool-row-ok' : '') +
      (st === 'failed' ? ' pool-row-err' : '');
    const note = clipNote(id, c);
    return (
      '<div class="' +
      rowCls +
      '" data-clip-id="' +
      QNC.esc(id) +
      '">' +
      '<div class="timeline-label">' +
      '<div class="timeline-title">' +
      '<input type="checkbox" class="pool-row-chk" data-id="' +
      QNC.esc(id) +
      '"' +
      (sel ? ' checked' : '') +
      '/>' +
      '<span class="timeline-filename">' +
      QNC.esc(id) +
      '</span></div>' +
      '<div class="timeline-meta">' +
      QNC.esc(formatDuration(dur)) +
      ' | ' +
      QNC.esc(transcriptLabel(c)) +
      ' | ' +
      QNC.esc(note) +
      '</div></div>' +
      '<section class="qnc-component qnc-filmstrip-viewer qnc-filmstrip-inline" data-qnc-panel="filmstrip-viewer">' +
      '<div class="thumbnail-strip" data-qnc-slot="frames"></div></section>' +
      '<button type="button" class="clip-edge-btn" data-id="' +
      QNC.esc(id) +
      '">' +
      QNC.esc(formatDuration(dur)) +
      '</button></div>'
    );
  }

  function bindClipRow(rowsRoot, clip) {
    const id = clip.clip_id;
    const row = rowsRoot.querySelector('.timeline-row[data-clip-id="' + CSS.escape(id) + '"]');
    if (!row) return;
    const chk = row.querySelector('.pool-row-chk[data-id="' + CSS.escape(id) + '"]');
    if (chk) {
      chk.addEventListener('click', (e) => e.stopPropagation());
      chk.addEventListener('change', () => {
        if (chk.checked) pool.selected.add(id);
        else pool.selected.delete(id);
        updateUi();
      });
    }
    row.addEventListener('click', (ev) => {
      if (ev.target.closest('.pool-row-chk, .clip-edge-btn, .thumb-btn, .qnc-media-thumb-btn')) return;
      playClip(clip, 0);
    });
    syncFilmstripForClip(clip, row);
    const edge = row.querySelector('.clip-edge-btn[data-id="' + CSS.escape(id) + '"]');
    if (edge) {
      edge.onclick = () => {
        const d = clipDuration(clip);
        playClip(clip, Math.max(0, d - 0.5));
      };
    }
  }

  async function renderRows() {
    if (updateTimelineSequence()) {
      updateUi();
      return;
    }
    const rows = timelineRowsEl();
    if (!rows) {
      QNC.log('[Media Pool] nema timeline-rows slota u panel-pool', 'err');
      return;
    }
    if (!pool.clips.length) {
      rows.innerHTML =
        '<p class="grid-empty muted">Nema uvezenih klipova — prvo Uvezi na Ingest tabu, zatim Osvježi pool.</p>';
      updateUi();
      return;
    }
    rows.innerHTML = pool.clips.map(rowHtml).join('');
    await syncAllFilmstrips(rows);
    pool.clips.forEach((clip) => bindClipRow(rows, clip));
    updateUi();
  }

  function pruneTimelines() {
    const inPool = new Set(ids());
    Object.keys(pool.timelines).forEach((id) => {
      if (!inPool.has(id)) delete pool.timelines[id];
    });
  }

  function applyTimelinesFromClips(clipList) {
    clipList.forEach((c) => {
      if (c.timeline_seeks?.length) pool.timelines[c.clip_id] = c.timeline_seeks;
    });
  }

  function timelineKey(clip) {
    return (clip.timeline_seeks || []).join(',');
  }

  function reconcileClipRows(nextClips, nextVirtualShots) {
    const rows = timelineRowsEl();
    const oldClips = pool.clips;
    const oldIds = ids();
    const oldById = new Map(oldClips.map((clip) => [clip.clip_id, clip]));
    const wasEmpty = !oldIds.length;
    const nextIds = nextClips.map((c) => c.clip_id).filter(Boolean);
    const oldSet = new Set(oldIds);
    const nextSet = new Set(nextIds);
    const removed = oldIds.some((id) => !nextSet.has(id));
    const orderChanged =
      oldIds.length &&
      (oldIds.length !== nextIds.length ||
        nextIds.slice(0, oldIds.length).some((id, idx) => id !== oldIds[idx]));

    pool.clips = nextClips;
    applyVirtualShots(nextVirtualShots, { force: false });
    applyTimelinesFromClips(pool.clips);
    pruneTimelines();
    pruneTranscripts();

    if (updateTimelineSequence()) {
      updateUi();
      return;
    }

    if (!rows) return;

    if (wasEmpty || removed || orderChanged) {
      renderRows().catch((e) => QNC.setBox('Pool: ' + e.message, 'err'));
      return;
    }

    for (const clip of nextClips) {
      const id = clip.clip_id;
      if (!id) continue;
      if (!oldSet.has(id)) {
        if (rows.querySelector('.grid-empty')) rows.innerHTML = '';
        rows.insertAdjacentHTML('beforeend', rowHtml(clip));
        mountFilmstripsIn(rows.lastElementChild)
          .then(() => syncFilmstripForClip(clip, rows.lastElementChild))
          .catch(() => {});
        bindClipRow(rows, clip);
        continue;
      }
      const old = oldById.get(id) || {};
      if (timelineKey(old) !== timelineKey(clip)) {
        const row = rows.querySelector('.timeline-row[data-clip-id="' + CSS.escape(id) + '"]');
        syncFilmstripForClip(clip, row);
      }
      const transcriptChanged = !!old.has_transcript !== !!clip.has_transcript;
      const noteChanged = clipNote(id, old) !== clipNote(id, clip);
      if (transcriptChanged || noteChanged) {
        const row = rows.querySelector('.timeline-row[data-clip-id="' + CSS.escape(id) + '"]');
        const meta = row?.querySelector('.timeline-meta');
        if (meta) {
          meta.textContent =
            formatDuration(clipDuration(clip)) +
            ' | ' +
            transcriptLabel(clip) +
            ' | ' +
            clipNote(id, clip);
        }
      }
    }
    updateUi();
  }

  async function loadPool() {
    const pid = poolProjectId();
    const d = sdkCtx
      ? await sdkCtx.api.get('/clips', { project_id: pid })
      : await QNC.api('GET', '/api/media-pool/clips?project_id=' + encodeURIComponent(pid));
    if (d.project_id && QNC.setActiveProjectId) QNC.setActiveProjectId(d.project_id);
    const nextClips = d.clips || [];
    const nextVirtualShots = d.virtual_shots || [];
    const signature = JSON.stringify({
      clips: nextClips.map((c) => [
        c.clip_id,
        c.transferred,
        c.has_transcript,
        c.filmstrip_status || 'missing',
        c.filmstrip_error || '',
        (c.timeline_seeks || []).length,
        c.timeline_duration_sec || 0,
      ]),
      virtual: virtualShotsSignature(nextVirtualShots),
    });
    if (signature === pool.lastSignature) return d;
    pool.lastSignature = signature;
    reconcileClipRows(nextClips, nextVirtualShots);
    requestMissingTimelines();
    return d;
  }

  function clipNote(clipId, c) {
    const note = pool.rowNote[clipId] || '';
    if (note) return note;
    const parts = [];
    if (c.transferred) parts.push('u projektu');
    else if (c.discovered) parts.push('na SD');
    if (c.has_transcript) parts.push('transkript');
    return parts.join(' · ') || '—';
  }

  const REF_BY_LEGACY_ID = {
    'pool-player': 'player',
    'pool-active-transcript': 'active-transcript',
    'chk-pool-select-all': 'select-all',
    'pool-summary': 'summary',
    'btn-pool-refresh': 'refresh',
    'btn-transcribe': 'transcribe',
    'pool-timeline-rows': 'timeline-rows',
    'pool-current-clip': 'current-clip',
    'pool-virtual-shots': 'virtual-shots',
    'pool-time-current': 'time-current',
    'pool-time-total': 'time-total',
    'pool-cut-selection': 'cut-selection',
    'pool-cut-in': 'cut-in',
    'pool-cut-out': 'cut-out',
    'pool-scrubber': 'scrubber',
    'pool-mark-in-val': 'mark-in-val',
    'pool-mark-in': 'mark-in',
    'pool-mark-out': 'mark-out',
    'pool-mark-out-val': 'mark-out-val',
    'pool-save-inout': 'save-inout',
    'pool-mark-duration': 'mark-duration',
  };

  function $(id) {
    if (id === ROWS_ID || id === 'pool-timeline-rows' || id === 'timeline-rows') {
      return timelineRowsEl();
    }
    return ref(REF_BY_LEGACY_ID[id] || id);
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
    const probe = c.media_probe || {};
    if (probe.duration_sec) return Number(probe.duration_sec);
    if (c.timeline_duration_sec) return Number(c.timeline_duration_sec);
    return 0;
  }

  function transcriptStatus(c) {
    if (pool.rowNote[c.clip_id]?.indexOf('greška') >= 0) return 'failed';
    if (c.has_transcript) return 'complete';
    if (pool.rowNote[c.clip_id]?.indexOf('ASR') >= 0) return 'pending';
    return 'none';
  }

  function transcriptLabel(c) {
    const st = transcriptStatus(c);
    if (st === 'complete') return 'Transkript OK';
    if (st === 'failed') return 'Transkript greška';
    if (st === 'pending') return 'Transkript…';
    return 'Transkript —';
  }

  function ids() {
    return pool.clips.map((c) => c.clip_id).filter(Boolean);
  }

  function selectedIds() {
    return ids().filter((id) => pool.selected.has(id));
  }

  function clipById(id) {
    return pool.clips.find((c) => c.clip_id === id) || null;
  }

  function mediaUrl(clipId) {
    return '/api/media-pool/media?clip_id=' + encodeURIComponent(clipId);
  }

  function syncSelectAll() {
    const chk = $('chk-pool-select-all');
    const all = ids();
    if (!chk) return;
    if (!all.length) {
      chk.checked = false;
      chk.indeterminate = false;
      return;
    }
    const n = selectedIds().length;
    chk.checked = n === all.length;
    chk.indeterminate = n > 0 && n < all.length;
  }

  function poolExtra() {
    const t = pool.clips.length;
    const tx = pool.clips.filter((c) => c.has_transcript).length;
    return t ? t + ' u poolu · ' + tx + ' transkript' : '';
  }

  function updateUi() {
    QNC.setShellSelection('pool', selectedIds().length, ids().length, poolExtra());
    syncSelectAll();
    const tr = $('btn-transcribe');
    if (tr) tr.disabled = selectedIds().length === 0;
  }

  function markerPct(seconds, duration) {
    if (!duration || seconds == null || !Number.isFinite(seconds)) return 0;
    return Math.max(0, Math.min(100, (seconds / duration) * 100));
  }

  function updateCutMarkers() {
    const player = $('pool-player');
    const cutSel = $('pool-cut-selection');
    const cutIn = $('pool-cut-in');
    const cutOut = $('pool-cut-out');
    if (!player || !cutSel) return;
    const dur = Number.isFinite(player.duration) ? player.duration : 0;
    const hasIn = pool.markIn != null;
    const hasOut = pool.markOut != null;
    if (cutIn) cutIn.hidden = !hasIn;
    if (cutOut) cutOut.hidden = !hasOut;
    if (hasIn && cutIn) cutIn.style.left = markerPct(pool.markIn, dur) + '%';
    if (hasOut && cutOut) cutOut.style.left = markerPct(pool.markOut, dur) + '%';
    const showSel = hasIn && hasOut && pool.markOut > pool.markIn;
    cutSel.hidden = !showSel;
    if (showSel) {
      const a = markerPct(pool.markIn, dur);
      const b = markerPct(pool.markOut, dur);
      cutSel.style.left = a + '%';
      cutSel.style.width = Math.max(0, b - a) + '%';
    }
  }

  function syncTransport() {
    const player = $('pool-player');
    const scrub = $('pool-scrubber');
    const cur = $('pool-time-current');
    const tot = $('pool-time-total');
    const markInVal = $('pool-mark-in-val');
    const markOutVal = $('pool-mark-out-val');
    const markDur = $('pool-mark-duration');
    if (!player || !scrub) return;
    const dur = Number.isFinite(player.duration) ? player.duration : 0;
    const t = Number.isFinite(player.currentTime) ? player.currentTime : 0;
    scrub.max = String(dur || 0);
    scrub.value = String(Math.min(t, dur || t));
    if (cur) cur.textContent = formatDuration(t);
    if (tot) tot.textContent = formatDuration(dur);
    if (markInVal) {
      markInVal.textContent = pool.markIn == null ? '-' : formatDuration(pool.markIn);
    }
    if (markOutVal) {
      markOutVal.textContent = pool.markOut == null ? '-' : formatDuration(pool.markOut);
    }
    if (markDur) {
      if (pool.markIn != null && pool.markOut != null && pool.markOut > pool.markIn) {
        markDur.textContent = formatDuration(pool.markOut - pool.markIn);
      } else {
        markDur.textContent = '-';
      }
    }
    updateCutMarkers();
    highlightTranscriptAtTime(t);
    updateTimelinePlayback();
  }

  const SENTENCE_END = /[.!?…]["')\]]*$|[.!?…]$/;

  function wordsToSentenceSegments(words) {
    const segs = [];
    if (!words?.length) return segs;
    let bucket = [];
    let start = 0;
    let end = 0;
    function flush() {
      if (!bucket.length) return;
      segs.push({ start, end, text: bucket.join(' ') });
      bucket = [];
    }
    for (const w of words) {
      const word = (w.word || '').trim();
      if (!word) continue;
      if (!bucket.length) start = Number(w.start || 0);
      bucket.push(word);
      end = Number(w.end || start);
      if (SENTENCE_END.test(word)) flush();
    }
    flush();
    return segs;
  }

  function transcriptToSegments(transcript) {
    const raw = transcript?.segments;
    if (raw?.length) {
      return raw
        .map((s) => ({
          start: Number(s.start || 0),
          end: Number(s.end || 0),
          text: String(s.text || '').trim(),
        }))
        .filter((s) => s.text);
    }
    return wordsToSentenceSegments(transcript?.words || []);
  }

  function transcriptBody() {
    return $('pool-active-transcript')?.querySelector('.pool-transcript-body') || null;
  }

  function activeTranscriptChunk() {
    return transcriptBody()?.querySelector('.transcript-chunk-active') || null;
  }

  function highlightTranscriptAtTime(t) {
    const body = transcriptBody();
    if (!body) return;
    const time = Number(t || 0);
    const player = $('pool-player');
    const playing = player && !player.paused;
    body.querySelectorAll('.transcript-chunk').forEach((chunk) => {
      const start = Number(chunk.dataset.start || 0);
      const end = Number(chunk.dataset.end || 0);
      chunk.classList.toggle('transcript-chunk-playing', playing && time >= start && time < end);
    });
  }

  function seekTo(seconds, autoplay) {
    const player = $('pool-player');
    if (!player?.src) return;
    const t = Math.max(0, Number(seconds || 0));
    player.currentTime = t;
    if (autoplay) player.play().catch(() => {});
    else player.pause();
    syncTransport();
  }

  function positionTranscriptHud(chunk, show) {
    const scroll = $('pool-active-transcript')?.querySelector('.pool-transcript-scroll');
    const hud = scroll?.querySelector('.pool-transcript-hud');
    if (!scroll || !hud || !chunk) return;
    if (show === false) {
      hud.hidden = true;
      return;
    }
    const clip = pool.currentClipId ? clipById(pool.currentClipId) : null;
    const fps = fpsForClip(clip);
    const start = Number(chunk.dataset.start || 0);
    const parts = formatSpanSfParts(start, fps);
    const timeEl = hud.querySelector('.pool-transcript-hud-time');
    const framesEl = hud.querySelector('.pool-transcript-hud-frames');
    const inMark = hud.querySelector('.pool-transcript-hud-mark.in');
    const outMark = hud.querySelector('.pool-transcript-hud-mark.out');
    if (timeEl) timeEl.textContent = parts.sec + ':';
    if (framesEl) framesEl.textContent = parts.frames;
    const chunkStart = Number(chunk.dataset.start || 0);
    const chunkEnd = Number(chunk.dataset.end || chunkStart);
    const hasIn =
      pool.markIn != null && chunkStart <= pool.markIn && chunkEnd > pool.markIn;
    const hasOut =
      pool.markOut != null && chunkStart < pool.markOut && chunkEnd >= pool.markOut;
    if (inMark) inMark.classList.toggle('is-on', hasIn);
    if (outMark) outMark.classList.toggle('is-on', hasOut);
    const top = chunk.offsetTop - hud.offsetHeight - 6;
    const left = Math.max(0, chunk.offsetLeft);
    hud.style.top = Math.max(0, top) + 'px';
    hud.style.left = left + 'px';
    hud.hidden = false;
  }

  function updateTranscriptChunkMarkers() {
    const body = transcriptBody();
    if (!body) return;
    const inT = pool.markIn;
    const outT = pool.markOut;
    body.querySelectorAll('.transcript-chunk').forEach((chunk) => {
      const start = Number(chunk.dataset.start || 0);
      const end = Number(chunk.dataset.end || start);
      chunk.classList.remove(
        'transcript-chunk-mark-in',
        'transcript-chunk-mark-out',
        'transcript-chunk-in-range'
      );
      if (inT != null && start <= inT && end > inT) chunk.classList.add('transcript-chunk-mark-in');
      if (outT != null && start < outT && end >= outT) chunk.classList.add('transcript-chunk-mark-out');
      if (inT != null && outT != null && outT > inT && end > inT && start < outT) {
        chunk.classList.add('transcript-chunk-in-range');
      }
    });
    const active = activeTranscriptChunk();
    if (active) positionTranscriptHud(active);
  }

  function markTranscriptIzrez() {
    const body = transcriptBody();
    if (!body) return;
    body.querySelectorAll('.transcript-chunk-in-range').forEach((chunk) => {
      chunk.classList.add('transcript-chunk-izrez');
      chunk.classList.remove('transcript-chunk-in-range');
    });
  }

  function onTranscriptChunkClick(chunk) {
    const body = transcriptBody();
    if (!body || !chunk) return;
    body.querySelectorAll('.transcript-chunk').forEach((el) => {
      el.classList.remove('transcript-chunk-active', 'transcript-chunk-playing');
    });
    chunk.classList.add('transcript-chunk-active');
    positionTranscriptHud(chunk);
    seekTo(Number(chunk.dataset.start || 0), false);
  }

  function ensureTranscriptShell(box) {
    let scroll = box.querySelector('.pool-transcript-scroll');
    if (scroll) return scroll;
    box.innerHTML = '';
    scroll = document.createElement('div');
    scroll.className = 'pool-transcript-scroll';
    const hud = document.createElement('div');
    hud.className = 'pool-transcript-hud';
    hud.hidden = true;
    hud.innerHTML =
      '<span class="pool-transcript-hud-time"></span>' +
      '<span class="pool-transcript-hud-frames"></span>' +
      '<span class="pool-transcript-hud-mark in">IN</span>' +
      '<span class="pool-transcript-hud-mark out">OUT</span>';
    const body = document.createElement('div');
    body.className = 'pool-transcript-body';
    scroll.append(hud, body);
    box.appendChild(scroll);
    scroll.addEventListener('scroll', () => {
      const active = activeTranscriptChunk();
      const hud = scroll.querySelector('.pool-transcript-hud');
      if (active && hud && !hud.hidden) positionTranscriptHud(active);
    });
    return scroll;
  }

  function createTranscriptChunk(seg) {
    const span = document.createElement('span');
    span.className = 'transcript-chunk';
    span.dataset.start = String(seg.start);
    span.dataset.end = String(seg.end);
    span.textContent = (seg.text || '').trim();
    span.addEventListener('click', () => onTranscriptChunkClick(span));
    return span;
  }

  function beginLiveTranscript(clipId) {
    const pid = poolProjectId();
    const cacheKey = pid + '::' + clipId;
    pool.transcripts[cacheKey] = { segments: [], text: '', words: [] };
    pool.liveTranscriptClip = clipId;
    const box = $('pool-active-transcript');
    if (!box) return;
    box.classList.remove('muted');
    const scroll = ensureTranscriptShell(box);
    const body = scroll.querySelector('.pool-transcript-body');
    if (body) body.innerHTML = '';
    const hint = document.createElement('p');
    hint.className = 'transcript-live-hint muted';
    hint.textContent = 'Transkripcija u tijeku…';
    body?.appendChild(hint);
  }

  function appendTranscriptSegment(clipId, seg) {
    const box = $('pool-active-transcript');
    if (!box || pool.liveTranscriptClip !== clipId) return;
    const body = transcriptBody() || ensureTranscriptShell(box).querySelector('.pool-transcript-body');
    if (!body) return;
    const hint = body.querySelector('.transcript-live-hint');
    if (hint) hint.remove();
    body.appendChild(createTranscriptChunk(seg));
    const scroll = box.querySelector('.pool-transcript-scroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;

    const pid = poolProjectId();
    const cacheKey = pid + '::' + clipId;
    const tr = pool.transcripts[cacheKey] || { segments: [], text: '', words: [] };
    tr.segments = tr.segments || [];
    tr.segments.push(seg);
    tr.text = (tr.text ? tr.text + ' ' : '') + (seg.text || '');
    pool.transcripts[cacheKey] = tr;
  }

  function finishLiveTranscript(clipId, transcript) {
    pool.liveTranscriptClip = null;
    const pid = poolProjectId();
    const cacheKey = pid + '::' + clipId;
    if (transcript) pool.transcripts[cacheKey] = transcript;
    if (pool.currentClipId === clipId) {
      renderTranscriptPanel(pool.transcripts[cacheKey] || transcript);
    }
  }

  function renderTranscriptPanel(transcript) {
    const box = $('pool-active-transcript');
    if (!box) return;
    if (pool.liveTranscriptClip) return;
    if (!transcript) {
      box.innerHTML = 'Nema transkripta — označi clip i pokreni transkripciju.';
      box.classList.add('muted');
      return;
    }
    box.classList.remove('muted');
    const text = transcript.text || '';
    const segments = transcriptToSegments(transcript);
    if (!segments.length) {
      box.innerHTML = text || 'Transkript prazan.';
      return;
    }
    const scroll = ensureTranscriptShell(box);
    const body = scroll.querySelector('.pool-transcript-body');
    if (!body) return;
    body.innerHTML = '';
    for (const seg of segments) {
      body.appendChild(createTranscriptChunk(seg));
    }
    updateTranscriptChunkMarkers();
    const player = $('pool-player');
    if (player) highlightTranscriptAtTime(player.currentTime || 0);
  }

  async function transcribeClipStream(clipId, pid) {
    const res = await fetch('/api/ai-search/transcribe-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clip_ids: [clipId], language: 'hr-HR', project_id: pid }),
    });
    if (!res.ok) {
      const text = await res.text();
      let msg = text;
      try {
        const d = JSON.parse(text);
        msg = (d.detail && d.detail.message) || d.message || text;
      } catch {
        /* raw text */
      }
      throw new Error(msg || 'Transkripcija nije uspjela');
    }
    const reader = res.body && res.body.getReader ? res.body.getReader() : null;
    if (!reader) throw new Error('Stream nije dostupan');

    const decoder = new TextDecoder();
    let buffer = '';
    let lastEvent = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() || '';
      for (const chunk of chunks) {
        const line = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        let ev;
        try {
          ev = JSON.parse(line.slice(6));
        } catch {
          continue;
        }
        lastEvent = ev;
        if (ev.type === 'segment' && ev.segment) {
          appendTranscriptSegment(clipId, ev.segment);
        } else if (ev.type === 'error') {
          throw new Error(ev.error || 'Transkripcija nije uspjela');
        }
      }
    }
    return lastEvent;
  }

  async function loadTranscript(clipId) {
    if (pool.liveTranscriptClip === clipId) return;
    const pid = poolProjectId();
    const cacheKey = pid + '::' + clipId;
    if (pool.transcripts[cacheKey]) {
      renderTranscriptPanel(pool.transcripts[cacheKey]);
      return;
    }
    try {
      const d = await QNC.api(
        'GET',
        '/api/ai-search/transcript/' +
          encodeURIComponent(clipId) +
          '?project_id=' +
          encodeURIComponent(pid)
      );
      pool.transcripts[cacheKey] = d.transcript || null;
      renderTranscriptPanel(pool.transcripts[cacheKey]);
    } catch {
      renderTranscriptPanel(null);
    }
  }

  function updatePlayerChrome() {
    const label = $('pool-current-clip');
    const c = pool.currentClipId ? clipById(pool.currentClipId) : null;
    if (label) {
      label.textContent = c ? c.clip_id : 'Klikni sličicu za odabir clipa';
    }
    const txKey = c?.clip_id && poolProjectId() + '::' + c.clip_id;
    if (c?.has_transcript || (txKey && pool.transcripts[txKey])) {
      loadTranscript(c.clip_id);
    } else {
      renderTranscriptPanel(null);
    }
    syncTransport();
    renderVirtualShots();
  }

  function virtualShotThumbUrl(shotId, kind) {
    const pid = poolProjectId();
    return (
      '/api/media-pool/virtual-shot/' +
      encodeURIComponent(shotId) +
      '/thumb?project_id=' +
      encodeURIComponent(pid) +
      '&kind=' +
      encodeURIComponent(kind || 'in') +
      '&r=' +
      pool.thumbRev
    );
  }

  function virtualShotDuration(shot) {
    const duration = Number(shot.duration_seconds || 0);
    if (duration > 0) return duration;
    const inSec = Number(shot.in_seconds || 0);
    const outSec = Number(shot.out_seconds || 0);
    return outSec > inSec ? outSec - inSec : 0;
  }

  function virtualShotsSignature(shots) {
    return JSON.stringify(
      (shots || []).map((s) => [
        s.id,
        s.clip_id,
        s.in_seconds,
        s.out_seconds,
        s.duration_seconds,
        s.source,
      ])
    );
  }

  function applyVirtualShots(nextVirtualShots, options) {
    const force = !!(options && options.force);
    const sig = virtualShotsSignature(nextVirtualShots);
    const changed = force || sig !== runtime.lastVirtualSignature;
    pool.virtualShots = nextVirtualShots || [];
    if (changed) {
      runtime.lastVirtualSignature = sig;
      renderVirtualShots();
    }
  }

  function renderVirtualShots() {
    const box = $('pool-virtual-shots');
    if (!box) return;
    const shots = shotsForCurrentClip();
    if (!pool.currentClipId) {
      box.innerHTML = '<span class="muted">Odaberi clip.</span>';
      return;
    }
    if (!shots.length) {
      box.innerHTML = '<span class="muted">Nema virtualnih kadrova — IN, OUT, Enter.</span>';
      return;
    }
    const clip = pool.currentClipId ? clipById(pool.currentClipId) : null;
    const fps = fpsForClip(clip);
    box.innerHTML = shots
      .map((shot) => {
        const active = pool.activeVirtualShotId === shot.id ? ' pool-vshot-active' : '';
        const originClass = shot.source === 'ai' ? ' pool-vshot-ai' : ' pool-vshot-manual';
        const dur = formatSpanSfParts(virtualShotDuration(shot), fps);
        return (
          '<div class="pool-vshot-item' +
          active +
          originClass +
          '" data-shot-id="' +
          QNC.esc(shot.id) +
          '" title="' +
          (shot.source === 'ai' ? 'AI kadar' : 'Ručni kadar') +
          '">' +
          '<button type="button" class="pool-vshot-thumb" data-play-shot="' +
          QNC.esc(shot.id) +
          '"><img src="' +
          virtualShotThumbUrl(shot.id, 'in') +
          '" alt="" loading="lazy"/></button>' +
          '<span class="pool-vshot-dur">' +
          QNC.esc(dur.sec) +
          ':<span class="pool-vshot-dur-frames">' +
          QNC.esc(dur.frames) +
          '</span></span>' +
          '<button type="button" class="pool-vshot-thumb" data-play-shot="' +
          QNC.esc(shot.id) +
          '"><img src="' +
          virtualShotThumbUrl(shot.id, 'out') +
          '" alt="" loading="lazy"/></button></div>'
        );
      })
      .join('');
    box.querySelectorAll('[data-play-shot]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const shot = shots.find((s) => s.id === btn.dataset.playShot);
        if (shot) playVirtualShot(shot);
      });
    });
  }

  function playVirtualShot(shot) {
    const clip = clipById(shot.clip_id);
    if (!clip) return;
    pool.markIn = Number(shot.in_seconds);
    pool.markOut = Number(shot.out_seconds);
    pool.activeVirtualShotId = shot.id;
    playClip(clip, pool.markIn, false);
    syncTransport();
    renderVirtualShots();
  }

  function playClip(clip, startAt, resetMarks) {
    const player = $('pool-player');
    if (!player || !clip?.clip_id) return;
    if (resetMarks !== false) {
      pool.markIn = null;
      pool.markOut = null;
      pool.activeVirtualShotId = null;
    }
    const seekSec = Number(startAt || 0);
    const sameClip = pool.currentClipId === clip.clip_id && player.src;
    pool.currentClipId = clip.clip_id;
    const applySeek = () => {
      player.currentTime = seekSec;
      syncTransport();
    };
    if (!sameClip) {
      player.src = mediaUrl(clip.clip_id);
      player.onloadedmetadata = () => applySeek();
    } else if (player.readyState >= 1) {
      applySeek();
    } else {
      player.onloadedmetadata = () => applySeek();
    }
    player.play().catch(() => {});
    document.querySelectorAll('.timeline-row').forEach((row) => {
      row.classList.toggle('pool-row-active', row.dataset.clipId === clip.clip_id);
    });
    updatePlayerChrome();
    renderVirtualShots();
    loadTranscript(clip.clip_id);
  }

  function pruneTranscripts() {
    const inPool = new Set(ids());
    Object.keys(pool.transcripts).forEach((key) => {
      const clipId = key.includes('::') ? key.split('::').slice(1).join('::') : key;
      if (!inPool.has(clipId)) delete pool.transcripts[key];
    });
  }

  function requestMissingTimelines() {
    if (QNC.getActiveTab?.() !== 'pool') return;
    const missing = pool.clips
      .filter((clip) => {
        const status = String(clip.filmstrip_status || 'missing');
        return (
          clip.transferred &&
          !(clip.timeline_seeks || []).length &&
          status !== 'building' &&
          status !== 'ready'
        );
      })
      .filter((clip) => !pool.buildingTimeline.has(clip.clip_id))
      .slice(0, 1);
    missing.forEach((clip) => {
      const pid = poolProjectId();
      pool.buildingTimeline.add(clip.clip_id);
      const buildReq = sdkCtx
        ? sdkCtx.action('filmstrip.build', {
            clip_id: clip.clip_id,
            frames: Math.min(10, THUMB_MAX_FRAMES),
            project_id: pid,
            media_path: clip.proxy_path || '',
          })
        : QNC.api('POST', '/api/media-pool/timeline/build', {
            clip_id: clip.clip_id,
            frames: Math.min(10, THUMB_MAX_FRAMES),
            project_id: pid,
            media_path: clip.proxy_path || '',
          });
      buildReq
        .then(() => {
          pool.buildingTimeline.delete(clip.clip_id);
          return loadPool();
        })
        .catch((e) => {
          pool.buildingTimeline.delete(clip.clip_id);
          QNC.log('[Media Pool] film-strip: ' + e.message, 'err');
        });
    });
  }

  function startPoolPolling() {
    if (pool.pollTimer) return;
    pool.pollTimer = setInterval(() => {
      if (QNC.getActiveTab?.() !== 'pool') return;
      loadPool().catch((e) => QNC.log('[Media Pool] auto refresh: ' + e.message, 'err'));
    }, 2000);
  }

  function stopPoolPolling() {
    if (!pool.pollTimer) return;
    clearInterval(pool.pollTimer);
    pool.pollTimer = null;
  }

  /** Oslobodi proxy stream prije brisanja projekta (Windows drži lock na open file). */
  function releasePlayerMedia() {
    const player = $('pool-player');
    if (!player) return;
    player.pause();
    player.removeAttribute('src');
    try {
      player.load();
    } catch (_) {
      /* ignore */
    }
  }

  function releaseProjectHold() {
    stopPoolPolling();
    releasePlayerMedia();
    pool.lastSignature = '';
    runtime.lastVirtualSignature = '';
    pool.clips = [];
    pool.timelines = {};
    pool.currentClipId = null;
    pool.buildingTimeline.clear();
  }

  function fpsForClip(clip) {
    const raw = String(clip?.media_probe?.fps || clip?.fx6_metadata?.fps || '');
    const parsed = parseFloat(raw);
    return parsed > 0 ? parsed : 25;
  }

  function fpsForCurrentClip() {
    return fpsForClip(pool.currentClipId ? clipById(pool.currentClipId) : null);
  }

  function snapToFrame(seconds, clip) {
    const fps = fpsForClip(clip);
    const frame = 1 / fps;
    if (!Number.isFinite(seconds) || frame <= 0) return seconds || 0;
    return Math.max(0, Math.round(seconds / frame) * frame);
  }

  function secondsToTc(seconds, fps) {
    const f = fps > 0 ? fps : 25;
    const total = Math.max(0, Math.round(seconds * f));
    const frames = total % f;
    const totalSec = Math.floor(total / f);
    const ss = totalSec % 60;
    const mm = Math.floor(totalSec / 60) % 60;
    const hh = Math.floor(totalSec / 3600);
    const pad = (n) => String(n).padStart(2, '0');
    return pad(hh) + ':' + pad(mm) + ':' + pad(ss) + ':' + pad(frames);
  }

  /** Trajanje virtualnog kadra: sekunde + kadrovi, npr. 15:23 = 15 s i 23. sličica. */
  function formatSpanSfParts(seconds, fps) {
    const f = fps > 0 ? fps : 25;
    const total = Math.max(0, Math.round(Number(seconds || 0) * f));
    return {
      sec: String(Math.floor(total / f)),
      frames: String(total % f).padStart(2, '0'),
    };
  }

  function markTimeFromTranscript(kind) {
    const chunk = activeTranscriptChunk();
    if (!chunk) return null;
    const start = Number(chunk.dataset.start || 0);
    const end = Number(chunk.dataset.end || start);
    return kind === 'out' ? end : start;
  }

  function setMarkIn() {
    const player = $('pool-player');
    const clip = pool.currentClipId ? clipById(pool.currentClipId) : null;
    if (!player?.src || !clip) {
      QNC.setBox('Prvo odaberi clip (klik na sličicu).', 'err');
      return;
    }
    const fromTx = markTimeFromTranscript('in');
    pool.markIn = snapToFrame(fromTx != null ? fromTx : player.currentTime || 0, clip);
    if (pool.markOut != null && pool.markOut <= pool.markIn) pool.markOut = null;
    pool.activeVirtualShotId = null;
    syncTransport();
    updateTranscriptChunkMarkers();
    renderVirtualShots();
  }

  function setMarkOut() {
    const player = $('pool-player');
    const clip = pool.currentClipId ? clipById(pool.currentClipId) : null;
    if (!player?.src || !clip) {
      QNC.setBox('Prvo odaberi clip (klik na sličicu).', 'err');
      return;
    }
    const fromTx = markTimeFromTranscript('out');
    pool.markOut = snapToFrame(fromTx != null ? fromTx : player.currentTime || 0, clip);
    if (pool.markIn == null) QNC.setBox('Prvo označi IN (I).', 'err');
    if (pool.markOut <= pool.markIn) QNC.setBox('OUT mora biti poslije IN točke.', 'err');
    pool.activeVirtualShotId = null;
    syncTransport();
    updateTranscriptChunkMarkers();
    renderVirtualShots();
  }

  async function saveInOut() {
    const clip = pool.currentClipId ? clipById(pool.currentClipId) : null;
    if (!clip?.clip_id) {
      QNC.setBox('Prvo odaberi clip (klik na sličicu).', 'err');
      return;
    }
    if (pool.markIn == null || pool.markOut == null || pool.markOut <= pool.markIn) {
      QNC.setBox('Označi ispravan IN i OUT prije spremanja.', 'err');
      return;
    }
    const fps = fpsForClip(clip);
    const inSec = snapToFrame(pool.markIn, clip);
    const outSec = snapToFrame(pool.markOut, clip);
    if (outSec <= inSec) {
      QNC.setBox('OUT mora biti poslije IN točke.', 'err');
      return;
    }
    const pid = poolProjectId();
    try {
      QNC.setBox('Spremam virtualni kadar…', 'busy');
      const d = sdkCtx
        ? await sdkCtx.action('virtual-shot.create', {
            project_id: pid,
            clip_id: clip.clip_id,
            in_seconds: inSec,
            out_seconds: outSec,
            windows_original_path: clip.windows_original_path || null,
          })
        : await QNC.api('POST', '/api/media-pool/virtual-shot', {
            project_id: pid,
            clip_id: clip.clip_id,
            in_seconds: inSec,
            out_seconds: outSec,
            windows_original_path: clip.windows_original_path || null,
          });
      applyVirtualShots(d.virtual_shots || pool.virtualShots, { force: true });
      pool.thumbRev++;
      pool.activeVirtualShotId = d.shot?.id || null;
      markTranscriptIzrez();
      pool.markIn = null;
      pool.markOut = null;
      updateTranscriptChunkMarkers();
      syncTransport();
      QNC.setBox('Virtualni kadar spremljen (trajno u projektu).', 'ok');
      QNC.log(
        '[Pool] virtual shot ' + clip.clip_id + ' ' + formatDuration(inSec) + '–' + formatDuration(outSec),
        'ok'
      );
    } catch (e) {
      QNC.setBox('Spremanje: ' + e.message, 'err');
    }
  }

  function togglePlayback() {
    const player = $('pool-player');
    if (!player?.src) return;
    if (player.paused) player.play().catch(() => {});
    else player.pause();
  }

  function stepPlayerByFrames(frameCount) {
    const player = $('pool-player');
    if (!player?.src) return;
    const frame = 1 / fpsForCurrentClip();
    const duration = Number.isFinite(player.duration) ? player.duration : 0;
    const next = (player.currentTime || 0) + frame * frameCount;
    player.currentTime = Math.max(0, Math.min(next, duration || next));
    syncTransport();
  }

  let unbindPoolShortcuts = null;

  async function bindPoolShortcuts() {
    if (!QNC.keyboardShortcuts?.bind) return;
    if (unbindPoolShortcuts) {
      unbindPoolShortcuts();
      unbindPoolShortcuts = null;
    }
    unbindPoolShortcuts = await QNC.keyboardShortcuts.bind(
      'media_pool',
      {
        play_pause: () => togglePlayback(),
        mark_in: () => setMarkIn(),
        mark_out: () => setMarkOut(),
        save_virtual_shot: () => saveInOut(),
        step_back_frame: () => stepPlayerByFrames(-1),
        step_forward_frame: () => stepPlayerByFrames(1),
      },
      {
        isActive: () => QNC.getActiveTab && QNC.getActiveTab() === 'pool',
        ignoreInputIds: [],
      }
    );
  }

  function bindPlayer() {
    const player = $('pool-player');
    const scrub = $('pool-scrubber');
    if (!player || !scrub) return;
    player.addEventListener('timeupdate', syncTransport);
    player.addEventListener('loadedmetadata', syncTransport);
    scrub.addEventListener('input', () => {
      player.currentTime = Number(scrub.value || 0);
      syncTransport();
    });
  }

  function installActionBridge(ctx) {
    if (!actionsInstalled && QNC.installComponentActions) {
      QNC.installComponentActions(panelRoot(), 'media_pool');
      actionsInstalled = true;
    }
    if (busInstalled || !ctx) return;
    ctx.on('filmstrip.seek', (event) => {
      const clipId = event.payload?.clip_id || event.root?.dataset?.clipId;
      const sec = Number(event.payload?.seconds);
      const clip = clipId ? clipById(clipId) : null;
      if (clip && Number.isFinite(sec)) playClip(clip, sec);
    });
    ctx.on('mark.in', setMarkIn);
    ctx.on('mark.out', setMarkOut);
    ctx.on('virtual-shot.create', saveInOut);
    ctx.on('clips.refresh', refresh);
    ctx.on('transcription.queue', transcribe);
    ctx.on('clip.toggle', (event) => {
      const id = String(event.payload?.clip_id || '').trim();
      if (!id) return;
      if (event.payload?.checked) pool.selected.add(id);
      else pool.selected.delete(id);
      updateUi();
    });
    ctx.on('clip.play', (event) => {
      const id = String(event.payload?.clip_id || '').trim();
      const clip = id ? clipById(id) : null;
      if (!clip) return;
      const d = clipDuration(clip);
      const start = event.payload?.edge ? Math.max(0, d - 0.5) : 0;
      playClip(clip, start);
    });
    ctx.on('clips.select-all', (event) => {
      const checked = !!event?.payload?.checked;
      ids().forEach((id) => (checked ? pool.selected.add(id) : pool.selected.delete(id)));
      renderRows();
    });
    busInstalled = true;
  }

  async function refresh() {
    try {
      const keep = new Set(selectedIds());
      pool.lastSignature = '';
      const d = await loadPool();
      pool.selected = new Set([...keep].filter((id) => ids().includes(id)));
      updateUi();
      if (pool.clips.length) {
        QNC.setBox('Media pool: ' + pool.clips.length + ' clipova', 'ok');
      } else {
        QNC.setBox('Media pool prazan.', 'ok');
      }
      return d;
    } catch (e) {
      QNC.setBox('Pool: ' + e.message, 'err');
    }
  }

  async function transcribe() {
    const pid = poolProjectId();
    const list = selectedIds().filter((id) => pool.clips.some((c) => c.clip_id === id));
    if (!list.length) {
      QNC.setBox('Označi checkboxom clipove za transkripciju.', 'err');
      return;
    }
    try {
      const asr = await QNC.api('GET', '/api/asr/health');
      if (asr.status !== 'ok') {
        QNC.setBox(asr.message || 'ASR offline', 'err');
        return;
      }
    } catch (e) {
      QNC.setBox('ASR: ' + e.message, 'err');
      return;
    }
    const btn = ref('transcribe');
    if (btn) btn.disabled = true;
    let ok = 0;
    let fail = 0;
    try {
      for (let i = 0; i < list.length; i++) {
        const id = list[i];
        const clip = clipById(id);
        QNC.setBox('Transkripcija ' + (i + 1) + '/' + list.length + ': ' + id, 'busy');
        pool.rowNote[id] = 'ASR…';
        delete pool.transcripts[pid + '::' + id];
        renderRows();
        if (clip) {
          beginLiveTranscript(id);
          playClip(clip, 0, true);
        }
        try {
          const last = await transcribeClipStream(id, pid);
          if (last?.type === 'complete') {
            finishLiveTranscript(id, last.transcript || null);
            pool.rowNote[id] = 'transkript ✓';
            ok++;
          } else {
            finishLiveTranscript(id, null);
            pool.rowNote[id] = 'greška';
            fail++;
          }
        } catch (e) {
          finishLiveTranscript(id, null);
          pool.rowNote[id] = 'greška';
          fail++;
          if (QNC.getActiveTab && QNC.getActiveTab() === 'pool') {
            QNC.setBox('Transkripcija: ' + (e.message || 'greška'), 'err');
          }
        }
        renderRows();
      }
      await refresh();
      QNC.setBox('Transkripcija: ' + ok + ' OK, ' + fail + ' greška', fail ? 'err' : 'ok');
    } finally {
      pool.liveTranscriptClip = null;
      if (btn) btn.disabled = false;
    }
  }

  const app = QNC.createPluginApp({
    pluginId: 'media_pool',
    tabId: 'pool',
    apiNamespace: '/api/media-pool',
    snapshots: ['media_pool.clips'],
    snapshotLoaders: {
      'media_pool.clips': { path: '/clips', projectScoped: true },
    },
  });

  app.lifecycle({
    onInit(ctx) {
      sdkCtx = ctx;
      bindPlayer();
      bindPoolShortcuts();
      installActionBridge(ctx);

      ctx.onShell('project:changed', () => {
        ctx.store.invalidate('media_pool.clips');
        releaseProjectHold();
        loadPool()
          .then(() => {
            if (pool.clips.length) renderRows();
          })
          .catch((e) => ctx.setStatus('Pool: ' + e.message, 'err'));
      });

      ctx.onShell('project:deleting', () => {
        releaseProjectHold();
      });

      renderRows();
      QNC.log('[Media Pool] SDK modul spreman (WIP)', 'ok');
    },

    onShow(ctx) {
      sdkCtx = ctx;
      startPoolPolling();
      pool.thumbRev += 1;
      loadPool()
        .then(() => {
          if (pool.clips.length) renderRows();
        })
        .catch((e) => ctx.setStatus('Pool: ' + e.message, 'err'));
    },

    onHide() {
      stopPoolPolling();
      releasePlayerMedia();
    },

    onDestroy(ctx) {
      stopPoolPolling();
      releasePlayerMedia();
      if (unbindPoolShortcuts) {
        unbindPoolShortcuts();
        unbindPoolShortcuts = null;
      }
      busInstalled = false;
      actionsInstalled = false;
      sdkCtx = null;
      ctx.teardown();
    },
  });

  app.register();

  QNC.mediaPool = pool;
})(window.QNC);
