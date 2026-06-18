/* Project template settings — odabir templatea + prikaz postavki. Build profil → available_sections. */
(function () {
  const COMPONENT_HTML = '/app/components/project-template-settings/component.html';
  const PANEL_SEL = '[data-qnc-panel="project-template-settings"]';
  const PROFILES_URL = '/plugins/design-tools/project-template-settings/build-profiles.json';
  const DEMO_URL = '/plugins/design-tools/project-template-settings/demo-templates.json';
  const STYLE_URL = '/plugins/design-tools/project-template-settings/style-tokens.json';
  const PREFS_API = '/api/design-tools/project-template-settings-lab';

  const ALL_SECTION_IDS = [
    'header',
    'template_picker',
    'project_create',
    'new_template_action',
    'ai_settings',
    'video_format',
    'export_mode',
    'export_directory',
    'workflow_tabs',
    'advanced_collapsible',
    'custom_template_save',
  ];

  const SECTION_LABELS = {
    header: 'Zaglavlje',
    template_picker: 'Radni tok (fiksno)',
    project_create: 'Naziv projekta + Novi projekt',
    new_template_action: 'Novi template (akcija)',
    ai_settings: 'Grupa — AI',
    video_format: 'Grupa — video format',
    export_mode: 'Grupa — export mod',
    export_directory: 'Grupa — export direktorij',
    workflow_tabs: 'Grupa — plugin tabovi',
    advanced_collapsible: 'Advanced — sklopivi blok',
    custom_template_save: 'Panel spremanja templatea',
  };

  const ADVANCED_BLOCK_IDS = ['video_format', 'export_mode', 'export_directory', 'workflow_tabs'];

  let profiles = {};
  let styleSchema = null;
  let panelStyle = {};
  let demoData = { templates: [], selected_template_id: '' };
  let activeProfileId = 'design-lab';
  let sectionStates = {};
  let panelHost = null;
  let templates = [];
  let selectedTemplateId = '';
  let projectName = '';
  let customSaveOpen = false;
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

  function isSectionAvailable(id) {
    return ALL_SECTION_IDS.includes(id) && (profile()?.available_sections || []).includes(id);
  }

  function isSectionOn(id) {
    if (!isSectionAvailable(id)) return false;
    return sectionStates[id] !== 'off';
  }

  function defaultSectionStates() {
    const out = {};
    const defs = profile()?.default_section_states || {};
    ALL_SECTION_IDS.forEach((id) => {
      out[id] = defs[id] === 'off' ? 'off' : 'on';
    });
    return out;
  }

  function selectedTemplate() {
    return templates.find((t) => t.template_id === selectedTemplateId) || templates[0] || null;
  }

  function aiLabel(settings) {
    const ai = settings?.ai || {};
    const on = !!(ai.enabled || ai.transcription_enabled);
    return on ? 'AI uključen' : 'AI isključen';
  }

  function nested(settings, path, fallback) {
    const parts = path.split('.');
    let cur = settings;
    for (const p of parts) {
      if (!cur || typeof cur !== 'object' || !(p in cur)) return fallback;
      cur = cur[p];
    }
    return cur == null ? fallback : cur;
  }

  function collectPrefs() {
    const sections = {};
    ALL_SECTION_IDS.forEach((id) => {
      if (isSectionAvailable(id)) sections[id] = sectionStates[id] || 'off';
    });
    return {
      version: 1,
      component: 'project-template-settings',
      active_profile_id: activeProfileId,
      section_states: sections,
      selected_template_id: selectedTemplateId,
      project_name: projectName,
      custom_save_open: customSaveOpen,
      style: { ...panelStyle },
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
    if (prefsHydrating || !panelHost) return;
    try {
      await fetch(PREFS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefs: collectPrefs() }),
      });
    } catch (err) {
      console.warn('[project-template-settings]', err);
    }
  }

  function mergePanelStyle(saved) {
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

  function panelSlot(host, name) {
    return host.querySelector('[data-qnc-slot="' + name + '"]');
  }

  function panelBind(host, name) {
    return host.querySelector('[data-qnc-bind="' + name + '"]');
  }

  function panelAction(host, name) {
    return host.querySelector('[data-qnc-action="' + name + '"]');
  }

  function renderGroupSlot(host, slotName, title, html) {
    const el = panelSlot(host, slotName);
    if (el) {
      el.innerHTML = '<h3 class="qnc-pts-group-title">' + esc(title) + '</h3>' + html;
    }
  }

  function setStatus(host, text) {
    const el = panelSlot(host, 'status');
    if (el) el.textContent = text;
  }

  function syncSections(host) {
    ALL_SECTION_IDS.forEach((id) => {
      const el = host.querySelector('[data-pts-section="' + id + '"]');
      if (!el) return;
      if (id === 'advanced_collapsible') {
        const showGroup = ADVANCED_BLOCK_IDS.some((blockId) => isSectionOn(blockId));
        el.hidden = !showGroup;
        el.classList.toggle('is-flat', !isSectionOn('advanced_collapsible'));
        if (!isSectionOn('advanced_collapsible')) el.open = true;
        return;
      }
      el.hidden = !isSectionOn(id);
    });

    const custom = host.querySelector('[data-pts-section="custom_template_save"]');
    if (custom) {
      custom.hidden = !isSectionOn('custom_template_save') || !customSaveOpen;
    }
  }

  function setSectionState(host, id, state) {
    if (!isSectionAvailable(id)) return;
    sectionStates[id] = state === 'on' ? 'on' : 'off';
    syncSections(host);
    schedulePersist();
  }

  function templateSummaryHtml(tpl) {
    if (!tpl) return '<strong>Nema templatea</strong>';
    const ws = tpl.settings?.workspace || {};
    const tabCount = (ws.tabs || []).length;
    const sourceCount = (tpl.source_template_ids || []).length;
    return (
      '<strong>' +
      esc(tpl.name) +
      '</strong><span>' +
      esc(aiLabel(tpl.settings)) +
      ' · ' +
      esc(tabCount) +
      ' modula · ' +
      esc(sourceCount) +
      ' izvora · ' +
      esc(tpl.system ? 'system' : 'custom') +
      '</span>'
    );
  }

  function templateCardsHtml() {
    if (!templates.length) {
      return '<div class="qnc-pts-empty muted">Nema dostupnih templatea.</div>';
    }
    return templates
      .map((t) => {
        const ws = t.settings?.workspace || {};
        const tabCount = (ws.tabs || []).length;
        const sourceCount = (t.source_template_ids || []).length;
        const selected = t.template_id === selectedTemplateId;
        return (
          '<button type="button" class="qnc-pts-card' +
          (selected ? ' is-selected' : '') +
          '" data-template-id="' +
          esc(t.template_id) +
          '">' +
          '<strong>' +
          esc(t.name) +
          '</strong>' +
          '<span>' +
          esc(aiLabel(t.settings)) +
          ' · ' +
          esc(tabCount) +
          ' modula · ' +
          esc(sourceCount) +
          ' izvora · ' +
          esc(t.system ? 'system' : 'custom') +
          '</span>' +
          '</button>'
        );
      })
      .join('');
  }

  function videoFormatHtml(s) {
    const v = s?.video || {};
    const a = s?.audio || {};
    const st = s?.storage || {};
    return (
      '<div class="qnc-pts-field-grid">' +
      fieldSelect('Format', 'video.format', v.format, ['HD 1080p', 'HD 1080i50', 'UHD 2160p']) +
      fieldSelect('Frame rate', 'video.fps', v.fps, ['25', '50', '29.97']) +
      fieldInput('Width', 'video.width', v.width) +
      fieldInput('Height', 'video.height', v.height) +
      fieldSelect('Field order', 'video.field_order', v.field_order, ['progressive', 'upper_first']) +
      fieldSelect('Timeline codec', 'video.timeline_codec', v.timeline_codec, [
        'proxy_h264',
        'xdcam_hd_422',
        'prores_422',
      ]) +
      fieldSelect('Proxy policy', 'storage.proxy_policy', st.proxy_policy, [
        'copy_to_project',
        'link_when_available',
      ]) +
      fieldSelect('Audio', 'audio.sample_rate', a.sample_rate, ['48000', '44100']) +
      '</div>'
    );
  }

  function exportModeHtml(s) {
    const ex = s?.export || {};
    const st = s?.storage || {};
    return (
      '<div class="qnc-pts-field-grid">' +
      fieldSelect('Export mode', 'export.default_mode', ex.default_mode, [
        'proxy_fast',
        'xml_master',
        'broadcast_mxf',
      ]) +
      fieldSelect('Original policy', 'storage.original_policy', st.original_policy, [
        'link_when_available',
        'copy_background',
        'ignore_for_fast_news',
      ]) +
      '</div>'
    );
  }

  function fieldDirectoryRow(label, bind, value) {
    return (
      '<div class="qnc-pts-path-field">' +
      '<label class="qnc-ui-label">' +
      esc(label) +
      '</label>' +
      '<div class="qnc-pts-path-row">' +
      '<input class="qnc-ui-input" data-pts-bind="' +
      esc(bind) +
      '" value="' +
      esc(value ?? '') +
      '" />' +
      '<button type="button" class="qnc-ui-button qnc-pts-btn" data-pts-action="export.directory.pick">Izbor direktorija</button>' +
      '</div></div>'
    );
  }

  function exportDirectoryHtml(s) {
    const ex = s?.export || {};
    const dir = ex.directory || ex.output_directory || 'exports/projekti';
    return (
      '<div class="qnc-pts-field-grid qnc-pts-field-grid--single">' +
      fieldDirectoryRow('Putanja', 'export.directory', dir) +
      '<p class="muted qnc-pts-field-hint">Zadani export direktorij za novi projekt iz ovog templatea.</p>' +
      '</div>'
    );
  }

  function renderSettingsPanels(host) {
    const tpl = selectedTemplate();
    const s = tpl?.settings || {};
    renderGroupSlot(host, 'ai-settings', 'AI', aiSettingsHtml(s));
    renderGroupSlot(host, 'video-format', 'Video format', videoFormatHtml(s));
    renderGroupSlot(host, 'export-mode', 'Export mod', exportModeHtml(s));
    renderGroupSlot(host, 'export-directory', 'Export direktorij', exportDirectoryHtml(s));
  }

  function fieldInput(label, bind, value) {
    return (
      '<div><label class="qnc-ui-label">' +
      esc(label) +
      '</label><input class="qnc-ui-input" data-pts-bind="' +
      esc(bind) +
      '" value="' +
      esc(value ?? '') +
      '" /></div>'
    );
  }

  function fieldSelect(label, bind, value, options) {
    const opts = options
      .map(
        (o) =>
          '<option value="' +
          esc(o) +
          '"' +
          (String(value) === String(o) ? ' selected' : '') +
          '>' +
          esc(o) +
          '</option>'
      )
      .join('');
    return (
      '<div><label class="qnc-ui-label">' +
      esc(label) +
      '</label><select class="qnc-ui-select" data-pts-bind="' +
      esc(bind) +
      '">' +
      opts +
      '</select></div>'
    );
  }

  function aiSettingsHtml(s) {
    const ai = s?.ai || {};
    return (
      '<div class="qnc-pts-ai-options">' +
      checkRow('ai.enabled', !!ai.enabled, 'AI analiza kadrova i virtualni kadrovi') +
      checkRow('ai.coverage_suggestions', ai.coverage_suggestions !== false, 'Coverage suggestions') +
      checkRow('ai.transcription_enabled', !!ai.transcription_enabled, 'Transkripcija u Media tabu') +
      '</div>'
    );
  }

  function checkRow(bind, checked, label) {
    return (
      '<label class="qnc-ui-checkbox qnc-pts-ai-row">' +
      '<input type="checkbox" data-pts-bind="' +
      esc(bind) +
      '"' +
      (checked ? ' checked' : '') +
      ' />' +
      '<span>' +
      esc(label) +
      '</span></label>'
    );
  }

  function defaultProjectName() {
    const d = new Date();
    return 'Projekt ' + d.toLocaleDateString('hr-HR');
  }

  function syncProjectNameField(host) {
    const input = panelBind(host, 'project.name');
    if (!input) return;
    if (!projectName) projectName = defaultProjectName();
    if (document.activeElement !== input) input.value = projectName;
  }

  function closeTemplatePicker(host) {
    const picker = host?.querySelector('[data-pts-picker]');
    if (picker) picker.open = false;
  }

  function renderTemplatePicker(host) {
    const tpl = selectedTemplate();
    const summary = panelSlot(host, 'template-summary');
    const cards = panelSlot(host, 'template-cards');
    if (summary) summary.innerHTML = templateSummaryHtml(tpl);
    if (cards) cards.innerHTML = templateCardsHtml();
    const base = panelSlot(host, 'template-base');
    if (base) base.textContent = tpl?.name || '—';
  }

  function renderAll(host) {
    renderTemplatePicker(host);
    renderSettingsPanels(host);
    syncProjectNameField(host);
    syncSections(host);
  }

  function bindInteractions(host) {
    panelSlot(host, 'template-cards')?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-template-id]');
      if (!btn) return;
      selectedTemplateId = btn.getAttribute('data-template-id') || '';
      closeTemplatePicker(host);
      renderAll(host);
      setStatus(host, 'Template: ' + (selectedTemplate()?.name || selectedTemplateId));
      schedulePersist();
    });

    panelBind(host, 'project.name')?.addEventListener('input', (ev) => {
      projectName = ev.target.value;
      schedulePersist();
    });

    panelAction(host, 'project.create')?.addEventListener('click', () => {
      const input = panelBind(host, 'project.name');
      const name = (input?.value || projectName || '').trim();
      if (!name) {
        setStatus(host, 'Upiši naziv projekta.');
        input?.focus();
        return;
      }
      projectName = name;
      if (input) input.value = name;
      const tpl = selectedTemplate();
      setStatus(host, 'Novi projekt (lab): ' + name + ' · ' + (tpl?.name || '—'));
      schedulePersist();
    });

    panelAction(host, 'template.create-panel.open')?.addEventListener('click', () => {
      if (!isSectionOn('custom_template_save')) {
        setStatus(host, 'custom_template_save nije u profilu.');
        return;
      }
      customSaveOpen = true;
      syncSections(host);
      panelBind(host, 'template.name')?.focus();
      schedulePersist();
    });

    panelAction(host, 'template.create-panel.close')?.addEventListener('click', () => {
      customSaveOpen = false;
      syncSections(host);
      schedulePersist();
    });

    panelAction(host, 'template.duplicate')?.addEventListener('click', () => {
      const name = panelBind(host, 'template.name')?.value?.trim();
      if (!name) {
        setStatus(host, 'Upiši naziv templatea.');
        return;
      }
      customSaveOpen = false;
      syncSections(host);
      setStatus(host, 'Template spremljen (lab): ' + name);
      schedulePersist();
    });

    host.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-pts-action="export.directory.pick"]');
      if (!btn || !host.contains(btn)) return;
      const input = host.querySelector('[data-pts-bind="export.directory"]');
      const initial = String(input?.value || '').trim();
      const fp = window.QNC?.components?.get?.('folder-picker') || window.QNC?.folderPicker;
      if (!fp?.pickDirectoryOrCancel) {
        if (input) input.value = initial || 'exports/projekti';
        setStatus(host, 'Izbor direktorija (lab mock).');
        schedulePersist();
        return;
      }
      fp.pickDirectoryOrCancel({ initial_dir: initial })
        .then((path) => {
          if (path && input) input.value = path;
          setStatus(host, path ? 'Export dir: ' + path : 'Direktorij nije odabran.');
          schedulePersist();
        })
        .catch((err) => {
          if (fp.isCancelled?.(err) || String(err.message || '').includes('cancelled')) return;
          setStatus(host, 'Direktorij: ' + err.message);
        });
    });
  }

  function openSectionsOverlay(host) {
    const ov = overlay();
    if (!ov) return;
    const parts = [];
    parts.push('<div class="qnc-design-overlay-stack"><section><h4>Sekcije (u build profilu)</h4>');
    parts.push('<div class="qnc-design-overlay-matrix">');
    ALL_SECTION_IDS.forEach((id) => {
      if (!isSectionAvailable(id)) return;
      parts.push('<div class="qnc-design-overlay-matrix-row"><span>' + esc(SECTION_LABELS[id]) + '</span>');
      parts.push(
        '<label><input type="radio" name="sec-' +
          id +
          '" value="on"' +
          (sectionStates[id] !== 'off' ? ' checked' : '') +
          '> Uklj.</label>'
      );
      parts.push(
        '<label><input type="radio" name="sec-' +
          id +
          '" value="off"' +
          (sectionStates[id] === 'off' ? ' checked' : '') +
          '> Isklj.</label>'
      );
      parts.push('</div>');
    });
    parts.push('</div></section></div>');

    ov.open({
      component: 'project-template-settings',
      title: 'Template postavke',
      subtitle: 'Sekcije komponente',
      applyLabel: 'Zatvori',
      renderBody: (body) => {
        body.innerHTML = parts.join('');
        body.querySelectorAll('input[type="radio"]').forEach((input) => {
          input.addEventListener('change', () => {
            setSectionState(host, input.name.slice(4), input.value);
            renderControls(document.querySelector('[data-qnc-slot="component-lab-sidebar"]'));
          });
        });
      },
    });
  }

  function renderControls(sidebar) {
    if (!sidebar) return;
    const tpl = selectedTemplate();
    const parts = [];
    parts.push('<div class="qnc-design-component-lab">');
    parts.push('<h4>Template postavke</h4>');
    parts.push(
      '<p class="qnc-pts-hint muted">Komponenta <strong>odabire template</strong> i <strong>prikazuje postavke</strong>. Developer u <code>build-profiles.json</code> određuje <code>available_sections</code>.</p>'
    );

    parts.push('<label class="qnc-ui-label">Build profil</label>');
    parts.push('<select class="qnc-ui-select" data-pts-profile>');
    Object.entries(profiles).forEach(([id, prof]) => {
      parts.push(
        '<option value="' + id + '"' + (id === activeProfileId ? ' selected' : '') + '>' + esc(prof.label) + '</option>'
      );
    });
    parts.push('</select>');

    parts.push('<button type="button" class="qnc-ui-button qnc-ui-button-primary" data-pts-sections">Sekcije…</button>');

    parts.push('<h4>Odabrano</h4>');
    parts.push(
      '<div class="qnc-design-track-row"><span>Template</span><span class="qnc-ui-chip">' +
        esc(tpl?.name || '—') +
        '</span></div>'
    );

    parts.push('<h4>U profilu</h4>');
    ALL_SECTION_IDS.forEach((id) => {
      if (!isSectionAvailable(id)) return;
      parts.push(
        '<div class="qnc-design-track-row"><span>' +
          esc(SECTION_LABELS[id]) +
          '</span><span class="qnc-ui-chip">' +
          esc(sectionStates[id] === 'off' ? 'off' : 'on') +
          '</span></div>'
      );
    });

    parts.push('<p class="muted qnc-design-hint">Radni tok: klik za popis · odabir zatvara popis.</p>');
    parts.push('</div>');
    sidebar.innerHTML = parts.join('');

    sidebar.querySelector('[data-pts-profile]')?.addEventListener('change', (ev) => {
      activeProfileId = ev.target.value;
      applyProfile(panelHost);
      renderControls(sidebar);
      schedulePersist();
    });
    sidebar.querySelector('[data-pts-sections]')?.addEventListener('click', () => {
      if (panelHost) openSectionsOverlay(panelHost);
    });
  }

  function applyProfile(host) {
    sectionStates = defaultSectionStates();
    templates = (demoData.templates || []).slice();
    selectedTemplateId = demoData.selected_template_id || templates[0]?.template_id || '';
    if (!templates.some((t) => t.template_id === selectedTemplateId)) {
      selectedTemplateId = templates[0]?.template_id || '';
    }
    if (!projectName) projectName = defaultProjectName();
    customSaveOpen = isSectionOn('custom_template_save') && profile()?.default_section_states?.custom_template_save === 'on';
    renderAll(host);
  }

  function applyPrefs(host, prefs) {
    if (!prefs) return;
    if (prefs.active_profile_id && profiles[prefs.active_profile_id]) activeProfileId = prefs.active_profile_id;
    applyProfile(host);
    if (prefs.section_states) {
      Object.entries(prefs.section_states).forEach(([id, st]) => {
        if (isSectionAvailable(id)) sectionStates[id] = st === 'off' ? 'off' : 'on';
      });
    }
    if (prefs.selected_template_id) selectedTemplateId = String(prefs.selected_template_id);
    if (prefs.project_name != null) projectName = String(prefs.project_name);
    if (prefs.custom_save_open != null) customSaveOpen = !!prefs.custom_save_open;
    if (prefs.style) {
      panelStyle = mergePanelStyle(prefs.style);
      applyStyleTokens(host, panelStyle);
    }
    renderAll(host);
  }

  async function loadProfiles() {
    const res = await fetch(PROFILES_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('Build profili nisu učitani');
    profiles = (await res.json()).profiles || {};
  }

  async function loadDemo() {
    const res = await fetch(DEMO_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('Demo templatei nisu učitani');
    demoData = await res.json();
  }

  async function mount(previewEl, sidebarEl) {
    await loadProfiles();
    await loadDemo();
    const res = await fetch(STYLE_URL, { cache: 'no-store' });
    if (res.ok) {
      styleSchema = await res.json();
      panelStyle = mergePanelStyle({});
    }
    const prefs = await loadPrefs();
    const mock = await fetch(COMPONENT_HTML, { cache: 'no-store' });
    if (!mock.ok) throw new Error('Komponenta nije učitana');
    previewEl.innerHTML =
      '<div class="qnc-design-pts-host"><div class="qnc-design-pts-frame">' + (await mock.text()) + '</div></div>';
    panelHost = previewEl.querySelector(PANEL_SEL);
    if (!panelHost) throw new Error('Nema project-template-settings root');

    prefsHydrating = true;
    applyProfile(panelHost);
    if (prefs) applyPrefs(panelHost, prefs);
    applyStyleTokens(panelHost, panelStyle);
    prefsHydrating = false;

    bindInteractions(panelHost);
    closeTemplatePicker(panelHost);
    setStatus(panelHost, 'Template: ' + (selectedTemplate()?.name || '—'));
    renderControls(sidebarEl);
    return panelHost;
  }

  window.QNCDesignProjectTemplateSettings = { mount, ALL_SECTION_IDS, SECTION_LABELS };
})();
