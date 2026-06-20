/* Tipkovnica — preset mapa iz keyboard-shortcuts.json; aktivni preset iz project templatea. */
window.QNC = window.QNC || {};

(function (QNC) {
  const BASE_URL = '/app/shell/keyboard-shortcuts.json?v=68';
  const LEGACY_STORAGE_KEY = 'qnc_keyboard_shortcuts';
  const API_URL = '/api/settings/keyboard-shortcuts';

  const PRESET_ORDER = ['default', 'resolve', 'premiere', 'finalcut', 'edius', 'avid'];

  let _baseConfig = null;
  let _config = null;
  let _serverUser = null;
  let _loadPromise = null;

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj || {}));
  }

  function readLegacyLocalUser() {
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function clearLegacyLocalUser() {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  function mergeUserIntoBase(base, user) {
    const merged = deepClone(base);
    if (!user || typeof user !== 'object') return merged;
    if (user.custom_presets && typeof user.custom_presets === 'object') {
      merged.presets = { ...(merged.presets || {}), ...user.custom_presets };
    }
    return merged;
  }

  function bindingsForScope(scopeId, presetId) {
    const presetName = presetId || _config?.active_preset || 'default';
    const preset = _config?.presets?.[presetName] || _config?.presets?.default || {};
    return preset[scopeId] || {};
  }

  function notifyChange(detail) {
    QNC.bus?.emit?.('keyboard-shortcuts:changed', detail || {});
  }

  async function fetchBaseConfig() {
    const r = await fetch(BASE_URL, { cache: 'no-store' });
    if (!r.ok) throw new Error('keyboard-shortcuts.json');
    return r.json();
  }

  async function fetchServerUser() {
    try {
      const r = await fetch(API_URL, { cache: 'no-store' });
      if (!r.ok) return null;
      const d = await r.json();
      return d.user || d.config || null;
    } catch {
      return null;
    }
  }

  async function migrateLegacyLocalUser(localUser) {
    if (!localUser || typeof localUser !== 'object' || !Object.keys(localUser).length) return null;
    try {
      await QNC.api('POST', API_URL, { user: localUser });
      clearLegacyLocalUser();
      return localUser;
    } catch (e) {
      console.warn('[QNC] shortcuts migrate:', e.message || e);
      return null;
    }
  }

  async function loadConfig(force) {
    if (_config && !force) return _config;
    if (_loadPromise && !force) return _loadPromise;
    _loadPromise = (async () => {
      try {
        _baseConfig = await fetchBaseConfig();
        let serverUser = await fetchServerUser();
        if (!serverUser || !Object.keys(serverUser).length) {
          const legacy = readLegacyLocalUser();
          serverUser = (await migrateLegacyLocalUser(legacy)) || legacy;
        }
        _serverUser = serverUser && typeof serverUser === 'object' ? serverUser : {};
        _config = mergeUserIntoBase(_baseConfig, _serverUser);
        return _config;
      } catch (e) {
        console.warn('[QNC] shortcuts:', e.message || e);
        _serverUser = {};
        _config = {
          active_preset: 'default',
          presets: { default: { name: 'QNC zadano', storyboard: {}, media_pool: {} } },
          actions: {},
        };
        return _config;
      } finally {
        _loadPromise = null;
      }
    })();
    return _loadPromise;
  }

  function invalidateConfig() {
    _config = null;
    _serverUser = null;
    _loadPromise = null;
  }

  function matchModifier(event, binding, name) {
    if (binding[name] == null) return true;
    const want = !!binding[name];
    const key =
      name === 'ctrl'
        ? event.ctrlKey || event.metaKey
        : name === 'alt'
          ? event.altKey
          : name === 'shift'
            ? event.shiftKey
            : false;
    return want === !!key;
  }

  function matchBinding(event, binding) {
    if (binding.code && event.code !== binding.code) return false;
    if (binding.key && event.key !== binding.key) return false;
    if (!binding.code && !binding.key) return false;
    if (!matchModifier(event, binding, 'ctrl')) return false;
    if (!matchModifier(event, binding, 'alt')) return false;
    if (!matchModifier(event, binding, 'shift')) return false;
    return true;
  }

  function matches(event, bindings) {
    if (!Array.isArray(bindings)) return false;
    return bindings.some((b) => matchBinding(event, b));
  }

  function isTypingTarget(target, ignoreInputIds) {
    const tag = target?.tagName?.toLowerCase();
    const ignore = new Set(ignoreInputIds || []);
    if (tag === 'input') {
      if (ignore.has(target.id)) return false;
      const type = (target.type || '').toLowerCase();
      if (type === 'range' || type === 'button' || type === 'checkbox' || type === 'radio') return false;
    }
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    return !!target?.isContentEditable;
  }

  function formatBinding(binding) {
    if (!binding) return '';
    const parts = [];
    if (binding.ctrl) parts.push('Ctrl');
    if (binding.alt) parts.push('Alt');
    if (binding.shift) parts.push('Shift');
    if (binding.key) {
      const keyLabel =
        binding.key === ' '
          ? 'Space'
          : binding.key.length === 1
            ? binding.key.toUpperCase()
            : binding.key;
      parts.push(keyLabel);
    } else if (binding.code) {
      parts.push(binding.code.replace(/^Key/, '').replace(/^Arrow/, ''));
    }
    return parts.join('+');
  }

  function formatBindings(bindings) {
    if (!Array.isArray(bindings) || !bindings.length) return '—';
    return bindings.map((b) => formatBinding(b)).filter(Boolean).join(', ');
  }

  function eventToBinding(event) {
    if (!event || event.key === 'Escape') return null;
    const binding = {};
    const ignoreKeys = new Set(['Control', 'Alt', 'Shift', 'Meta']);
    if (event.code) binding.code = event.code;
    if (event.key && !ignoreKeys.has(event.key)) {
      binding.key = event.key.length === 1 ? event.key : event.key;
    }
    if (event.ctrlKey || event.metaKey) binding.ctrl = true;
    if (event.altKey) binding.alt = true;
    if (event.shiftKey) binding.shift = true;
    if (!binding.code && !binding.key) return null;
    return binding;
  }

  function isBuiltInPreset(presetId) {
    return !!_baseConfig?.presets?.[presetId];
  }

  function extractCustomPresets(config) {
    const baseIds = new Set(Object.keys(_baseConfig?.presets || {}));
    const out = {};
    Object.entries(config?.presets || {}).forEach(([id, preset]) => {
      if (!baseIds.has(id)) out[id] = preset;
    });
    return out;
  }

  async function mergeAndSaveUser(patch) {
    await loadConfig();
    const existing = deepClone(_serverUser || {});
    const payload = { ...existing, ...(patch || {}) };
    await QNC.api('POST', API_URL, { user: payload });
    clearLegacyLocalUser();
    invalidateConfig();
    const cfg = await loadConfig(true);
    notifyChange({ preset: cfg?.active_preset || 'default' });
    return cfg;
  }

  QNC.keyboardShortcuts = {
    load: loadConfig,
    invalidate: invalidateConfig,
    PRESET_ORDER,

    getConfig() {
      return _config;
    },

    getActivePreset() {
      return _config?.active_preset || 'default';
    },

    listPresets() {
      const presets = _config?.presets || {};
      const items = Object.entries(presets).map(([id, p]) => ({
        id,
        name: p.name || id,
        description: p.description || '',
        builtIn: isBuiltInPreset(id),
      }));
      items.sort((a, b) => {
        const ai = PRESET_ORDER.indexOf(a.id);
        const bi = PRESET_ORDER.indexOf(b.id);
        const ar = ai === -1 ? 100 : ai;
        const br = bi === -1 ? 100 : bi;
        if (ar !== br) return ar - br;
        return a.name.localeCompare(b.name, 'hr');
      });
      return items;
    },

    listScopes(presetId) {
      const presetName = presetId || _config?.active_preset || 'default';
      const preset = _config?.presets?.[presetName] || {};
      return Object.keys(preset).filter((k) => typeof preset[k] === 'object');
    },

    getBindings(scopeId, presetId) {
      return bindingsForScope(scopeId, presetId);
    },

    getBaseBindings(scopeId, presetId) {
      return bindingsForScope(scopeId, presetId);
    },

    describeAction(actionId) {
      return _config?.actions?.[actionId]?.label || actionId;
    },

    formatBinding,
    formatBindings,
    eventToBinding,
    isBuiltInPreset,

    async setActivePreset(presetId) {
      return QNC.keyboardShortcuts.applyPreset(presetId);
    },

    /** Aktivni preset iz templatea/projekta — ne piše u globalni app_settings. */
    async applyPreset(presetId) {
      await loadConfig();
      let id = String(presetId || 'default').trim();
      if (!_config?.presets?.[id]) id = 'default';
      _config.active_preset = id;
      notifyChange({ preset: id, source: 'template' });
      return _config;
    },

    presetFromSettings(settings) {
      const s = settings && typeof settings === 'object' ? settings : {};
      const id = s?.keyboard_shortcuts?.active_preset;
      return typeof id === 'string' && id.trim() ? id.trim() : 'default';
    },

    async applyFromProjectSettings(settings) {
      return QNC.keyboardShortcuts.applyPreset(QNC.keyboardShortcuts.presetFromSettings(settings));
    },

    async applyForActiveProject() {
      const pid = String(QNC.getProjectId?.() || '').trim();
      if (!pid) return QNC.keyboardShortcuts.applyPreset('default');
      try {
        const d = await QNC.api('GET', '/api/projects/' + encodeURIComponent(pid) + '/settings');
        const inner = d?.settings?.settings || d?.settings || {};
        return QNC.keyboardShortcuts.applyFromProjectSettings(inner);
      } catch (e) {
        console.warn('[QNC] shortcuts project:', e.message || e);
        return QNC.keyboardShortcuts.applyPreset('default');
      }
    },

    async saveCustomPreset(presetId, presetData) {
      await loadConfig();
      return mergeAndSaveUser({
        active_preset: _config?.active_preset,
        custom_presets: {
          ...extractCustomPresets(_config),
          [presetId]: presetData,
        },
        preset_overrides: _serverUser?.preset_overrides || {},
      });
    },

    async updateBinding(scopeId, actionId, bindings) {
      await loadConfig();
      const presetName = _config?.active_preset || 'default';
      const byPreset = deepClone(_serverUser?.preset_overrides || {});
      const presetOv = { ...(byPreset[presetName] || {}) };
      const scopeOv = { ...(presetOv[scopeId] || {}) };
      scopeOv[actionId] = Array.isArray(bindings) ? bindings : [bindings];
      presetOv[scopeId] = scopeOv;
      byPreset[presetName] = presetOv;
      return mergeAndSaveUser({
        active_preset: presetName,
        custom_presets: extractCustomPresets(_config),
        preset_overrides: byPreset,
      });
    },

    async resetBinding(scopeId, actionId) {
      await loadConfig();
      const presetName = _config?.active_preset || 'default';
      const byPreset = deepClone(_serverUser?.preset_overrides || {});
      const presetOv = { ...(byPreset[presetName] || {}) };
      const scopeOv = { ...(presetOv[scopeId] || {}) };
      delete scopeOv[actionId];
      if (Object.keys(scopeOv).length) presetOv[scopeId] = scopeOv;
      else delete presetOv[scopeId];
      if (Object.keys(presetOv).length) byPreset[presetName] = presetOv;
      else delete byPreset[presetName];
      return mergeAndSaveUser({
        active_preset: presetName,
        custom_presets: extractCustomPresets(_config),
        preset_overrides: byPreset,
      });
    },

    async resetPresetOverrides(presetId) {
      await loadConfig();
      const presetName = presetId || _config?.active_preset || 'default';
      const byPreset = deepClone(_serverUser?.preset_overrides || {});
      delete byPreset[presetName];
      return mergeAndSaveUser({
        active_preset: _config?.active_preset,
        custom_presets: extractCustomPresets(_config),
        preset_overrides: byPreset,
      });
    },

    async saveUser(userData) {
      return mergeAndSaveUser(userData || {});
    },

    exportConfig() {
      const presetName = _config?.active_preset || 'default';
      return {
        version: _config?.version || 1,
        active_preset: presetName,
        custom_presets: extractCustomPresets(_config),
        preset_overrides: deepClone(_serverUser?.preset_overrides || {}),
        exported_at: new Date().toISOString(),
      };
    },

    async importConfig(data) {
      if (!data || typeof data !== 'object') throw new Error('Neispravan JSON');
      return mergeAndSaveUser({
        active_preset: data.active_preset,
        custom_presets: data.custom_presets || {},
        preset_overrides: data.preset_overrides || {},
      });
    },

    /**
     * @param {string} scopeId npr. "storyboard", "media_pool"
     * @param {Record<string, function>} handlers mapa action → callback
     * @param {{ isActive?: () => boolean, ignoreInputIds?: string[] }} opts
     * @returns {Promise<() => void>} unbind
     */
    async bind(scopeId, handlers, opts) {
      await loadConfig();
      const isActive = opts?.isActive || (() => true);
      const ignoreInputIds = opts?.ignoreInputIds || [];

      const onKeyDown = (event) => {
        if (!isActive()) return;
        if (isTypingTarget(event.target, ignoreInputIds)) return;
        const scope = bindingsForScope(scopeId);
        for (const [action, bindings] of Object.entries(scope)) {
          if (!handlers[action] || !matches(event, bindings)) continue;
          const handled = handlers[action](event);
          if (handled === false) continue;
          event.preventDefault();
          return;
        }
      };

      document.addEventListener('keydown', onKeyDown);
      return () => document.removeEventListener('keydown', onKeyDown);
    },
  };
})(window.QNC);
