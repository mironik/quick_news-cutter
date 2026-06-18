/* Ingest clip grid — prikaz klipova iz baze; odabir ide preko API-ja u DB. */
window.QNC = window.QNC || {};

(function (QNC) {
  const PANEL_ID = 'ingest-clip-grid';

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
      return QNC.emitComponent(pluginId || 'ingest', PANEL_ID, action, payload || {});
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

  function formatDuration(sec) {
    const s = Math.max(0, Number(sec) || 0);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = Math.floor(s % 60);
    if (h > 0) {
      return h + ':' + String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
    }
    return m + ':' + String(r).padStart(2, '0');
  }

  function statusKind(clip) {
    if (clip.error || clip.import_status === 'error' || clip.proxy_status === 'error') return 'error';
    if (clip.import_status === 'done' || clip.import_status === 'imported') return 'ready';
    if (clip.proxy_status === 'ready' || clip.detected) return 'ready';
    if (clip.import_status === 'queued' || clip.proxy_status === 'pending') return 'pending';
    return 'idle';
  }

  function importLabel(clip) {
    const st = String(clip.import_status || '').toLowerCase();
    if (st === 'done' || st === 'imported') return 'Uvezen';
    if (st === 'queued') return 'U redu';
    if (st === 'error') return 'Greška';
    if (st === 'processing') return 'Uvozi…';
    return '';
  }

  function thumbApi() {
    return QNC.components?.get?.('media-thumb') || QNC.mediaThumb || null;
  }

  function paintClipThumb(container, clip) {
    const api = thumbApi();
    if (!api?.paint) return;
    api.paint(container, api.fromClip ? api.fromClip(clip, { variant: 'poster' }) : clip);
  }

  function renderClip(clip, selectedIds, features) {
    const id = String(clip.clip_id || clip.id || '');
    const selected = selectedIds.includes(id);
    const imported = statusKind(clip) === 'ready' && importLabel(clip) === 'Uvezen';
    const chip = importLabel(clip);
    const parts = [];
    parts.push(
      '<button type="button" class="qnc-ip-clip' +
        (selected ? ' is-selected' : '') +
        (imported ? ' is-imported' : '') +
        '" role="listitem" data-clip-id="' +
        esc(id) +
        '" aria-pressed="' +
        (selected ? 'true' : 'false') +
        '">'
    );
    parts.push('<div class="qnc-ip-clip-thumb-wrap">');
    parts.push('<div class="qnc-media-thumb qnc-media-thumb--poster" data-qnc-thumb-slot data-clip-id="' + esc(id) + '"></div>');
    if (features.duration !== false) {
      parts.push('<span class="qnc-ip-clip-duration">' + esc(formatDuration(clip.duration_sec || clip.duration)) + '</span>');
    }
    if (features.status !== false) {
      parts.push('<span class="qnc-ip-clip-status" data-status="' + esc(statusKind(clip)) + '"></span>');
    }
    if (features.selection !== false) {
      parts.push('<span class="qnc-ip-clip-check" aria-hidden="true"></span>');
    }
    parts.push('</div>');
    parts.push('<h3 class="qnc-ip-clip-name">' + esc(clip.name || clip.clip_id || id) + '</h3>');
    if (features.meta !== false) {
      const meta = [clip.import_label, clip.codec ? 'izvor ' + clip.codec : '']
        .filter(Boolean)
        .join(' · ');
      parts.push('<p class="qnc-ip-clip-meta">' + esc(meta || clip.media_id || '') + '</p>');
    }
    if (features.import_chip !== false && chip) {
      parts.push('<span class="qnc-ip-clip-chip">' + esc(chip) + '</span>');
    }
    parts.push('</button>');
    return parts.join('');
  }

  function syncFeatures(panel, features) {
    const f = features || {};
    panel.dataset.featureFooter = f.footer === false ? 'off' : 'on';
    panel.dataset.featureEmpty = f.empty === false ? 'off' : 'on';
    panel.dataset.featureDuration = f.duration === false ? 'off' : 'on';
    panel.dataset.featureStatus = f.status === false ? 'off' : 'on';
    panel.dataset.featureMeta = f.meta === false ? 'off' : 'on';
    panel.dataset.featureImportChip = f.import_chip === false ? 'off' : 'on';
    panel.dataset.featureSelection = f.selection === false ? 'off' : 'on';
    if (f.density) panel.dataset.density = f.density;
  }

  function bindGrid(panel, pluginId) {
    if (panel._qncIpGridBound) return;
    panel._qncIpGridBound = true;
    const grid = slot('clip-grid', panel);
    if (!grid) return;
    grid.addEventListener('click', (ev) => {
      const btn = ev.target.closest?.('.qnc-ip-clip');
      if (!btn) return;
      const clipId = btn.getAttribute('data-clip-id') || '';
      if (!clipId) return;
      emit(pluginId, 'clip.toggle', { clip_id: clipId });
    });
  }

  function update(root, data, ctx) {
    const panel = panelRoot(root);
    if (!panel) return;
    const pluginId = ctx?.pluginId || 'ingest';
    bindGrid(panel, pluginId);

    const clips = Array.isArray(data?.clips) ? data.clips : [];
    const selectedIds = Array.isArray(data?.selected_clip_ids)
      ? data.selected_clip_ids.map(String)
      : [];

    const features = data?.features || {};
    syncFeatures(panel, features);

    const grid = slot('clip-grid', panel);
    const empty = slot('empty', panel);
    const status = slot('status', panel);
    if (!grid) return;

    if (!clips.length) {
      grid.innerHTML = '';
      if (empty) empty.hidden = features.empty === false;
      if (status) status.textContent = data?.status_text || 'Nema klipova.';
      return;
    }

    if (empty) empty.hidden = true;
    grid.innerHTML = clips.map((clip) => renderClip(clip, selectedIds, features)).join('');
    grid.querySelectorAll('[data-qnc-thumb-slot]').forEach((slot) => {
      const clipId = slot.getAttribute('data-clip-id') || '';
      const clip = clips.find((c) => String(c.clip_id || c.id || '') === clipId);
      if (clip) paintClipThumb(slot, clip);
    });
    if (status) {
      const sel = selectedIds.length;
      status.textContent =
        data?.status_text ||
        (sel ? sel + ' od ' + clips.length + ' odabrano' : clips.length + ' klipova');
    }
  }

  function mount(root, ctx) {
    const panel = panelRoot(root);
    if (!panel) return;
    bindGrid(panel, ctx?.pluginId || 'ingest_proxy');
    update(root, { clips: [], features: {} }, ctx);
  }

  QNC.components = QNC.components || { registry: new Map() };
  if (QNC.components.register) {
    QNC.components.register(PANEL_ID, { PANEL_ID, mount, update });
  }
})(window.QNC);
