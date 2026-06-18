/* Project tab — Plugin SDK v1 orchestrator. Workflow u SQLite; UI = ctx.store snapshoti. */
window.QNC = window.QNC || {};

(function (QNC) {
  if (!QNC.createPluginApp) {
    console.error('[Projekt] QNC.createPluginApp nije učitan (qnc-plugin-sdk.js)');
    return;
  }

  const SNAPSHOT_KEYS = ['project.index', 'project.templates', 'project.modules', 'project.ui'];
  const PLUGIN_CTX = { pluginId: 'project' };

  const runtime = {
    openingId: '',
    session: null,
    mounted: false,
    actionsInstalled: false,
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

  function comp(id) {
    return QNC.components?.get?.(id);
  }

  function folderPicker() {
    return comp('folder-picker') || QNC.folderPicker || null;
  }

  function snapIndex(ctx) {
    return ctx.store.get('project.index') || {};
  }

  function snapUi(ctx) {
    return ctx.store.get('project.ui') || {};
  }

  function snapTemplates(ctx) {
    return ctx.store.get('project.templates') || {};
  }

  function snapModules(ctx) {
    return ctx.store.get('project.modules') || [];
  }

  function projects(ctx) {
    return snapIndex(ctx).projects || [];
  }

  function projectIds(ctx) {
    return projects(ctx).map((p) => p.project_id).filter(Boolean);
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

  function selectedTemplate(ctx) {
    const ui = snapUi(ctx);
    const templates = snapTemplates(ctx).templates || [];
    const id = ui.selected_template_id || 'tpl_breaking_news';
    return templates.find((t) => t.template_id === id) || templates[0] || null;
  }

  function effectiveSettings(ctx) {
    const tpl = selectedTemplate(ctx);
    return deepMerge(tpl?.settings || {}, snapUi(ctx).settings_override || {});
  }

  function defaultProjectName() {
    const d = new Date();
    return 'Projekt ' + d.toLocaleDateString('hr-HR');
  }

  function resolveSelectedId(ctx) {
    const ids = projectIds(ctx);
    const ui = snapUi(ctx);
    const fromUi = String(ui.selected_project_id || '').trim();
    if (fromUi && ids.includes(fromUi)) return fromUi;
    const active = snapIndex(ctx).active_project_id || '';
    if (active && ids.includes(active)) return active;
    return ids[0] || null;
  }

  function moduleSortKey(mod) {
    const tabId = String(mod.tab_id || mod.module_id || '');
    const position = String(mod.position || 'normal');
    let bucket = 0;
    if (position === 'first' || tabId === 'project') bucket = -1;
    else if (position === 'last' || tabId === 'preview' || tabId === 'export') bucket = 1;
    return [bucket, Number(mod.priority || 0), String(mod.label || tabId)];
  }

  function sortedModules(ctx) {
    return [...snapModules(ctx)].sort((a, b) => {
      const ka = moduleSortKey(a);
      const kb = moduleSortKey(b);
      for (let i = 0; i < ka.length; i += 1) {
        if (ka[i] < kb[i]) return -1;
        if (ka[i] > kb[i]) return 1;
      }
      return 0;
    });
  }

  async function reloadAll(ctx) {
    return ctx.store.reload(SNAPSHOT_KEYS);
  }

  async function patchUi(ctx, patch) {
    await ctx.action('project.ui.patch', patch || {});
    return ctx.store.reload('project.ui');
  }

  function syncActiveProject(ctx) {
    const activeId = snapIndex(ctx).active_project_id || '';
    QNC.setActiveProjectId(activeId);
    return activeId;
  }

  function updateActiveLabel(ctx) {
    const el = QNC.$('#active-project-label');
    if (!el) return;
    const activeId = syncActiveProject(ctx);
    const p = projects(ctx).find((x) => x.project_id === activeId);
    el.textContent = 'Projekt: ' + (p ? p.name : activeId || '—');
  }

  function updateUi(ctx) {
    const selectedId = resolveSelectedId(ctx);
    QNC.setShellSelection('project', selectedId ? 1 : 0, projectIds(ctx).length);
  }

  function listViewData(ctx, extra) {
    const activeId = syncActiveProject(ctx);
    return {
      projects: projects(ctx),
      selectedId: resolveSelectedId(ctx),
      activeId,
      openingId: runtime.openingId,
      ...(extra || {}),
    };
  }

  function ptsViewData(ctx, extra) {
    const ui = snapUi(ctx);
    return {
      templates: snapTemplates(ctx).templates || [],
      ui,
      mergedSettings: effectiveSettings(ctx),
      availableModules: sortedModules(ctx),
      templateCreateOpen: !!ui.template_create_open,
      ...(extra || {}),
    };
  }

  function renderProjectList(ctx, extra) {
    const api = comp('project-list');
    if (!api) return;
    api.update(listRoot(), listViewData(ctx, extra), PLUGIN_CTX);
    updateActiveLabel(ctx);
    updateUi(ctx);
  }

  function renderTemplateSettings(ctx, extra) {
    const api = comp('project-template-settings');
    const root = ptsRoot();
    if (!api || !root) return;
    api.update(root, ptsViewData(ctx, extra), PLUGIN_CTX);
  }

  function renderAll(ctx, extra) {
    renderProjectList(ctx, extra);
    renderTemplateSettings(ctx, extra);
  }

  async function ensureSelectedProject(ctx) {
    const selected = resolveSelectedId(ctx);
    const current = String(snapUi(ctx).selected_project_id || '');
    if (String(selected || '') === current) return selected;
    await patchUi(ctx, { selected_project_id: selected || '' });
    return selected;
  }

  async function ensureDefaultProjectName(ctx) {
    if (String(snapUi(ctx).project_name || '').trim()) return;
    await patchUi(ctx, { project_name: defaultProjectName() });
  }

  async function ensureValidTemplate(ctx) {
    const ui = snapUi(ctx);
    const templates = snapTemplates(ctx).templates || [];
    const id = ui.selected_template_id || 'tpl_breaking_news';
    if (templates.some((t) => t.template_id === id)) return;
    const next = templates[0]?.template_id || '';
    if (!next) return;
    await patchUi(ctx, { selected_template_id: next, reset_settings_override: true });
  }

  async function ensureSession(ctx) {
    const activeId = syncActiveProject(ctx);
    if (runtime.session?.session_id) return runtime.session;
    const storedId = String(snapUi(ctx).collab_session_id || '').trim();
    if (storedId) {
      try {
        const d = await QNC.api('POST', '/api/collab/touch', {
          session_id: storedId,
          project_id: activeId || '',
        });
        runtime.session = d.session?.session_id ? d.session : { session_id: storedId };
        return runtime.session;
      } catch {
        await patchUi(ctx, { collab_session_id: '' });
      }
    }
    try {
      const d = await QNC.api('POST', '/api/collab/session', {
        display_name: 'QNC korisnik',
        role: 'editor',
        station_id: location.hostname || 'local',
        client_label: 'QNC web',
        project_id: activeId || '',
      });
      runtime.session = d.session || null;
      if (runtime.session?.session_id) {
        await patchUi(ctx, { collab_session_id: runtime.session.session_id });
      }
    } catch {
      runtime.session = null;
    }
    return runtime.session;
  }

  async function selectProject(ctx, id) {
    await patchUi(ctx, { selected_project_id: id || '' });
    renderProjectList(ctx);
  }

  async function activateProject(ctx, id) {
    if (!id || runtime.openingId) return;
    runtime.openingId = id;
    ctx.setStatus('Otvaram projekt...', 'busy');
    try {
      await ctx.action('project.open', { project_id: id });
      await ctx.store.reload(['project.index', 'project.ui']);
      syncActiveProject(ctx);
      await patchUi(ctx, { selected_project_id: id });
      await ensureSession(ctx);
      renderAll(ctx);
      ctx.emitShell('project:opened', { projectId: id });
      ctx.setStatus('Projekt otvoren.', 'ok');
    } catch (e) {
      ctx.setStatus('Projekt: ' + e.message, 'err');
    } finally {
      runtime.openingId = '';
      renderProjectList(ctx);
    }
  }

  async function setTemplateCreateOpen(ctx, open) {
    await patchUi(ctx, { template_create_open: !!open });
    renderTemplateSettings(ctx, { focusTemplateName: !!open });
  }

  async function createFromTemplate(ctx) {
    const ui = snapUi(ctx);
    const name = String(ui.project_name || '').trim();
    if (!name) {
      ctx.setStatus('Upiši naziv projekta.', 'err');
      return;
    }
    const tpl = selectedTemplate(ctx);
    if (!tpl) {
      ctx.setStatus('Odaberi template.', 'err');
      return;
    }
    ctx.setStatus('Kreiram projekt...', 'busy');
    const session = await ensureSession(ctx);
    try {
      const d = await ctx.action('project.create', {
        name,
        template_id: tpl.template_id,
        settings_override: ui.settings_override || {},
        user_id: session?.user_id || '',
        session_id: session?.session_id || '',
      });
      await ctx.store.reload(['project.index', 'project.ui']);
      const id = d.active_project_id || d.project?.project_id;
      if (!id) throw new Error('Server nije vratio project_id');
      syncActiveProject(ctx);
      await patchUi(ctx, { selected_project_id: id, project_name: defaultProjectName() });
      renderAll(ctx);
      ctx.emitShell('project:opened', { projectId: id });
      ctx.setStatus('Projekt kreiran.', 'ok');
    } catch (e) {
      ctx.setStatus('Template: ' + e.message, 'err');
    }
  }

  async function duplicateTemplate(ctx) {
    const tpl = selectedTemplate(ctx);
    if (!tpl) return;
    const ui = snapUi(ctx);
    const name = String(ui.template_draft_name || '').trim();
    if (!name) {
      ctx.setStatus('Upiši naziv custom templatea.', 'err');
      return;
    }
    const session = await ensureSession(ctx);
    ctx.setStatus('Spremam custom template...', 'busy');
    try {
      const d = await ctx.action('template.save-custom', {
        name,
        description: String(ui.template_draft_description || ''),
        settings: effectiveSettings(ctx),
        source_template_ids: tpl.source_template_ids || [],
        base_template_id: tpl.template_id,
        user_id: session?.user_id || '',
      });
      await patchUi(ctx, {
        selected_template_id: d.template?.template_id || ui.selected_template_id,
        template_create_open: false,
        template_draft_name: '',
        template_draft_description: '',
      });
      await ctx.store.reload('project.templates');
      renderTemplateSettings(ctx);
      ctx.setStatus('Novi template spremljen.', 'ok');
    } catch (e) {
      ctx.setStatus('Template: ' + e.message, 'err');
    }
  }

  async function cleanupOrphanFolders(ctx, silent) {
    try {
      const d = await ctx.api.post('/api/projects/cleanup-orphans', {});
      const removed = d.removed || [];
      const leftovers = d.leftovers || [];
      if (removed.length) {
        ctx.setStatus('Očišćeni orphan folderi: ' + removed.join(', '), 'ok');
      } else if (leftovers.length) {
        ctx.setStatus(
          'Folderi još postoje (zaključani): ' +
            leftovers.join(', ') +
            ' — zatvori qnc-host.exe i obriši ručno.',
          'err'
        );
      } else if (!silent) {
        ctx.setStatus('Nema orphan projekt foldera.', 'ok');
      }
    } catch (e) {
      if (!silent) ctx.setStatus('Čišćenje: ' + e.message, 'err');
    }
  }

  async function deleteProject(ctx, projectId) {
    const id = String(projectId || '').trim();
    if (!id) {
      ctx.setStatus('Odaberi projekt za brisanje.', 'err');
      return;
    }
    const p = projects(ctx).find((x) => x.project_id === id);
    const label = p ? p.name || id : id;
    if (!window.confirm('Obrisati projekt "' + label + '"?')) return;
    ctx.setStatus('Brisanje...', 'busy');
    try {
      ctx.emitShell('project:deleting', { projectId: id });
      await new Promise((r) => setTimeout(r, 200));
      await ctx.action('project.delete', { project_ids: [id] });
      await ctx.store.reload(['project.index', 'project.ui']);
      runtime.session = null;
      syncActiveProject(ctx);
      await ensureSelectedProject(ctx);
      renderAll(ctx);
      const activeId = syncActiveProject(ctx);
      if (activeId) {
        ctx.emitShell('project:opened', { projectId: activeId });
      } else {
        QNC.shell?.showProjectOnly?.();
        ctx.emitShell('project:changed', { projectId: '' });
      }
      ctx.setStatus('Projekt obrisan.', 'ok');
    } catch (e) {
      ctx.setStatus('Briši: ' + (e.message || e), 'err');
    }
  }

  async function pickExportDirectory(ctx) {
    const initial = String(
      nestedGet(effectiveSettings(ctx), 'export.directory', nestedGet(effectiveSettings(ctx), 'export.output_directory', ''))
    ).trim();
    const fp = folderPicker();
    if (!fp?.pickDirectoryOrCancel) {
      ctx.setStatus('folder-picker nije učitan.', 'err');
      return;
    }
    try {
      const path = await fp.pickDirectoryOrCancel({ initial_dir: initial });
      if (!path) return;
      await patchUi(ctx, { settings_path: { path: 'export.directory', value: path } });
      renderTemplateSettings(ctx);
    } catch (e) {
      ctx.setStatus('Direktorij: ' + e.message, 'err');
    }
  }

  async function pickProjectsRootDirectory(ctx) {
    const initial = String(nestedGet(effectiveSettings(ctx), 'storage.projects_root', '')).trim();
    const fp = folderPicker();
    if (!fp?.pickDirectoryOrCancel) {
      ctx.setStatus('folder-picker nije učitan.', 'err');
      return;
    }
    try {
      const path = await fp.pickDirectoryOrCancel({ initial_dir: initial });
      if (!path) return;
      await patchUi(ctx, { settings_path: { path: 'storage.projects_root', value: path } });
      renderTemplateSettings(ctx);
    } catch (e) {
      ctx.setStatus('Direktorij: ' + e.message, 'err');
    }
  }

  async function persistSettingsPath(ctx, path, value) {
    await patchUi(ctx, { settings_path: { path, value } });
    renderTemplateSettings(ctx);
  }

  async function persistWorkflowTabs(ctx, tabs) {
    const labels = { ...(effectiveSettings(ctx)?.workspace?.tab_labels || {}) };
    (tabs || []).forEach((tabId) => {
      const mod = sortedModules(ctx).find((m) => (m.tab_id || m.module_id) === tabId);
      if (mod && !labels[tabId]) labels[tabId] = mod.label || tabId;
    });
    await patchUi(ctx, {
      settings_override: {
        workspace: {
          tabs: tabs || [],
          tab_labels: labels,
        },
      },
    });
    renderTemplateSettings(ctx);
  }

  function mountComponents() {
    if (runtime.mounted) return;
    comp('project-list')?.mount?.(listRoot(), PLUGIN_CTX);
    comp('project-template-settings')?.mount?.(ptsRoot(), PLUGIN_CTX);
    runtime.mounted = true;
  }

  function installPanelActions() {
    if (runtime.actionsInstalled || !panel() || !QNC.installComponentActions) return;
    runtime.actionsInstalled = true;
    runtime.panelActionsDispose = QNC.installComponentActions(panel(), 'project');
  }

  async function waitForPanel(maxAttempts) {
    const limit = Number(maxAttempts || 20);
    for (let i = 0; i < limit; i += 1) {
      if (panel()) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  async function refreshAndRender(ctx) {
    await reloadAll(ctx);
    await ensureValidTemplate(ctx);
    await ensureDefaultProjectName(ctx);
    await ensureSelectedProject(ctx);
    syncActiveProject(ctx);
    renderAll(ctx);
  }

  const app = QNC.createPluginApp({
    pluginId: 'project',
    tabId: 'project',
    apiNamespace: '/api/projects',
    snapshots: SNAPSHOT_KEYS,
    snapshotLoaders: {
      'project.index': { path: '/api/projects' },
      'project.templates': { path: '/api/project-templates' },
      'project.modules': { path: '/api/modules', pick: 'modules' },
      'project.ui': { path: '/api/projects/ui-state', pick: 'ui_state' },
    },
  });

  app.lifecycle({
    async onInit(ctx) {
      if (!(await waitForPanel())) {
        QNC.log('[Projekt] panel nije spreman', 'err');
        return;
      }
      mountComponents();
      installPanelActions();

      ctx.on('project.open', async (event) => {
        const id = event.payload?.project_id || '';
        await selectProject(ctx, id);
        await activateProject(ctx, id);
      });
      ctx.on('project.delete', async (event) => {
        await deleteProject(ctx, event.payload?.project_id || '');
      });
      ctx.on('template.select', async (event) => {
        await patchUi(ctx, {
          selected_template_id: event.payload?.template_id || '',
          reset_settings_override: true,
        });
        renderTemplateSettings(ctx);
      });
      ctx.on('field.change', async (event) => {
        const field = event.payload?.field || '';
        const value = event.payload?.value;
        if (!field) return;
        await patchUi(ctx, { [field]: value });
        renderTemplateSettings(ctx);
      });
      ctx.on('settings.change', async (event) => {
        await persistSettingsPath(ctx, event.payload?.path || '', event.payload?.value);
      });
      ctx.on('ai.change', async (event) => {
        await persistSettingsPath(ctx, event.payload?.path || '', event.payload?.value);
      });
      ctx.on('workflow-tabs.change', async (event) => {
        await persistWorkflowTabs(ctx, event.payload?.tabs || []);
      });
      ctx.on('template.create-panel.open', async () => {
        await setTemplateCreateOpen(ctx, true);
      });
      ctx.on('template.create-panel.close', async () => {
        await setTemplateCreateOpen(ctx, false);
      });
      ctx.on('project.create', () => createFromTemplate(ctx));
      ctx.on('template.duplicate', () => duplicateTemplate(ctx));
      ctx.on('export.directory.pick', () => pickExportDirectory(ctx));
      ctx.on('projects-root.pick', () => pickProjectsRootDirectory(ctx));

      try {
        await refreshAndRender(ctx);
        await ensureSession(ctx);
        QNC.shell?.showProjectOnly?.();
        QNC.log('[Projekt] SDK modul spreman', 'ok');
      } catch (e) {
        ctx.setStatus('Projekti: ' + e.message, 'err');
      }
    },

    async onShow(ctx) {
      try {
        await refreshAndRender(ctx);
        await ensureSession(ctx);
        QNC.shell?.showProjectOnly?.();
      } catch (e) {
        ctx.setStatus('Projekti: ' + e.message, 'err');
      }
    },

    onDestroy(ctx) {
      if (typeof runtime.panelActionsDispose === 'function') {
        runtime.panelActionsDispose();
        runtime.panelActionsDispose = null;
      }
      runtime.session = null;
      runtime.openingId = '';
      runtime.mounted = false;
      runtime.actionsInstalled = false;
      ctx.teardown();
    },
  });

  app.register();
})(window.QNC);
