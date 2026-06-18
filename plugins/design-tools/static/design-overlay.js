/* Zajednički overlay za sve Design Studio komponente (timeline, primitives, …). */
(function () {
  let panelEl = null;
  let overlayEl = null;
  let session = null;

  function esc(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function ensureDom() {
    if (overlayEl) return overlayEl;
    if (!panelEl) throw new Error('Design overlay: panel nije inicijaliziran');
    overlayEl = panelEl.querySelector('[data-qnc-design-overlay]');
    if (!overlayEl) throw new Error('Design overlay: nema DOM elementa');
    overlayEl.querySelectorAll('[data-design-overlay-close]').forEach((node) => {
      node.addEventListener('click', () => close());
    });
    overlayEl.querySelector('[data-design-overlay-apply]')?.addEventListener('click', () => {
      if (!session?.onApply) {
        close();
        return;
      }
      try {
        const keepOpen = session.onApply(getBody(), session) === false;
        if (!keepOpen) close();
      } catch (err) {
        console.error('[design-overlay]', err);
      }
    });
    panelEl.addEventListener('keydown', onPanelKeydown);
    return overlayEl;
  }

  function onPanelKeydown(ev) {
    if (!isOpen()) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      close();
    }
  }

  function isOpen() {
    return !!(overlayEl && !overlayEl.hidden);
  }

  function getBody() {
    return overlayEl?.querySelector('[data-design-overlay-body]') || null;
  }

  function open(options) {
    const opts = options || {};
    ensureDom();
    session = {
      component: opts.component || 'generic',
      onApply: opts.onApply || null,
      onClose: opts.onClose || null,
    };
    overlayEl.setAttribute('data-overlay-component', session.component);
    const titleEl = overlayEl.querySelector('[data-design-overlay-title]');
    const subtitleEl = overlayEl.querySelector('[data-design-overlay-subtitle]');
    const hintEl = overlayEl.querySelector('[data-design-overlay-hint]');
    const body = getBody();
    if (titleEl) titleEl.textContent = opts.title || 'Postavke';
    if (subtitleEl) {
      if (opts.subtitle) {
        subtitleEl.textContent = opts.subtitle;
        subtitleEl.hidden = false;
      } else {
        subtitleEl.hidden = true;
      }
    }
    if (hintEl) hintEl.textContent = opts.hint || 'Esc zatvara';
    if (body) {
      body.innerHTML = '';
      if (typeof opts.renderBody === 'function') {
        opts.renderBody(body, session);
      } else if (opts.bodyHtml) {
        body.innerHTML = opts.bodyHtml;
      }
      if (typeof opts.onBodyReady === 'function') {
        opts.onBodyReady(body, session);
      }
    }
    const applyBtn = overlayEl.querySelector('[data-design-overlay-apply]');
    if (applyBtn) {
      applyBtn.textContent = opts.applyLabel || 'Primijeni';
      applyBtn.hidden = opts.showApply === false;
    }
    overlayEl.hidden = false;
    panelEl.classList.add('has-design-overlay');
    const focusTarget =
      (opts.focusSelector && body?.querySelector(opts.focusSelector)) ||
      body?.querySelector('input, select, button, textarea');
    focusTarget?.focus();
    return session;
  }

  function close() {
    if (!overlayEl) return;
    overlayEl.hidden = true;
    panelEl?.classList.remove('has-design-overlay');
    const cb = session?.onClose;
    session = null;
    if (typeof cb === 'function') cb();
  }

  function init(panel) {
    panelEl = panel || document.getElementById('panel-design-tools');
    ensureDom();
  }

  window.QNCDesignOverlay = {
    init,
    open,
    close,
    isOpen,
    getBody,
    esc,
  };
})();
