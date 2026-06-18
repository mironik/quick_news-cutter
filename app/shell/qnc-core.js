/* Zajednički shell — API, status, tabovi, mreža (bez ingest/pool logike) */
window.QNC = window.QNC || {};

(function (QNC) {
  QNC.NETWORK_PRESETS = [];
  QNC.API_PORT = location.port || '8001';
  QNC.SERVER_LABEL = 'QNC server';
  QNC.runtime = null;

  QNC.serverHostEl = () => QNC.$('#qnc-server-host') || QNC.$('#jetson-host');

  QNC.setServerLinkState = (state, title) => {
    const sel = QNC.serverHostEl();
    if (!sel) return;
    sel.classList.remove('online', 'offline', 'busy');
    if (state) sel.classList.add(state);
    sel.title = title || QNC.SERVER_LABEL || 'QNC server';
  };

  QNC.setJetsonLinkState = QNC.setServerLinkState;

  QNC.initServerHostCombo = () => {
    const sel = QNC.serverHostEl();
    if (!sel) return;
    const presets = Array.isArray(QNC.NETWORK_PRESETS) ? QNC.NETWORK_PRESETS : [];
    const cur = location.hostname;
    let found = false;
    sel.innerHTML = '';
    presets.forEach((p) => {
      const o = document.createElement('option');
      o.value = p.host;
      o.textContent = p.label;
      if (p.host === cur) {
        o.selected = true;
        found = true;
      }
      sel.appendChild(o);
    });
    if (!found && cur) {
      const o = document.createElement('option');
      o.value = cur;
      o.textContent = cur;
      o.selected = true;
      sel.insertBefore(o, sel.firstChild);
    }
    QNC.setServerLinkState('busy', 'Provjera veze…');
    QNC.bindChange('#qnc-server-host', () => {
      const h = sel.value;
      const port = QNC.API_PORT || location.port || '8001';
      if (h && h !== location.hostname) {
        window.location.href = location.protocol + '//' + h + ':' + port + '/app';
      }
    });
  };

  QNC.initJetsonCombo = QNC.initServerHostCombo;

  QNC.refreshHealth = async () => {
    const sel = QNC.serverHostEl();
    try {
      const h = await QNC.api('GET', '/api/health', undefined, 5000);
      const ok = h.status === 'ok';
      const label = sel?.selectedOptions?.[0]?.textContent || location.hostname;
      QNC.setServerLinkState(
        ok ? 'online' : 'offline',
        ok ? label + ' — online' : label + ' — offline'
      );
    } catch (e) {
      const label = sel?.selectedOptions?.[0]?.textContent || location.host;
      QNC.setServerLinkState('offline', label + ' — nema veze (' + (e.message || 'offline') + ')');
    }
  };

  QNC.clientIp = '';
  /** Projection of `active_project_id` from API — not a separate source of truth. */
  QNC.activeProjectId = '';

  QNC.getProjectId = () => QNC.activeProjectId || '';

  /** Sync shell context after API returns active_project_id (project tab / boot). */
  QNC.setActiveProjectId = (id) => {
    QNC.activeProjectId = id ? String(id).trim() : '';
  };

  QNC.$ = (s) => document.querySelector(s);

  QNC.esc = (s) => {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  };

  QNC.shellState = { msg: 'Spreman.', kind: 'ok', byTab: {}, byTabMsg: {} };

  QNC.getActiveTab = () => {
    const b = document.querySelector('.qtab.active');
    return b ? b.dataset.tab : 'project';
  };

  QNC.setShellSelection = (tab, selected, total, extra) => {
    QNC.shellState.byTab[tab] = { selected, total, extra: extra || '' };
    QNC.paintShell();
  };

  QNC.paintShell = () => {
    const { msg, kind, byTab, byTabMsg } = QNC.shellState;
    const active = QNC.getActiveTab();
    document.querySelectorAll('.tab-status').forEach((box) => {
      const tab = box.dataset.tab;
      const s = byTab[tab];
      const tabMsg = byTabMsg[tab] || 'Spreman.';
      const parts = [tabMsg];
      if (s && s.total !== undefined) {
        parts.push(s.selected + ' / ' + s.total + ' odabrano');
      }
      if (s && s.extra) parts.push(s.extra);
      box.textContent = parts.join(' · ');
      box.className =
        'tab-status shell-status ' + (tab === active ? kind || 'muted' : 'muted');
    });
    QNC.shellState.msg = byTabMsg[active] || msg;
  };

  QNC.setBox = (msg, kind) => {
    const tab = QNC.getActiveTab();
    QNC.shellState.msg = msg;
    QNC.shellState.kind = kind || 'muted';
    QNC.shellState.byTabMsg[tab] = msg;
    QNC.paintShell();
  };

  QNC.logLines = [];

  QNC.renderLogModal = () => {
    const el = QNC.$('#log-modal-body');
    if (!el) return;
    el.innerHTML = QNC.logLines
      .map((row) => {
        const cls = row.cls ? ' class="' + row.cls + '"' : '';
        return '<div' + cls + '><span class="log-ts">' + QNC.esc(row.ts) + '</span> ' + QNC.esc(row.msg) + '</div>';
      })
      .join('');
  };

  QNC.log = (msg, cls) => {
    const ts = new Date().toLocaleTimeString('hr-HR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    QNC.logLines.unshift({ msg: String(msg), cls: cls || '', ts });
    if (QNC.logLines.length > 400) QNC.logLines.length = 400;
    QNC.renderLogModal();
  };

  QNC.openLogModal = () => {
    const modal = QNC.$('#log-modal');
    if (!modal) return;
    QNC.renderLogModal();
    modal.hidden = false;
    document.body.classList.add('log-modal-open');
  };

  QNC.closeLogModal = () => {
    const modal = QNC.$('#log-modal');
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove('log-modal-open');
  };

  QNC.initProcessLog = () => {
    document.querySelectorAll('.select-bar').forEach((bar) => {
      if (bar.querySelector('.btn-process-log')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'qbtn btn-process-log';
      btn.textContent = 'Process log';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        QNC.openLogModal();
      });
      bar.appendChild(btn);
    });
    document.querySelectorAll('[data-log-close]').forEach((el) => {
      el.addEventListener('click', QNC.closeLogModal);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') QNC.closeLogModal();
    });
  };

  QNC.api = async (method, path, body, timeoutMs) => {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const ctrl = timeoutMs ? new AbortController() : null;
    if (ctrl) setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(path, ctrl ? { ...opts, signal: ctrl.signal } : opts);
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text };
    }
    if (!res.ok) {
      const d = data.detail || data;
      const msg = typeof d === 'object' ? (d.message || JSON.stringify(d)) : String(d);
      throw new Error(msg);
    }
    return data;
  };

  QNC.bindClick = (sel, fn) => {
    const el = QNC.$(sel);
    if (el) el.onclick = fn;
  };

  QNC.bindChange = (sel, fn) => {
    const el = QNC.$(sel);
    if (el) el.onchange = fn;
  };

  QNC.componentBus = QNC.componentBus || {
    handlers: {},
    on(pluginId, eventName, handler) {
      const key = String(pluginId || '') + ':' + String(eventName || '');
      this.handlers[key] = this.handlers[key] || [];
      this.handlers[key].push(handler);
      return () => {
        this.handlers[key] = (this.handlers[key] || []).filter((item) => item !== handler);
      };
    },
    async emit(pluginId, eventName, payload) {
      const key = String(pluginId || '') + ':' + String(eventName || '');
      const handlers = this.handlers[key] || [];
      for (const handler of handlers) {
        await handler(payload || {});
      }
    },
    offPlugin(pluginId) {
      const prefix = String(pluginId || '').trim() + ':';
      if (!prefix || prefix === ':') return;
      Object.keys(this.handlers).forEach((key) => {
        if (key.startsWith(prefix)) delete this.handlers[key];
      });
    },
  };

  /** Registry runtime API-ja komponenti (component.js → register, orchestrator → get). */
  QNC.components = QNC.components || {
    _entries: Object.create(null),
    register(componentId, api) {
      const id = String(componentId || '').trim();
      if (!id || !api) return;
      this._entries[id] = api;
    },
    get(componentId) {
      return this._entries[String(componentId || '').trim()] || null;
    },
    unregister(componentId) {
      const id = String(componentId || '').trim();
      if (id) delete this._entries[id];
    },
  };

  QNC.emitComponent = (pluginId, componentId, action, payload, meta = {}) => {
    return QNC.componentBus.emit(pluginId, action, {
      component_id: componentId,
      action,
      payload: payload || {},
      root: meta.root || null,
      target: meta.target || null,
    });
  };

  QNC.componentRoot = (element) => {
    return element?.closest?.('[data-qnc-panel]') || null;
  };

  QNC.readComponentBinds = (root) => {
    const data = {};
    if (!root) return data;
    root.querySelectorAll('[data-qnc-bind]').forEach((el) => {
      const key = el.getAttribute('data-qnc-bind');
      if (!key) return;
      if (el.type === 'checkbox') data[key] = !!el.checked;
      else if (el.type === 'radio') {
        if (el.checked) data[key] = el.value;
      } else data[key] = el.value;
    });
    return data;
  };

  QNC.installComponentActions = (root, hostPluginId, options = {}) => {
    if (!root || !hostPluginId) return () => {};
    const eventName = options.event || 'click';
    const handler = (ev) => {
      const actionEl = ev.target?.closest?.('[data-qnc-action]');
      if (!actionEl || !root.contains(actionEl)) return;
      if (actionEl.closest('[disabled], [aria-disabled="true"]')) return;
      const action = actionEl.getAttribute('data-qnc-action');
      if (!action) return;
      const componentRoot = QNC.componentRoot(actionEl) || root;
      const componentId = componentRoot.getAttribute('data-qnc-panel') || '';
      const payload = {
        ref: actionEl.getAttribute('data-qnc-ref') || '',
        value: actionEl.type === 'checkbox' ? !!actionEl.checked : actionEl.value,
        checked: actionEl.type === 'checkbox' ? !!actionEl.checked : undefined,
        bind: QNC.readComponentBinds(componentRoot),
      };
      if (options.preventDefault !== false && actionEl.tagName !== 'INPUT') ev.preventDefault();
      QNC.emitComponent(hostPluginId, componentId, action, payload, {
        root: componentRoot,
        target: actionEl,
      });
    };
    root.addEventListener(eventName, handler);
    return () => root.removeEventListener(eventName, handler);
  };

  QNC.switchTab = (tabId) => {
    if (!tabId) return;
    document.querySelectorAll('.qtab').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === tabId);
    });
    const host = document.getElementById('qnc-plugin-panels');
    const panels = host
      ? host.querySelectorAll('.tab-panel[id^="panel-"]')
      : document.querySelectorAll('.tab-panel[id^="panel-"]');
    panels.forEach((p) => {
      const match = p.id === 'panel-' + tabId || p.dataset.tabId === tabId;
      p.classList.toggle('active', match);
    });
    const hash = '#/' + tabId;
    if (location.hash !== hash) {
      history.replaceState(null, '', hash);
    }
    QNC.paintShell();
  };

  QNC.ensureShell = () => {
    if (QNC.shell && typeof QNC.shell.applyWorkspace === 'function' && typeof QNC.shell.nextTab === 'function') {
      return QNC.shell;
    }
    let availableTabs = [];
    let activeTabs = [];
    const normalize = (def) => ({
      tab_id: String(def.tab_id || def.id || '').trim(),
      label: String(def.label || def.title || def.tab_id || def.id || '').trim(),
      priority: Number.isFinite(Number(def.priority)) ? Number(def.priority) : 0,
      position: def.position || 'normal',
      enabled: def.enabled !== false,
    });
    const sortTabs = (tabs, manualOrder) => {
      const manual = Array.isArray(manualOrder) ? manualOrder : [];
      const manualIndex = new Map(manual.map((id, index) => [id, index]));
      return tabs.slice().sort((a, b) => {
        if (a.tab_id === 'project') return -1;
        if (b.tab_id === 'project') return 1;
        if (a.position === 'last' || a.tab_id === 'preview' || a.tab_id === 'export') return 1;
        if (b.position === 'last' || b.tab_id === 'preview' || b.tab_id === 'export') return -1;
        const ai = manualIndex.has(a.tab_id) ? manualIndex.get(a.tab_id) : null;
        const bi = manualIndex.has(b.tab_id) ? manualIndex.get(b.tab_id) : null;
        if (ai !== null && bi !== null && ai !== bi) return ai - bi;
        if (ai !== null) return -1;
        if (bi !== null) return 1;
        return a.priority - b.priority || a.label.localeCompare(b.label);
      });
    };
    const renderFooterTabs = (tabs) => {
      const host = document.querySelector('.qtab-footer-tabs');
      if (!host) return;
      const active = QNC.getActiveTab ? QNC.getActiveTab() : 'project';
      host.innerHTML = tabs
        .filter((tab) => tab.enabled)
        .map((tab) => '<button type="button" class="qtab' + (tab.tab_id === active ? ' active' : '') + '" data-tab="' + QNC.esc(tab.tab_id) + '">' + QNC.esc(tab.label) + '</button>')
        .join('');
      if (QNC.bindTabs) QNC.bindTabs();
    };
    const filterWorkspaceTabs = (tabs, ids, labels) => {
      const labelMap = labels && typeof labels === 'object' ? labels : {};
      const byId = new Map(tabs.map((tab) => [tab.tab_id, tab]));
      const order = ['project'].concat(
        (ids || []).map((id) => String(id || '').trim()).filter(Boolean)
      );
      const seen = new Set();
      const out = [];
      for (const raw of order) {
        if (seen.has(raw)) continue;
        seen.add(raw);
        const tab = byId.get(raw);
        if (!tab) continue;
        const copy = { ...tab };
        if (labelMap[copy.tab_id]) copy.label = String(labelMap[copy.tab_id]);
        out.push(copy);
      }
      return out;
    };
    QNC.shell = {
      installTabs(defs, options) {
        availableTabs = (defs || []).map(normalize).filter((tab) => tab.tab_id && tab.enabled);
        activeTabs = sortTabs(options && Array.isArray(options.onlyTabs)
          ? filterWorkspaceTabs(availableTabs, options.onlyTabs, options.tabLabels)
          : availableTabs);
        renderFooterTabs(activeTabs);
        return activeTabs.slice();
      },
      applyWorkspace(workspace) {
        const tabs =
          workspace && Array.isArray(workspace.tabs) && workspace.tabs.length
            ? filterWorkspaceTabs(availableTabs, workspace.tabs, workspace.tab_labels || workspace.tabLabels)
            : availableTabs;
        activeTabs = sortTabs(tabs, workspace?.tabs);
        renderFooterTabs(activeTabs);
        return activeTabs.slice();
      },
      showProjectOnly() {
        activeTabs = filterWorkspaceTabs(availableTabs, ['project']);
        renderFooterTabs(activeTabs);
        if (QNC.switchTab) QNC.switchTab('project');
        return activeTabs.slice();
      },
      availableTabs() {
        return availableTabs.slice();
      },
      activeTabs() {
        return activeTabs.slice();
      },
      footerHasTab(tabId) {
        const id = String(tabId || '').trim();
        if (!id) return false;
        return activeTabs.some((tab) => tab.tab_id === id && tab.enabled);
      },
      nextTab(fromTab) {
        const current = String(fromTab || (QNC.getActiveTab ? QNC.getActiveTab() : '') || '').trim();
        const visible = activeTabs.length
          ? activeTabs.filter((tab) => tab.enabled)
          : Array.from(document.querySelectorAll('.qtab')).map((btn) => ({ tab_id: btn.dataset.tab, enabled: true }));
        const index = visible.findIndex((tab) => tab.tab_id === current);
        const next = index >= 0 ? visible[index + 1] : null;
        return next ? next.tab_id : '';
      },
      workflowEntryTab(workspace) {
        const steps = Array.isArray(workspace?.steps) ? workspace.steps : [];
        const activeStepId = String(workspace?.active_step_id || workspace?.entry_step_id || '').trim();
        if (activeStepId) {
          const step = steps.find((item) => String(item?.step_id || '') === activeStepId);
          const tabId = String(step?.tab_id || '').trim();
          if (tabId && tabId !== 'project') return tabId;
        }
        const entryStep = steps.find((item) => String(item?.status || '') === 'active');
        const entryTab = String(entryStep?.tab_id || '').trim();
        if (entryTab && entryTab !== 'project') return entryTab;
        const manual = Array.isArray(workspace?.tabs) ? workspace.tabs : [];
        for (const raw of manual) {
          const id = String(raw || '').trim();
          if (id && id !== 'project') return id;
        }
        return '';
      },
    };
    return QNC.shell;
  };

  QNC.nextTab = async (fromTab) => {
    const shell = QNC.ensureShell ? QNC.ensureShell() : QNC.shell;
    const next = shell?.nextTab?.(fromTab || QNC.getActiveTab());
    if (!next) return false;
    if (QNC.pluginLoader?.ensure) await QNC.pluginLoader.ensure(next);
    await QNC.switchTab(next);
    return true;
  };

  function shellFooterHasTab(tabId) {
    if (QNC.shell?.footerHasTab) return QNC.shell.footerHasTab(tabId);
    const id = String(tabId || '').trim();
    if (!id) return false;
    return (QNC.shell?.activeTabs?.() || []).some((t) => t.tab_id === id && t.enabled);
  }

  QNC.tabFromHash = () => {
    const id = (location.hash || '').replace(/^#\/?/, '').trim();
    const allowedAlways = new Set(['project', 'design-tools']);
    if (id && !allowedAlways.has(id) && !shellFooterHasTab(id)) {
      return 'project';
    }
    if (id && document.querySelector('.qtab[data-tab="' + id + '"]')) return id;
    return 'project';
  };

  QNC.bindTabButtons = () => {
    document.querySelectorAll('.qtab').forEach((btn) => {
      btn.onclick = () => {
        Promise.resolve(QNC.switchTab(btn.dataset.tab)).catch((e) => {
          QNC.setBox?.('Tab: ' + (e.message || e), 'err');
        });
      };
    });
  };

  QNC.bindTabs = () => {
    QNC.bindTabButtons();
    if (QNC._tabsHashBound) return;
    QNC._tabsHashBound = true;
    Promise.resolve(QNC.switchTab(QNC.tabFromHash())).catch((e) => {
      QNC.setBox?.('Tab: ' + (e.message || e), 'err');
    });
    window.addEventListener('hashchange', () => {
      Promise.resolve(QNC.switchTab(QNC.tabFromHash())).catch((e) => {
        QNC.setBox?.('Tab: ' + (e.message || e), 'err');
      });
    });
  };

  QNC.refreshClient = async () => {
    /* IP klijenta nije potreban u UI — edge ingest ga čita iz HTTP zahtjeva. */
  };

  /** Aktiviraj projekt na serveru — ostali tabovi učitavaju SAMO svoj dio kad se prikažu. */
  QNC.notifyProjectChanged = async (projectId) => {
    const pid =
      projectId !== undefined && projectId !== null
        ? String(projectId).trim()
        : QNC.getProjectId();
    if (!pid) {
      QNC.setActiveProjectId('');
      if (QNC.bus) QNC.bus.emit('project:changed', { projectId: '' });
      return;
    }
    QNC.setActiveProjectId(pid);
    await QNC.api('POST', '/api/projects/open', { project_id: pid });
    if (QNC.bus) QNC.bus.emit('project:changed', { projectId: pid });
  };
})(window.QNC);
