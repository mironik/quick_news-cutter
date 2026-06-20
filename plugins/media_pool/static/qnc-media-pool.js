/* Media Pool — Plugin SDK v1. Clips/virtual_shots/workflow iz ctx.store; samo tehnički handle-i lokalno. */
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

  function maxFilmstripFrames() {
    return QNC.filmstrip?.DEFAULTS?.maxFrames || 24;
  }

  const handles = {
    thumbRev: 0,
    pollTimer: null,
    buildingTimeline: new Set(),
    transcribingClips: new Set(), // in-flight mutex only — not used for transcript UI status
    liveTranscriptClip: null,
    lastPoolSignature: '',
    lastClips: [],
    importWatchUntil: 0,
    importWatchCount: 0,
  };

  function snap(ctx) {
    const c = ctx || sdkCtx;
    return (c && c.store?.get?.('media_pool.clips')) || {};
  }

  function snapClips(ctx) {
    return snap(ctx).clips || [];
  }

  function snapVirtualShots(ctx) {
    return snap(ctx).virtual_shots || [];
  }

  function snapSummary(ctx) {
    return snap(ctx).summary || {};
  }

  function snapWorkflow(ctx) {
    return snap(ctx).workflow || {};
  }

  function workflowSelectedIds(ctx) {
    const c = ctx || sdkCtx;
    return (snapWorkflow(c).selected_clip_ids || []).map(String).filter(Boolean);
  }

  function wfCurrentClipId(ctx) {
    const id = String(snapWorkflow(ctx || sdkCtx).current_clip_id || '').trim();
    return id || null;
  }

  function wfMarkIn(ctx) {
    const v = snapWorkflow(ctx || sdkCtx).mark_in_sec;
    return v == null || v === undefined ? null : Number(v);
  }

  function wfMarkOut(ctx) {
    const v = snapWorkflow(ctx || sdkCtx).mark_out_sec;
    return v == null || v === undefined ? null : Number(v);
  }

  function wfActiveVirtualShotId(ctx) {
    const id = String(snapWorkflow(ctx || sdkCtx).active_virtual_shot_id || '').trim();
    return id || null;
  }

  async function writeWorkflow(ctx, patch) {
    const activeCtx = ctx || sdkCtx;
    if (!activeCtx?.action) throw new Error('[Media Pool] SDK nije spreman');
    await activeCtx.action('workflow.patch', { project_id: poolProjectId(), ...(patch || {}) });
    return activeCtx.store.reload('media_pool.clips');
  }

  function shotsForCurrentClip(ctx, allShots) {
    const clipId = wfCurrentClipId(ctx);
    if (!clipId) return [];
    const source = allShots || snapVirtualShots(ctx);
    return source.filter((s) => String(s.clip_id || '') === clipId);
  }

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
      ref('timeline-rows') ||
      document.querySelector('#panel-pool [data-qnc-ref="timeline-rows"]') ||
      document.querySelector('#panel-pool [data-qnc-slot="clip-rows"]') ||
      document.querySelector('#panel-pool .timeline-view')
    );
  }

  function clipListPanel() {
    return document.querySelector('#panel-pool [data-qnc-panel="media-pool-clip-list"]');
  }

  function buildRowNotes() {
    const notes = {};
    handles.transcribingClips.forEach((id) => {
      notes[id] = 'ASR…';
    });
    return notes;
  }

  function clipListPayload(prevClips, forceFull) {
    const player = $('pool-player');
    const currentId = wfCurrentClipId();
    return {
      clips: snapClips(),
      prev_clips: prevClips || handles.lastClips || [],
      forceFull: !!forceFull,
      selected_ids: selectedIds(),
      current_clip_id: currentId,
      thumb_rev: handles.thumbRev,
      project_id: poolProjectId(),
      row_notes: buildRowNotes(),
      thumbUrl: (id, sec) => thumbUrl(id, sec),
      snapFn: (sec, clip) => snapToFrame(sec, clip),
      virtual_shots: snapVirtualShots(),
      active_virtual_shot_id: wfActiveVirtualShotId(),
      mark_in_sec: wfMarkIn(),
      mark_out_sec: wfMarkOut(),
      playhead_sec: player && currentId ? Number(player.currentTime || 0) : 0,
      duration_sec:
        player && currentId && Number.isFinite(player.duration) ? Number(player.duration) : 0,
    };
  }

  function syncClipRowPlayback() {
    const panel = clipListPanel();
    const api = QNC.components?.get?.('media-pool-clip-list');
    if (!panel || !api?.updatePlayback) return;
    api.updatePlayback(panel, clipListPayload(handles.lastClips || []), { pluginId: 'media_pool' });
  }

  async function updateClipList(options) {
    const opts = options || {};
    const panel = clipListPanel();
    const api = QNC.components?.get?.('media-pool-clip-list');
    if (!panel || !api?.update) {
      QNC.log('[Media Pool] clip-list nije spreman (panel=' + !!panel + ', api=' + !!api?.update + ')', 'err');
      return false;
    }
    const prev = handles.lastClips || [];
    await api.update(panel, clipListPayload(prev, opts.forceFull), { pluginId: 'media_pool' });
    handles.lastClips = snapClips().slice();
    updateUi();
    updatePlayerChrome();
    return true;
  }

  function thumbUrl(clipId, seek) {
    if (QNC.filmstrip?.thumbUrl) {
      return QNC.filmstrip.thumbUrl(clipId, seek, {
        thumbRev: handles.thumbRev,
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
      handles.thumbRev
    );
  }

  async function renderRows(options) {
    await updateClipList(options);
  }

  function reconcileClipRows(oldClips, nextClips, nextVirtualShots) {
    applyVirtualShots(nextVirtualShots);
    updateClipList().catch((e) => QNC.setBox('Pool: ' + e.message, 'err'));
  }

  async function loadPool(ctx) {
    const activeCtx = ctx || sdkCtx;
    if (!activeCtx?.store?.reload) {
      throw new Error('[Media Pool] SDK store nije dostupan');
    }
    const oldClips = snapClips(activeCtx);
    const d = await activeCtx.store.reload('media_pool.clips');
    if (d.project_id && QNC.setActiveProjectId) QNC.setActiveProjectId(d.project_id);
    const signature = poolSnapshotSignature(d);
    if (signature === handles.lastPoolSignature) {
      return d;
    }
    handles.lastPoolSignature = signature;
    const nextClips = d.clips || [];
    const nextVirtualShots = d.virtual_shots || [];
    handles.lastClips = oldClips.slice();
    reconcileClipRows(oldClips, nextClips, nextVirtualShots);
    requestMissingTimelines();
    maybeEndImportWatch();
    return d;
  }

  function clipNote(clipId, c) {
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
    if (c.has_transcript || c.transcript_status === 'complete') return 'complete';
    if (c.transcript_status === 'failed') return 'failed';
    if (c.transcript_status === 'pending') return 'pending';
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
    return snapClips().map((c) => c.clip_id).filter(Boolean);
  }

  function selectedIds() {
    return workflowSelectedIds().filter((id) => ids().includes(id));
  }

  function clipById(id) {
    return snapClips().find((c) => c.clip_id === id) || null;
  }

  function mediaUrl(clipId) {
    const pid = poolProjectId();
    const q =
      'clip_id=' +
      encodeURIComponent(clipId) +
      (pid ? '&project_id=' + encodeURIComponent(pid) : '');
    return '/api/media-pool/media?' + q;
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
    const clips = snapClips();
    const t = clips.length;
    const tx = clips.filter((c) => c.has_transcript).length;
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
    const hasIn = wfMarkIn() != null;
    const hasOut = wfMarkOut() != null;
    if (cutIn) cutIn.hidden = !hasIn;
    if (cutOut) cutOut.hidden = !hasOut;
    if (hasIn && cutIn) cutIn.style.left = markerPct(wfMarkIn(), dur) + '%';
    if (hasOut && cutOut) cutOut.style.left = markerPct(wfMarkOut(), dur) + '%';
    const showSel = hasIn && hasOut && wfMarkOut() > wfMarkIn();
    cutSel.hidden = !showSel;
    if (showSel) {
      const a = markerPct(wfMarkIn(), dur);
      const b = markerPct(wfMarkOut(), dur);
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
      markInVal.textContent = wfMarkIn() == null ? '-' : formatDuration(wfMarkIn());
    }
    if (markOutVal) {
      markOutVal.textContent = wfMarkOut() == null ? '-' : formatDuration(wfMarkOut());
    }
    if (markDur) {
      if (wfMarkIn() != null && wfMarkOut() != null && wfMarkOut() > wfMarkIn()) {
        markDur.textContent = formatDuration(wfMarkOut() - wfMarkIn());
      } else {
        markDur.textContent = '-';
      }
    }
    updateCutMarkers();
    highlightTranscriptAtTime(t);
    syncClipRowPlayback();
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
    const clip = wfCurrentClipId() ? clipById(wfCurrentClipId()) : null;
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
      wfMarkIn() != null && chunkStart <= wfMarkIn() && chunkEnd > wfMarkIn();
    const hasOut =
      wfMarkOut() != null && chunkStart < wfMarkOut() && chunkEnd >= wfMarkOut();
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
    const inT = wfMarkIn();
    const outT = wfMarkOut();
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
    handles.liveTranscriptClip = clipId;
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
    if (!box || handles.liveTranscriptClip !== clipId) return;
    const body = transcriptBody() || ensureTranscriptShell(box).querySelector('.pool-transcript-body');
    if (!body) return;
    const hint = body.querySelector('.transcript-live-hint');
    if (hint) hint.remove();
    body.appendChild(createTranscriptChunk(seg));
    const scroll = box.querySelector('.pool-transcript-scroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }

  function finishLiveTranscript(clipId) {
    handles.liveTranscriptClip = null;
    if (wfCurrentClipId() === clipId) {
      loadTranscript(clipId);
    }
  }

  function renderTranscriptPanel(transcript) {
    const box = $('pool-active-transcript');
    if (!box) return;
    if (handles.liveTranscriptClip) return;
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
    const segments = [];
    let text = '';

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
          segments.push(ev.segment);
          text = text ? text + ' ' + (ev.segment.text || '') : ev.segment.text || '';
          appendTranscriptSegment(clipId, ev.segment);
        } else if (ev.type === 'error') {
          throw new Error(ev.error || 'Transkripcija nije uspjela');
        }
      }
    }
    if (lastEvent?.type === 'complete' && lastEvent.transcript) {
      return lastEvent;
    }
    return {
      type: 'complete',
      transcript: { text: text.trim(), segments },
    };
  }

  async function persistTranscript(clipId, status, transcript) {
    const activeCtx = sdkCtx;
    if (!activeCtx?.action) {
      throw new Error('[Media Pool] SDK nije spreman');
    }
    await activeCtx.action('transcript.save', {
      project_id: poolProjectId(),
      clip_id: clipId,
      status: status || 'complete',
      transcript: transcript || { text: '', segments: [] },
    });
    await activeCtx.store.reload('media_pool.clips');
  }

  async function loadTranscript(clipId) {
    if (handles.liveTranscriptClip === clipId) return;
    const pid = poolProjectId();
    if (!sdkCtx?.action) {
      renderTranscriptPanel(null);
      return;
    }
    try {
      const d = await sdkCtx.action('transcript.get', {
        project_id: pid,
        clip_id: clipId,
      });
      renderTranscriptPanel(d.transcript || null);
    } catch {
      renderTranscriptPanel(null);
    }
  }

  function updatePlayerChrome() {
    const label = $('pool-current-clip');
    const c = wfCurrentClipId() ? clipById(wfCurrentClipId()) : null;
    if (label) {
      label.textContent = c ? c.clip_id : 'Klikni sličicu za odabir clipa';
    }
    if (c?.has_transcript) {
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
      handles.thumbRev
    );
  }

  function virtualShotDuration(shot) {
    const duration = Number(shot.duration_seconds || 0);
    if (duration > 0) return duration;
    const inSec = Number(shot.in_seconds || 0);
    const outSec = Number(shot.out_seconds || 0);
    return outSec > inSec ? outSec - inSec : 0;
  }

  function applyVirtualShots(nextVirtualShots) {
    renderVirtualShots(nextVirtualShots || snapVirtualShots());
  }

  function renderVirtualShots(allVirtualShots) {
    const box = $('pool-virtual-shots');
    if (!box) return;
    const shots = shotsForCurrentClip(undefined, allVirtualShots);
    if (!wfCurrentClipId()) {
      box.innerHTML = '<span class="muted">Odaberi clip.</span>';
      return;
    }
    if (!shots.length) {
      box.innerHTML = '<span class="muted">Nema virtualnih kadrova — IN, OUT, Enter.</span>';
      return;
    }
    const clip = wfCurrentClipId() ? clipById(wfCurrentClipId()) : null;
    const fps = fpsForClip(clip);
    box.innerHTML = shots
      .map((shot) => {
        const active = wfActiveVirtualShotId() === shot.id ? ' pool-vshot-active' : '';
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

  async function playVirtualShot(shot) {
    const clip = clipById(shot.clip_id);
    if (!clip) return;
    const inSec = Number(shot.in_seconds);
    await writeWorkflow(sdkCtx, {
      mark_in_sec: inSec,
      mark_out_sec: Number(shot.out_seconds),
      active_virtual_shot_id: shot.id,
      current_clip_id: clip.clip_id,
    });
    playClip(clip, inSec, false);
    syncTransport();
    renderVirtualShots();
  }

  function virtualShotsSignature(shots) {
    return (shots || [])
      .map((s) => [s.id, s.clip_id, s.in_seconds, s.out_seconds].join(':'))
      .join('|');
  }

  function poolSnapshotSignature(d) {
    const clips = d?.clips || [];
    const wf = d?.workflow || {};
    return JSON.stringify({
      clips: clips.map((c) => [
        c.clip_id,
        c.transferred,
        c.has_transcript,
        c.transcript_status || '',
        c.filmstrip_status || 'missing',
        c.filmstrip_error || '',
        (c.timeline_seeks || []).join(','),
        (c.filmstrip_frames || [])
          .map((f) => String(f.frame_index ?? f.index ?? '') + '@' + Number(f.seek_sec ?? 0).toFixed(3))
          .join(','),
        c.timeline_duration_sec || 0,
        c.name || '',
      ]),
      virtual: virtualShotsSignature(d?.virtual_shots),
      selected: (wf.selected_clip_ids || []).slice().sort().join(','),
      current: wf.current_clip_id || '',
    });
  }

  function highlightActiveRow(clipId) {
    document.querySelectorAll('.timeline-row[data-clip-id]').forEach((row) => {
      row.classList.toggle('pool-row-active', row.getAttribute('data-clip-id') === clipId);
    });
  }

  async function playClip(clip, startAt, resetMarks) {
    const player = $('pool-player');
    if (!player || !clip?.clip_id) return;
    const seekSec = Number(startAt || 0);
    const sameClip = wfCurrentClipId() === clip.clip_id && player.src;
    const applySeek = () => {
      player.currentTime = seekSec;
      syncTransport();
    };

    if (sameClip) {
      if (player.readyState >= 1) applySeek();
      else player.onloadedmetadata = () => applySeek();
      player.play().catch(() => {});
      highlightActiveRow(clip.clip_id);
      updatePlayerChrome();
      return;
    }

    const patch = { current_clip_id: clip.clip_id };
    if (resetMarks !== false) {
      patch.clear_marks = true;
    }
    const d = await writeWorkflow(sdkCtx, patch);
    handles.lastPoolSignature = poolSnapshotSignature(d);
    handles.lastClips = snapClips().slice();
    highlightActiveRow(clip.clip_id);
    player.src = mediaUrl(clip.clip_id);
    player.onloadedmetadata = () => applySeek();
    player.play().catch(() => {});
    updatePlayerChrome();
    renderVirtualShots();
    loadTranscript(clip.clip_id);
    await updateClipList();
  }

  function requestMissingTimelines() {
    if (QNC.getActiveTab?.() !== 'pool') return;
    const missing = snapClips()
      .filter((clip) => {
        const status = String(clip.filmstrip_status || 'missing');
        return (
          clip.transferred &&
          !(clip.timeline_seeks || []).length &&
          status !== 'building' &&
          status !== 'ready' &&
          status !== 'error'
        );
      })
      .filter((clip) => !handles.buildingTimeline.has(clip.clip_id))
      .slice(0, 1);
    missing.forEach((clip) => {
      const pid = poolProjectId();
      handles.buildingTimeline.add(clip.clip_id);
      const buildReq = sdkCtx
        ? sdkCtx.action('filmstrip.build', {
            clip_id: clip.clip_id,
            frames: maxFilmstripFrames(),
            project_id: pid,
            media_path: clip.proxy_path || '',
          })
        : QNC.api('POST', '/api/media-pool/timeline/build', {
            clip_id: clip.clip_id,
            frames: maxFilmstripFrames(),
            project_id: pid,
            media_path: clip.proxy_path || '',
          });
      buildReq
        .then(() => {
          handles.buildingTimeline.delete(clip.clip_id);
          return loadPool();
        })
        .catch((e) => {
          handles.buildingTimeline.delete(clip.clip_id);
          QNC.log('[Media Pool] film-strip: ' + e.message, 'err');
        });
    });
  }

  function beginImportWatch(count) {
    handles.importWatchUntil = Date.now() + 180000;
    handles.importWatchCount = Math.max(0, Number(count) || 0);
    handles.lastPoolSignature = '';
    handles.lastClips = [];
  }

  function importWatchActive() {
    return handles.importWatchUntil > Date.now();
  }

  function maybeEndImportWatch() {
    if (!importWatchActive()) return;
    const clips = snapClips();
    if (!clips.length) return;
    const pending = clips.some((clip) => {
      const fs = String(clip.filmstrip_status || 'missing');
      return (
        fs === 'building' ||
        (clip.transferred && !(clip.timeline_seeks || []).length && fs !== 'ready' && fs !== 'error')
      );
    });
    if (!pending) {
      handles.importWatchUntil = 0;
      handles.importWatchCount = 0;
    }
  }

  function poolNeedsPoll() {
    if (importWatchActive()) return true;
    return snapClips().some((clip) => {
      const status = String(clip.filmstrip_status || 'missing');
      return (
        status === 'building' ||
        (clip.transferred &&
          !(clip.timeline_seeks || []).length &&
          status !== 'ready' &&
          status !== 'error')
      );
    });
  }

  function startPoolPolling() {
    if (handles.pollTimer) return;
    handles.pollTimer = setInterval(() => {
      if (QNC.getActiveTab?.() !== 'pool') return;
      if (!poolNeedsPoll()) return;
      loadPool().catch((e) => QNC.log('[Media Pool] auto refresh: ' + e.message, 'err'));
    }, 3000);
  }

  function stopPoolPolling() {
    if (!handles.pollTimer) return;
    clearInterval(handles.pollTimer);
    handles.pollTimer = null;
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

  function releaseProjectHold(ctx) {
    stopPoolPolling();
    releasePlayerMedia();
    const activeCtx = ctx || sdkCtx;
    activeCtx?.store?.invalidate?.('media_pool.clips');
    handles.buildingTimeline.clear();
    handles.transcribingClips.clear();
    handles.lastPoolSignature = '';
    handles.lastClips = [];
    handles.importWatchUntil = 0;
    handles.importWatchCount = 0;
  }

  function fpsForClip(clip) {
    const raw = String(clip?.media_probe?.fps || clip?.fx6_metadata?.fps || '');
    const parsed = parseFloat(raw);
    return parsed > 0 ? parsed : 25;
  }

  function fpsForCurrentClip() {
    return fpsForClip(wfCurrentClipId() ? clipById(wfCurrentClipId()) : null);
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

  async function setMarkIn() {
    const player = $('pool-player');
    const clip = wfCurrentClipId() ? clipById(wfCurrentClipId()) : null;
    if (!player?.src || !clip) {
      QNC.setBox('Prvo odaberi clip (klik na sličicu).', 'err');
      return;
    }
    const fromTx = markTimeFromTranscript('in');
    const markIn = snapToFrame(fromTx != null ? fromTx : player.currentTime || 0, clip);
    const patch = {
      mark_in_sec: markIn,
      active_virtual_shot_id: '',
    };
    if (wfMarkOut() != null && wfMarkOut() <= markIn) {
      patch.mark_out_sec = null;
    }
    await writeWorkflow(sdkCtx, patch);
    syncTransport();
    updateTranscriptChunkMarkers();
    renderVirtualShots();
  }

  async function setMarkOut() {
    const player = $('pool-player');
    const clip = wfCurrentClipId() ? clipById(wfCurrentClipId()) : null;
    if (!player?.src || !clip) {
      QNC.setBox('Prvo odaberi clip (klik na sličicu).', 'err');
      return;
    }
    const fromTx = markTimeFromTranscript('out');
    const markOut = snapToFrame(fromTx != null ? fromTx : player.currentTime || 0, clip);
    if (wfMarkIn() == null) QNC.setBox('Prvo označi IN (I).', 'err');
    if (markOut <= wfMarkIn()) QNC.setBox('OUT mora biti poslije IN točke.', 'err');
    await writeWorkflow(sdkCtx, {
      mark_out_sec: markOut,
      active_virtual_shot_id: '',
    });
    syncTransport();
    updateTranscriptChunkMarkers();
    renderVirtualShots();
  }

  async function saveInOut() {
    const clip = wfCurrentClipId() ? clipById(wfCurrentClipId()) : null;
    if (!clip?.clip_id) {
      QNC.setBox('Prvo odaberi clip (klik na sličicu).', 'err');
      return;
    }
    if (wfMarkIn() == null || wfMarkOut() == null || wfMarkOut() <= wfMarkIn()) {
      QNC.setBox('Označi ispravan IN i OUT prije spremanja.', 'err');
      return;
    }
    const fps = fpsForClip(clip);
    const inSec = snapToFrame(wfMarkIn(), clip);
    const outSec = snapToFrame(wfMarkOut(), clip);
    if (outSec <= inSec) {
      QNC.setBox('OUT mora biti poslije IN točke.', 'err');
      return;
    }
    const pid = poolProjectId();
    try {
      QNC.setBox('Spremam virtualni kadar…', 'busy');
      const d = await sdkCtx.action('virtual-shot.create', {
        project_id: pid,
        clip_id: clip.clip_id,
        in_seconds: inSec,
        out_seconds: outSec,
        windows_original_path: clip.windows_original_path || null,
      });
      await sdkCtx.store.reload('media_pool.clips');
      applyVirtualShots(snapVirtualShots());
      handles.thumbRev++;
      await writeWorkflow(sdkCtx, {
        active_virtual_shot_id: d?.shot?.id || '',
        clear_marks: true,
      });
      markTranscriptIzrez();
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
      if (clip && Number.isFinite(sec)) playClip(clip, sec, false).catch((e) => ctx.setStatus('Pool: ' + e.message, 'err'));
    });
    ctx.on('mark.in', setMarkIn);
    ctx.on('mark.out', setMarkOut);
    ctx.on('virtual-shot.create', saveInOut);
    ctx.on('clips.refresh', refresh);
    ctx.on('transcription.queue', transcribe);
    ctx.on('clip.toggle', (event) => {
      const id = String(event.payload?.clip_id || '').trim();
      if (!id) return;
      writeWorkflow(ctx, { toggle_clip_id: id, clip_selected: !!event.payload?.checked })
        .then(() => updateUi())
        .catch((e) => ctx.setStatus('Pool: ' + e.message, 'err'));
    });
    ctx.on('clip.play', (event) => {
      const id = String(event.payload?.clip_id || '').trim();
      const clip = id ? clipById(id) : null;
      if (!clip) return;
      const d = clipDuration(clip);
      const start = event.payload?.edge ? Math.max(0, d - 0.5) : 0;
      playClip(clip, start).catch((e) => ctx.setStatus('Pool: ' + e.message, 'err'));
    });
    ctx.on('clips.select-all', (event) => {
      const checked = !!event?.payload?.checked;
      writeWorkflow(ctx, { selected_clip_ids: checked ? ids() : [] })
        .then(() => renderRows())
        .catch((e) => ctx.setStatus('Pool: ' + e.message, 'err'));
    });
    busInstalled = true;
  }

  async function refresh() {
    try {
      const d = await loadPool();
      updateUi();
      if (snapClips().length) {
        QNC.setBox('Media pool: ' + snapClips().length + ' clipova', 'ok');
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
    const list = selectedIds().filter((id) => snapClips().some((c) => c.clip_id === id));
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
        if (handles.transcribingClips.has(id)) continue;
        const clip = clipById(id);
        QNC.setBox('Transkripcija ' + (i + 1) + '/' + list.length + ': ' + id, 'busy');
        handles.transcribingClips.add(id);
        if (clip) {
          beginLiveTranscript(id);
          playClip(clip, 0, true).catch(() => {});
        }
        try {
          await persistTranscript(id, 'pending', { text: '', segments: [] });
          renderRows();
          const last = await transcribeClipStream(id, pid);
          if (last?.type === 'complete') {
            await persistTranscript(id, 'complete', last.transcript || { text: '', segments: [] });
            finishLiveTranscript(id);
            ok++;
          } else {
            await persistTranscript(id, 'failed', { text: '', segments: [] });
            finishLiveTranscript(id);
            fail++;
          }
        } catch (e) {
          await persistTranscript(id, 'failed', { text: '', segments: [] }).catch(() => {});
          finishLiveTranscript(id);
          fail++;
          if (QNC.getActiveTab && QNC.getActiveTab() === 'pool') {
            QNC.setBox('Transkripcija: ' + (e.message || 'greška'), 'err');
          }
        }
        handles.transcribingClips.delete(id);
        renderRows();
      }
      await refresh();
      QNC.setBox('Transkripcija: ' + ok + ' OK, ' + fail + ' greška', fail ? 'err' : 'ok');
    } finally {
      handles.liveTranscriptClip = null;
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
    async onInit(ctx) {
      sdkCtx = ctx;
      bindPlayer();
      await bindPoolShortcuts();
      installActionBridge(ctx);

      ctx.onShell('project:changed', () => {
        ctx.store.invalidate('media_pool.clips');
        releaseProjectHold(ctx);
        loadPool(ctx)
          .then(() => {
            if (snapClips(ctx).length) renderRows();
          })
          .catch((e) => ctx.setStatus('Pool: ' + e.message, 'err'));
      });

      ctx.onShell('project:deleting', () => {
        releaseProjectHold(ctx);
      });

      ctx.onShell('ingest:import-queued', (payload) => {
        beginImportWatch(payload?.count || payload?.clip_ids?.length || 0);
        startPoolPolling();
        loadPool(ctx)
          .then(() => updateClipList({ forceFull: true }))
          .catch((e) => ctx.setStatus('Pool: ' + e.message, 'err'));
      });

      ctx.onShell('keyboard-shortcuts:changed', () => {
        bindPoolShortcuts().catch(() => {});
      });

      renderRows({ forceFull: true });
      QNC.log('[Media Pool] SDK modul spreman', 'ok');
    },

    async onShow(ctx) {
      sdkCtx = ctx;
      await bindPoolShortcuts();
      startPoolPolling();
      loadPool(ctx)
        .then(() => {
          if (snapClips(ctx).length && !handles.lastClips.length) {
            updateClipList({ forceFull: true });
          }
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
})(window.QNC);
