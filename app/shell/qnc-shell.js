/* QNC Shell - offline zajednicka ljuska bez poslovne logike tabova.
   Plain JS only. No remote runtime dependency. */
window.QNC = window.QNC || {};

(function (QNC) {
  const lockedFirst = new Set(["project"]);
  const lockedLast = new Set(["preview", "export"]);
  let availableTabs = [];
  let activeTabs = [];

  function normalizeTab(def) {
    return {
      tab_id: String(def.tab_id || def.id || "").trim(),
      label: String(def.label || def.title || def.tab_id || def.id || "").trim(),
      priority: Number.isFinite(Number(def.priority)) ? Number(def.priority) : 0,
      position: def.position || "normal",
      panel_id: def.panel_id || "panel-" + (def.tab_id || def.id),
      enabled: def.enabled !== false,
      system: !!def.system,
      removable: def.removable !== false,
      entry_js: def.entry_js || "",
      entry_css: def.entry_css || "",
    };
  }

  function sortTabs(tabs, manualOrder) {
    const manual = Array.isArray(manualOrder) ? manualOrder : [];
    const manualIndex = new Map(manual.map((id, index) => [id, index]));
    return tabs.slice().sort((a, b) => {
      if (a.position === "first" || lockedFirst.has(a.tab_id)) return -1;
      if (b.position === "first" || lockedFirst.has(b.tab_id)) return 1;
      if (a.position === "last" || lockedLast.has(a.tab_id)) return 1;
      if (b.position === "last" || lockedLast.has(b.tab_id)) return -1;
      const ai = manualIndex.has(a.tab_id) ? manualIndex.get(a.tab_id) : null;
      const bi = manualIndex.has(b.tab_id) ? manualIndex.get(b.tab_id) : null;
      if (ai !== null && bi !== null && ai !== bi) return ai - bi;
      if (ai !== null) return -1;
      if (bi !== null) return 1;
      return a.priority - b.priority || a.label.localeCompare(b.label);
    });
  }

  /** Legacy DB workspace tab id → registered shell plugin tab id (read-only alias). */
  function resolveWorkspaceTabId(raw) {
    const id = String(raw || "").trim();
    if (!id) return "";
    if (id === "ingest_proxy") return "ingest";
    return id;
  }

  function registeredTabId(raw) {
    const id = resolveWorkspaceTabId(raw);
    if (!id) return "";
    return availableTabs.some((t) => t.tab_id === id && t.enabled) ? id : "";
  }

  /** Redoslijed tabova iz SQLite workspace (steps + tabs), bez DOM-a. */
  function dbWorkflowTabIds(workspace) {
    const out = [];
    const push = (raw) => {
      const id = resolveWorkspaceTabId(raw);
      if (!id || id === "project" || out.includes(id)) return;
      out.push(id);
    };
    const steps = Array.isArray(workspace?.steps) ? workspace.steps.slice() : [];
    steps.sort((a, b) => Number(a?.position || 0) - Number(b?.position || 0));
    const activeStepId = String(workspace?.active_step_id || workspace?.entry_step_id || "").trim();
    if (activeStepId) {
      const step = steps.find((item) => String(item?.step_id || "") === activeStepId);
      push(step?.tab_id);
    }
    steps
      .filter((item) => String(item?.status || "") === "active")
      .forEach((item) => push(item?.tab_id));
    steps.forEach((item) => push(item?.tab_id));
    (Array.isArray(workspace?.tabs) ? workspace.tabs : []).forEach((raw) => push(raw));
    return out;
  }

  function footerHasTab(tabId) {
    const id = resolveWorkspaceTabId(tabId);
    if (!id) return false;
    return activeTabs.some((t) => t.tab_id === id && t.enabled);
  }

  function workflowTabsOpen() {
    return activeTabs.some((t) => t.tab_id !== "project" && t.enabled);
  }

  function renderFooterTabs(tabs) {
    const host = document.querySelector(".qtab-footer-tabs");
    if (!host) return;
    const active = QNC.getActiveTab ? QNC.getActiveTab() : "project";
    host.innerHTML = tabs
      .filter((tab) => tab.enabled)
      .map(
        (tab) =>
          '<button type="button" class="qtab' +
          (tab.tab_id === active ? " active" : "") +
          '" data-tab="' +
          QNC.esc(tab.tab_id) +
          '">' +
          QNC.esc(tab.label) +
          "</button>"
      )
      .join("");
    if (QNC.bindTabButtons) QNC.bindTabButtons();
  }

  QNC.shell = {
    normalizeTab,
    sortTabs,
    renderFooterTabs,

    installTabs(defs, options) {
      availableTabs = (defs || []).map(normalizeTab).filter((tab) => tab.tab_id && tab.enabled);
      if (options?.deferRender) {
        return availableTabs.slice();
      }
      const tabs = options && Array.isArray(options.onlyTabs)
        ? filterWorkspaceTabs(availableTabs, options.onlyTabs, options.tabLabels)
        : availableTabs;
      const sorted = sortTabs(tabs, options && options.manualOrder);
      activeTabs = sorted;
      renderFooterTabs(sorted);
      return sorted;
    },

    applyWorkspace(workspace) {
      const tabs = workspace && Array.isArray(workspace.tabs) && workspace.tabs.length
        ? filterWorkspaceTabs(availableTabs, workspace.tabs, workspace.tab_labels || workspace.tabLabels)
        : availableTabs;
      const sorted = sortTabs(
        tabs,
        (workspace?.tabs || []).map((id) => resolveWorkspaceTabId(id))
      );
      activeTabs = sorted;
      renderFooterTabs(sorted);
      const active = QNC.getActiveTab ? QNC.getActiveTab() : "project";
      if (!sorted.some((tab) => tab.tab_id === active) && QNC.switchTab) {
        QNC.switchTab("project");
      }
      return sorted;
    },

    showProjectOnly() {
      const tabs = filterWorkspaceTabs(availableTabs, ["project"]);
      activeTabs = tabs;
      renderFooterTabs(tabs);
      if (QNC.switchTab) QNC.switchTab("project");
      return tabs;
    },

    footerHasTab(tabId) {
      return footerHasTab(tabId);
    },

    workflowTabsOpen() {
      return workflowTabsOpen();
    },

    availableTabs() {
      return availableTabs.slice();
    },

    activeTabs() {
      return activeTabs.slice();
    },

    nextTab(fromTab) {
      const current = String(fromTab || (QNC.getActiveTab ? QNC.getActiveTab() : "") || "").trim();
      const visible = activeTabs.filter((tab) => tab.enabled);
      const index = visible.findIndex((tab) => tab.tab_id === current);
      const next = index >= 0 ? visible[index + 1] : null;
      return next ? next.tab_id : "";
    },

    /** Prvi workflow tab iz SQLite workspace (ne ovisi o trenutnom footer DOM-u). */
    workflowEntryTab(workspace) {
      for (const raw of dbWorkflowTabIds(workspace)) {
        const id = registeredTabId(raw);
        if (id && id !== "project") return id;
      }
      return "";
    },
  };

  function filterWorkspaceTabs(tabs, ids, labels) {
    const labelMap = labels && typeof labels === "object" ? labels : {};
    const byId = new Map(tabs.map((tab) => [tab.tab_id, tab]));
    const order = ["project"].concat(
      (ids || []).map((id) => resolveWorkspaceTabId(id)).filter(Boolean)
    );
    const seen = new Set();
    const out = [];
    for (const id of order) {
      if (seen.has(id)) continue;
      seen.add(id);
      const tab = byId.get(id);
      if (!tab) continue;
      const copy = { ...tab };
      const label =
        labelMap[copy.tab_id] ||
        (copy.tab_id === "ingest" ? labelMap.ingest_proxy : "");
      if (label) copy.label = String(label);
      out.push(copy);
    }
    return out;
  }
})(window.QNC);
