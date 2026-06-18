/* Samostalan Design add-on — plugins/design-tools (Rust /api/design-tools, bez Pythona). */
(function () {
  const API = '/api/design-tools';
  const TOKENS_BASE = '/plugins/design-tools/design/tokens.json';

  function esc(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(text, kind) {
    if (window.QNC && QNC.setBox) QNC.setBox(text, kind || 'ok');
  }

  const Runtime = {
    applyTokens(tokens) {
      if (!tokens || typeof tokens !== 'object') return;
      const root = document.documentElement;
      Object.entries(tokens).forEach(([name, value]) => {
        if (!String(name).startsWith('--') || value == null) return;
        root.style.setProperty(name, String(value));
      });
    },
    async fetchMergedTokens() {
      const res = await fetch(API + '/tokens', { cache: 'no-store' });
      if (!res.ok) throw new Error('Tokeni nisu učitani');
      const data = await res.json();
      return data.tokens || {};
    },
    async applyActiveThemeOnBoot() {
      try {
        const tokens = await Runtime.fetchMergedTokens();
        Runtime.applyTokens(tokens);
      } catch (err) {
        console.warn('[design-tools]', err.message);
      }
    },
  };

  const panel = () => document.getElementById('panel-design-tools');
  const q = (sel, root) => (root || panel() || document).querySelector(sel);

  let baseGroups = {};
  let appBaseTokens = {};
  let workingTokens = {};
  let activeThemeId = 'default';
  let themes = [];

  function tokenInputType(name) {
    if (name.includes('font') || name.includes('space')) return 'text';
    const value = workingTokens[name] || '';
    return /^#[0-9a-f]{3,8}$/i.test(value) ? 'color' : 'text';
  }

  function renderTokenGroups() {
    const host = q('[data-qnc-slot="token-groups"]');
    if (!host) return;
    const parts = [];
    Object.entries(baseGroups).forEach(([groupId, group]) => {
      const ids = Array.isArray(group.tokens) ? group.tokens : [];
      if (!ids.length) return;
      parts.push('<section class="qnc-design-token-group">');
      parts.push('<h4>' + esc(group.label || groupId) + '</h4>');
      ids.forEach((tokenId) => {
        const value = workingTokens[tokenId] || '';
        const type = tokenInputType(tokenId);
        parts.push('<div class="qnc-design-token-row">');
        parts.push('<code>' + esc(tokenId) + '</code>');
        if (type === 'color') {
          parts.push(
            '<input type="color" data-design-token="' +
              esc(tokenId) +
              '" value="' +
              esc(value || '#000000') +
              '" />'
          );
        } else {
          parts.push(
            '<input type="text" class="qnc-ui-input" data-design-token="' +
              esc(tokenId) +
              '" value="' +
              esc(value) +
              '" />'
          );
        }
        parts.push('</div>');
      });
      parts.push('</section>');
    });
    host.innerHTML = parts.join('');
    host.querySelectorAll('[data-design-token]').forEach((input) => {
      input.addEventListener('input', onTokenInput);
    });
  }

  function onTokenInput(ev) {
    const el = ev.target;
    const tokenId = el.getAttribute('data-design-token');
    if (!tokenId) return;
    workingTokens[tokenId] = el.value;
    Runtime.applyTokens({ [tokenId]: el.value });
  }

  function setStatus(text, kind) {
    const chip = q('[data-qnc-slot="design-status"]');
    if (!chip) return;
    chip.textContent = text;
    chip.className = 'qnc-ui-chip' + (kind ? ' is-' + kind : '');
  }

  function renderThemeSelect() {
    const select = q('[data-design-theme-select]');
    if (!select) return;
    select.innerHTML = themes
      .map(
        (theme) =>
          '<option value="' +
          esc(theme.id) +
          '"' +
          (theme.id === activeThemeId ? ' selected' : '') +
          '>' +
          esc(theme.label || theme.id) +
          (theme.built_in ? ' (ugrađena)' : '') +
          '</option>'
      )
      .join('');
  }

  async function loadThemes() {
    const res = await fetch(API + '/themes', { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || data.message || 'Teme nisu učitane');
    themes = Array.isArray(data.themes) ? data.themes : [];
    activeThemeId = data.active_id || 'default';
    renderThemeSelect();
  }

  async function loadEditorData() {
    const [statusRes, tokenRes, schemaRes] = await Promise.all([
      fetch(API + '/status', { cache: 'no-store' }),
      fetch(API + '/tokens', { cache: 'no-store' }),
      fetch(TOKENS_BASE, { cache: 'no-store' }),
    ]);
    const status = await statusRes.json();
    const tokenData = await tokenRes.json();
    const schema = await schemaRes.json();
    baseGroups = schema.groups || {};
    appBaseTokens = { ...(schema.tokens || {}) };
    workingTokens = { ...(tokenData.tokens || {}) };
    activeThemeId = tokenData.theme_id || 'default';
    const mode = status.mode || 'off';
    const modeEl = q('[data-qnc-bind="design.mode"]');
    if (modeEl) modeEl.textContent = mode;
    setStatus('tema: ' + (tokenData.label || activeThemeId), mode === 'open' ? 'ok' : 'muted');
    await loadThemes();
    renderThemeSelect();
    renderTokenGroups();
  }

  async function selectTheme(themeId) {
    if (!themeId || themeId === activeThemeId) return;
    const res = await fetch(API + '/themes/' + encodeURIComponent(themeId) + '/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || data.message || 'Aktivacija teme nije uspjela');
    activeThemeId = themeId;
    const tokenRes = await fetch(API + '/tokens', { cache: 'no-store' });
    const tokenData = await tokenRes.json();
    workingTokens = { ...(tokenData.tokens || {}) };
    Runtime.applyTokens(workingTokens);
    setStatus('tema: ' + (tokenData.label || themeId), 'ok');
    renderThemeSelect();
    renderTokenGroups();
    toast('Tema aktivirana: ' + (tokenData.label || themeId), 'ok');
  }

  async function createTheme() {
    const label = window.prompt('Naziv nove teme:', 'Nova tema');
    if (!label || !label.trim()) return;
    const res = await fetch(API + '/themes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: label.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || data.message || 'Kreiranje teme nije uspjelo');
    activeThemeId = data.id || data.active_id || activeThemeId;
    await loadThemes();
    const tokenRes = await fetch(API + '/tokens', { cache: 'no-store' });
    const tokenData = await tokenRes.json();
    workingTokens = { ...(tokenData.tokens || {}) };
    Runtime.applyTokens(workingTokens);
    renderThemeSelect();
    renderTokenGroups();
    toast('Nova tema: ' + (data.label || label.trim()), 'ok');
  }

  async function saveTokens() {
    const overrides = {};
    Object.keys(workingTokens).forEach((key) => {
      if (workingTokens[key] !== appBaseTokens[key]) {
        overrides[key] = workingTokens[key];
      }
    });
    const res = await fetch(API + '/overrides/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokens: overrides }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || data.message || 'Spremanje nije uspjelo');
    toast('Tema spremljena: ' + activeThemeId, 'ok');
  }

  function resetOverrides() {
    fetch(API + '/tokens', { cache: 'no-store' })
      .then((r) => r.json())
      .then(() => {
        workingTokens = { ...appBaseTokens };
        Runtime.applyTokens(workingTokens);
        renderTokenGroups();
        return fetch(API + '/overrides/tokens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tokens: {} }),
        });
      })
      .then(() => toast('Override resetiran.', 'ok'))
      .catch((e) => toast('Reset: ' + e.message, 'err'));
  }

  function bindActions() {
    const root = panel();
    if (!root) return;
    const saveBtn = root.querySelector('[data-design-action="save"]');
    const resetBtn = root.querySelector('[data-design-action="reset"]');
    const newBtn = root.querySelector('[data-design-action="theme-new"]');
    const select = root.querySelector('[data-design-theme-select]');
    if (saveBtn) {
      saveBtn.onclick = () => saveTokens().catch((e) => toast('Spremi: ' + e.message, 'err'));
    }
    if (resetBtn) resetBtn.onclick = resetOverrides;
    if (newBtn) {
      newBtn.onclick = () => createTheme().catch((e) => toast('Nova tema: ' + e.message, 'err'));
    }
    if (select) {
      select.onchange = () =>
        selectTheme(select.value).catch((e) => toast('Tema: ' + e.message, 'err'));
    }
    root.querySelectorAll('[data-design-editor]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-design-editor');
        if (id && !btn.disabled) switchEditor(id);
      });
    });
  }

  let activeEditor = 'theme';
  const loadedLabScripts = new Set();
  let activeComponentId = 'story-segment';

  const COMPONENT_LABS = [
    {
      id: 'story-segment',
      label: 'Story segment',
      script: '/plugins/design-tools/static/story-segment-design.js?v=51',
      scriptId: 'qnc-design-story-segment-js',
      global: 'QNCDesignStorySegment',
    },
    {
      id: 'project-list',
      label: 'Project list',
      script: '/plugins/design-tools/static/project-list-design.js?v=51',
      scriptId: 'qnc-design-project-list-js',
      global: 'QNCDesignProjectList',
    },
    {
      id: 'project-template-settings',
      label: 'Template postavke',
      script: '/plugins/design-tools/static/project-template-settings-design.js?v=52',
      scriptId: 'qnc-design-project-template-settings-js',
      global: 'QNCDesignProjectTemplateSettings',
    },
    {
      id: 'ingest-clip-grid',
      label: 'Ingest',
      script: '/plugins/design-tools/static/ingest-proxy-workspace-design.js?v=52',
      scriptId: 'qnc-design-ingest-proxy-js',
      global: 'QNCDesignIngestProxy',
    },
  ];

  function loadScriptOnce(src, id) {
    return new Promise((resolve, reject) => {
      if (document.getElementById(id)) {
        resolve();
        return;
      }
      const el = document.createElement('script');
      el.id = id;
      el.src = src;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error('Skripta nije učitana: ' + src));
      document.body.appendChild(el);
    });
  }

  function switchEditor(editorId) {
    const root = panel();
    if (!root || editorId === activeEditor) return;
    activeEditor = editorId;

    root.querySelectorAll('[data-design-editor]').forEach((btn) => {
      const on = btn.getAttribute('data-design-editor') === editorId;
      btn.classList.toggle('qnc-ui-button-primary', on);
      btn.classList.toggle('is-active', on);
    });

    root.querySelectorAll('.qnc-design-editor[data-design-view]').forEach((el) => {
      el.hidden = el.getAttribute('data-design-view') !== editorId;
    });

    if (editorId === 'components') {
      mountComponentsEditor().catch((e) => toast('Components: ' + e.message, 'err'));
      const lab = COMPONENT_LABS.find((c) => c.id === activeComponentId);
      setStatus((lab?.label || 'Component') + ' lab', 'ok');
    } else {
      setStatus('tema: ' + activeThemeId, 'ok');
    }
  }

  function bindPanelResize(root) {
    root.querySelectorAll('[data-design-resizable]').forEach((row) => {
      const handle = row.querySelector('[data-design-resize="col"]');
      const sidebar = row.querySelector('.qnc-design-sidebar');
      if (!handle || !sidebar) return;

      let dragging = false;

      function onMove(clientX) {
        const rect = row.getBoundingClientRect();
        const w = Math.max(240, Math.min(560, clientX - rect.left));
        row.style.setProperty('--qnc-design-sidebar-w', w + 'px');
      }

      handle.addEventListener('pointerdown', (ev) => {
        dragging = true;
        handle.classList.add('is-dragging');
        handle.setPointerCapture(ev.pointerId);
        ev.preventDefault();
      });

      handle.addEventListener('pointermove', (ev) => {
        if (!dragging) return;
        onMove(ev.clientX);
      });

      function stopDrag(ev) {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('is-dragging');
        try {
          handle.releasePointerCapture(ev.pointerId);
        } catch (_) {
          /* ignore */
        }
      }

      handle.addEventListener('pointerup', stopDrag);
      handle.addEventListener('pointercancel', stopDrag);

      handle.addEventListener('dblclick', () => {
        const view = row.closest('.qnc-design-editor')?.getAttribute('data-design-view');
        row.style.setProperty('--qnc-design-sidebar-w', view === 'components' ? '340px' : '260px');
      });
    });
  }

  function renderComponentPickerHtml() {
    const parts = [];
    parts.push('<div class="qnc-design-component-picker">');
    parts.push('<label class="qnc-ui-label" for="qnc-design-component-select">Komponenta</label>');
    parts.push('<select id="qnc-design-component-select" class="qnc-ui-select" data-design-component-select>');
    COMPONENT_LABS.forEach((lab) => {
      parts.push(
        '<option value="' +
          esc(lab.id) +
          '"' +
          (lab.id === activeComponentId ? ' selected' : '') +
          '>' +
          esc(lab.label) +
          '</option>'
      );
    });
    parts.push('</select></div>');
    parts.push('<div class="qnc-design-component-lab-sidebar" data-qnc-slot="component-lab-sidebar"></div>');
    return parts.join('');
  }

  async function ensureComponentLab(componentId) {
    const lab = COMPONENT_LABS.find((c) => c.id === componentId);
    if (!lab) throw new Error('Nepoznata komponenta: ' + componentId);
    if (!loadedLabScripts.has(lab.id)) {
      await loadScriptOnce(lab.script, lab.scriptId);
      loadedLabScripts.add(lab.id);
    }
    const mod = window[lab.global];
    if (!mod || typeof mod.mount !== 'function') {
      throw new Error(lab.label + ' lab nije spreman');
    }
    return mod;
  }

  async function mountComponentsEditor() {
    const root = panel();
    const controls = root.querySelector('[data-qnc-slot="component-controls"]');
    const preview = root.querySelector('[data-qnc-slot="component-preview"]');
    if (!controls || !preview) throw new Error('Components editor nije u DOM-u');

    controls.innerHTML = renderComponentPickerHtml();
    const sidebar = controls.querySelector('[data-qnc-slot="component-lab-sidebar"]');
    controls.querySelector('[data-design-component-select]')?.addEventListener('change', (ev) => {
      activeComponentId = ev.target.value;
      mountComponentsEditor().catch((e) => toast('Components: ' + e.message, 'err'));
      const lab = COMPONENT_LABS.find((c) => c.id === activeComponentId);
      setStatus((lab?.label || 'Component') + ' lab', 'ok');
    });

    preview.innerHTML = '<p class="muted">Učitavam…</p>';
    const mod = await ensureComponentLab(activeComponentId);
    preview.innerHTML = '';
    await mod.mount(preview, sidebar);
  }

  window.QNCDesignTools = { Runtime, loadEditorData, bindActions, switchEditor };

  Runtime.applyActiveThemeOnBoot()
    .then(() => loadScriptOnce('/plugins/design-tools/static/design-overlay.js?v=22', 'qnc-design-overlay-js'))
    .then(() => {
      if (window.QNCDesignOverlay) QNCDesignOverlay.init(panel());
    })
    .then(() => loadEditorData())
    .then(() => {
      bindActions();
      bindPanelResize(panel());
      toast('Design Studio spreman.', 'ok');
    })
    .catch((e) => toast('Design Studio: ' + e.message, 'err'));
})();
