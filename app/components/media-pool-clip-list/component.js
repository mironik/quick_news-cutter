/* Media pool clip list — SDK snapshot; inkrementalni patch (Jetson reconcileRows). */
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

  function rowsSlot(root) {
    return panelRoot(root)?.querySelector?.('[data-qnc-slot="clip-rows"]') || null;
  }

  function filmstripPanel(row) {
    if (!row) return null;
    return (
      row.querySelector('[data-qnc-panel="' + FILMSTRIP_ID + '"]') ||
      row.querySelector('[data-qnc-component="' + FILMSTRIP_ID + '"]')
    );
  }

  function emit(pluginId, action, payload) {
    if (!QNC.emitComponent) return Promise.resolve();
    return QNC.emitComponent(pluginId || 'media_pool', PANEL_ID, action, payload || {});
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

  function clipDuration(c) {
    if (c?.timeline_duration_sec) return Number(c.timeline_duration_sec);
    if (c?.duration_sec) return Number(c.duration_sec);
    return 0;
  }

  function transcriptStatus(c, rowNotes) {
    const id = c?.clip_id || '';
    if (rowNotes?.[id]?.indexOf('greška') >= 0) return 'failed';
    if (c?.has_transcript || c?.transcript_status === 'complete') return 'complete';
    if (c?.transcript_status === 'failed') return 'failed';
    if (c?.transcript_status === 'pending' || rowNotes?.[id]?.indexOf('ASR') >= 0) return 'pending';
    return 'none';
  }

  function transcriptLabel(c, rowNotes) {
    const st = transcriptStatus(c, rowNotes);
    if (st === 'complete') return 'Transkript OK';
    if (st === 'failed') return 'Transkript greška';
    if (st === 'pending') return 'Transkript…';
    return 'Transkript —';
  }

  function clipNote(c, rowNotes) {
    const id = c?.clip_id || '';
    const note = rowNotes?.[id] || '';
    if (note) return note;
    const parts = [];
    if (c?.transferred) parts.push('u projektu');
    else if (c?.discovered) parts.push('detektiran');
    if (c?.has_transcript) parts.push('transkript');
    const fs = String(c?.filmstrip_status || 'missing');
    if (fs === 'building') parts.push('filmstrip…');
    if (fs === 'error') parts.push('filmstrip greška');
    return parts.join(' · ') || '—';
  }

  function timelineKey(clip) {
    const seeks = (clip?.timeline_seeks || []).join(',');
    const frames = (clip?.filmstrip_frames || [])
      .map((f) => String(f.frame_index ?? f.index ?? '') + '@' + Number(f.seek_sec ?? 0).toFixed(3))
      .join(',');
    return [
      clip?.filmstrip_status || 'missing',
      clip?.filmstrip_error || '',
      seeks,
      frames,
      clip?.timeline_duration_sec || clip?.duration_sec || 0,
    ].join('|');
  }

  function rowStateKey(clip, data) {
    const id = clip?.clip_id || '';
    const rowNotes = data?.row_notes || {};
    return [
      transcriptStatus(clip, rowNotes),
      clipNote(clip, rowNotes),
      formatDuration(clipDuration(clip)),
      clip?.name || id,
      (data?.selected_ids || []).includes(id) ? '1' : '0',
      data?.current_clip_id === id ? '1' : '0',
    ].join('|');
  }

  function filmstripMountHtml() {
    return '<div data-qnc-component="filmstrip-viewer" data-qnc-variant="inline"></div>';
  }

  function renderRow(clip, data) {
    const id = clip.clip_id || '';
    const rowNotes = data?.row_notes || {};
    const sel = (data?.selected_ids || []).includes(id);
    const current = data?.current_clip_id === id;
    const dur = clipDuration(clip);
    const st = transcriptStatus(clip, rowNotes);
    const rowCls =
      'timeline-row' +
      (current ? ' pool-row-active' : '') +
      (st === 'complete' ? ' pool-row-ok' : '') +
      (st === 'failed' ? ' pool-row-err' : '');
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
      esc(clip.name || id) +
      '</span></div>' +
      '<div class="timeline-meta">' +
      esc(formatDuration(dur)) +
      ' | ' +
      esc(transcriptLabel(clip, rowNotes)) +
      ' | ' +
      esc(clipNote(clip, rowNotes)) +
      '</div></div>' +
      filmstripMountHtml() +
      '<button type="button" class="clip-edge-btn" data-id="' +
      esc(id) +
      '">' +
      esc(formatDuration(dur)) +
      '</button></div>'
    );
  }

  function defaultThumbUrl(clipId, seek, data, frameIndex) {
    if (typeof data?.thumbUrl === 'function' && frameIndex == null) {
      return data.thumbUrl(clipId, seek);
    }
    const pid = data?.project_id || (QNC.getProjectId ? QNC.getProjectId() : '');
    const rev = data?.thumb_rev || 0;
    let url =
      '/api/media-pool/thumbnail?clip_id=' +
      encodeURIComponent(clipId) +
      '&seek=' +
      Number(seek).toFixed(3) +
      '&w=' +
      THUMB_W +
      '&project_id=' +
      encodeURIComponent(pid) +
      '&r=' +
      rev;
    if (frameIndex != null && Number(frameIndex) >= 0) {
      url += '&frame_index=' + Number(frameIndex);
    }
    return url;
  }

  function frameThumbUrl(clipId, frame, data) {
    const idx = frame?.frame_index ?? frame?.index;
    const seek = Number(frame?.seek_sec ?? frame?.seek ?? 0);
    return defaultThumbUrl(clipId, seek, data, idx);
  }

  function filmstripSlots(panel) {
    const slotEl = panel?.querySelector?.('[data-qnc-slot="frames"]') || panel;
    if (QNC.filmstrip?.stripSlotCount) {
      return QNC.filmstrip.stripSlotCount(slotEl || panel, {
        thumbW: THUMB_W,
        maxFrames: THUMB_MAX_FRAMES,
        defaultSlots: 6,
      });
    }
    return 6;
  }

  function shotsForClip(clipId, data) {
    if (!clipId) return [];
    return (data?.virtual_shots || []).filter((s) => s.clip_id === clipId);
  }

  function playbackPayload(clip, data) {
    const clipId = clip?.clip_id || '';
    const isActive = data?.current_clip_id === clipId;
    const duration = isActive
      ? Number(data?.duration_sec || 0) || clipDuration(clip)
      : clipDuration(clip);
    const shots = shotsForClip(clipId, data);
    const activeShotId = isActive ? String(data?.active_virtual_shot_id || '').trim() : '';
    const activeShot = shots.find((s) => s.id === activeShotId) || null;
    const markIn = isActive && data?.mark_in_sec != null ? Number(data.mark_in_sec) : null;
    const markOut = isActive && data?.mark_out_sec != null ? Number(data.mark_out_sec) : null;
    let draftLabel = '';
    if (isActive && markIn != null && markOut != null && markOut > markIn && !activeShot) {
      draftLabel =
        'Novi kadar · ' +
        formatDuration(markIn) +
        '–' +
        formatDuration(markOut) +
        ' (Enter)';
    }
    return {
      active: isActive,
      clip_id: clipId,
      duration_sec: duration,
      playhead_sec: isActive ? Number(data?.playhead_sec || 0) : 0,
      mark_in_sec: markIn,
      mark_out_sec: markOut,
      virtual_shots: shots,
      active_virtual_shot_id: activeShotId,
      active_shot: activeShot,
      draftLabel,
      hostPluginId: data?.hostPluginId || 'media_pool',
      formatDuration,
      snapFn: typeof data?.snapFn === 'function' ? data.snapFn : null,
    };
  }

  function paintPlaybackForRow(row, clip, data, ctx) {
    const panel = filmstripPanel(row);
    if (!panel || !QNC.filmstrip?.paintPlayback) return;
    const payload = playbackPayload(clip, {
      ...data,
      hostPluginId: ctx?.pluginId || 'media_pool',
      snapFn: typeof data?.snapFn === 'function' ? (sec) => data.snapFn(sec, clip) : null,
    });
    QNC.filmstrip.paintPlayback(panel, payload);
  }

  function paintAllPlayback(rows, clips, data, ctx) {
    if (!rows) return;
    clips.forEach((clip) => {
      const row = rows.querySelector('.timeline-row[data-clip-id="' + CSS.escape(clip.clip_id) + '"]');
      if (row) paintPlaybackForRow(row, clip, data, ctx);
    });
  }

  function paintFilmstrip(panel, clip, data, ctx) {
    if (!panel || !clip?.clip_id || !QNC.filmstrip?.update) return;
    const fsStatus = String(clip.filmstrip_status || 'missing');
    const seeks = Array.isArray(clip.timeline_seeks) ? clip.timeline_seeks : [];
    const dbFrames = Array.isArray(clip.filmstrip_frames) ? clip.filmstrip_frames : [];
    const slots = filmstripSlots(panel);
    const hostPluginId = ctx?.pluginId || 'media_pool';
    const snapFn = typeof data?.snapFn === 'function' ? data.snapFn : null;
    QNC.filmstrip.mountPanel(panel, hostPluginId);

    if (fsStatus === 'ready' && dbFrames.length) {
      const sampled = QNC.filmstrip.sampleFrames
        ? QNC.filmstrip.sampleFrames(dbFrames, slots)
        : dbFrames.slice(0, slots);
      const frames = sampled.map((fr) => ({
        seek_sec: Number(fr.seek_sec ?? fr.seek ?? 0),
        url: frameThumbUrl(clip.clip_id, fr, data),
      }));
      QNC.filmstrip.update(panel, {
        hostPluginId,
        clip,
        filmstrip: {
          status: fsStatus,
          seeks,
          error: clip.filmstrip_error || '',
        },
        frames,
        loading: false,
        slots,
        durationSec: clip.timeline_duration_sec || clipDuration(clip),
        thumbRev: data?.thumb_rev || 0,
        formatDuration,
        snapFn: snapFn ? (sec) => snapFn(sec, clip) : undefined,
        placeholder: 'Sličice se generiraju…',
        playback: playbackPayload(clip, { ...data, hostPluginId }),
      });
      return;
    }

    const list =
      fsStatus === 'ready' && seeks.length
        ? QNC.filmstrip.seeksFromTimeline
          ? QNC.filmstrip.seeksFromTimeline(seeks, slots)
          : seeks.slice(0, slots)
        : null;
    const loading = fsStatus === 'missing' || fsStatus === 'building' || !list;
    QNC.filmstrip.update(panel, {
      hostPluginId,
      clip,
      filmstrip: {
        status: fsStatus,
        seeks,
        error: clip.filmstrip_error || '',
      },
      seeks: list,
      loading,
      slots,
      durationSec: clip.timeline_duration_sec || clipDuration(clip),
      thumbRev: data?.thumb_rev || 0,
      thumbUrl: (id, sec) => defaultThumbUrl(id, sec, data),
      formatDuration,
      snapFn: snapFn ? (sec) => snapFn(sec, clip) : undefined,
      placeholder:
        fsStatus === 'building'
          ? 'Filmstrip se generira…'
          : fsStatus === 'error'
            ? clip.filmstrip_error || 'Greška filmstripa'
            : 'Sličice se generiraju…',
      playback: playbackPayload(clip, { ...data, hostPluginId }),
    });
  }

  function patchRowMeta(row, clip, data) {
    if (!row || !clip) return;
    const rowNotes = data?.row_notes || {};
    const meta = row.querySelector('.timeline-meta');
    if (meta) {
      meta.textContent =
        formatDuration(clipDuration(clip)) +
        ' | ' +
        transcriptLabel(clip, rowNotes) +
        ' | ' +
        clipNote(clip, rowNotes);
    }
    const title = row.querySelector('.timeline-filename');
    if (title) title.textContent = clip.name || clip.clip_id || '';
    const edge = row.querySelector('.clip-edge-btn[data-id]');
    if (edge) edge.textContent = formatDuration(clipDuration(clip));

    const st = transcriptStatus(clip, rowNotes);
    row.classList.toggle('pool-row-ok', st === 'complete');
    row.classList.toggle('pool-row-err', st === 'failed');
    row.classList.toggle('pool-row-active', data?.current_clip_id === clip.clip_id);

    const chk = row.querySelector('.pool-row-chk[data-id]');
    if (chk) chk.checked = (data?.selected_ids || []).includes(clip.clip_id);
  }

  async function renderAll(rows, clips, data, ctx) {
    if (!rows) return;
    if (!clips.length) {
      rows.innerHTML =
        '<p class="grid-empty muted">Nema uvezenih klipova — prvo Uvezi na Ingest tabu, zatim Osvježi pool.</p>';
      return;
    }
    rows.innerHTML = clips.map((c) => renderRow(c, data)).join('');
    if (QNC.resolveComponents) {
      await QNC.resolveComponents(rows);
    }
    clips.forEach((clip) => {
      const row = rows.querySelector('.timeline-row[data-clip-id="' + CSS.escape(clip.clip_id) + '"]');
      const panel = filmstripPanel(row);
      if (panel) {
        panel.dataset.qncTimelineKey = timelineKey(clip);
        paintFilmstrip(panel, clip, data, ctx);
      }
    });
    paintAllPlayback(rows, clips, data, ctx);
  }

  async function appendRow(rows, clip, data, ctx) {
    if (!rows || !clip?.clip_id) return;
    if (rows.querySelector('.grid-empty')) rows.innerHTML = '';
    rows.insertAdjacentHTML('beforeend', renderRow(clip, data));
    const row = rows.lastElementChild;
    if (QNC.resolveComponents && row) {
      await QNC.resolveComponents(row);
    }
    const panel = filmstripPanel(row);
    if (panel) {
      panel.dataset.qncTimelineKey = timelineKey(clip);
      paintFilmstrip(panel, clip, data, ctx);
    }
    if (row) paintPlaybackForRow(row, clip, data, ctx);
  }

  async function reconcileRows(rows, clips, data, ctx, prevClips) {
    const prev = Array.isArray(prevClips) ? prevClips : [];
    const prevById = new Map(prev.map((c) => [c.clip_id, c]));
    const prevIds = prev.map((c) => c.clip_id).filter(Boolean);
    const nextIds = clips.map((c) => c.clip_id).filter(Boolean);
    const prevSet = new Set(prevIds);
    const nextSet = new Set(nextIds);
    const wasEmpty = !prevIds.length;
    const removed = prevIds.some((id) => !nextSet.has(id));
    const orderChanged =
      prevIds.length !== nextIds.length || nextIds.some((id, idx) => id !== prevIds[idx]);

    if (wasEmpty || removed || orderChanged || !rows.querySelector('.timeline-row')) {
      await renderAll(rows, clips, data, ctx);
      return;
    }

    for (const clip of clips) {
      const id = clip.clip_id;
      if (!id) continue;

      if (!prevSet.has(id)) {
        await appendRow(rows, clip, data, ctx);
        continue;
      }

      const row = rows.querySelector('.timeline-row[data-clip-id="' + CSS.escape(id) + '"]');
      if (!row) {
        await renderAll(rows, clips, data, ctx);
        return;
      }

      const old = prevById.get(id) || {};
      const panel = filmstripPanel(row);
      const nextTimeline = timelineKey(clip);
      const prevTimeline = panel?.dataset?.qncTimelineKey || timelineKey(old);

      if (panel && nextTimeline !== prevTimeline) {
        panel.dataset.qncTimelineKey = nextTimeline;
        paintFilmstrip(panel, clip, data, ctx);
      }

      const prevRowState = row.dataset.qncRowState || rowStateKey(old, data);
      const nextRowState = rowStateKey(clip, data);
      if (nextRowState !== prevRowState) {
        row.dataset.qncRowState = nextRowState;
        patchRowMeta(row, clip, data);
      }
      paintPlaybackForRow(row, clip, data, ctx);
    }
  }

  function bindList(panel, pluginId) {
    if (panel.dataset.qncPoolListBound === '1') return;
    panel.dataset.qncPoolListBound = '1';
    const rows = rowsSlot(panel);
    if (!rows) return;
    rows.addEventListener('change', (ev) => {
      const chk = ev.target.closest?.('.pool-row-chk[data-id]');
      if (!chk) return;
      emit(pluginId, 'clip.toggle', {
        clip_id: chk.getAttribute('data-id') || '',
        checked: chk.checked,
      });
    });
    rows.addEventListener('click', (ev) => {
      const edge = ev.target.closest?.('.clip-edge-btn[data-id]');
      if (edge) {
        emit(pluginId, 'clip.play', { clip_id: edge.getAttribute('data-id') || '', edge: true });
        return;
      }
      if (ev.target.closest?.('.pool-row-chk, .thumb-btn, .qnc-media-thumb-btn, .thumbnail-strip, .qnc-filmstrip-inout')) return;
      const row = ev.target.closest?.('.timeline-row[data-clip-id]');
      if (row) emit(pluginId, 'clip.play', { clip_id: row.getAttribute('data-clip-id') || '' });
    });
  }

  async function update(root, data, ctx) {
    const panel = panelRoot(root);
    if (!panel) return;
    const pluginId = ctx?.pluginId || 'media_pool';
    bindList(panel, pluginId);

    const clips = Array.isArray(data?.clips) ? data.clips : [];
    const rows = rowsSlot(panel);
    if (!rows) return;

    if (!clips.length) {
      rows.innerHTML =
        '<p class="grid-empty muted">Nema uvezenih klipova — prvo Uvezi na Ingest tabu, zatim Osvježi pool.</p>';
      return;
    }

    if (data?.forceFull) {
      await renderAll(rows, clips, data, ctx);
      return;
    }

    await reconcileRows(rows, clips, data, ctx, data?.prev_clips || []);
    paintAllPlayback(rows, clips, data, ctx);
  }

  function updatePlayback(root, data, ctx) {
    const panel = panelRoot(root);
    const rows = rowsSlot(panel);
    const clips = Array.isArray(data?.clips) ? data.clips : [];
    if (!rows || !clips.length) return;
    paintAllPlayback(rows, clips, data, ctx);
  }

  function mount(root, ctx) {
    const panel = panelRoot(root);
    if (!panel) return;
    bindList(panel, ctx?.pluginId || 'media_pool');
    update(root, { clips: [], forceFull: true }, ctx);
  }

  QNC.components = QNC.components || { registry: new Map() };
  if (QNC.components.register) {
    QNC.components.register(PANEL_ID, {
      PANEL_ID,
      mount,
      update,
      updatePlayback,
      paintFilmstrip,
      reconcileRows,
    });
  }
})(window.QNC);
