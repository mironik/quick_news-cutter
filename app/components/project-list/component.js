/* Project list — vlasnik DOM-a unutar data-qnc-panel="project-list". */
window.QNC = window.QNC || {};

(function (QNC) {
  const PANEL_ID = 'project-list';

  function panelRoot(root) {
    if (!root) return null;
    if (root.matches?.('[data-qnc-panel="' + PANEL_ID + '"]')) return root;
    return root.querySelector?.('[data-qnc-panel="' + PANEL_ID + '"]') || null;
  }

  function listSlot(root) {
    return panelRoot(root)?.querySelector('[data-qnc-slot="project-list"]') || null;
  }

  function statusSlot(root) {
    return panelRoot(root)?.querySelector('[data-qnc-slot="status"]') || null;
  }

  function emit(pluginId, action, payload) {
    if (QNC.emitComponent) {
      return QNC.emitComponent(pluginId || 'project', PANEL_ID, action, payload || {});
    }
    return Promise.resolve();
  }

  function setStatus(root, message, kind) {
    const el = statusSlot(root);
    if (!el) return;
    el.textContent = String(message || '');
    el.classList.remove('is-ok', 'is-err', 'is-busy');
    if (kind) el.classList.add('is-' + kind);
  }

  function sortProjects(projects) {
    return [...projects].sort((a, b) => {
      const aKey = String(a.last_opened_at || a.created_at || '');
      const bKey = String(b.last_opened_at || b.created_at || '');
      if (aKey !== bKey) return bKey.localeCompare(aKey);
      return String(b.project_id || '').localeCompare(String(a.project_id || ''));
    });
  }

  function renderList(root, data) {
    const ul = listSlot(root);
    if (!ul) return;
    const projects = sortProjects(Array.isArray(data?.projects) ? data.projects : []);
    if (!projects.length) {
      ul.innerHTML = '<li class="qnc-project-list-empty muted">Nema projekata.</li>';
      return;
    }
    const selectedId = data?.selectedId || null;
    const activeId = data?.activeId || null;
    ul.innerHTML = projects
      .map((p) => {
        const id = p.project_id || '';
        const selected = id === selectedId;
        const active = id === activeId;
        const meta = QNC.esc(id) + (p.created_at ? ' / ' + QNC.esc(p.created_at) : '');
        return [
          '<li class="' + (selected ? 'selected-row ' : '') + (active ? 'active-project-row' : '') + '" data-id="' + QNC.esc(id) + '">',
          '  <span class="qnc-project-list-dot" aria-hidden="true"></span>',
          '  <span class="qnc-project-list-text">',
          '    <span class="qnc-project-list-name">' + QNC.esc(p.name || id) + '</span>',
          '    <span class="qnc-project-list-meta">' + meta + '</span>',
          '  </span>',
          '  <button type="button" class="qnc-project-list-delete" data-delete-id="' + QNC.esc(id) + '" aria-label="Obriši projekt">×</button>',
          '</li>',
        ].join('');
      })
      .join('');
  }

  function mount(root, options) {
    const panel = panelRoot(root);
    if (!panel || panel.dataset.qncComponentMounted === '1') return panel;
    panel.dataset.qncComponentMounted = '1';
    const pluginId = options?.pluginId || panel.dataset.hostPluginId || 'project';
    panel.dataset.hostPluginId = pluginId;

    panel.addEventListener('click', (e) => {
      const deleteBtn = e.target.closest?.('[data-delete-id]');
      if (deleteBtn) {
        e.stopPropagation();
        emit(pluginId, 'project.delete', { project_id: deleteBtn.dataset.deleteId || '' });
        return;
      }
      const row = e.target.closest?.('li[data-id]');
      if (row) emit(pluginId, 'project.open', { project_id: row.dataset.id || '' });
    });

    return panel;
  }

  function update(root, data, options) {
    const panel = panelRoot(root);
    if (!panel) return;
    if (panel.dataset.qncComponentMounted !== '1') mount(panel, options);
    renderList(panel, data || {});
    if (data?.status != null) setStatus(panel, data.status, data.statusKind);
  }

  QNC.components.register(PANEL_ID, { PANEL_ID, mount, update, setStatus });
})(window.QNC);
