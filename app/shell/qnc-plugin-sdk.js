/* QNC Plugin SDK v1 — thin orchestrator helpers (DB/API = source of truth). */
window.QNC = window.QNC || {};

(function (QNC) {
  const SDK_VERSION = 1;

  function trim(s) {
    return String(s || '').trim();
  }

  function asArray(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  }

  function resolveRoot(root) {
    if (!root) return null;
    if (typeof root === 'string') return document.querySelector(root);
    if (root.nodeType === 1) return root;
    return null;
  }

  function mergeQuery(path, query) {
    if (!query || typeof query !== 'object') return path;
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value == null || value === '') return;
      params.set(key, String(value));
    });
    const qs = params.toString();
    if (!qs) return path;
    return path + (path.includes('?') ? '&' : '?') + qs;
  }

  function pickManifest(tabId) {
    return QNC.pluginLoader?.manifest?.(tabId) || null;
  }

  function manifestActions(manifest) {
    const backend = manifest?.backend || {};
    return asArray(manifest?.actions).concat(asArray(backend.actions));
  }

  function manifestSnapshots(manifest) {
    const state = manifest?.state || {};
    return asArray(state.snapshots);
  }

  function snapshotDefFromManifest(manifest, key) {
    const found = manifestSnapshots(manifest).find((item) => item && item.key === key);
    if (!found) return null;
    return {
      method: found.method || 'GET',
      path: found.path,
      projectScoped: asArray(found.query).includes('project_id'),
      pick: found.pick || '',
    };
  }

  function buildSnapshotRegistry(config, manifest) {
    const registry = Object.create(null);
    asArray(config.snapshots).forEach((key) => {
      const fromManifest = snapshotDefFromManifest(manifest, key);
      const fromConfig = config.snapshotLoaders?.[key];
      const def = fromConfig || fromManifest;
      if (!def || !def.path) {
        console.warn('[QNC SDK] snapshot loader missing for', key);
        return;
      }
      registry[key] = {
        method: def.method || 'GET',
        path: def.path,
        projectScoped:
          def.projectScoped != null ? !!def.projectScoped : asArray(fromManifest?.query).includes('project_id'),
        pick: def.pick || '',
      };
    });
    Object.entries(config.snapshotLoaders || {}).forEach(([key, def]) => {
      if (registry[key] || !def?.path) return;
      registry[key] = {
        method: def.method || 'GET',
        path: def.path,
        projectScoped: !!def.projectScoped,
        pick: def.pick || '',
      };
    });
    return registry;
  }

  function buildContext(config) {
    const pluginId = trim(config.pluginId);
    const tabId = trim(config.tabId || pluginId);
    const apiNamespace = trim(config.apiNamespace || config.api_namespace || pickManifest(tabId)?.api_namespace || '');
    const manifest = pickManifest(tabId);
    const snapshotRegistry = buildSnapshotRegistry(config, manifest);
    const allowedShellListens = new Set(asArray(config.listens).map(String));

    const storeCache = Object.create(null);
    const storeInvalid = new Set();
    const storeSubs = Object.create(null);
    const busDisposers = [];
    const shellDisposers = [];
    const componentBindings = [];

    function projectId() {
      return trim(QNC.getProjectId?.() || '');
    }

    function apiPath(path) {
      const p = trim(path);
      if (!p) throw new Error('API path je prazan');
      if (p.startsWith('/api/')) return p;
      if (!apiNamespace) return p.startsWith('/') ? p : '/' + p;
      const base = apiNamespace.replace(/\/$/, '');
      const rest = p.startsWith('/') ? p : '/' + p;
      return base + rest;
    }

    function notifyStore(key) {
      (storeSubs[key] || []).forEach((fn) => {
        try {
          fn(storeCache[key]);
        } catch (e) {
          console.warn('[QNC SDK] store subscriber', key, e);
        }
      });
    }

    async function fetchSnapshot(key) {
      const def = snapshotRegistry[key];
      if (!def) throw new Error('Snapshot nije registriran: ' + key);
      const query = {};
      if (def.projectScoped) {
        const pid = projectId();
        if (!pid) throw new Error('project_id nije postavljen');
        query.project_id = pid;
      }
      const url = mergeQuery(apiPath(def.path), query);
      const data = await QNC.api(def.method || 'GET', url);
      let value = data;
      if (def.pick) {
        value = data?.[def.pick] ?? data;
      }
      storeCache[key] = value;
      storeInvalid.delete(key);
      notifyStore(key);
      return value;
    }

    const ctx = {
      pluginId,
      tabId,
      sdkVersion: SDK_VERSION,

      get projectId() {
        return projectId();
      },

      api: {
        async get(path, query) {
          return QNC.api('GET', mergeQuery(apiPath(path), query));
        },
        async post(path, body) {
          return QNC.api('POST', apiPath(path), body || {});
        },
      },

      async action(actionId, body) {
        const id = trim(actionId);
        const actions = manifestActions(manifest);
        const spec = actions.find((item) => trim(item?.action) === id);
        if (!spec?.path) throw new Error('Nepoznata action: ' + id);
        const method = trim(spec.method || 'POST').toUpperCase();
        const payload = { ...(body || {}) };
        const reads = asArray(spec.reads).concat(asArray(spec.writes));
        if (reads.some((r) => String(r).includes('project')) && !payload.project_id && projectId()) {
          payload.project_id = projectId();
        }
        const url =
          method === 'GET' ? mergeQuery(apiPath(spec.path), payload) : apiPath(spec.path);
        return QNC.api(method, url, method === 'GET' ? undefined : payload);
      },

      bindComponent(componentId, root, options) {
        const el = resolveRoot(root);
        if (!el) {
          options?.onMissing?.();
          return null;
        }
        const api = QNC.components?.get?.(componentId);
        if (!api?.mount) {
          options?.onMissing?.();
          return null;
        }
        const mountCtx = options?.mountCtx || { pluginId };
        const mapModel = typeof options?.mapModel === 'function' ? options.mapModel : () => ({});
        const binding = {
          componentId,
          root: el,
          render() {
            if (typeof api.update === 'function') {
              api.update(el, mapModel(), mountCtx);
            } else {
              api.mount(el, mapModel(), mountCtx);
            }
          },
          update(patch) {
            if (typeof api.update === 'function') api.update(el, patch, mountCtx);
            else this.render();
          },
          dispose() {
            if (typeof api.unmount === 'function') api.unmount(el);
          },
        };
        if (typeof api.update === 'function' && api.mount) {
          api.mount(el, mountCtx);
        } else {
          api.mount(el, mountCtx);
        }
        binding.render();
        componentBindings.push(binding);
        return binding;
      },

      store: {
        async load(key) {
          const k = trim(key);
          if (storeCache[k] !== undefined && !storeInvalid.has(k)) return storeCache[k];
          return fetchSnapshot(k);
        },
        async reload(key) {
          const keys = asArray(key).map(trim).filter(Boolean);
          const out = {};
          for (const k of keys) {
            out[k] = await fetchSnapshot(k);
          }
          return keys.length === 1 ? out[keys[0]] : out;
        },
        get(key) {
          return storeCache[trim(key)];
        },
        invalidate(key) {
          asArray(key).forEach((k) => storeInvalid.add(trim(k)));
        },
        subscribe(key, fn) {
          const k = trim(key);
          storeSubs[k] = storeSubs[k] || [];
          storeSubs[k].push(fn);
          return () => {
            storeSubs[k] = (storeSubs[k] || []).filter((item) => item !== fn);
          };
        },
        async refreshInvalidated() {
          const keys = [...storeInvalid];
          if (!keys.length) return;
          await ctx.store.reload(keys);
        },
      },

      on(eventName, handler) {
        if (!QNC.componentBus?.on) throw new Error('componentBus nije dostupan');
        const off = QNC.componentBus.on(pluginId, eventName, handler);
        busDisposers.push(off);
        return off;
      },

      onShell(eventName, handler) {
        const name = trim(eventName);
        if (allowedShellListens.size && !allowedShellListens.has(name)) {
          console.warn('[QNC SDK] shell listen nije deklariran u config.listens:', name);
        }
        if (!QNC.bus?.on) throw new Error('QNC.bus nije dostupan');
        const off = QNC.bus.on(name, handler);
        shellDisposers.push(off);
        return off;
      },

      emitShell(eventName, payload) {
        QNC.bus?.emit?.(trim(eventName), payload || {});
      },

      setStatus(message, kind) {
        QNC.setBox?.(message, kind || 'muted');
      },

      teardown() {
        busDisposers.splice(0).forEach((off) => {
          try {
            if (typeof off === 'function') off();
          } catch (_) {}
        });
        shellDisposers.splice(0).forEach((off) => {
          try {
            if (typeof off === 'function') off();
          } catch (_) {}
        });
        componentBindings.splice(0).forEach((binding) => {
          try {
            binding.dispose();
          } catch (_) {}
        });
        Object.keys(storeSubs).forEach((k) => delete storeSubs[k]);
        Object.keys(storeCache).forEach((k) => delete storeCache[k]);
        storeInvalid.clear();
        QNC.componentBus?.offPlugin?.(pluginId);
      },
    };

    asArray(config.listens).forEach((eventName) => {
      const name = trim(eventName);
      if (!name) return;
      ctx.onShell(name, () => {
        asArray(config.snapshots).forEach((k) => ctx.store.invalidate(trim(k)));
      });
    });

    return ctx;
  }

  /**
   * @param {object} config
   * @returns {{ lifecycle: Function, register: Function, ctx: object|null }}
   */
  function createPluginApp(config) {
    if (!config?.pluginId) throw new Error('createPluginApp: pluginId obavezan');
    let ctx = null;
    const hooks = {};

    function lifecycle(nextHooks) {
      Object.assign(hooks, nextHooks || {});
    }

    function register() {
      const tabId = trim(config.tabId || config.pluginId);
      if (!QNC.tabs?.register) throw new Error('QNC.tabs.register nije dostupan');

      QNC.tabs.register({
        id: tabId,
        init: async () => {
          ctx = buildContext(config);
          if (typeof hooks.onInit === 'function') await hooks.onInit(ctx);
        },
        onShow: async () => {
          if (!ctx) ctx = buildContext(config);
          await ctx.store.refreshInvalidated();
          if (typeof hooks.onShow === 'function') await hooks.onShow(ctx);
        },
        onHide: () => {
          if (typeof hooks.onHide === 'function') hooks.onHide(ctx);
        },
        destroy: () => {
          if (typeof hooks.onDestroy === 'function') hooks.onDestroy(ctx);
          ctx?.teardown();
          ctx = null;
        },
      });
    }

    return {
      lifecycle,
      register,
      get ctx() {
        return ctx;
      },
    };
  }

  QNC.PluginSDK = { version: SDK_VERSION };
  QNC.createPluginApp = createPluginApp;
})(window.QNC);
