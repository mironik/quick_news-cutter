/* Ingest Proxy workspace — design lab (FCP 11 clip browser). */
(function () {
  const WORKSPACE_HTML = '/app/components/ingest-workspace/component.html';
  const TOOLBAR_HTML = '/app/components/ingest-toolbar/component.html';
  const SOURCE_HTML = '/app/components/ingest-source-picker/component.html';
  const ACTIONS_HTML = '/app/components/ingest-actions/component.html';
  const GRID_HTML = '/app/components/ingest-clip-grid/component.html';
  const GRID_JS = '/app/components/ingest-clip-grid/component.js';
  const THUMB_JS = '/app/components/media-thumb/component.js';

  const PROFILES_URL = '/plugins/design-tools/ingest-clip-grid/build-profiles.json';
  const DEMO_URL = '/plugins/design-tools/ingest-clip-grid/demo-clips.json';
  const STYLE_URL = '/plugins/design-tools/ingest-clip-grid/style-tokens.json';
  const PREFS_API = '/api/design-tools/ingest-clip-grid-lab';

  const ALL_FEATURE_IDS = [
    'toolbar',
    'source_picker',
    'actions',
    'duration_badge',
    'status_dot',
    'meta_line',
    'import_chip',
    'selection_check',
    'footer_status',
    'empty_state',
  ];
  const FEATURE_LABELS = {
    toolbar: 'Toolbar',
    source_picker: 'Source picker',
    actions: 'Action bar',
    duration_badge: 'Trajanje na thumbu',
    status_dot: 'Status točka',
    meta_line: 'Meta linija',
    import_chip: 'Import chip',
    selection_check: 'Checkbox odabira',
    footer_status: 'Status traka',
    empty_state: 'Prazan grid',
  };

  let profiles = {};
  let styleSchema = null;
  let gridStyle = {};
  let demoData = {};
  let activeProfileId = 'fcp11-browser';
  let featureStates = {};
  let workspaceHost = null;
  let selectedClipIds = [];
  let prefsHydrating = false;
  let saveTimer = null;

  const overlay = () => window.QNCDesignOverlay;

  function esc(v) {
    return String(v || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function profile() {
    return profiles[activeProfileId] || null;
  }

  function isFeatureAvailable(id) {
    return ALL_FEATURE_IDS.includes(id) && (profile()?.available_features || []).includes(id);
  }

  function isFeatureOn(id) {
    if (!isFeatureAvailable(id)) return false;
    const st = featureStates[id];
    if (st === 'off') return false;
    return st === 'on' || st == null;
  }

  function defaultFeatureStates() {
    const out = {};
    const defs = profile()?.default_feature_states || {};
    ALL_FEATURE_IDS.forEach((id) => {
      out[id] = defs[id] === 'off' ? 'off' : 'on';
    });
    return out;
  }

  function collectPrefs() {
    const features = {};
    ALL_FEATURE_IDS.forEach((id) => {
      if (isFeatureAvailable(id)) features[id] = featureStates[id] || 'off';
    });
    return {
      version: 1,
      component: 'ingest-clip-grid',
      active_profile_id: activeProfileId,
      feature_states: features,
      selected_clip_ids: selectedClipIds,
      style: { ...gridStyle },
    };
  }

  function schedulePersist() {
    if (prefsHydrating) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistPrefs, 150);
  }

  async function loadPrefs() {
    try {
      const res = await fetch(PREFS_API, { cache: 'no-store' });
      if (!res.ok) return null;
      return (await res.json()).prefs || null;
    } catch {
      return null;
    }
  }

  async function persistPrefs() {
    if (prefsHydrating || !workspaceHost) return;
    try {
      await fetch(PREFS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefs: collectPrefs() }),
      });
    } catch (err) {
      console.warn('[ingest-proxy]', err);
    }
  }

  function mergeGridStyle(saved) {
    const merged = {};
    const defaults = styleSchema?.defaults || {};
    Object.keys(defaults).forEach((name) => {
      merged[name] = saved?.[name] != null ? String(saved[name]) : String(defaults[name] ?? '');
    });
    return merged;
  }

  function applyStyleTokens(host, style) {
    if (!host) return;
    Object.entries(style || {}).forEach(([name, value]) => {
      if (String(name).startsWith('--')) host.style.setProperty(name, String(value));
    });
  }

  function resolveDemoClips() {
    if (activeProfileId === 'empty') return [];
    return demoData.clips || [];
  }

  function gridFeatures() {
    const density = profile()?.density || 'comfortable';
    return {
      density,
      duration: isFeatureOn('duration_badge'),
      status: isFeatureOn('status_dot'),
      meta: isFeatureOn('meta_line'),
      import_chip: isFeatureOn('import_chip'),
      selection: isFeatureOn('selection_check'),
      footer: isFeatureOn('footer_status'),
      empty: isFeatureOn('empty_state'),
    };
  }

  function syncChrome(host) {
    const ws = host.closest('[data-qnc-panel="ingest-workspace"]') || host;
    const toolbarSlot = ws.querySelector('[data-qnc-slot="toolbar"]');
    const sourceSlot = ws.querySelector('[data-qnc-slot="source-picker"]');
    const actionsSlot = ws.querySelector('[data-qnc-slot="actions"]');
    const controls = ws.querySelector('.qnc-ip-workspace-controls');

    if (toolbarSlot) toolbarSlot.hidden = !isFeatureOn('toolbar');
    if (sourceSlot) sourceSlot.hidden = !isFeatureOn('source_picker');
    if (actionsSlot) actionsSlot.hidden = !isFeatureOn('actions');
    if (controls) {
      controls.hidden = !isFeatureOn('source_picker') && !isFeatureOn('actions');
    }

    const title = ws.querySelector('.qnc-ip-toolbar-title');
    const project = ws.querySelector('[data-qnc-slot="project-label"]');
    const summary = ws.querySelector('[data-qnc-slot="summary"]');
    if (project) project.textContent = demoData.project_name || '—';
    if (summary) {
      const clips = resolveDemoClips();
      summary.textContent = clips.length ? clips.length + ' klipova · ' + selectedClipIds.length + ' odabrano' : '';
    }
    if (title && !isFeatureOn('toolbar')) title.textContent = 'Ingest Proxy';

    const select = ws.querySelector('[data-qnc-slot="source-select"]');
    const pathEl = ws.querySelector('[data-qnc-slot="source-path"]');
    if (select && select.options.length <= 1) {
      (demoData.sources || []).forEach((src) => {
        const opt = document.createElement('option');
        opt.value = src.source_template_id;
        opt.textContent = src.name;
        if (src.source_template_id === demoData.active_source_id) opt.selected = true;
        select.appendChild(opt);
      });
    }
    if (pathEl) {
      const src = (demoData.sources || []).find((s) => s.source_template_id === demoData.active_source_id);
      pathEl.textContent = src?.path ? 'Projekti/…/' + src.path : '';
    }
  }

  function renderGrid(host) {
    const gridPanel = host.querySelector('[data-qnc-panel="ingest-clip-grid"]');
    if (!gridPanel) return;
    const api = window.QNC?.components?.get?.('ingest-clip-grid');
    const clips = resolveDemoClips();
    const payload = {
      clips,
      selected_clip_ids: selectedClipIds,
      features: gridFeatures(),
      status_text: clips.length ? selectedClipIds.length + ' od ' + clips.length + ' odabrano' : 'Nema klipova.',
    };
    if (api?.update) {
      api.update(gridPanel, payload, { pluginId: 'design-tools' });
    }
    syncChrome(host);
  }

  function toggleClip(host, clipId) {
    const id = String(clipId || '');
    if (!id) return;
    const idx = selectedClipIds.indexOf(id);
    if (idx >= 0) selectedClipIds.splice(idx, 1);
    else selectedClipIds.push(id);
    renderGrid(host);
    schedulePersist();
  }

  function bindLabActions(host) {
    if (host._qncIpLabBound) return;
    host._qncIpLabBound = true;
    host.addEventListener('click', (ev) => {
      const btn = ev.target.closest?.('[data-action]');
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      if (action === 'select-all') {
        const all = resolveDemoClips();
        const allIds = all.map((c) => String(c.clip_id));
        const allSelected =
          allIds.length > 0 && allIds.every((id) => selectedClipIds.includes(id));
        selectedClipIds = allSelected ? [] : [...allIds];
        renderGrid(host);
        schedulePersist();
        return;
      }
      if (action === 'discover' && window.QNC?.setBox) {
        QNC.setBox('Lab: Otkrij proxyje (mock)', 'ok');
      }
    });
    host.addEventListener('click', (ev) => {
      const clipBtn = ev.target.closest?.('.qnc-ip-clip');
      if (!clipBtn) return;
      toggleClip(host, clipBtn.getAttribute('data-clip-id'));
    });
  }

  function applyProfile(host) {
    featureStates = defaultFeatureStates();
    selectedClipIds = [...(demoData.selected_clip_ids || [])];
    syncChrome(host);
    renderGrid(host);
  }

  function openFeaturesOverlay(host) {
    const ov = overlay();
    if (!ov) return;
    const parts = [];
    parts.push('<div class="qnc-design-overlay-stack"><section><h4>Značajke</h4><div class="qnc-design-overlay-matrix">');
    ALL_FEATURE_IDS.forEach((id) => {
      if (!isFeatureAvailable(id)) return;
      parts.push('<div class="qnc-design-overlay-matrix-row"><span>' + esc(FEATURE_LABELS[id]) + '</span>');
      parts.push(
        '<label><input type="radio" name="ip-feat-' +
          id +
          '" value="on"' +
          (featureStates[id] !== 'off' ? ' checked' : '') +
          '> Uklj.</label>'
      );
      parts.push(
        '<label><input type="radio" name="ip-feat-' +
          id +
          '" value="off"' +
          (featureStates[id] === 'off' ? ' checked' : '') +
          '> Isklj.</label>'
      );
      parts.push('</div>');
    });
    parts.push('</div></section></div>');

    ov.open({
      component: 'ingest-clip-grid',
      title: 'Ingest Proxy',
      subtitle: 'Značajke komponente',
      applyLabel: 'Zatvori',
      renderBody: (body) => {
        body.innerHTML = parts.join('');
        body.querySelectorAll('input[type="radio"]').forEach((input) => {
          input.addEventListener('change', () => {
            const id = input.name.slice(8);
            if (isFeatureAvailable(id)) {
              featureStates[id] = input.value === 'off' ? 'off' : 'on';
              syncChrome(host);
              renderGrid(host);
              renderControls(document.querySelector('[data-qnc-slot="component-lab-sidebar"]'));
              schedulePersist();
            }
          });
        });
      },
    });
  }

  function renderControls(sidebar) {
    if (!sidebar) return;
    const parts = [];
    parts.push('<div class="qnc-design-component-lab"><h4>Ingest Proxy</h4>');
    parts.push(
      '<p class="qnc-ip-design-hint muted">Clip grid u stilu <strong>Final Cut Pro 11</strong> browsera — orange selection ring, thumb + meta ispod.</p>'
    );
    parts.push('<label class="qnc-ui-label">Build profil</label><select class="qnc-ui-select" data-ip-profile>');
    Object.entries(profiles).forEach(([id, prof]) => {
      parts.push(
        '<option value="' + id + '"' + (id === activeProfileId ? ' selected' : '') + '>' + esc(prof.label) + '</option>'
      );
    });
    parts.push('</select>');
    parts.push('<button type="button" class="qnc-ui-button qnc-ui-button-primary" data-ip-features">Značajke…</button>');
    parts.push('<h4>U profilu</h4>');
    ALL_FEATURE_IDS.forEach((id) => {
      if (!isFeatureAvailable(id)) return;
      parts.push(
        '<div class="qnc-design-track-row"><span>' +
          esc(FEATURE_LABELS[id]) +
          '</span><span class="qnc-ui-chip">' +
          esc(featureStates[id] === 'off' ? 'off' : 'on') +
          '</span></div>'
      );
    });
    parts.push('<p class="muted qnc-design-hint">Klik na klip = odabir (lab)</p></div>');
    sidebar.innerHTML = parts.join('');

    sidebar.querySelector('[data-ip-profile]')?.addEventListener('change', (ev) => {
      activeProfileId = ev.target.value;
      applyProfile(workspaceHost);
      renderControls(sidebar);
      schedulePersist();
    });
    sidebar.querySelector('[data-ip-features]')?.addEventListener('click', () => {
      if (workspaceHost) openFeaturesOverlay(workspaceHost);
    });
  }

  function applyPrefs(host, prefs) {
    if (!prefs) return;
    if (prefs.active_profile_id && profiles[prefs.active_profile_id]) activeProfileId = prefs.active_profile_id;
    applyProfile(host);
    if (prefs.feature_states) {
      Object.entries(prefs.feature_states).forEach(([id, st]) => {
        if (isFeatureAvailable(id)) featureStates[id] = st === 'off' ? 'off' : 'on';
      });
    }
    if (Array.isArray(prefs.selected_clip_ids)) selectedClipIds = prefs.selected_clip_ids.map(String);
    if (prefs.style) {
      gridStyle = mergeGridStyle(prefs.style);
      applyStyleTokens(host, gridStyle);
    }
    syncChrome(host);
    renderGrid(host);
  }

  async function fetchText(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('Nije učitano: ' + url);
    return res.text();
  }

  async function loadComponentScripts() {
    if (!document.getElementById('qnc-media-thumb-js')) {
      await new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.id = 'qnc-media-thumb-js';
        el.src = THUMB_JS + '?v=1.0.0';
        el.onload = () => resolve();
        el.onerror = () => reject(new Error('Thumb JS nije učitan'));
        document.body.appendChild(el);
      });
    }
    if (document.getElementById('qnc-ip-clip-grid-js')) return;
    await new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.id = 'qnc-ip-clip-grid-js';
      el.src = GRID_JS + '?v=1.0.3';
      el.onload = () => resolve();
      el.onerror = () => reject(new Error('Grid JS nije učitan'));
      document.body.appendChild(el);
    });
  }

  async function mount(previewEl, sidebarEl) {
    await Promise.all([
      fetch(PROFILES_URL, { cache: 'no-store' }).then((r) => r.json()).then((d) => {
        profiles = d.profiles || {};
      }),
      fetch(DEMO_URL, { cache: 'no-store' }).then((r) => r.json()).then((d) => {
        demoData = d;
      }),
    ]);

    const styleRes = await fetch(STYLE_URL, { cache: 'no-store' });
    if (styleRes.ok) {
      styleSchema = await styleRes.json();
      gridStyle = mergeGridStyle({});
    }

    await loadComponentScripts();

    const [wsHtml, toolbarHtml, sourceHtml, actionsHtml, gridHtml] = await Promise.all([
      fetchText(WORKSPACE_HTML),
      fetchText(TOOLBAR_HTML),
      fetchText(SOURCE_HTML),
      fetchText(ACTIONS_HTML),
      fetchText(GRID_HTML),
    ]);

    previewEl.innerHTML =
      '<div class="qnc-design-ingest-host"><div class="qnc-design-ingest-frame">' + wsHtml + '</div></div>';

    workspaceHost = previewEl.querySelector('[data-qnc-panel="ingest-workspace"]');
    if (!workspaceHost) throw new Error('Nema ingest-workspace root');

    workspaceHost.querySelector('[data-qnc-slot="toolbar"]').innerHTML = toolbarHtml;
    workspaceHost.querySelector('[data-qnc-slot="source-picker"]').innerHTML = sourceHtml;
    workspaceHost.querySelector('[data-qnc-slot="actions"]').innerHTML = actionsHtml;
    workspaceHost.querySelector('[data-qnc-slot="clip-grid"]').innerHTML = gridHtml;

    const prefs = await loadPrefs();
    prefsHydrating = true;
    applyProfile(workspaceHost);
    if (prefs) applyPrefs(workspaceHost, prefs);
    applyStyleTokens(workspaceHost, gridStyle);
    bindLabActions(workspaceHost);
    prefsHydrating = false;

    renderControls(sidebarEl);
    return workspaceHost;
  }

  window.QNCDesignIngestProxy = { mount, ALL_FEATURE_IDS, FEATURE_LABELS };
})();
