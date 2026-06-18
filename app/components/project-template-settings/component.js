/* Project template settings — prikaz iz SQLite modela; promjene idu u bazu preko busa. */
window.QNC = window.QNC || {};

(function (QNC) {
  const PANEL_ID = 'project-template-settings';

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

  function byBind(path, root) {
    const panel = panelRoot(root);
    if (!panel) return null;
    return panel.querySelector('[data-qnc-bind="' + String(path || '').replace(/"/g, '\\"') + '"]');
  }

  function qAll(selector, root) {
    const panel = panelRoot(root);
    return panel ? Array.from(panel.querySelectorAll(selector)) : [];
  }

  function emit(pluginId, action, payload) {
    if (QNC.emitComponent) {
      return QNC.emitComponent(pluginId || 'project', PANEL_ID, action, payload || {});
    }
    return Promise.resolve();
  }

  function nestedValue(obj, path, fallback) {
    const parts = String(path || '').split('.');
    let cur = obj;
    for (const part of parts) {
      if (!cur || typeof cur !== 'object' || !(part in cur)) return fallback;
      cur = cur[part];
    }
    return cur == null ? fallback : cur;
  }

  const FIELD_BIND_MAP = {
    'project.name': 'project_name',
    'template.name': 'template_draft_name',
    'template.description': 'template_draft_description',
  };

  function setFieldFromUi(panel, bind, val) {
    const el = byBind(bind, panel);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!val;
    else el.value = val == null ? '' : String(val);
  }

  function aiEnabled(settings) {
    const ai = settings?.ai || {};
    return !!(ai.enabled || ai.virtual_shots || ai.transcription_enabled);
  }

  function aiLabel(settings) {
    return aiEnabled(settings) ? 'AI uključen' : 'AI isključen';
  }

  function moduleSortKey(mod) {
    const tabId = String(mod.tab_id || mod.module_id || '');
    const position = String(mod.position || 'normal');
    let bucket = 0;
    if (position === 'first' || tabId === 'project') bucket = -1;
    else if (position === 'last' || tabId === 'preview' || tabId === 'export') bucket = 1;
    const priority = Number(mod.priority || 0);
    const label = String(mod.label || tabId);
    return [bucket, priority, label];
  }

  function sortedModules(modules) {
    return [...(modules || [])].sort((a, b) => {
      const ka = moduleSortKey(a);
      const kb = moduleSortKey(b);
      for (let i = 0; i < ka.length; i += 1) {
        if (ka[i] < kb[i]) return -1;
        if (ka[i] > kb[i]) return 1;
      }
      return 0;
    });
  }

  function fieldInput(label, bind, val) {
    return (
      '<div><label class="qnc-ui-label">' +
      QNC.esc(label) +
      '</label><input class="qnc-ui-input" data-qnc-bind="' +
      QNC.esc(bind) +
      '" value="' +
      QNC.esc(val ?? '') +
      '" /></div>'
    );
  }

  function fieldSelect(label, bind, val, options) {
    const opts = options
      .map(
        (o) =>
          '<option value="' +
          QNC.esc(o) +
          '"' +
          (String(val) === String(o) ? ' selected' : '') +
          '>' +
          QNC.esc(o) +
          '</option>'
      )
      .join('');
    return (
      '<div><label class="qnc-ui-label">' +
      QNC.esc(label) +
      '</label><select class="qnc-ui-select" data-qnc-bind="' +
      QNC.esc(bind) +
      '">' +
      opts +
      '</select></div>'
    );
  }

  function checkRow(bind, isChecked, label) {
    return (
      '<label class="qnc-ui-checkbox qnc-pts-ai-row">' +
      '<input type="checkbox" data-qnc-bind="' +
      QNC.esc(bind) +
      '"' +
      (isChecked ? ' checked' : '') +
      ' />' +
      '<span>' +
      QNC.esc(label) +
      '</span></label>'
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

  function videoFormatHtml(s) {
    const v = s?.video || {};
    const a = s?.audio || {};
    const st = s?.storage || {};
    return (
      '<div class="qnc-pts-field-grid">' +
      fieldSelect('Format', 'video.format', nestedValue(s, 'video.format', v.format || 'HD 1080p'), [
        'HD 1080p',
        'HD 1080i50',
        'UHD 2160p',
      ]) +
      fieldSelect('Frame rate', 'video.fps', nestedValue(s, 'video.fps', v.fps || 25), ['25', '50', '29.97']) +
      fieldInput('Width', 'video.width', nestedValue(s, 'video.width', v.width || 1920)) +
      fieldInput('Height', 'video.height', nestedValue(s, 'video.height', v.height || 1080)) +
      fieldSelect('Field order', 'video.field_order', nestedValue(s, 'video.field_order', v.field_order || 'progressive'), [
        'progressive',
        'upper_first',
      ]) +
      fieldSelect('Color space', 'video.color_space', nestedValue(s, 'video.color_space', v.color_space || 'rec709'), [
        'rec709',
        'rec2020',
      ]) +
      fieldSelect('Timeline codec', 'video.timeline_codec', nestedValue(s, 'video.timeline_codec', v.timeline_codec || 'proxy_h264'), [
        'proxy_h264',
        'xdcam_hd_422',
        'prores_422',
      ]) +
      fieldSelect('Proxy policy', 'storage.proxy_policy', nestedValue(s, 'storage.proxy_policy', st.proxy_policy || 'copy_to_project'), [
        'copy_to_project',
        'link_when_available',
      ]) +
      fieldSelect('Audio', 'audio.sample_rate', nestedValue(s, 'audio.sample_rate', a.sample_rate || 48000), ['48000', '44100']) +
      fieldSelect('Channels', 'audio.channels', nestedValue(s, 'audio.channels', a.channels || 2), ['2', '4', '6', '8']) +
      '</div>'
    );
  }

  function exportModeHtml(s) {
    const ex = s?.export || {};
    const st = s?.storage || {};
    return (
      '<div class="qnc-pts-field-grid">' +
      fieldSelect('Export mode', 'export.default_mode', nestedValue(s, 'export.default_mode', ex.default_mode || 'proxy_fast'), [
        'proxy_fast',
        'xml_master',
        'broadcast_mxf',
      ]) +
      fieldSelect('Original policy', 'storage.original_policy', nestedValue(s, 'storage.original_policy', st.original_policy || 'link_when_available'), [
        'link_when_available',
        'copy_background',
        'ignore_for_fast_news',
      ]) +
      '</div>'
    );
  }

  function fieldDirectoryRow(label, bind, val, action) {
    return (
      '<div class="qnc-pts-path-field">' +
      '<label class="qnc-ui-label">' +
      QNC.esc(label) +
      '</label>' +
      '<div class="qnc-pts-path-row">' +
      '<input class="qnc-ui-input" data-qnc-bind="' +
      QNC.esc(bind) +
      '" value="' +
      QNC.esc(val ?? '') +
      '" />' +
      '<button type="button" class="qnc-ui-button qnc-pts-btn" data-qnc-action="' +
      QNC.esc(action || 'export.directory.pick') +
      '">Izbor direktorija</button>' +
      '</div></div>'
    );
  }

  function exportDirectoryHtml(s) {
    const ex = s?.export || {};
    const dir = ex.directory || ex.output_directory || 'exports/projekti';
    return (
      '<div class="qnc-pts-field-grid qnc-pts-field-grid--single">' +
      fieldDirectoryRow('Putanja', 'export.directory', dir, 'export.directory.pick') +
      '<p class="muted qnc-pts-field-hint">Zadani export direktorij za novi projekt iz ovog templatea.</p>' +
      '</div>'
    );
  }

  function projectsRootHtml(s) {
    const path = nestedValue(s, 'storage.projects_root', '');
    return (
      '<div class="qnc-pts-field-grid qnc-pts-field-grid--single">' +
      fieldDirectoryRow('Lokacija projekata', 'storage.projects_root', path, 'projects-root.pick') +
      '<p class="muted qnc-pts-field-hint">Direktorij u koji će se spremati projekti kreirani iz ovog templatea. Ako je prazno, koristi se OS default.</p>' +
      '</div>'
    );
  }

  function renderGroupSlot(slotName, title, html, root) {
    const el = slot(slotName, root);
    if (el) el.innerHTML = '<h3 class="qnc-pts-group-title">' + QNC.esc(title) + '</h3>' + html;
  }

  function templateSummaryHtml(tpl) {
    if (!tpl) return '<strong>Nema templatea</strong>';
    const ws = tpl.settings?.workspace || {};
    const tabCount = (ws.tabs || []).length;
    const sourceCount = (tpl.source_template_ids || []).length;
    return (
      '<strong>' +
      QNC.esc(tpl.name) +
      '</strong><span>' +
      QNC.esc(aiLabel(tpl.settings)) +
      ' · ' +
      QNC.esc(tabCount) +
      ' modula · ' +
      QNC.esc(sourceCount) +
      ' izvora · ' +
      QNC.esc(tpl.system ? 'system' : 'custom') +
      '</span>'
    );
  }

  function templateCardsHtml(templates, selectedTemplateId) {
    if (!templates.length) {
      return '<div class="qnc-pts-empty muted">Nema dostupnih templatea.</div>';
    }
    return templates
      .map((t) => {
        const workspace = t.settings?.workspace || {};
        const tabCount = (workspace.tabs || []).length;
        const sourceCount = (t.source_template_ids || []).length;
        const selected = t.template_id === selectedTemplateId;
        return [
          '<button type="button" class="qnc-pts-card' + (selected ? ' is-selected' : '') + '" data-template-id="' + QNC.esc(t.template_id) + '">',
          '  <strong>' + QNC.esc(t.name) + '</strong>',
          '  <span>' + QNC.esc(aiLabel(t.settings)) + ' · ' + QNC.esc(tabCount) + ' modula · ' + QNC.esc(sourceCount) + ' izvora · ' + QNC.esc(t.system ? 'system' : 'custom') + '</span>',
          '</button>',
        ].join('');
      })
      .join('');
  }

  function moduleChecks(workspace, availableModules) {
    const tabs = new Set(workspace.tabs || []);
    const labels = workspace.tab_labels || {};
    const modules = availableModules.length
      ? sortedModules(availableModules)
      : (workspace.tabs || []).map((id) => ({
          tab_id: id,
          label: labels[id] || id,
          description: '',
          enabled: true,
        }));
    if (!modules.length) {
      return '<span class="muted">Nema učitanih plugin modula.</span>';
    }
    return modules
      .map((mod) => {
        const id = String(mod.tab_id || mod.module_id || '').trim();
        if (!id) return '';
        const locked = id === 'project';
        const globallyDisabled = mod.enabled === false;
        const checked = locked || tabs.has(id);
        const title = labels[id] || mod.label || id;
        const desc = String(mod.description || '').trim() || 'Plugin modul bez opisa.';
        const disabled = locked || globallyDisabled ? ' disabled' : '';
        const checkedAttr = checked ? ' checked' : '';
        const extraClass = globallyDisabled ? ' is-disabled' : '';
        return [
          '<label class="qnc-ui-checkbox qnc-module-check qnc-module-check-row' + extraClass + '">',
          '<input type="checkbox" class="qnc-template-module" value="' +
            QNC.esc(id) +
            '"' +
            disabled +
            checkedAttr +
            ' />',
          '<span class="qnc-module-check-text">',
          '<strong>' + QNC.esc(title) + '</strong>',
          '<span class="qnc-module-desc">' + QNC.esc(desc) + '</span>',
          '</span>',
          '</label>',
        ].join('');
      })
      .filter(Boolean)
      .join('');
  }

  function renderWorkflowTabs(workspace, availableModules, root) {
    const panel = panelRoot(root);
    const zone = panel?.querySelector('[data-pts-plugin-tabs-zone]');
    if (!zone) return;
    zone.hidden = false;
    zone.innerHTML = '<div class="qnc-pts-module-checks">' + moduleChecks(workspace, availableModules) + '</div>';
  }

  function renderSettingsPanels(tpl, availableModules, root, mergedSettings) {
    const s = mergedSettings || tpl?.settings || {};
    renderGroupSlot('ai-settings', 'AI', aiSettingsHtml(s), root);
    renderGroupSlot('video-format', 'Video format', videoFormatHtml(s), root);
    renderGroupSlot('export-mode', 'Export mod', exportModeHtml(s), root);
    renderGroupSlot('export-directory', 'Export direktorij', exportDirectoryHtml(s), root);
    renderGroupSlot('projects-root', 'Lokacija projekata', projectsRootHtml(s), root);
    renderWorkflowTabs(s.workspace || {}, availableModules, root);
  }

  function updateTemplateSummary(tpl, root) {
    const summary = slot('template-summary', root);
    if (summary) summary.innerHTML = templateSummaryHtml(tpl);
    const base = slot('template-base', root);
    if (base) base.textContent = tpl?.name || '—';
  }

  function closePicker(root) {
    const panel = panelRoot(root);
    const picker = panel?.querySelector('[data-pts-picker]');
    if (picker) picker.open = false;
  }

  function syncTemplateCreatePanel(open, root) {
    const panel = panelRoot(root);
    const box = panel?.querySelector('[data-pts-section="custom_template_save"]');
    if (box) box.hidden = !open;
  }

  function setStatus(root, message, kind) {
    const el = slot('status', root);
    if (!el) return;
    el.textContent = String(message || '');
    el.classList.remove('is-ok', 'is-err', 'is-busy');
    if (kind) el.classList.add('is-' + kind);
  }

  function selectedTemplate(data) {
    const templates = Array.isArray(data?.templates) ? data.templates : [];
    const id = data?.ui?.selected_template_id || data?.selectedTemplateId || '';
    return templates.find((t) => t.template_id === id) || templates[0] || null;
  }

  function mount(root, options) {
    const panel = panelRoot(root);
    if (!panel || panel.dataset.qncComponentMounted === '1') return panel;
    panel.dataset.qncComponentMounted = '1';
    const pluginId = options?.pluginId || panel.dataset.hostPluginId || 'project';
    panel.dataset.hostPluginId = pluginId;

    panel.addEventListener('click', (e) => {
      const actionEl = e.target.closest?.('[data-qnc-action]');
      if (actionEl && panel.contains(actionEl)) {
        const action = actionEl.getAttribute('data-qnc-action') || '';
        if (action) {
          e.preventDefault();
          e.stopPropagation();
          emit(pluginId, action, {
            ref: actionEl.getAttribute('data-qnc-ref') || '',
            value: actionEl.value,
            bind: QNC.readComponentBinds ? QNC.readComponentBinds(panel) : {},
          });
          return;
        }
      }
      const card = e.target.closest?.('.qnc-pts-card[data-template-id]');
      if (card) {
        closePicker(panel);
        emit(pluginId, 'template.select', { template_id: card.dataset.templateId || '' });
      }
    });

    panel.addEventListener('input', (e) => {
      const el = e.target;
      const bind = el?.dataset?.qncBind || '';
      const field = FIELD_BIND_MAP[bind];
      if (field) emit(pluginId, 'field.change', { field, value: el.value });
    });

    panel.addEventListener('change', (e) => {
      const el = e.target;
      if (el?.matches?.('.qnc-template-module')) {
        const tabs = qAll('.qnc-template-module', panel)
          .filter((item) => item.checked || item.value === 'project')
          .map((item) => item.value)
          .filter(Boolean);
        emit(pluginId, 'workflow-tabs.change', { tabs });
        return;
      }
      if (!el?.matches?.('[data-qnc-bind]')) return;
      const path = el.dataset.qncBind || '';
      if (path.startsWith('ai.')) {
        emit(pluginId, 'ai.change', { path, value: !!el.checked });
      } else {
        emit(pluginId, 'settings.change', { path, value: el.value });
      }
    });

    const name = byBind('project.name', panel);
    if (name) {
      name.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') emit(pluginId, 'project.create');
      });
    }

    return panel;
  }

  function update(root, data, options) {
    const panel = panelRoot(root);
    if (!panel) return;
    if (panel.dataset.qncComponentMounted !== '1') mount(panel, options);

    const templates = Array.isArray(data?.templates) ? data.templates : [];
    const ui = data?.ui || {};
    const selectedTemplateId = ui.selected_template_id || data?.selectedTemplateId || '';
    panel.dataset.selectedTemplateId = selectedTemplateId;
    const tpl = selectedTemplate({ templates, ui, selectedTemplateId });
    const availableModules = Array.isArray(data?.availableModules) ? data.availableModules : [];
    const merged = data?.mergedSettings || tpl?.settings || {};
    setFieldFromUi(panel, 'project.name', ui.project_name);
    setFieldFromUi(panel, 'template.name', ui.template_draft_name);
    setFieldFromUi(panel, 'template.description', ui.template_draft_description);

    updateTemplateSummary(tpl, panel);

    const cards = slot('template-cards', panel);
    if (cards) cards.innerHTML = templateCardsHtml(templates, selectedTemplateId);

    renderSettingsPanels(tpl, availableModules, panel, merged);
    syncTemplateCreatePanel(!!data?.templateCreateOpen, panel);

    if (data?.templateCreateOpen && data?.focusTemplateName) {
      byBind('template.name', panel)?.focus();
    }

    if (data?.status != null) setStatus(panel, data.status, data.statusKind);
  }

  QNC.components.register(PANEL_ID, {
    PANEL_ID,
    mount,
    update,
    setStatus,
    closePicker,
    updateTemplateSummary,
    selectedTemplate,
  });
})(window.QNC);
