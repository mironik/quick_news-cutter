/* Postavke tipkovnice u project templateu — odabir gotovog NLE preseta. */
window.QNC = window.QNC || {};

(function (QNC) {
  const PANEL_ID = 'keyboard-shortcuts-settings';

  const SCOPE_LABELS = {
    media_pool: 'Media Pool',
    storyboard: 'Story',
    timeline_modal: 'Timeline (prozor)',
    off: 'OFF modul',
  };

  let uiPreset = 'default';

  function panelRoot(root) {
    if (!root) return null;
    if (root.matches?.('[data-qnc-panel="' + PANEL_ID + '"]')) return root;
    return root.querySelector?.('[data-qnc-panel="' + PANEL_ID + '"]') || null;
  }

  function ks() {
    return QNC.keyboardShortcuts;
  }

  function emit(pluginId, action, payload) {
    if (QNC.emitComponent) {
      return QNC.emitComponent(pluginId || 'project', PANEL_ID, action, payload || {});
    }
    return Promise.resolve();
  }

  function setStatus(panel, msg, kind) {
    const el = panel.querySelector('[data-kbd-status]');
    if (!el) return;
    el.textContent = msg || 'Spreman.';
    el.classList.remove('is-ok', 'is-err');
    if (kind) el.classList.add('is-' + kind);
  }

  function scopeLabel(scopeId) {
    return SCOPE_LABELS[scopeId] || scopeId;
  }

  function selectedScope(panel) {
    const sel = panel.querySelector('[data-kbd-scope]');
    return sel?.value || 'media_pool';
  }

  async function renderPresetSelect(panel, presetId) {
    const api = ks();
    if (!api?.load) return;
    await api.load();
    uiPreset = presetId || api.getActivePreset() || 'default';
    const sel = panel.querySelector('[data-kbd-preset]');
    const desc = panel.querySelector('[data-kbd-preset-desc]');
    if (!sel) return;
    const presets = api.listPresets().filter((p) => p.builtIn !== false);
    sel.innerHTML = presets
      .map(
        (p) =>
          '<option value="' +
          QNC.esc(p.id) +
          '"' +
          (p.id === uiPreset ? ' selected' : '') +
          '>' +
          QNC.esc(p.name) +
          '</option>'
      )
      .join('');
    const current = presets.find((p) => p.id === uiPreset);
    if (desc) desc.textContent = current?.description || '';
  }

  async function renderScopeSelect(panel) {
    const api = ks();
    const sel = panel.querySelector('[data-kbd-scope]');
    if (!sel || !api) return;
    await api.load();
    const scopes = api.listScopes(uiPreset);
    const prev = sel.value;
    sel.innerHTML = scopes
      .map(
        (id) =>
          '<option value="' + QNC.esc(id) + '">' + QNC.esc(scopeLabel(id)) + '</option>'
      )
      .join('');
    if (prev && scopes.includes(prev)) sel.value = prev;
    else if (scopes.includes('media_pool')) sel.value = 'media_pool';
  }

  async function renderRows(panel) {
    const api = ks();
    const tbody = panel.querySelector('[data-kbd-rows]');
    if (!tbody || !api) return;
    await api.load();
    const scopeId = selectedScope(panel);
    const bindings = api.getBaseBindings(scopeId, uiPreset);
    const actionIds = Object.keys(bindings).sort((a, b) =>
      api.describeAction(a).localeCompare(api.describeAction(b), 'hr')
    );
    if (!actionIds.length) {
      tbody.innerHTML = '<tr><td colspan="2" class="muted">Nema akcija za ovaj modul.</td></tr>';
      return;
    }
    tbody.innerHTML = actionIds
      .map((actionId) => {
        const label = api.describeAction(actionId);
        const keyText = api.formatBindings(bindings[actionId]);
        return (
          '<tr><td>' +
          QNC.esc(label) +
          '</td><td><span class="qnc-kbd-key">' +
          QNC.esc(keyText) +
          '</span></td></tr>'
        );
      })
      .join('');
  }

  async function render(panel, data) {
    if (!panel || !ks()) {
      setStatus(panel, 'Modul tipkovnice nije učitan (qnc-keyboard-shortcuts.js).', 'err');
      return;
    }
    const preset =
      data?.keyboardPreset ||
      ks().presetFromSettings?.(data?.mergedSettings) ||
      ks().getActivePreset?.() ||
      'default';
    await renderPresetSelect(panel, preset);
    await renderScopeSelect(panel);
    await renderRows(panel);
    const tplName = data?.templateName || '';
    if (tplName) {
      setStatus(panel, 'Preset spremljen u template: ' + tplName + '.', 'ok');
    }
  }

  function mount(root, options) {
    const panel = panelRoot(root);
    if (!panel || panel.dataset.qncComponentMounted === '1') return panel;
    panel.dataset.qncComponentMounted = '1';
    const pluginId = options?.pluginId || 'project';

    panel.addEventListener('change', async (e) => {
      if (!e.target?.matches?.('[data-kbd-preset]')) return;
      const presetId = e.target.value;
      uiPreset = presetId;
      try {
        setStatus(panel, 'Spremam u novi template…', 'ok');
        await emit(pluginId, 'keyboard.preset.select', { preset_id: presetId });
        await renderScopeSelect(panel);
        await renderRows(panel);
        setStatus(panel, 'Preset će biti u novom templateu.', 'ok');
      } catch (err) {
        setStatus(panel, err.message || 'Greška.', 'err');
      }
    });

    panel.addEventListener('change', async (e) => {
      if (e.target?.matches?.('[data-kbd-scope]')) {
        await renderRows(panel);
      }
    });

    if (QNC.bus?.on) {
      QNC.bus.on('keyboard-shortcuts:changed', () => {
        render(panel).catch(() => {});
      });
    }

    render(panel, options).catch((e) => setStatus(panel, e.message || 'Greška učitavanja.', 'err'));
    return panel;
  }

  function update(root, data, options) {
    const panel = panelRoot(root);
    if (!panel) return;
    const opts = { ...(options || {}), ...(data || {}) };
    if (panel.dataset.qncComponentMounted !== '1') mount(panel, opts);
    else render(panel, opts).catch(() => {});
  }

  QNC.components = QNC.components || { register: function () {}, get: function () {} };
  if (QNC.components.register) {
    QNC.components.register(PANEL_ID, { PANEL_ID, mount, update });
  }
})(window.QNC);
