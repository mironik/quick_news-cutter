/* Project list — komponenta s punim katalogom. Build profil određuje available_features. */
(function () {
  const COMPONENT_HTML = '/app/components/project-list/component.html';
  const PANEL_SEL = '[data-qnc-panel="project-list"]';
  const PROFILES_URL = '/plugins/design-tools/project-list/build-profiles.json';
  const DEMO_URL = '/plugins/design-tools/project-list/demo-projects.json';
  const STYLE_URL = '/plugins/design-tools/project-list/style-tokens.json';
  const PREFS_API = '/api/design-tools/project-list-lab';

  const ALL_FEATURE_IDS = ['header', 'delete_button', 'meta_id', 'meta_created', 'footer_status', 'empty_state'];
  const FEATURE_LABELS = {
    header: 'Zaglavlje',
    delete_button: 'Gumb brisanja',
    meta_id: 'Meta — ID',
    meta_created: 'Meta — datum',
    footer_status: 'Status traka',
    empty_state: 'Prazan popis',
  };

  let profiles = {};
  let styleSchema = null;
  let listStyle = {};
  let demoSets = {};
  let activeProfileId = 'design-lab';
  let featureStates = {};
  let listHost = null;
  let projects = [];
  let activeProjectId = '';
  let selectedProjectId = '';
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
      component: 'project-list',
      active_profile_id: activeProfileId,
      feature_states: features,
      active_project_id: activeProjectId,
      selected_project_id: selectedProjectId,
      style: { ...listStyle },
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
    if (prefsHydrating || !listHost) return;
    try {
      await fetch(PREFS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefs: collectPrefs() }),
      });
    } catch (err) {
      console.warn('[project-list]', err);
    }
  }

  function mergeListStyle(saved) {
    const merged = {};
    const defaults = styleSchema?.defaults || {};
    Object.keys(defaults).forEach((name) => {
      merged[name] = saved?.[name] != null ? String(saved[name]) : String(defaults[name] ?? '');
    });
    return merged;
  }

  function applyStyleTokens(host, style) {
    if (!host || !styleSchema) return;
    Object.keys(styleSchema.defaults || {}).forEach((name) => {
      const val = style[name];
      const def = String(styleSchema.defaults[name] ?? '');
      if (val == null || val === '' || String(val) === def) host.style.removeProperty(name);
      else host.style.setProperty(name, String(val));
    });
  }

  function resolveDemoProjects() {
    const setId = profile()?.demo_set || 'default';
    if (setId === 'empty') return [];
    const data = demoSets.default || demoSets;
    return Array.isArray(data.projects) ? data.projects.slice() : [];
  }

  function setFeatureState(host, id, state) {
    if (!isFeatureAvailable(id)) return;
    featureStates[id] = state === 'on' ? 'on' : 'off';
    syncChrome(host);
    renderList(host);
    schedulePersist();
  }

  function syncChrome(host) {
    host.querySelectorAll('[data-project-list-chrome]').forEach((el) => {
      const id = el.getAttribute('data-project-list-chrome');
      const map = { footer_status: 'footer_status', header: 'header' };
      const feat = map[id] || id;
      el.hidden = !isFeatureOn(feat);
    });
    host.setAttribute('data-feature-delete', isFeatureOn('delete_button') ? 'on' : 'off');
  }

  function updateStatus(host, text) {
    const el = host.querySelector('[data-qnc-slot="status"]');
    if (el) el.textContent = text;
  }

  function listUl(host) {
    return host.querySelector('[data-qnc-slot="project-list"]');
  }

  function renderMetaLine(p) {
    const id = p.project_id || '';
    const parts = [];
    if (isFeatureOn('meta_id') && id) parts.push(id);
    if (isFeatureOn('meta_created') && p.created_at) parts.push(p.created_at);
    if (!parts.length) return '';
    return '<span class="qnc-project-list-meta">' + esc(parts.join(' / ')) + '</span>';
  }

  function renderList(host) {
    const ul = listUl(host);
    if (!ul) return;

    if (!projects.length) {
      if (isFeatureOn('empty_state')) {
        ul.innerHTML = '<li class="qnc-project-list-empty muted">Nema projekata.</li>';
      } else {
        ul.innerHTML = '';
      }
      updateStatus(host, projects.length ? 'Spreman.' : 'Prazan popis.');
      return;
    }

    ul.innerHTML = projects
      .map((p) => {
        const id = p.project_id || '';
        const selected = id === selectedProjectId;
        const active = id === activeProjectId;
        const classes = [
          selected ? 'selected-row' : '',
          active ? 'active-project-row' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const deleteBtn = isFeatureOn('delete_button')
          ? '<button type="button" class="qnc-project-list-delete" data-delete-id="' +
            esc(id) +
            '" aria-label="Obriši projekt">×</button>'
          : '';
        const meta = renderMetaLine(p);
        return (
          '<li class="' +
          classes +
          '" data-id="' +
          esc(id) +
          '">' +
          '<span class="qnc-project-list-dot" aria-hidden="true"></span>' +
          '<span class="qnc-project-list-text">' +
          '<span class="qnc-project-list-name">' +
          esc(p.name || id) +
          '</span>' +
          meta +
          '</span>' +
          deleteBtn +
          '</li>'
        );
      })
      .join('');

    ul.querySelectorAll('[data-delete-id]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const id = btn.getAttribute('data-delete-id');
        projects = projects.filter((p) => p.project_id !== id);
        if (activeProjectId === id) activeProjectId = projects[0]?.project_id || '';
        if (selectedProjectId === id) selectedProjectId = projects[0]?.project_id || '';
        renderList(host);
        updateStatus(host, 'Obrisano: ' + id);
        schedulePersist();
      });
    });

    ul.querySelectorAll('li[data-id]').forEach((row) => {
      row.addEventListener('click', () => {
        selectedProjectId = row.getAttribute('data-id') || '';
        activeProjectId = selectedProjectId;
        renderList(host);
        updateStatus(host, 'Otvoren: ' + selectedProjectId);
        schedulePersist();
      });
    });

    updateStatus(host, projects.length + ' projekata · odabrano: ' + (selectedProjectId || '—'));
  }

  function applyProfile(host) {
    featureStates = defaultFeatureStates();
    projects = resolveDemoProjects();
    const demo = demoSets.default || demoSets;
    activeProjectId = demo.active_project_id || projects[0]?.project_id || '';
    selectedProjectId = demo.selected_project_id || activeProjectId;
    syncChrome(host);
    renderList(host);
  }

  function openFeaturesOverlay(host) {
    const ov = overlay();
    if (!ov) return;
    const parts = [];
    parts.push('<div class="qnc-design-overlay-stack">');
    parts.push('<section><h4>Značajke (u build profilu)</h4><div class="qnc-design-overlay-matrix">');
    ALL_FEATURE_IDS.forEach((id) => {
      if (!isFeatureAvailable(id)) return;
      parts.push('<div class="qnc-design-overlay-matrix-row"><span>' + esc(FEATURE_LABELS[id]) + '</span>');
      parts.push(
        '<label><input type="radio" name="feat-' +
          id +
          '" value="on"' +
          (featureStates[id] !== 'off' ? ' checked' : '') +
          '> Uklj.</label>'
      );
      parts.push(
        '<label><input type="radio" name="feat-' +
          id +
          '" value="off"' +
          (featureStates[id] === 'off' ? ' checked' : '') +
          '> Isklj.</label>'
      );
      parts.push('</div>');
    });
    parts.push('</div></section></div>');

    ov.open({
      component: 'project-list',
      title: 'Project list',
      subtitle: 'Značajke komponente',
      applyLabel: 'Zatvori',
      renderBody: (body) => {
        body.innerHTML = parts.join('');
        body.querySelectorAll('input[type="radio"]').forEach((input) => {
          input.addEventListener('change', () => {
            const id = input.name.slice(5);
            setFeatureState(host, id, input.value);
            renderControls(document.querySelector('[data-qnc-slot="component-lab-sidebar"]'));
          });
        });
      },
    });
  }

  function renderControls(sidebar) {
    if (!sidebar) return;
    const parts = [];
    parts.push('<div class="qnc-design-component-lab">');
    parts.push('<h4>Project list</h4>');
    parts.push(
      '<p class="qnc-project-list-hint muted">Komponenta sadrži <strong>sve značajke</strong>. Developer u <code>build-profiles.json</code> određuje <code>available_features</code> za primjenu.</p>'
    );

    parts.push('<label class="qnc-ui-label">Build profil</label>');
    parts.push('<select class="qnc-ui-select" data-pl-profile>');
    Object.entries(profiles).forEach(([id, prof]) => {
      parts.push(
        '<option value="' + id + '"' + (id === activeProfileId ? ' selected' : '') + '>' + esc(prof.label) + '</option>'
      );
    });
    parts.push('</select>');

    parts.push('<button type="button" class="qnc-ui-button qnc-ui-button-primary" data-pl-features">Značajke…</button>');

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

    parts.push('<p class="muted qnc-design-hint">Klik = odabir · × = brisanje (lab)</p>');
    parts.push('</div>');
    sidebar.innerHTML = parts.join('');

    sidebar.querySelector('[data-pl-profile]')?.addEventListener('change', (ev) => {
      activeProfileId = ev.target.value;
      applyProfile(listHost);
      renderControls(sidebar);
      schedulePersist();
    });
    sidebar.querySelector('[data-pl-features]')?.addEventListener('click', () => {
      if (listHost) openFeaturesOverlay(listHost);
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
    if (prefs.active_project_id) activeProjectId = String(prefs.active_project_id);
    if (prefs.selected_project_id) selectedProjectId = String(prefs.selected_project_id);
    if (prefs.style) {
      listStyle = mergeListStyle(prefs.style);
      applyStyleTokens(host, listStyle);
    }
    syncChrome(host);
    renderList(host);
  }

  async function loadProfiles() {
    const res = await fetch(PROFILES_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('Build profili nisu učitani');
    const data = await res.json();
    profiles = data.profiles || {};
  }

  async function loadDemoSets() {
    const res = await fetch(DEMO_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('Demo projekti nisu učitani');
    const data = await res.json();
    demoSets = { default: data };
  }

  async function mount(previewEl, sidebarEl) {
    await loadProfiles();
    await loadDemoSets();
    const res = await fetch(STYLE_URL, { cache: 'no-store' });
    if (res.ok) {
      styleSchema = await res.json();
      listStyle = mergeListStyle({});
    }
    const prefs = await loadPrefs();
    const mock = await fetch(COMPONENT_HTML, { cache: 'no-store' });
    if (!mock.ok) throw new Error('Komponenta nije učitana');
    previewEl.innerHTML =
      '<div class="qnc-design-project-list-host"><div class="qnc-design-project-list-frame">' +
      (await mock.text()) +
      '</div></div>';
    listHost = previewEl.querySelector(PANEL_SEL);
    if (!listHost) throw new Error('Nema project-list root');

    prefsHydrating = true;
    applyProfile(listHost);
    if (prefs) applyPrefs(listHost, prefs);
    applyStyleTokens(listHost, listStyle);
    prefsHydrating = false;

    renderControls(sidebarEl);
    return listHost;
  }

  window.QNCDesignProjectList = { mount, ALL_FEATURE_IDS, FEATURE_LABELS };
})();
