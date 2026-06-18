/* media-thumb — jedna sličica (poster / frame). Prikaz samo; generiranje u hostu. */
window.QNC = window.QNC || {};

(function (QNC) {
  const PANEL_ID = 'media-thumb';

  function esc(v) {
    return String(v || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function thumbUrl(data) {
    return String(data?.thumb_url || data?.thumbnail_url || data?.url || '').trim();
  }

  function thumbStatus(data) {
    const url = thumbUrl(data);
    const st = String(data?.thumb_status || '').toLowerCase();
    if (st === 'error') return 'error';
    if (st === 'processing' || st === 'pending') return 'pending';
    if (url) return 'ready';
    if (data?.loading) return 'pending';
    return 'idle';
  }

  function buildFrameUrl(clipId, seek, options) {
    const o = options || {};
    const pid = o.projectId || (QNC.getProjectId ? QNC.getProjectId() : '');
    const w = Number(o.width || o.thumbW || 112);
    const rev = o.thumbRev != null ? o.thumbRev : 0;
    const base = o.apiBase || '/api/media-pool/thumbnail';
    return (
      base +
      '?clip_id=' +
      encodeURIComponent(clipId) +
      '&seek=' +
      Number(seek || 0).toFixed(3) +
      '&w=' +
      w +
      '&project_id=' +
      encodeURIComponent(pid) +
      '&r=' +
      rev
    );
  }

  function normalizeInput(data) {
    const d = data || {};
    const url = thumbUrl(d);
    return {
      url,
      status: thumbStatus(d),
      variant: d.variant || 'poster',
      alt: d.alt || d.clip_id || '',
      title: d.title || '',
      loading: !!d.loading,
      colorA: d.thumb_color_a || '#2c2c2e',
      colorB: d.thumb_color_b || '#1c1c1e',
    };
  }

  function applyVariantClasses(el, variant) {
    el.classList.remove('qnc-media-thumb--poster', 'qnc-media-thumb--frame', 'qnc-media-thumb--inline');
    el.classList.add('qnc-media-thumb', 'qnc-media-thumb--' + (variant || 'poster'));
  }

  /**
   * Crta sličicu u bilo koji kontejner (grid ćelija, filmstrip slot).
   */
  function paint(container, data) {
    if (!container) return;
    const n = normalizeInput(data);
    applyVariantClasses(container, n.variant);
    container.dataset.thumbStatus = n.status;
    container.classList.toggle('is-loading', n.loading || n.status === 'pending' && !n.url);

    if (n.loading) {
      container.replaceChildren();
      const shimmer = document.createElement('span');
      shimmer.className = 'qnc-media-thumb__shimmer';
      shimmer.setAttribute('aria-hidden', 'true');
      container.appendChild(shimmer);
      return;
    }

    container.classList.remove('is-loading');

    if (n.url && n.status !== 'error') {
      const img = document.createElement('img');
      img.className = 'qnc-media-thumb__img';
      img.src = n.url;
      img.alt = n.alt;
      img.loading = n.variant === 'frame' ? 'eager' : 'lazy';
      if (n.title) img.title = n.title;
      img.onerror = function () {
        this.classList.add('is-broken');
      };
      container.replaceChildren(img);
      return;
    }

    const ph = document.createElement('div');
    ph.className = 'qnc-media-thumb__placeholder';
    ph.style.setProperty('--qnc-mt-ph-a', n.colorA);
    ph.style.setProperty('--qnc-mt-ph-b', n.colorB);
    container.replaceChildren(ph);
  }

  function panelRoot(root) {
    if (!root) return null;
    if (root.matches?.('[data-qnc-panel="' + PANEL_ID + '"]')) return root;
    return root.querySelector?.('[data-qnc-panel="' + PANEL_ID + '"]') || root;
  }

  function update(root, data) {
    const panel = panelRoot(root);
    if (!panel) return;
    paint(panel, data);
  }

  function mount(root, ctx) {
    update(root, ctx?.data || {});
  }

  function fromClip(clip, extra) {
    const c = clip || {};
    const e = extra || {};
    return {
      thumb_url: c.thumb_url || c.thumbnail_url,
      thumb_status: c.thumb_status,
      thumb_error: c.thumb_error,
      thumb_color_a: c.thumb_color_a,
      thumb_color_b: c.thumb_color_b,
      clip_id: c.clip_id || c.id,
      variant: e.variant || 'poster',
      alt: e.alt || c.name || c.clip_id || '',
      title: e.title || '',
      loading: e.loading,
    };
  }

  QNC.mediaThumb = {
    PANEL_ID,
    paint,
    update,
    thumbUrl,
    thumbStatus,
    buildFrameUrl,
    fromClip,
  };

  QNC.components = QNC.components || { register: function () {} };
  if (QNC.components.register) {
    QNC.components.register(PANEL_ID, { PANEL_ID, mount, update, paint, fromClip, buildFrameUrl });
  }
})(window.QNC);
