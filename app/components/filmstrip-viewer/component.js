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

  function seeksFromTimeline(seeks, slots) {
    if (!Array.isArray(seeks) || !seeks.length) return null;
    const n = Math.max(1, Number(slots) || DEFAULTS.defaultSlots);
    return seeks.slice(0, n);
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

  function paintLoading(slot, slots) {
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

  function paintFrames(root, state) {
    const slot = framesSlot(root);
    if (!slot) return;

    const cfg = state || {};
    const slots = cfg.slots || stripSlotCount(slot, cfg);
    const clipId = cfg.clipId || '';
    const hostPluginId = cfg.hostPluginId || 'media_pool';
    const mode = cfg.mode === 'plain' ? 'plain' : 'buttons';
    const thumbFor =
      typeof cfg.thumbUrl === 'function' ? cfg.thumbUrl : (id, sec) => defaultThumbUrl(id, sec, cfg);
    const fmt = typeof cfg.formatDuration === 'function' ? cfg.formatDuration : (s) => String(Math.round(s));

    if (cfg.loading) {
      paintLoading(slot, slots);
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
      paintLoading(slot, slots);
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
      seeks,
      loading: data.loading || seeks === null,
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
    seeksFromTimeline,
    seeksFromRange,
    clickToSeconds,
    thumbUrl: defaultThumbUrl,
    update,
    mountPanel,
    scanPanels,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scanPanels);
  else scanPanels();
})(window.QNC);
