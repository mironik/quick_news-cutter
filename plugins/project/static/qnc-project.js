/* Project tab — orchestrator; stanje u SQLite (/api/projects/ui-state), DOM samo prikaz. */
window.QNC = window.QNC || {};

(function (QNC) {
  const state = {
    projects: [],
    templates: [],
    sourceTemplates: [],
    availableModules: [],
    activeId: '',
    selectedId: null,
    selectedTemplateId: 'tpl_breaking_news',
    ui: {},
    session: null,
    openingId: '',
    templateCreateOpen: false,
    orchestratorReady: false,
    bootStarted: false,
    actionsInstalled: false,
    busDisposers: [],
    panelActionsDispose: null,
  };

  function panel() {
    return document.getElementById('panel-project');
  }

  function q(selector, root) {
    return (root || panel() || document).querySelector(selector);
  }

  function listRoot() {
    return q('[data-qnc-panel="project-list"]');
  }

  function ptsRoot() {
    return q('[data-qnc-panel="project-template-settings"]');
  }

  function listApi() {
    return QNC.components?.get?.('project-list');
  }

  function ptsApi() {
    return QNC.components?.get?.('project-template-settings');
  }

  function folderPicker() {
    return QNC.components?.get?.('folder-picker') || QNC.folderPicker || null;
  }

  function ids() {
    return state.projects.map((p) => p.project_id).filter(Boolean);
  }

  function deepMerge(base, override) {
    const out = { ...(base || {}) };
    Object.entries(override || {}).forEach(([key, value]) => {
      if (value && typeof value === 'object' && !Array.isArray(value) && typeof out[key] === 'object' && out[key]) {
        out[key] = deepMerge(out[key], value);
      } else {
        out[key] = value;
      }
    });
    return out;
  }

  function nestedGet(obj, path, fallback) {
    const parts = String(path || '').split('.');
    let cur = obj;
    for (const part of parts) {
      if (!cur || typeof cur !== 'object' || !(part in cur)) return fallback;
      cur = cur[part];
    }
    return cur == null ? fallback : cur;
  }

  function selectedTemplate() {
    const id = state.ui?.selected_template_id || state.selectedTemplateId;
    return state.templates.find((t) => t.template_id === id) || state.templates[0] || null;
  }

  function effectiveSettings() {
    const tpl = selectedTemplate();
    return deepMerge(tpl?.settings || {}, state.ui?.settings_override || {});
  }

  function defaultProjectName() {
    const d = new Date();
    return 'Projekt ' + d.toLocaleDateString('hr-HR');
  }

  function syncFromUi(ui) {
    state.ui = ui || state.ui || {};
    state.selectedTemplateId = state.ui.selected_template_id || state.selectedTemplateId;
    if (state.ui.selected_project_id) state.selectedId = state.ui.selected_project_id;
    state.templateCreateOpen = !!state.ui.template_create_open;
  }

  async function loadUiState() {
    const d = await QNC.api('GET', '/api/projects/ui-state');
    syncFromUi(d.ui_state || {});
    return state.ui;
  }

  async function patchUi(patch) {
    const d = await QNC.api('POST', '/api/projects/ui-state', patch || {});
    syncFromUi(d.ui_state || {});
    return state.ui;
  }

  function updateActiveLabel() {
    const el = QNC.$('#active-project-label');
    if (!el) return;
    const p = state.projects.find((x) => x.project_id === state.activeId);
    el.textContent = 'Projekt: ' + (p ? p.name : state.activeId || '—');
  }

  function updateUi() {
    QNC.setShellSelection('project', state.selectedId ? 1 : 0, ids().length);
  }

  function listViewData(extra) {
    return {
      projects: state.projects,
      selectedId: state.selectedId,
      activeId: state.activeId,
      openingId: state.openingId,
      ...(extra || {}),
    };
  }

  function ptsViewData(extra) {
    return {
      templates: state.templates,
      ui: state.ui,
      mergedSettings: effectiveSettings(),
      availableModules: state.availableModules,
      templateCreateOpen: state.templateCreateOpen,
      ...(extra || {}),
    };
  }

  function renderProjectList(extra) {
    const api = listApi();
    if (!api) return;
    api.update(listRoot(), listViewData(extra), { pluginId: 'project' });
    updateUi();
  }

  function renderTemplateSettings(extra) {
    const api = ptsApi();
    const root = ptsRoot();
    if (!api || !root) return;
    api.update(root, ptsViewData(extra), { pluginId: 'project' });
  }

  async function ensureSession() {
    if (state.session?.session_id) return state.session;
    const storedId = String(state.ui?.collab_session_id || '').trim();
    if (storedId) {
      try {
        const d = await QNC.api('POST', '/api/collab/touch', {
          session_id: storedId,
          project_id: state.activeId || '',
        });
        state.session = d.session?.session_id ? d.session : { session_id: storedId };
        return state.session;
      } catch {
        await patchUi({ collab_session_id: '' });
      }
    }
    try {
      const d = await QNC.api('POST', '/api/collab/session', {
        display_name: 'QNC korisnik',
        role: 'editor',
        station_id: location.hostname || 'local',
        client_label: 'QNC web',
        project_id: state.activeId || '',
      });
      state.session = d.session || null;
      if (state.session?.session_id) {
        await patchUi({ collab_session_id: state.session.session_id });
      }
    } catch {
      state.session = null;
    }
    return state.session;
  }

  async function selectProject(id) {
    state.selectedId = id || null;
    await patchUi({ selected_project_id: state.selectedId || '' });
    renderProjectList();
  }

  async function activateProject(id) {
    if (!id) return;
    if (state.openingId) return;
    state.openingId = id;
    QNC.setBox('Otvaram projekt...', 'busy');
    try {
      await QNC.api('POST', '/api/projects/open', { project_id: id });
      QNC.setActiveProjectId(id);
      state.activeId = id;
      state.selectedId = id;
      await patchUi({ selected_project_id: id });
      await ensureSession();
      updateActiveLabel();
      renderProjectList();
      if (QNC.bus) QNC.bus.emit('project:opened', { projectId: id });
      QNC.setBox('Projekt otvoren.', 'ok');
    } catch (e) {
      QNC.setBox('Projekt: ' + e.message, 'err');
    } finally {
      state.openingId = '';
    }
  }

  async function refreshProjects() {
    const d = await QNC.api('GET', '/api/projects');
    state.projects = d.projects || [];
    state.activeId = d.active_project_id || '';
    QNC.setActiveProjectId(state.activeId);
    if (!state.selectedId || !ids().includes(state.selectedId)) {
      state.selectedId = ids().includes(state.activeId) ? state.activeId : ids()[0] || null;
    }
    updateActiveLabel();
  }

  async function refreshTemplates() {
    const d = await QNC.api('GET', '/api/project-templates');
    state.templates = d.templates || [];
    state.sourceTemplates = d.source_templates || [];
    const id = state.ui?.selected_template_id || state.selectedTemplateId;
    if (!state.templates.some((t) => t.template_id === id)) {
      const next = state.templates[0]?.template_id || '';
      await patchUi({ selected_template_id: next, reset_settings_override: true });
    }
  }

  function moduleSortKey(mod) {
    const tabId = String(mod.tab_id || mod.module_id || '');
    const position = String(mod.position || 'normal');
    let bucket = 0;
    if (position === 'first' || tabId === 'project') bucket = -1;
    else if (position === 'last' || tabId === 'preview' || tabId === 'export') bucket = 1;
    return [bucket, Number(mod.priority || 0), String(mod.label || tabId)];
  }

  async function refreshModules() {
    try {
      const d = await QNC.api('GET', '/api/modules');
      state.availableModules = [...(d.modules || [])].sort((a, b) => {
        const ka = moduleSortKey(a);
        const kb = moduleSortKey(b);
        for (let i = 0; i < ka.length; i += 1) {
          if (ka[i] < kb[i]) return -1;
          if (ka[i] > kb[i]) return 1;
        }
        return 0;
      });
    } catch (e) {
      QNC.log('[Projekt] moduli: ' + e.message, 'err');
      state.availableModules = [];
    }
  }

  async function setTemplateCreateOpen(open) {
    await patchUi({ template_create_open: !!open });
    renderTemplateSettings({ focusTemplateName: !!open });
  }

  async function createFromTemplate() {
    const name = String(state.ui?.project_name || '').trim();
    if (!name) {
      QNC.setBox('Upiši naziv projekta.', 'err');
      return;
    }
    const tpl = selectedTemplate();
    if (!tpl) {
      QNC.setBox('Odaberi template.', 'err');
      return;
    }
    QNC.setBox('Kreiram projekt...', 'busy');
    const session = await ensureSession();
    try {
      const d = await QNC.api('POST', '/api/projects/from-template', {
        name,
        template_id: tpl.template_id,
        settings_override: state.ui?.settings_override || {},
        user_id: session?.user_id || '',
        session_id: session?.session_id || '',
      });
      const id = d.active_project_id || d.project?.project_id;
      if (!id) throw new Error('Server nije vratio project_id');
      state.activeId = id;
      state.selectedId = id;
      QNC.setActiveProjectId(id);
      await refreshProjects();
      await patchUi({ selected_project_id: id, project_name: defaultProjectName() });
      renderProjectList();
      renderTemplateSettings();
      if (QNC.bus) {
        QNC.bus.emit('project:opened', { projectId: id });
      }
      QNC.setBox('Projekt kreiran.', 'ok');
    } catch (e) {
      QNC.setBox('Template: ' + e.message, 'err');
    }
  }

  async function duplicateTemplate() {
    const tpl = selectedTemplate();
    if (!tpl) return;
    const name = String(state.ui?.template_draft_name || '').trim();
    if (!name) {
      QNC.setBox('Upiši naziv custom templatea.', 'err');
      return;
    }
    const session = await ensureSession();
    QNC.setBox('Spremam custom template...', 'busy');
    try {
      const d = await QNC.api('POST', '/api/project-templates', {
        name,
        description: String(state.ui?.template_draft_description || ''),
        settings: effectiveSettings(),
        source_template_ids: tpl.source_template_ids || [],
        base_template_id: tpl.template_id,
        user_id: session?.user_id || '',
      });
      await patchUi({
        selected_template_id: d.template?.template_id || state.ui.selected_template_id,
        template_create_open: false,
        template_draft_name: '',
        template_draft_description: '',
      });
      await refreshTemplates();
      renderTemplateSettings();
      QNC.setBox('Novi template spremljen.', 'ok');
    } catch (e) {
      QNC.setBox('Template: ' + e.message, 'err');
    }
  }

  async function cleanupOrphanFolders(silent) {
    try {
      const d = await QNC.api('POST', '/api/projects/cleanup-orphans', {});
      const removed = d.removed || [];
      const leftovers = d.leftovers || [];
      if (removed.length) {
        QNC.setBox('Očišćeni orphan folderi: ' + removed.join(', '), 'ok');
      } else if (leftovers.length) {
        QNC.setBox(
          'Folderi još postoje (zaključani): ' +
            leftovers.join(', ') +
            ' — zatvori qnc-host.exe i obriši ručno.',
          'err'
        );
      } else if (!silent) {
        QNC.setBox('Nema orphan projekt foldera.', 'ok');
      }
    } catch (e) {
      if (!silent) QNC.setBox('Čišćenje: ' + e.message, 'err');
    }
  }

  async function deleteProject(projectId) {
    const id = String(projectId || '').trim();
    if (!id) {
      QNC.setBox('Odaberi projekt za brisanje.', 'err');
      return;
    }
    const p = state.projects.find((x) => x.project_id === id);
    const label = p ? p.name || id : id;
    if (!window.confirm('Obrisati projekt "' + label + '"?')) return;
    QNC.setBox('Brisanje...', 'busy');
    try {
      if (QNC.bus) QNC.bus.emit('project:deleting', { projectId: id });
      await new Promise((r) => setTimeout(r, 200));
      const d = await QNC.api('POST', '/api/projects/delete', { project_ids: [id] });
      state.projects = d.projects || [];
      state.activeId = d.active_project_id || '';
      state.selectedId = state.activeId || state.projects[0]?.project_id || null;
      QNC.setActiveProjectId(state.activeId);
      state.session = null;
      await patchUi({ selected_project_id: state.selectedId || '' });
      renderProjectList();
      renderTemplateSettings();
      updateActiveLabel();
      if (state.activeId) {
        if (QNC.bus) {
          QNC.bus.emit('project:opened', { projectId: state.activeId });
        }
      } else {
        QNC.shell?.showProjectOnly?.();
        if (QNC.bus) QNC.bus.emit('project:changed', { projectId: '' });
      }
      QNC.setBox('Projekt obrisan.', 'ok');
    } catch (e) {
      QNC.setBox('Briši: ' + (e.message || e), 'err');
    }
  }

  async function pickExportDirectory() {
    const initial = String(
      nestedGet(effectiveSettings(), 'export.directory', nestedGet(effectiveSettings(), 'export.output_directory', ''))
    ).trim();
    const fp = folderPicker();
    if (!fp?.pickDirectoryOrCancel) {
      QNC.setBox('folder-picker nije učitan.', 'err');
      return;
    }
    try {
      const path = await fp.pickDirectoryOrCancel({ initial_dir: initial });
      if (!path) return;
      await patchUi({ settings_path: { path: 'export.directory', value: path } });
      renderTemplateSettings();
    } catch (e) {
      QNC.setBox('Direktorij: ' + e.message, 'err');
    }
  }

  async function pickProjectsRootDirectory() {
    const initial = String(nestedGet(effectiveSettings(), 'storage.projects_root', '')).trim();
    const fp = folderPicker();
    if (!fp?.pickDirectoryOrCancel) {
      QNC.setBox('folder-picker nije učitan.', 'err');
      return;
    }
    try {
      const path = await fp.pickDirectoryOrCancel({ initial_dir: initial });
      if (!path) return;
      await patchUi({ settings_path: { path: 'storage.projects_root', value: path } });
      renderTemplateSettings();
    } catch (e) {
      QNC.setBox('Direktorij: ' + e.message, 'err');
    }
  }

  async function persistSettingsPath(path, value) {
    await patchUi({ settings_path: { path, value } });
    renderTemplateSettings();
  }

  async function persistWorkflowTabs(tabs) {
    const labels = { ...(effectiveSettings()?.workspace?.tab_labels || {}) };
    (tabs || []).forEach((tabId) => {
      const mod = state.availableModules.find((m) => (m.tab_id || m.module_id) === tabId);
      if (mod && !labels[tabId]) labels[tabId] = mod.label || tabId;
    });
    await patchUi({
      settings_override: {
        workspace: {
          tabs: tabs || [],
          tab_labels: labels,
        },
      },
    });
    renderTemplateSettings();
  }

  async function refreshAll() {
    await Promise.all([refreshProjects(), refreshTemplates(), refreshModules(), loadUiState()]);
    if (!String(state.ui?.project_name || '').trim()) {
      await patchUi({ project_name: defaultProjectName() });
    }
    renderProjectList();
    renderTemplateSettings();
  }

  function mountComponents() {
    listApi()?.mount?.(listRoot(), { pluginId: 'project' });
    ptsApi()?.mount?.(ptsRoot(), { pluginId: 'project' });
  }

  function installComponentOrchestrator() {
    if (state.orchestratorReady || !QNC.componentBus) return;
    state.orchestratorReady = true;
    const on = (event, handler) => {
      const off = QNC.componentBus.on('project', event, handler);
      state.busDisposers.push(off);
    };
    on('project.open', async (event) => {
      const id = event.payload?.project_id || '';
      await selectProject(id);
      await activateProject(id);
    });
    on('project.delete', async (event) => {
      await deleteProject(event.payload?.project_id || '');
    });
    on('template.select', async (event) => {
      await patchUi({
        selected_template_id: event.payload?.template_id || '',
        reset_settings_override: true,
      });
      renderTemplateSettings();
    });
    on('field.change', async (event) => {
      const field = event.payload?.field || '';
      const value = event.payload?.value;
      if (!field) return;
      await patchUi({ [field]: value });
      renderTemplateSettings();
    });
    on('settings.change', async (event) => {
      await persistSettingsPath(event.payload?.path || '', event.payload?.value);
    });
    on('ai.change', async (event) => {
      await persistSettingsPath(event.payload?.path || '', event.payload?.value);
    });
    on('workflow-tabs.change', async (event) => {
      await persistWorkflowTabs(event.payload?.tabs || []);
    });
    on('template.create-panel.open', async () => {
      await setTemplateCreateOpen(true);
    });
    on('template.create-panel.close', async () => {
      await setTemplateCreateOpen(false);
    });
    on('project.create', createFromTemplate);
    on('template.duplicate', duplicateTemplate);
    on('export.directory.pick', pickExportDirectory);
    on('projects-root.pick', pickProjectsRootDirectory);
  }

  function teardownProject() {
    state.busDisposers.forEach((off) => {
      try {
        if (typeof off === 'function') off();
      } catch (_) {}
    });
    state.busDisposers = [];
    if (typeof state.panelActionsDispose === 'function') {
      state.panelActionsDispose();
      state.panelActionsDispose = null;
    }
    state.orchestratorReady = false;
    state.actionsInstalled = false;
    state.openingId = '';
    state.session = null;
    QNC.componentBus?.offPlugin?.('project');
  }

  function installPanelActions() {
    if (state.actionsInstalled || !panel() || !QNC.installComponentActions) return;
    state.actionsInstalled = true;
    state.panelActionsDispose = QNC.installComponentActions(panel(), 'project');
  }

  async function bootProject() {
    if (state.bootStarted) return;
    state.bootStarted = true;
    installComponentOrchestrator();
    mountComponents();
    try {
      installPanelActions();
      await refreshAll();
      await ensureSession();
      QNC.shell?.showProjectOnly?.();
      QNC.log('[Projekt] modul spreman', 'ok');
    } catch (e) {
      QNC.setBox('Projekti: ' + e.message, 'err');
      state.bootStarted = false;
    }
  }

  function bootWhenPanelReady(attempt) {
    if (state.bootStarted) return;
    if (panel()) {
      bootProject();
      return;
    }
    const next = Number(attempt || 0) + 1;
    if (next <= 20) {
      window.setTimeout(() => bootWhenPanelReady(next), 100);
    }
  }

  if (QNC.tabs && QNC.tabs.register) {
    QNC.tabs.register({
      id: 'project',
      init: bootProject,
      destroy: teardownProject,
      onShow() {
        refreshAll().catch((e) => QNC.setBox('Projekti: ' + e.message, 'err'));
      },
    });
    bootWhenPanelReady(0);
  } else {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => bootWhenPanelReady(0), { once: true });
    } else {
      bootWhenPanelReady(0);
    }
  }
})(window.QNC);
