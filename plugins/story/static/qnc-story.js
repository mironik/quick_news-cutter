/* Story tab — Jetson editorial UX + Plugin SDK v1 (SQLite snapshot only). */
window.QNC = window.QNC || {};

(function (QNC) {
  if (!QNC.createPluginApp) {
    console.error('[Story] QNC.createPluginApp nije učitan (qnc-plugin-sdk.js)');
    return;
  }

  const runtime = {
    mounted: false,
    busy: false,
    playheadByPart: {},
    previewOpen: false,
    previewLabel: '',
  };
  const PLUGIN_CTX = { pluginId: 'story' };

  function panel() {
    return document.getElementById('panel-storyboard');
  }

  function q(selector) {
    return (panel() || document).querySelector(selector);
  }

  function comp(id) {
    return QNC.components?.get?.(id);
  }

  function snap(ctx) {
    return ctx.store.get('story.state') || {};
  }

  function hasProject(ctx) {
    return !!String(ctx.projectId || '').trim();
  }

  function partSpan(part) {
    const inS = Number(part.in_seconds);
    const outS = Number(part.out_seconds);
    if (Number.isFinite(inS) && Number.isFinite(outS) && outS > inS) {
      return Math.max(0.05, outS - inS);
    }
    return 3;
  }

  function globalPlayheadSec(db) {
    const partId = db.selected_part_id;
    if (!partId) return 0;
    let cursor = 0;
    for (const part of db.parts || []) {
      if (part.part_id === partId) {
        return cursor + partSpan(part) * (Number(runtime.playheadByPart[partId]) || 0);
      }
      cursor += partSpan(part);
    }
    return 0;
  }

  function storyModel(ctx) {
    const db = snap(ctx);
    const open = hasProject(ctx);
    return {
      project_id: db.project_id || ctx.projectId || '',
      selected_part_id: db.selected_part_id || '',
      selected_shot_id: db.selected_shot_id || '',
      selected_slot_id: db.selected_slot_id || '',
      selected_cover_id: db.selected_cover_id || '',
      covers: Array.isArray(db.covers) ? db.covers : [],
      parts: Array.isArray(db.parts) ? db.parts : [],
      markers: Array.isArray(db.markers) ? db.markers : [],
      marker_slots: Array.isArray(db.marker_slots) ? db.marker_slots : [],
      virtual_shots: [],
      part_count: db.summary?.part_count ?? (Array.isArray(db.parts) ? db.parts.length : 0),
      duration_sec: db.summary?.duration_sec ?? 0,
      draft_updated_at: db.draft_updated_at,
      committed_at: db.committed_at,
      playhead_by_part: runtime.playheadByPart,
      global_playhead_sec: globalPlayheadSec(db),
      preview_open: runtime.previewOpen,
      preview_label: runtime.previewLabel,
      busy: runtime.busy,
    };
  }

  async function writeAndReload(ctx, actionId, body) {
    await ctx.action(actionId, { project_id: ctx.projectId, ...(body || {}) });
    return ctx.store.reload('story.state');
  }

  function mountComponents() {
    comp('story-tab-layout')?.mount?.(q('[data-qnc-panel="story-tab-layout"]'), PLUGIN_CTX);
    comp('story-toolbar')?.mount?.(q('[data-qnc-panel="story-toolbar"]'), PLUGIN_CTX);
    comp('story-preview-overlay')?.mount?.(q('[data-qnc-panel="story-preview-overlay"]'), PLUGIN_CTX);
    comp('story-virtual-shots')?.mount?.(q('[data-qnc-panel="story-virtual-shots"]'), PLUGIN_CTX);
    comp('story-segment-timeline')?.mount?.(q('[data-qnc-panel="story-segment-timeline"]'), PLUGIN_CTX);
    comp('story-virtual-timeline')?.mount?.(q('[data-qnc-panel="story-virtual-timeline"]'), PLUGIN_CTX);
    runtime.mounted = true;
  }

  function ensureMounted() {
    if (!q('[data-qnc-panel="story-tab-layout"]')) return;
    if (runtime.mounted) return;
    mountComponents();
  }

  function renderAll(ctx) {
    const model = storyModel(ctx);
    comp('story-tab-layout')?.update?.(q('[data-qnc-panel="story-tab-layout"]'), model, PLUGIN_CTX);
    comp('story-toolbar')?.update?.(q('[data-qnc-panel="story-toolbar"]'), model, PLUGIN_CTX);
    comp('story-preview-overlay')?.update?.(q('[data-qnc-panel="story-preview-overlay"]'), model, PLUGIN_CTX);
    comp('story-virtual-shots')?.update?.(q('[data-qnc-panel="story-virtual-shots"]'), model, PLUGIN_CTX);
    comp('story-segment-timeline')?.update?.(
      q('[data-qnc-panel="story-segment-timeline"]'),
      model,
      PLUGIN_CTX
    );
    comp('story-virtual-timeline')?.update?.(
      q('[data-qnc-panel="story-virtual-timeline"]'),
      model,
      PLUGIN_CTX
    );
  }

  async function runMutation(ctx, actionId, body) {
    if (!hasProject(ctx)) {
      ctx.setStatus('Story: prvo otvori projekt.', 'err');
      return;
    }
    if (runtime.busy) return;
    runtime.busy = true;
    renderAll(ctx);
    try {
      await writeAndReload(ctx, actionId, body);
      renderAll(ctx);
    } catch (e) {
      ctx.setStatus('Story: ' + e.message, 'err');
    } finally {
      runtime.busy = false;
      renderAll(ctx);
    }
  }

  function setPlayhead(partId, ratio) {
    if (!partId) return;
    runtime.playheadByPart[partId] = Math.max(0, Math.min(1, Number(ratio) || 0));
  }

  async function addMarkerAtPlayhead(ctx) {
    const db = snap(ctx);
    const partId = String(db.selected_part_id || '').trim();
    if (!partId) {
      ctx.setStatus('Story: odaberi segment.', 'err');
      return;
    }
    const localSec = partSpan(db.parts.find((p) => p.part_id === partId)) * (runtime.playheadByPart[partId] || 0);
    await runMutation(ctx, 'story.marker.create', { part_id: partId, local_sec: localSec });
  }

  const app = QNC.createPluginApp({
    pluginId: 'story',
    tabId: 'storyboard',
    apiNamespace: '/api/story',
    snapshots: ['story.state'],
    snapshotLoaders: {
      'story.state': { path: '/api/story/state', projectScoped: true },
    },
    listens: ['project:changed'],
  });

  app.lifecycle({
    onInit(ctx) {
      mountComponents();

      ctx.onShell('project:changed', () => {
        runtime.playheadByPart = {};
        runtime.previewOpen = false;
        ctx.store.invalidate('story.state');
      });

      ctx.on('story.refresh', async () => {
        if (!hasProject(ctx)) return;
        runtime.busy = true;
        renderAll(ctx);
        try {
          await ctx.store.reload('story.state');
          renderAll(ctx);
        } catch (e) {
          ctx.setStatus('Story: ' + e.message, 'err');
        } finally {
          runtime.busy = false;
          renderAll(ctx);
        }
      });

      ctx.on('story.part.create', async (ev) => {
        const kind = String(ev.payload?.kind || 'tonovi').trim();
        await runMutation(ctx, 'story.part.create', { kind });
      });

      ctx.on('story.part.delete', async (ev) => {
        const db = snap(ctx);
        const partId = String(ev.payload?.part_id || db.selected_part_id || '').trim();
        if (!partId) return;
        delete runtime.playheadByPart[partId];
        await runMutation(ctx, 'story.part.delete', { part_id: partId });
      });

      ctx.on('story.part.select', async (ev) => {
        const partId = String(ev.payload?.part_id || '').trim();
        if (!partId) return;
        if (ev.payload?.playhead_ratio != null) {
          setPlayhead(partId, ev.payload.playhead_ratio);
        }
        await runMutation(ctx, 'story.part.select', { part_id: partId });
        renderAll(ctx);
      });

      ctx.on('story.marker_slot.select', async (ev) => {
        const slotId = String(ev.payload?.slot_id || '').trim();
        if (!slotId) return;
        await runMutation(ctx, 'story.marker_slot.select', { slot_id: slotId });
      });

      ctx.on('story.cover.create', async (ev) => {
        const db = snap(ctx);
        const slotId = String(ev.payload?.slot_id || db.selected_slot_id || '').trim();
        if (!slotId) {
          ctx.setStatus('Story: odaberi odsječak na timelineu.', 'err');
          return;
        }
        await runMutation(ctx, 'story.cover.create', { slot_id: slotId });
      });

      ctx.on('story.test', () => {
        runtime.previewOpen = true;
        runtime.previewLabel = 'TEST reprodukcija — uskoro';
        ctx.setStatus('Story TEST: reprodukcija u sljedećoj fazi.', 'busy');
        renderAll(ctx);
      });

      ctx.on('story.commit', () => {
        ctx.setStatus('Story GOTOVO: commit API u sljedećoj fazi.', 'ok');
      });

      ctx.on('story.preview.close', () => {
        runtime.previewOpen = false;
        renderAll(ctx);
      });

      ctx.on('story.timeline.scrub', (ev) => {
        const db = snap(ctx);
        const ratio = Number(ev.payload?.ratio);
        if (!Number.isFinite(ratio)) return;
        const parts = db.parts || [];
        const dur = Number(db.summary?.duration_sec) || parts.reduce((s, p) => s + partSpan(p), 0);
        const target = ratio * dur;
        let cursor = 0;
        for (const part of parts) {
          const span = partSpan(part);
          if (target <= cursor + span + 0.001) {
            setPlayhead(part.part_id, span > 0 ? (target - cursor) / span : 0);
            runMutation(ctx, 'story.part.select', { part_id: part.part_id });
            return;
          }
          cursor += span;
        }
      });

      document.addEventListener('keydown', (ev) => {
        if (QNC.getActiveTab?.() !== 'storyboard') return;
        if (ev.key === 'm' || ev.key === 'M') {
          ev.preventDefault();
          addMarkerAtPlayhead(ctx);
        }
        if (ev.key === 'F10') {
          ev.preventDefault();
          const db = snap(ctx);
          const slotId = String(db.selected_slot_id || '').trim();
          if (!slotId) {
            ctx.setStatus('Story: odaberi odsječak.', 'err');
            return;
          }
          runMutation(ctx, 'story.cover.create', { slot_id: slotId });
        }
      });

      QNC.log('[Story] Jetson editorial UX + SDK', 'ok');
    },

    async onShow(ctx) {
      if (!QNC.shell?.footerHasTab?.('storyboard')) {
        ctx.setStatus('Prvo otvori projekt na Project tabu.', 'err');
        renderAll(ctx);
        return;
      }
      if (!hasProject(ctx)) {
        ctx.setStatus('Prvo otvori projekt na Project tabu.', 'err');
        renderAll(ctx);
        return;
      }
      ensureMounted();
      try {
        await ctx.store.reload('story.state');
        renderAll(ctx);
      } catch (e) {
        ctx.setStatus('Story: ' + e.message, 'err');
      }
    },

    onDestroy(ctx) {
      runtime.mounted = false;
      ctx.teardown();
    },
  });

  app.register();
})(window.QNC);
