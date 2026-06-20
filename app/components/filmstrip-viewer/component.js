/* Filmstrip komponenta — jedini vlasnik DOM-a unutar data-qnc-panel instance. */
window.QNC = window.QNC || {};

(function (QNC) {
  const PANEL_ID = 'filmstrip-viewer';

  const DEFAULTS = {
    thumbW: 112,
    thumbGap: 3,
    minFrames: 2,
    maxFrames: 24,
    defaultSlots: 6,
  };

  function opts(extra) {
    return { ...DEFAULTS, ...(extra || {}) };
  }

  function framesSlot(root) {
    return root?.querySelector?.('[data-qnc-slot="frames"]') || null;
  }

  function statusSlot(root) {
    return root?.querySelector?.('[data-qnc-slot="filmstrip-status"]') || null;
  }

  function trackStack(root) {
    return root?.querySelector?.('.qnc-filmstrip-track-stack') || null;
  }

  function inoutLane(root) {
    return root?.querySelector?.('[data-qnc-slot="inout-lane"]') || null;
  }

  function pct(seconds, duration) {
    const d = Number(duration || 0);
    const s = Number(seconds || 0);
    if (!d || !Number.isFinite(s)) return 0;
    return Math.max(0, Math.min(100, (s / d) * 100));
  }

  function escHtml(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function bindInoutLane(root, cfg) {
    const lane = inoutLane(root);
    if (!lane || lane.dataset.qncInoutBound === '1') return;
    lane.dataset.qncInoutBound = '1';
    lane.addEventListener('click', (event) => {
      if (event.target?.closest?.('.qnc-filmstrip-vshot-seg')) return;
      const clipId = root?.dataset?.clipId || cfg?.clipId || '';
      const duration = Number(root?.dataset?.durationSec || cfg?.durationSec || 0);
      if (!clipId || !duration) return;
      const sec = clickToSeconds(lane, duration, event, cfg?.snapFn);
      emitSeek(root, cfg?.hostPluginId || 'media_pool', clipId, sec);
    });
  }

  function paintVirtualShotSegments(lane, shots, duration, activeShotId) {
    const slot = lane?.querySelector?.('[data-qnc-slot="vshot-segments"]');
    if (!slot) return;
    slot.innerHTML = '';
    if (!duration || !Array.isArray(shots) || !shots.length) return;
    for (const shot of shots) {
      const inSec = Number(shot.in_seconds || 0);
      const outSec = Number(shot.out_seconds || 0);
      if (outSec <= inSec) continue;
      const left = pct(inSec, duration);
      const width = Math.max(0.5, pct(outSec, duration) - left);
      const seg = document.createElement('div');
      seg.className =
        'qnc-filmstrip-vshot-seg' +
        (activeShotId && shot.id === activeShotId ? ' is-active' : '');
      seg.style.left = left + '%';
      seg.style.width = width + '%';
      seg.title = shot.label || shot.id || 'Virtualni kadar';
      slot.appendChild(seg);
    }
  }

  function paintVirtualShotLabels(root, data) {
    const slot = root?.querySelector?.('[data-qnc-slot="virtual-shots"]');
    if (!slot) return;
    slot.innerHTML = '';
    const fmt = typeof data?.formatDuration === 'function' ? data.formatDuration : (s) => String(Math.round(s));
    const labels = [];

    if (data?.active && data?.draftLabel) {
      labels.push(
        '<span class="qnc-filmstrip-vshot-label is-draft">' +
          escHtml(data.draftLabel) +
          '</span>'
      );
    }

    const activeShot = data?.active_shot;
    if (activeShot) {
      const inSec = Number(activeShot.in_seconds || 0);
      const outSec = Number(activeShot.out_seconds || 0);
      const title = activeShot.label || activeShot.name || 'Virtualni kadar';
      labels.push(
        '<span class="qnc-filmstrip-vshot-label is-active">' +
          '<span class="qnc-filmstrip-vshot-label__icon" aria-hidden="true">♥</span>' +
          escHtml(title) +
          ' · ' +
          escHtml(fmt(inSec)) +
          '–' +
          escHtml(fmt(outSec)) +
          '</span>'
      );
    } else if (data?.active && !data?.draftLabel && !(data?.virtual_shots || []).length) {
      labels.push(
        '<span class="qnc-filmstrip-vshot-label">IN · OUT · Enter za virtualni kadar</span>'
      );
    }

    slot.innerHTML = labels.join('');
  }

  /**
   * IN/OUT traka + playhead + virtualni kadrovi (media pool inline).
   */
  function paintPlayback(root, input) {
    if (!root) return;
    const data = input || {};
    const stack = trackStack(root);
    const lane = inoutLane(root);
    if (!stack || !lane) return;

    const duration = Number(data.duration_sec || data.durationSec || root.dataset.durationSec || 0);
    if (duration > 0) root.dataset.durationSec = String(duration);

    const active = !!data.active;
    stack.classList.toggle('is-active', active);

    const inSec = data.mark_in_sec == null ? null : Number(data.mark_in_sec);
    const outSec = data.mark_out_sec == null ? null : Number(data.mark_out_sec);
    const hasIn = inSec != null && Number.isFinite(inSec);
    const hasOut = outSec != null && Number.isFinite(outSec);
    const playheadPct = pct(data.playhead_sec, duration);
    const rangeStart = hasIn ? pct(inSec, duration) : 0;
    const rangeEnd = hasOut ? pct(outSec, duration) : 100;
    const rangeLeft = Math.min(rangeStart, rangeEnd);
    const rangeWidth = Math.max(0, Math.abs(rangeEnd - rangeStart));

    stack.style.setProperty('--qnc-fs-playhead', playheadPct + '%');
    stack.style.setProperty('--qnc-fs-in', rangeStart + '%');
    stack.style.setProperty('--qnc-fs-out', rangeEnd + '%');
    stack.style.setProperty('--qnc-fs-range-left', rangeLeft + '%');
    stack.style.setProperty('--qnc-fs-range-width', rangeWidth + '%');

    lane.classList.toggle('has-in', !!(active && hasIn));
    lane.classList.toggle('has-out', !!(active && hasOut));
    lane.classList.toggle('has-range', !!(active && hasIn && hasOut && outSec > inSec));

    paintVirtualShotSegments(lane, data.virtual_shots || [], duration, data.active_virtual_shot_id || '');
    paintVirtualShotLabels(root, data);

    bindInoutLane(root, {
      clipId: root.dataset.clipId || data.clip_id || '',
      hostPluginId: data.hostPluginId || root.dataset.hostPluginId || 'media_pool',
      durationSec: duration,
      snapFn: data.snapFn,
    });
  }

  function stripSlotCount(target, extra) {
    const o = opts(extra);
    let width = 0;
    if (typeof target === 'number') width = target;
    else if (target?.clientWidth > 0) width = target.clientWidth;
    else if (o.fallbackWidth > 0) width = o.fallbackWidth;
    if (width <= 0) return o.defaultSlots;
    const n = Math.floor((width + o.thumbGap) / (o.thumbW + o.thumbGap));
    return Math.max(o.minFrames, Math.min(o.maxFrames, n));
  }

  function sampleIndices(total, slots) {
    const count = Math.max(0, Number(total) || 0);
    const n = Math.max(1, Number(slots) || DEFAULTS.defaultSlots);
    if (!count) return [];
    if (count <= n) return Array.from({ length: count }, (_, i) => i);
    const out = [];
    for (let i = 0; i < n; i += 1) {
      out.push(Math.round((i * (count - 1)) / Math.max(1, n - 1)));
    }
    return out;
  }

  function seeksFromTimeline(seeks, slots) {
    if (!Array.isArray(seeks) || !seeks.length) return null;
    const n = Math.max(1, Number(slots) || DEFAULTS.defaultSlots);
    if (seeks.length <= n) return seeks.slice();
    return sampleIndices(seeks.length, n).map((idx) => seeks[idx]);
  }

  function sampleFrames(frames, slots) {
    if (!Array.isArray(frames) || !frames.length) return [];
    const n = Math.max(1, Number(slots) || DEFAULTS.defaultSlots);
    if (frames.length <= n) return frames.slice();
    return sampleIndices(frames.length, n).map((idx) => frames[idx]);
  }

  function seeksFromRange(inSeconds, outSeconds, slots) {
    const inS = Number(inSeconds || 0);
    const outS = Number(outSeconds ?? inS);
    const dur = Math.max(0.05, outS - inS);
    const n = Math.max(2, Number(slots) || DEFAULTS.defaultSlots);
    const list = [];
    for (let i = 0; i < n; i += 1) {
      list.push(inS + (dur * i) / (n - 1));
    }
    return list;
  }

  function clickToSeconds(stripEl, durationSec, event, snapFn) {
    const duration = Number(durationSec || 0);
    if (!duration || !stripEl || !event) return 0;
    const rect = stripEl.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const ratio = rect.width > 0 ? x / rect.width : 0;
    const raw = duration * ratio;
    return typeof snapFn === 'function' ? snapFn(raw) : raw;
  }

  function defaultThumbUrl(clipId, seek, extra) {
    const o = opts(extra);
    const api = thumbApi();
    if (api?.buildFrameUrl) {
      return api.buildFrameUrl(clipId, seek, o);
    }
    const pid = o.projectId || (QNC.getProjectId ? QNC.getProjectId() : '');
    const rev = o.thumbRev != null ? o.thumbRev : 0;
    return (
      '/api/media-pool/thumbnail?clip_id=' +
      encodeURIComponent(clipId) +
      '&seek=' +
      Number(seek).toFixed(3) +
      '&w=' +
      o.thumbW +
      '&project_id=' +
      encodeURIComponent(pid) +
      '&r=' +
      rev
    );
  }

  function thumbApi() {
    return QNC.components?.get?.('media-thumb') || QNC.mediaThumb || null;
  }

  function paintFrameThumb(container, data) {
    const api = thumbApi();
    if (!api?.paint) return;
    api.paint(container, data);
  }

  function emitSeek(root, hostPluginId, clipId, seconds) {
    if (!QNC.emitComponent) return;
    QNC.emitComponent(hostPluginId || 'media_pool', PANEL_ID, 'filmstrip.seek', {
      clip_id: clipId,
      seconds: Number(seconds || 0),
    }, { root, target: root });
  }

  function paintLoading(slot, slots, cfg) {
    applyStripLayout(slot, cfg);
    slot.innerHTML = '';
    slot.classList.add('loading');
    const n = Math.max(2, Number(slots) || DEFAULTS.defaultSlots);
    const api = thumbApi();
    for (let i = 0; i < n; i += 1) {
      const el = document.createElement('div');
      el.className = 'qnc-media-thumb qnc-media-thumb--frame';
      if (api?.paint) api.paint(el, { loading: true, variant: 'frame' });
      else {
        const span = document.createElement('span');
        span.className = 'qnc-media-thumb__shimmer';
        el.appendChild(span);
      }
      slot.appendChild(el);
    }
  }

  function paintPlaceholder(slot, text) {
    slot.innerHTML = '';
    slot.classList.remove('loading');
    const ph = document.createElement('div');
    ph.className = 'thumbnail-placeholder';
    ph.textContent = text || 'Nema sličica';
    slot.appendChild(ph);
  }

  function applyStripLayout(slot, cfg) {
    if (!slot) return;
    const o = opts(cfg);
    slot.style.setProperty('--qnc-fs-thumb-w', o.thumbW + 'px');
    slot.style.setProperty('--qnc-fs-thumb-gap', o.thumbGap + 'px');
  }

  function paintFrames(root, state) {
    const slot = framesSlot(root);
    if (!slot) return;

    const cfg = state || {};
    applyStripLayout(slot, cfg);
    const slots = cfg.slots || stripSlotCount(slot, cfg);
    const clipId = cfg.clipId || '';
    const hostPluginId = cfg.hostPluginId || 'media_pool';
    const mode = cfg.mode === 'plain' ? 'plain' : 'buttons';
    const thumbFor =
      typeof cfg.thumbUrl === 'function' ? cfg.thumbUrl : (id, sec) => defaultThumbUrl(id, sec, cfg);
    const fmt = typeof cfg.formatDuration === 'function' ? cfg.formatDuration : (s) => String(Math.round(s));

    if (cfg.loading) {
      paintLoading(slot, slots, cfg);
      return;
    }

    const dbFrames = Array.isArray(cfg.frames) ? cfg.frames : [];
    if (dbFrames.length) {
      slot.innerHTML = '';
      slot.classList.remove('loading');
      if (cfg.durationSec > 0) {
        slot.onclick = (event) => {
          if (event.target?.closest?.('[data-qnc-action="filmstrip.seek"]')) return;
          const sec = clickToSeconds(slot, cfg.durationSec, event, cfg.snapFn);
          emitSeek(root, hostPluginId, clipId, sec);
        };
      } else {
        slot.onclick = null;
      }
      for (const fr of dbFrames) {
        const sec = Number(fr.seek_sec ?? fr.seek ?? 0);
        const url = String(fr.url || fr.thumb_url || '').trim();
        const title =
          typeof cfg.titleForSeek === 'function'
            ? cfg.titleForSeek(sec)
            : clipId
              ? clipId + ' · ' + fmt(sec)
              : fmt(sec);
        const thumbData = { url, variant: 'frame', alt: title, title };
        if (mode === 'plain') {
          const wrap = document.createElement('div');
          wrap.className = 'qnc-media-thumb qnc-media-thumb--frame';
          paintFrameThumb(wrap, thumbData);
          slot.appendChild(wrap);
          continue;
        }
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'qnc-media-thumb-btn thumb-btn';
        btn.title = title;
        btn.addEventListener('click', (event) => {
          event.stopPropagation();
          emitSeek(root, hostPluginId, clipId, sec);
        });
        const wrap = document.createElement('div');
        wrap.className = 'qnc-media-thumb qnc-media-thumb--frame';
        paintFrameThumb(wrap, thumbData);
        btn.appendChild(wrap);
        slot.appendChild(btn);
      }
      return;
    }

    if (cfg.seeks === null) {
      paintLoading(slot, slots, cfg);
      return;
    }

    const seeks = Array.isArray(cfg.seeks) ? cfg.seeks : [];
    if (!seeks.length) {
      paintPlaceholder(slot, cfg.placeholder);
      return;
    }

    slot.innerHTML = '';
    slot.classList.remove('loading');

    if (cfg.durationSec > 0) {
      slot.onclick = (event) => {
        if (event.target?.closest?.('[data-qnc-action="filmstrip.seek"]')) return;
        const sec = clickToSeconds(slot, cfg.durationSec, event, cfg.snapFn);
        emitSeek(root, hostPluginId, clipId, sec);
      };
    } else {
      slot.onclick = null;
    }

    for (const sec of seeks) {
      const title =
        typeof cfg.titleForSeek === 'function'
          ? cfg.titleForSeek(sec)
          : clipId
            ? clipId + ' · ' + fmt(sec)
            : fmt(sec);
      const thumbData = {
        url: clipId ? thumbFor(clipId, sec) : '',
        variant: 'frame',
        alt: title,
        title,
      };

      if (mode === 'plain') {
        const wrap = document.createElement('div');
        wrap.className = 'qnc-media-thumb qnc-media-thumb--frame';
        paintFrameThumb(wrap, thumbData);
        slot.appendChild(wrap);
        continue;
      }

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'qnc-media-thumb-btn thumb-btn';
      btn.title = title;
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        emitSeek(root, hostPluginId, clipId, sec);
      });
      const wrap = document.createElement('div');
      wrap.className = 'qnc-media-thumb qnc-media-thumb--frame';
      paintFrameThumb(wrap, thumbData);
      btn.appendChild(wrap);
      slot.appendChild(btn);
    }
  }

  /**
   * Host orkestrator zove update() — ne dira slot DOM izvan komponente.
   * @param {HTMLElement} root data-qnc-panel="media_pool.filmstrip-viewer"
   * @param {{
   *   hostPluginId?: string,
   *   clip?: object,
   *   filmstrip?: object,
   *   seeks?: number[] | null,
   *   loading?: boolean,
   *   slots?: number,
   *   placeholder?: string,
   *   mode?: 'buttons' | 'plain',
   *   durationSec?: number,
   *   thumbRev?: number,
   *   thumbUrl?: function,
   *   formatDuration?: function,
   *   titleForSeek?: function,
   *   snapFn?: function,
   * }} input
   */
  function update(root, input) {
    if (!root) return;
    const data = input || {};
    const clip = data.clip || {};
    const filmstrip = data.filmstrip || {};
    const clipId = clip.clip_id || data.clipId || '';
    const hostPluginId = data.hostPluginId || 'media_pool';
    const slotEl = framesSlot(root);
    const slots = data.slots || stripSlotCount(slotEl || root, data);

    root.dataset.clipId = clipId;

    const status = filmstrip.status || data.status || (data.seeks === null || data.loading ? 'missing' : 'ready');
    const statusEl = statusSlot(root);
    if (statusEl) {
      if (status === 'building') statusEl.textContent = 'Filmstrip se generira…';
      else if (status === 'ready') statusEl.textContent = 'Filmstrip spreman';
      else if (status === 'error') statusEl.textContent = filmstrip.error || 'Greška filmstripa';
      else if (!root.classList.contains('qnc-filmstrip-inline')) statusEl.textContent = 'Filmstrip nije učitan';
    }

    let seeks = data.seeks;
    if (seeks === undefined) {
      if (status === 'ready' && Array.isArray(filmstrip.seeks)) {
        seeks = seeksFromTimeline(filmstrip.seeks, slots);
      } else if (status === 'ready' && Array.isArray(clip.timeline_seeks)) {
        seeks = seeksFromTimeline(clip.timeline_seeks, slots);
      } else if (data.range) {
        seeks = seeksFromRange(data.range.in_seconds, data.range.out_seconds, slots);
      } else {
        seeks = null;
      }
    }

    paintFrames(root, {
      clipId,
      hostPluginId,
      frames: Array.isArray(data.frames) ? data.frames : [],
      seeks,
      loading: data.loading || (seeks === null && !(Array.isArray(data.frames) && data.frames.length)),
      slots,
      placeholder: data.placeholder,
      mode: data.mode,
      durationSec: data.durationSec ?? clip.timeline_duration_sec ?? clip.duration_sec,
      thumbRev: data.thumbRev,
      thumbUrl: data.thumbUrl,
      formatDuration: data.formatDuration,
      titleForSeek: data.titleForSeek,
      snapFn: data.snapFn,
    });

    if (data.playback) {
      paintPlayback(root, {
        ...data.playback,
        hostPluginId,
        clip_id: clipId,
        duration_sec: data.durationSec ?? clip.timeline_duration_sec ?? clip.duration_sec,
        formatDuration: data.formatDuration,
        snapFn: data.snapFn,
      });
    }
  }

  function mountPanel(root, hostPluginId) {
    if (!root || root.dataset.qncFilmstripMounted === '1') return root;
    root.dataset.qncFilmstripMounted = '1';
    if (hostPluginId) root.dataset.hostPluginId = hostPluginId;
    return root;
  }

  function scanPanels() {
    document.querySelectorAll('[data-qnc-panel="' + PANEL_ID + '"]').forEach((el) => mountPanel(el));
  }

  QNC.filmstrip = {
    PANEL_ID,
    DEFAULTS,
    stripSlotCount,
    sampleIndices,
    seeksFromTimeline,
    sampleFrames,
    seeksFromRange,
    clickToSeconds,
    thumbUrl: defaultThumbUrl,
    update,
    paintPlayback,
    mountPanel,
    scanPanels,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scanPanels);
  else scanPanels();
})(window.QNC);
