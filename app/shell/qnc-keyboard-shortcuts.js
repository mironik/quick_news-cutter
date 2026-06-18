/* Globalni keyboard shortcuts — preset iz keyboard-shortcuts.json + SQLite / localStorage */
window.QNC = window.QNC || {};

(function (QNC) {
  const BASE_URL = '/app/shell/keyboard-shortcuts.json?v=67';
  const STORAGE_KEY = 'qnc_keyboard_shortcuts';
  const API_URL = '/api/settings/keyboard-shortcuts';

  let _baseConfig = null;
  let _config = null;
  let _loadPromise = null;

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj || {}));
  }

  function readLocalUser() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function writeLocalUser(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data || {}));
  }

  function mergeUserIntoBase(base, user) {
    const merged = deepClone(base);
    if (!user || typeof user !== 'object') return merged;
    if (user.active_preset) merged.active_preset = user.active_preset;
    if (user.custom_presets && typeof user.custom_presets === 'object') {
      merged.presets = { ...(merged.presets || {}), ...user.custom_presets };
    }
    return merged;
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

  async function loadConfig(force) {
    if (_config && !force) return _config;
    if (_loadPromise && !force) return _loadPromise;
    _loadPromise = (async () => {
      try {
        _baseConfig = await fetchBaseConfig();
        const serverUser = await fetchServerUser();
        const localUser = readLocalUser();
        const user = serverUser || localUser;
        if (serverUser && serverUser !== localUser) writeLocalUser(serverUser);
        _config = mergeUserIntoBase(_baseConfig, user);
        return _config;
      } catch (e) {
        console.warn('[QNC] shortcuts:', e.message || e);
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
    _loadPromise = null;
  }

  function bindingsForScope(scopeId) {
    const presetName = _config?.active_preset || 'default';
    const preset = _config?.presets?.[presetName] || _config?.presets?.default || {};
    return preset[scopeId] || {};
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
    if (binding.key) parts.push(String(binding.key).length === 1 ? binding.key.toUpperCase() : binding.key);
    else if (binding.code) parts.push(binding.code.replace(/^Key/, ''));
    return parts.join('+');
  }

  QNC.keyboardShortcuts = {
    load: loadConfig,
    invalidate: invalidateConfig,

    getConfig() {
      return _config;
    },

    getActivePreset() {
      return _config?.active_preset || 'default';
    },

    listPresets() {
      const presets = _config?.presets || {};
      return Object.entries(presets).map(([id, p]) => ({
        id,
        name: p.name || id,
        description: p.description || '',
      }));
    },

    getBindings(scopeId) {
      return bindingsForScope(scopeId);
    },

    describeAction(actionId) {
      return _config?.actions?.[actionId]?.label || actionId;
    },

    formatBinding,

    async setActivePreset(presetId) {
      await loadConfig();
      if (!_config?.presets?.[presetId]) throw new Error('Nepoznat preset: ' + presetId);
      const user = readLocalUser();
      user.active_preset = presetId;
      writeLocalUser(user);
      _config = mergeUserIntoBase(_baseConfig, user);
      await QNC.keyboardShortcuts.saveUser(user);
      return _config;
    },

    async saveCustomPreset(presetId, presetData) {
      await loadConfig();
      const user = readLocalUser();
      user.custom_presets = user.custom_presets || {};
      user.custom_presets[presetId] = presetData;
      writeLocalUser(user);
      _config = mergeUserIntoBase(_baseConfig, user);
      await QNC.keyboardShortcuts.saveUser(user);
      return _config;
    },

    async saveUser(userData) {
      writeLocalUser(userData);
      try {
        await QNC.api('POST', API_URL, { user: userData });
      } catch (e) {
        console.warn('[QNC] shortcuts save server:', e.message || e);
      }
      invalidateConfig();
      return loadConfig(true);
    },

    exportConfig() {
      const user = readLocalUser();
      return {
        version: _config?.version || 1,
        active_preset: user.active_preset || _config?.active_preset,
        custom_presets: user.custom_presets || {},
        exported_at: new Date().toISOString(),
      };
    },

    async importConfig(data) {
      if (!data || typeof data !== 'object') throw new Error('Neispravan JSON');
      const user = {
        active_preset: data.active_preset,
        custom_presets: data.custom_presets || {},
      };
      return QNC.keyboardShortcuts.saveUser(user);
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
