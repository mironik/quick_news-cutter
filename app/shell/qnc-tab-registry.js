/* Shell tabovi — stranica po tabu: učitaj pri prikazu, zatvori pri napuštanju. */
window.QNC = window.QNC || {};

(function (QNC) {
  const mods = new Map();
  let switchSeq = 0;

  QNC.tabs = {
    register(def) {
      if (!def?.id) throw new Error('tab.register: id obavezan');
      mods.set(def.id, def);
    },

    unregister(id) {
      mods.delete(String(id || '').trim());
    },

    get(id) {
      return mods.get(id);
    },

    onHide(tabId) {
      const mod = mods.get(tabId);
      if (mod && typeof mod.onHide === 'function') mod.onHide();
    },

    onShow(tabId) {
      const mod = mods.get(tabId);
      if (mod && typeof mod.onShow === 'function') mod.onShow();
    },

    panel(id) {
      return document.getElementById('panel-' + id);
    },

    $in(id, sel) {
      const p = QNC.tabs.panel(id);
      return p ? p.querySelector(sel) : null;
    },
  };

  const origSwitch = QNC.switchTab;

  function footerHasTabId(tabId) {
    if (typeof QNC.shell?.footerHasTab === 'function') return QNC.shell.footerHasTab(tabId);
    const id = String(tabId || '').trim();
    if (!id) return false;
    return (QNC.shell?.activeTabs?.() || []).some((t) => t.tab_id === id && t.enabled);
  }

  QNC.switchTab = async (tabId) => {
    if (!tabId) return;
    const allowedAlways = new Set(['project', 'design-tools']);
    if (!allowedAlways.has(tabId) && !footerHasTabId(tabId)) {
      QNC.setBox?.('Prvo otvori projekt na Project tabu.', 'err');
      tabId = 'project';
    }
    const seq = ++switchSeq;
    const prev = QNC.getActiveTab ? QNC.getActiveTab() : null;

    if (prev && prev !== tabId) {
      QNC.tabs.onHide(prev);
      if (QNC.pluginLoader?.release) {
        try {
          await QNC.pluginLoader.release(prev);
        } catch (e) {
          console.warn('[QNC] release tab', prev, e);
        }
      }
    }
    if (seq !== switchSeq) return;

    if (QNC.pluginLoader?.ensure) {
      try {
        await QNC.pluginLoader.ensure(tabId);
      } catch (e) {
        QNC.setBox?.('Tab ' + tabId + ': ' + (e.message || e), 'err');
        return;
      }
    }
    if (seq !== switchSeq) return;

    if (origSwitch) origSwitch(tabId);
    else {
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
    }
    QNC.tabs.onShow(tabId);
  };
})(window.QNC);
