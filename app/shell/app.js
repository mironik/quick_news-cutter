/* QNC v2 bootstrap — shell + tab stranice (učitaj / zatvori, bez stalnog držanja u memoriji). */
(function () {
  function trackAsset(session, id) {
    if (session && id && !session.assetIds.includes(id)) session.assetIds.push(id);
  }

  function trackComponent(session, componentId) {
    if (session && componentId && !session.componentIds.includes(componentId)) {
      session.componentIds.push(componentId);
    }
  }

  function assetPathSlug(assetPath) {
    return String(assetPath || '')
      .replace(/^\/+/, '')
      .replace(/[^\w-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(-96);
  }

  function componentAssetDomId(prefix, componentId, assetPath) {
    const cid = String(componentId || 'unknown').replace(/[^\w-]+/g, '_');
    const slug = assetPathSlug(assetPath);
    return prefix + cid + (slug ? '--' + slug : '');
  }

  function loadCss(href, id, session) {
    return new Promise((resolve, reject) => {
      if (!href) return resolve();
      const linkId = id || 'qnc-css-' + href.replace(/[^\w-]+/g, '_');
      trackAsset(session, linkId);
      const existing = document.getElementById(linkId);
      if (existing) {
        const current = existing.dataset.qncHref || existing.getAttribute('href') || '';
        if (current === href) return resolve();
        existing.remove();
      }
      const link = document.createElement('link');
      link.id = linkId;
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.qncHref = href;
      link.dataset.qncTabAsset = session?.tabId || '';
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const fail = () => {
        if (settled) return;
        settled = true;
        reject(new Error('CSS nije ucitan: ' + href));
      };
      link.onload = finish;
      link.onerror = fail;
      document.head.appendChild(link);
      if (link.sheet) finish();
    });
  }

  function loadScript(src, id, session) {
    return new Promise((resolve, reject) => {
      if (!src) return resolve();
      const scriptId = id || 'qnc-js-' + src.replace(/[^\w-]+/g, '_');
      trackAsset(session, scriptId);
      const existing = document.getElementById(scriptId);
      if (existing) {
        const current = existing.dataset.qncSrc || existing.getAttribute('src') || '';
        if (current === src) return resolve();
        existing.remove();
      }
      const script = document.createElement('script');
      script.id = scriptId;
      script.src = src;
      script.defer = false;
      script.dataset.qncSrc = src;
      script.dataset.qncTabAsset = session?.tabId || '';
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const fail = () => {
        if (settled) return;
        settled = true;
        reject(new Error('JS nije ucitan: ' + src));
      };
      script.onload = finish;
      script.onerror = fail;
      document.body.appendChild(script);
    });
  }

  function assetUrl(plugin, path) {
    if (!path) return path;
    const version = plugin?.asset_version || plugin?.version || '';
    if (!version) return path;
    return path + (path.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(version);
  }

  const pluginComponentById = new Map();
  const globalComponentById = new Map();

  function registerPluginComponents(plugins) {
    pluginComponentById.clear();
    plugins.forEach((plugin) => {
      (plugin.components || []).forEach((component) => {
        const id = component.component_id || '';
        if (id) pluginComponentById.set(id, { plugin, component, scope: 'plugin' });
      });
    });
  }

  function registerGlobalComponents(catalog) {
    globalComponentById.clear();
    const items = catalog?.components || {};
    Object.entries(items).forEach(([globalId, meta]) => {
      globalComponentById.set(globalId, {
        component: meta,
        plugin: { asset_version: meta.version || '1' },
        scope: 'global',
      });
    });
  }

  function componentEntryByPath(path) {
    if (!path) return null;
    for (const [, entry] of globalComponentById) {
      if ((entry.component.path || '') === path) return entry;
    }
    for (const [, entry] of pluginComponentById) {
      if ((entry.component.path || '') === path) return entry;
    }
    return null;
  }

  function componentEntryFor(node) {
    const id = node.getAttribute('data-qnc-component') || '';
    if (!id) return null;
    return globalComponentById.get(id) || pluginComponentById.get(id) || null;
  }

  function componentPathFor(node, entry) {
    const variant = node.getAttribute('data-qnc-variant') || '';
    const component = entry?.component || {};
    const variants = component.variants || {};
    if (variant && variants[variant]) return variants[variant];
    return component.path || '';
  }

  function componentGlobalId(entry) {
    return entry?.component?.global_id || entry?.component?.component_id || '';
  }

  async function loadComponentAssets(entry, session) {
    if (!entry) return;
    trackComponent(session, componentGlobalId(entry));
    const assets = entry.component.assets || {};
    const cssFiles = Array.isArray(assets.css) ? assets.css : [];
    const version = entry.component.version || entry.plugin?.asset_version || '';
    const cid = componentGlobalId(entry) || 'component';
    await Promise.all(
      cssFiles.map((href) => {
        const url = href + (version ? (href.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(version) : '');
        return loadCss(url, componentAssetDomId('qnc-component-css-', cid, href), session);
      })
    );
  }

  async function loadComponentScripts(entry, session) {
    if (!entry) return;
    trackComponent(session, componentGlobalId(entry));
    const jsFiles = Array.isArray(entry.component.assets?.js) ? entry.component.assets.js : [];
    if (!jsFiles.length) return;
    const version = entry.component.version || entry.plugin?.asset_version || '1';
    const cid = componentGlobalId(entry) || 'component';
    for (const src of jsFiles) {
      const url = src + (src.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(version);
      await loadScript(url, componentAssetDomId('qnc-component-js-', cid, src), session);
    }
  }

  async function loadCoreServiceComponents() {
    const session = { tabId: 'core', assetIds: [], componentIds: [] };
    for (const [, entry] of globalComponentById) {
      const kind = String(entry.component?.kind || '').toLowerCase();
      const source = String(entry.component?.source_plugin_id || '').toLowerCase();
      if (kind !== 'service' || source !== 'core') continue;
      await loadComponentScripts(entry, session);
    }
  }

  async function preloadPluginComponents(plugin, session) {
    const ids = Array.isArray(plugin?.uses_components) ? plugin.uses_components : [];
    await Promise.all(
      ids.map(async (id) => {
        trackComponent(session, id);
        const entry = globalComponentById.get(id);
        if (!entry) return;
        await loadComponentAssets(entry, session);
        await loadComponentScripts(entry, session);
      })
    );
  }

  function pluginPanelId(plugin) {
    return String(plugin.panel_id || 'panel-' + (plugin.tab_id || plugin.plugin_id || '')).trim();
  }

  function pluginTabId(plugin) {
    return String(plugin.tab_id || plugin.plugin_id || '').trim();
  }

  function pluginSlot(host, tabId) {
    return host?.querySelector?.('[data-plugin-slot="' + tabId + '"]') || null;
  }

  function ensurePluginSlots(plugins) {
    const host = document.getElementById('qnc-plugin-panels');
    if (!host) return;
    (plugins || []).forEach((plugin) => {
      const tabId = pluginTabId(plugin);
      if (!tabId || pluginSlot(host, tabId)) return;
      const slot = document.createElement('div');
      slot.className = 'qnc-plugin-slot';
      slot.dataset.pluginSlot = tabId;
      host.appendChild(slot);
    });
  }

  function isPluginPanelMounted(plugin) {
    const tabId = pluginTabId(plugin);
    const host = document.getElementById('qnc-plugin-panels');
    const slot = host ? pluginSlot(host, tabId) : null;
    if (slot?.querySelector?.('.tab-panel')) return true;
    const panelId = pluginPanelId(plugin);
    if (panelId && document.getElementById(panelId)) return true;
    return false;
  }

  function removePluginPanels(plugin) {
    const host = document.getElementById('qnc-plugin-panels');
    if (!host || !plugin) return;
    const tabId = pluginTabId(plugin);
    const slot = pluginSlot(host, tabId);
    if (slot) slot.innerHTML = '';
    const panelId = pluginPanelId(plugin);
    const byId = panelId ? document.getElementById(panelId) : null;
    if (byId && byId.parentElement) byId.remove();
  }

  async function loadPanel(plugin, session) {
    if (isPluginPanelMounted(plugin)) return;
    const host = document.getElementById('qnc-plugin-panels');
    if (!host) throw new Error('Nema qnc-plugin-panels hosta');
    const tabId = pluginTabId(plugin);
    const slot = pluginSlot(host, tabId);
    if (!slot) throw new Error('Nema plug slot za tab: ' + tabId);
    const url = plugin.panel_html;
    if (!url) throw new Error('Plugin nema panel_html: ' + plugin.plugin_id);
    const panelComponent = componentEntryByPath(url);
    if (panelComponent) await loadComponentAssets(panelComponent, session);
    await preloadPluginComponents(plugin, session);
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('Panel nije ucitan: ' + url);
    const html = await res.text();
    const tpl = document.createElement('template');
    tpl.innerHTML = html.trim();
    slot.appendChild(tpl.content.cloneNode(true));
    const panelRoot = slot.querySelector('.tab-panel') || slot.lastElementChild;
    applyPluginPanelMeta(panelRoot, plugin);
    await resolveComponents(panelRoot, session);
  }

  function applyPluginPanelMeta(panelRoot, plugin) {
    if (!panelRoot) return;
    const panelId = pluginPanelId(plugin);
    const panelClass = pluginTabId(plugin) + '-panel';
    const tabId = pluginTabId(plugin);
    if (panelRoot.classList.contains('tab-panel')) {
      panelRoot.id = panelId;
      if (panelClass && panelClass !== '-panel') panelRoot.classList.add(panelClass);
      panelRoot.dataset.qncPluginId = plugin.plugin_id || '';
      panelRoot.dataset.tabId = tabId;
    }
  }

  async function resolveComponents(root, session) {
    if (!root) return;
    const maxPasses = 32;
    let passes = 0;
    let nodes = Array.from(root.querySelectorAll('[data-qnc-component]'));
    while (nodes.length) {
      passes += 1;
      if (passes > maxPasses) {
        const stuck = nodes.map((n) => n.getAttribute('data-qnc-component') || '?').join(', ');
        throw new Error('resolveComponents: unresolved component nodes: ' + stuck);
      }
      const beforeKey = nodes
        .map((n) => (n.getAttribute('data-qnc-component') || '?') + '@' + (n.getAttribute('data-qnc-variant') || ''))
        .sort()
        .join('|');
      await Promise.all(
        nodes.map(async (node) => {
          const compId = node.getAttribute('data-qnc-component') || '';
          if (!compId) throw new Error('resolveComponents: empty data-qnc-component');
          const entry = componentEntryFor(node);
          const url = componentPathFor(node, entry);
          if (!entry || !url) {
            throw new Error('resolveComponents: unknown component "' + compId + '"');
          }
          await loadComponentAssets(entry, session);
          await loadComponentScripts(entry, session);
          const res = await fetch(url, { cache: 'no-store' });
          if (!res.ok) throw new Error('Komponenta nije ucitana: ' + url);
          const html = await res.text();
          const tpl = document.createElement('template');
          tpl.innerHTML = html.trim();
          node.replaceWith(tpl.content.cloneNode(true));
        })
      );
      nodes = Array.from(root.querySelectorAll('[data-qnc-component]'));
      const afterKey = nodes
        .map((n) => (n.getAttribute('data-qnc-component') || '?') + '@' + (n.getAttribute('data-qnc-variant') || ''))
        .sort()
        .join('|');
      if (nodes.length && afterKey === beforeKey) {
        throw new Error('resolveComponents: no progress resolving: ' + beforeKey);
      }
    }
  }

  async function initPluginModule(tabId) {
    if (!window.QNC?.tabs?.get) return;
    const mod = QNC.tabs.get(tabId);
    if (!mod || mod._qncReady) return;
    mod._qncReady = true;
    if (typeof mod.init === 'function') await mod.init();
  }

  async function loadPluginAssets(plugin) {
    const tabId = pluginTabId(plugin);
    const session = { tabId, pluginId: plugin.plugin_id, assetIds: [], componentIds: [] };
    pluginLoader.sessions.set(tabId, session);
    await loadPanel(plugin, session);
    await loadCss(assetUrl(plugin, plugin.entry_css), 'qnc-plugin-css-' + plugin.plugin_id, session);
    if (plugin.entry_js) {
      await loadScript(assetUrl(plugin, plugin.entry_js), 'qnc-plugin-js-' + plugin.plugin_id, session);
    }
    await initPluginModule(tabId);
  }

  function pluginKeepsAlive(plugin) {
    return !!(plugin?.keep_alive || plugin?.background || plugin?.tab_lifecycle === 'resident');
  }

  const pluginLoader = {
    manifests: new Map(),
    loaded: new Set(),
    inflight: new Map(),
    sessions: new Map(),

    registerAll(plugins) {
      this.manifests.clear();
      (plugins || []).forEach((plugin) => {
        const id = pluginTabId(plugin);
        if (id) this.manifests.set(id, plugin);
      });
    },

    manifest(tabId) {
      return this.manifests.get(String(tabId || '').trim()) || null;
    },

    isLoaded(tabId) {
      return this.loaded.has(String(tabId || '').trim());
    },

    async ensure(tabId) {
      const id = String(tabId || '').trim();
      if (!id || this.loaded.has(id)) return;
      if (this.inflight.has(id)) return this.inflight.get(id);
      const plugin = this.manifests.get(id);
      if (!plugin) return;
      const job = loadPluginAssets(plugin)
        .then(() => {
          this.loaded.add(id);
        })
        .finally(() => {
          this.inflight.delete(id);
        });
      this.inflight.set(id, job);
      return job;
    },

    /** Zatvori tab-stranicu: DOM, asseti, bus, komponente (osim keep_alive / background). */
    async release(tabId) {
      const id = String(tabId || '').trim();
      if (!id) return;
      const plugin = this.manifests.get(id);
      if (plugin && pluginKeepsAlive(plugin)) return;

      this.inflight.delete(id);

      const mod = window.QNC?.tabs?.get?.(id);
      if (mod) {
        if (typeof mod.destroy === 'function') {
          try {
            await mod.destroy();
          } catch (e) {
            console.warn('[QNC] destroy tab', id, e);
          }
        }
        delete mod._qncReady;
        window.QNC.tabs.unregister?.(id);
      }

      const busId = plugin?.plugin_id || id;
      window.QNC?.componentBus?.offPlugin?.(busId);

      const session = this.sessions.get(id);
      if (session) {
        session.assetIds.forEach((assetId) => {
          document.getElementById(assetId)?.remove();
        });
        session.componentIds.forEach((cid) => {
          window.QNC?.components?.unregister?.(cid);
        });
        this.sessions.delete(id);
      }

      document.querySelectorAll('[data-qnc-tab-asset="' + id + '"]').forEach((el) => el.remove());

      if (plugin) removePluginPanels(plugin);

      if (id === 'design-tools') {
        delete window.QNCDesignTools;
        delete window.QNCDesignOverlay;
      }
      if (id === 'project') {
        delete window.QNC.project;
      }
      if (id === 'ingest') {
        delete window.QNC.ingest;
      }

      this.loaded.delete(id);
    },
  };

  function filterCapabilityTabs(plugins, runtime) {
    const caps = runtime?.capabilities || {};
    return (plugins || []).filter((plugin) => {
      const required = String(plugin.requires_capability || '').trim();
      if (!required) return true;
      const block = caps[required];
      if (block == null) return true;
      if (typeof block === 'object') return block.available !== false;
      return !!block;
    });
  }

  async function installWorkflowBoot() {
    if (!QNC.bus || QNC._workflowBootInstalled) return;
    QNC._workflowBootInstalled = true;
    QNC.openProjectWorkflow = openWorkflowAfterProject;
    QNC.applyWorkspaceFooterOnly = applyWorkspaceFooterOnly;
    QNC.bus.on('project:opened', (payload) => {
      Promise.resolve(openWorkflowAfterProject(payload)).catch((e) => {
        QNC.setBox?.('Workflow: ' + (e.message || e), 'err');
      });
    });
  }

  async function openWorkflowAfterProject(payload) {
    const projectId = payload?.projectId || QNC.getProjectId?.() || '';
    if (!projectId) return;
    QNC.setActiveProjectId?.(projectId);
    const d = await QNC.api(
      'GET',
      '/api/projects/' + encodeURIComponent(projectId) + '/workspace'
    );
    const workspace = d.workspace || {};
    QNC.shell?.applyWorkspace?.(workspace);
    const entry = QNC.shell?.workflowEntryTab?.(workspace) || '';
    if (entry) {
      if (QNC.pluginLoader?.ensure) await QNC.pluginLoader.ensure(entry);
      await QNC.switchTab?.(entry);
    }
    QNC.bus?.emit('project:changed', { projectId });
  }

  async function applyWorkspaceFooterOnly(projectId) {
    if (!projectId) {
      QNC.shell?.showProjectOnly?.();
      return;
    }
    const d = await QNC.api(
      'GET',
      '/api/projects/' + encodeURIComponent(projectId) + '/workspace'
    );
    QNC.shell?.applyWorkspace?.(d.workspace || {});
    await QNC.switchTab?.('project');
  }

  async function syncActiveProjectFromApi() {
    try {
      const d = await QNC.api('GET', '/api/projects');
      QNC.setActiveProjectId?.(d.active_project_id || '');
    } catch (_) {
      QNC.setActiveProjectId?.('');
    }
  }

  async function boot() {
    if (!window.QNC) {
      console.error('qnc-core.js nije ucitan');
      return;
    }
    QNC.resolveComponents = (root, session) => resolveComponents(root, session);
    QNC.pluginLoader = pluginLoader;
    if (QNC.ensureShell) QNC.ensureShell();

    const [tabsRes, componentsRes, runtimeRes] = await Promise.all([
      QNC.api('GET', '/api/shell/tabs'),
      fetch('/api/shell/components', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/shell/runtime', { cache: 'no-store' }).then((r) => r.json()),
    ]);

    QNC.runtime = runtimeRes;
    QNC.NETWORK_PRESETS = runtimeRes.network_presets || [];
    QNC.API_PORT = String(runtimeRes.api_port || location.port || '8001');
    QNC.SERVER_LABEL = (runtimeRes.labels && runtimeRes.labels.server) || 'QNC server';

    registerGlobalComponents(componentsRes);
    await loadCoreServiceComponents();
    const plugins = filterCapabilityTabs(tabsRes.tabs || [], runtimeRes);
    registerPluginComponents(plugins);
    pluginLoader.registerAll(plugins);

    await syncActiveProjectFromApi();
    if (QNC.keyboardShortcuts?.applyForActiveProject) {
      await QNC.keyboardShortcuts.applyForActiveProject().catch(() => {});
    }

    if (QNC.shell) QNC.shell.installTabs(plugins, { deferRender: true });
    ensurePluginSlots(plugins);
    await installWorkflowBoot();
    QNC.shell?.showProjectOnly?.();
    QNC.initServerHostCombo();
    QNC.initProcessLog();
    QNC.bindTabs();
    await QNC.refreshHealth();
    await QNC.refreshClient();
    if (QNC.pluginLoader?.ensure) {
      await QNC.pluginLoader.ensure('project');
    }
    await QNC.switchTab?.('project');
    setInterval(QNC.refreshHealth, 5000);
    QNC.setBox('QNC v2 spreman.', 'ok');
  }

  boot().catch((e) => {
    if (window.QNC && QNC.setBox) QNC.setBox('Init v2: ' + e.message, 'err');
    else console.error(e);
  });
})();
