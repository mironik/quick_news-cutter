/* Timeline dizajn lab — univerzalni model v3 (axis + overlay + virtual klipovi). */
(function () {
  const MOCK_URL = '/plugins/design-tools/timeline/mock.html';
  const PROFILES_URL = '/plugins/design-tools/timeline/build-profiles.json';
  const STYLE_URL = '/plugins/design-tools/timeline/style-tokens.json';
  const PREFS_API = '/api/design-tools/timeline-lab';

  const TRACK_STATES = ['off', 'on-visible', 'on-hidden'];
  const OVERLAY_STATE_COLS = ['on-visible', 'on-hidden', 'off'];
  const VIDEO_MODES = ['filmstrip', 'inout-thumbs', 'poster'];
  const AXIS_MODES = ['source_clip', 'segment_local', 'montage_global'];
  const AXIS_LABELS = {
    source_clip: 'Source klip',
    segment_local: 'Story segment',
    montage_global: 'Virtual timeline',
  };

  const TRACK_LABELS = {
    play: 'Play',
    video: 'Video',
    'audio-1': 'Audio 1',
    'audio-2': 'Audio 2',
    'audio-3': 'Audio 3',
    'audio-4': 'Audio 4',
    stabilization: 'Stabilizacija',
    transcript: 'Transkript',
    inout: 'In–Out',
  };

  const TRACK_NAMES = {
    play: { full: 'Play', short: 'PL', icon: '▶' },
    video: { full: 'Video', short: 'V1', icon: '▦' },
    'audio-1': { full: 'Audio 1', short: 'A1', icon: '♪' },
    'audio-2': { full: 'Audio 2', short: 'A2', icon: '♪' },
    'audio-3': { full: 'Audio 3', short: 'A3', icon: '♪' },
    'audio-4': { full: 'Audio 4', short: 'A4', icon: '♪' },
    stabilization: { full: 'Stabilizacija', short: 'ST', icon: '⌇' },
    transcript: { full: 'Transkript', short: 'TX', icon: 'T' },
    inout: { full: 'In–Out', short: 'IO', icon: '⎸⎹' },
  };

  const OVERLAY_IDS = ['segments', 'virtual_clips', 'markers', 'slots'];
  const OVERLAY_LABELS = {
    segments: 'Story segmenti',
    virtual_clips: 'Virtual klipovi',
    markers: 'Markeri (M)',
    slots: 'Slotovi M–M',
  };

  const LANE_IO_IDS = ['video', 'audio-1', 'audio-2', 'audio-3', 'audio-4', 'inout'];
  const EDITORIAL_TRACK = 'editorial';
  const LABEL_DISPLAY_MODES = ['full', 'short', 'icon'];

  let labelDisplayMode = 'full';
  let profiles = {};
  let styleSchema = null;
  let timelineStyle = {};
  let activeProfileId = 'design-lab';
  let axisMode = 'montage_global';
  let trackStates = {};
  let overlayStates = {};
  let videoPresentation = 'filmstrip';
  let timelineHost = null;
  let selectedTrackId = 'video';
  let overlayFocusTrackId = null;
  let isPlaying = false;
  let playTimer = null;
  let prefsHydrating = false;
  let saveTimer = null;

  const DEMO_DURATION_SEC = 120;
  const DEMO_FPS = 25;
  const PLAY_TICK_MS = 40;
  const PLAY_STEP_PCT = 0.08;
  const MIN_INOUT_GAP = 2;
  const DEFAULT_IO_IN_PCT = 0;
  const DEFAULT_IO_OUT_PCT = 10;
  const ITEM_KEY_STEP = 0.5;
  const ITEM_KEY_STEP_SHIFT = 2.5;

  let timelineItems = null;
  let selectedItem = null;
  let dragState = null;

  const overlay = () => window.QNCDesignOverlay;

  const STATE_UI = {
    'on-visible': { label: 'Uključeno — vidljivo', hint: 'Puna visina, interaktivno' },
    'on-hidden': { label: 'Uključeno — skriveno', hint: 'Suzeno, sync ostaje' },
    off: { label: 'Isključeno', hint: 'Bez sadržaja trake' },
  };

  const TRACK_OVERLAY_KEY = 't';

  function esc(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toggleIcon(state) {
    if (state === 'on-visible') return '◉';
    if (state === 'on-hidden') return '○';
    return '—';
  }

  function nextState(current) {
    const i = TRACK_STATES.indexOf(current);
    if (i < 0) return 'on-visible';
    return TRACK_STATES[(i + 1) % TRACK_STATES.length];
  }

  function profile() {
    return profiles[activeProfileId] || null;
  }

  function defaultSegments() {
    return [
      { id: 'seg1', type: 'izjava', label: 'Izjava 1', start_pct: 0, width_pct: 38 },
      { id: 'seg2', type: 'off', label: 'Off 1', start_pct: 38, width_pct: 12 },
      { id: 'seg3', type: 'izjava', label: 'Izjava 2', start_pct: 50, width_pct: 50 },
    ];
  }

  function defaultVirtualClips() {
    return [
      { id: 'vc1', segment_id: 'seg1', label: 'VC izjava 1', left_pct: 2, width_pct: 30, role: 'primary' },
      { id: 'vc2', segment_id: 'seg1', label: 'Pokrivanje', left_pct: 8, width_pct: 22, role: 'cover' },
      { id: 'vc3', segment_id: 'seg3', label: 'VC izjava 2', left_pct: 52, width_pct: 38, role: 'primary' },
    ];
  }

  function defaultTimelineItems() {
    return {
      version: 3,
      axis: { mode: 'montage_global', duration_sec: DEMO_DURATION_SEC, segment_index: 0 },
      clip_range: { in_pct: DEFAULT_IO_IN_PCT, out_pct: DEFAULT_IO_OUT_PCT },
      virtual_clips: defaultVirtualClips(),
      segments: defaultSegments(),
      editorial: {
        markers: [
          { id: 'm1', pct: 18, label: 'M' },
          { id: 'm2', pct: 62, label: 'M' },
        ],
      },
      slots: [],
      scopes: {
        stabilization: [{ id: 's1', left_pct: 18, width_pct: 44 }],
        transcript: [
          { id: 't1', left_pct: 20, width_pct: 20, text: 'Segment u slotu …' },
          { id: 't2', left_pct: 64, width_pct: 18, text: 'Drugi segment …' },
        ],
      },
      lanes: {},
    };
  }

  function initDefaultLanes(base) {
    LANE_IO_IDS.forEach((laneId) => {
      if (!base.lanes[laneId]) {
        base.lanes[laneId] = {
          in_pct: base.clip_range.in_pct,
          out_pct: base.clip_range.out_pct,
          markers: [],
        };
      }
    });
  }

  function rebuildMarkerSlots() {
    if (!timelineItems) return [];
    const markers = [...(timelineItems.editorial?.markers || [])].sort((a, b) => a.pct - b.pct);
    const slots = [];
    for (let i = 0; i < markers.length - 1; i++) {
      const start = markers[i].pct;
      const end = markers[i + 1].pct;
      if (end <= start + MIN_INOUT_GAP * 0.5) continue;
      slots.push({ index: i, start_pct: start, end_pct: end });
    }
    timelineItems.slots = slots;
    return slots;
  }

  function migrateV2Items(saved, base) {
    if (saved.version === 2 && saved.tracks && typeof saved.tracks === 'object') {
      const tracks = saved.tracks;
      if (tracks.markers?.markers?.length) {
        base.editorial.markers = tracks.markers.markers.map((m, i) => ({
          id: String(m.id || 'm' + (i + 1)),
          pct: clampPct(m.pct ?? 0),
          label: String(m.label ?? 'M'),
        }));
      }
      LANE_IO_IDS.forEach((laneId) => {
        const src = tracks[laneId];
        if (!src) return;
        base.lanes[laneId] = {
          in_pct: clampPct(src.in_pct ?? base.clip_range.in_pct),
          out_pct: clampPct(src.out_pct ?? base.clip_range.out_pct),
          markers: Array.isArray(src.markers)
            ? src.markers.map((m, i) => ({
                id: String(m.id || laneId + '-m' + (i + 1)),
                pct: clampPct(m.pct ?? 0),
                label: String(m.label ?? 'M'),
              }))
            : [],
        };
      });
      if (saved.inout?.in_pct != null) {
        base.clip_range.in_pct = clampPct(saved.inout.in_pct);
        base.clip_range.out_pct = clampPct(saved.inout.out_pct ?? DEFAULT_IO_OUT_PCT);
      }
    } else if (!saved.version || saved.version < 3) {
      const inPct = saved.inout?.in_pct != null ? clampPct(saved.inout.in_pct) : DEFAULT_IO_IN_PCT;
      let outPct = saved.inout?.out_pct != null ? clampPct(saved.inout.out_pct) : DEFAULT_IO_OUT_PCT;
      if (outPct < inPct + MIN_INOUT_GAP) outPct = clampPct(inPct + MIN_INOUT_GAP);
      base.clip_range = { in_pct: inPct, out_pct: outPct };
      LANE_IO_IDS.forEach((laneId) => {
        base.lanes[laneId] = { in_pct: inPct, out_pct: outPct, markers: [] };
      });
      if (Array.isArray(saved.markers) && saved.markers.length) {
        base.editorial.markers = saved.markers.map((m, i) => ({
          id: String(m.id || 'm' + (i + 1)),
          pct: clampPct(m.pct ?? 0),
          label: String(m.label ?? 'M'),
        }));
      }
    }
    if (Array.isArray(saved.stabilization)) {
      base.scopes.stabilization = saved.stabilization.map((s, i) => ({
        id: String(s.id || 's' + (i + 1)),
        left_pct: clampPct(s.left_pct ?? 0),
        width_pct: clampPct(s.width_pct ?? 10),
      }));
    }
    if (Array.isArray(saved.transcript)) {
      base.scopes.transcript = saved.transcript.map((t, i) => ({
        id: String(t.id || 't' + (i + 1)),
        left_pct: clampPct(t.left_pct ?? 0),
        width_pct: clampPct(t.width_pct ?? 20),
        text: String(t.text ?? 'Segment …'),
      }));
    }
  }

  function mergeTimelineItems(saved) {
    const base = defaultTimelineItems();
    initDefaultLanes(base);
    if (!saved || typeof saved !== 'object') {
      rebuildMarkerSlotsOn(base);
      return base;
    }

    migrateV2Items(saved, base);

    if (saved.axis && typeof saved.axis === 'object') {
      if (AXIS_MODES.includes(saved.axis.mode)) base.axis.mode = saved.axis.mode;
      if (saved.axis.segment_index != null) base.axis.segment_index = Number(saved.axis.segment_index) || 0;
      if (saved.axis.duration_sec != null) base.axis.duration_sec = Number(saved.axis.duration_sec) || DEMO_DURATION_SEC;
    }

    if (saved.clip_range) {
      base.clip_range.in_pct = clampPct(saved.clip_range.in_pct ?? base.clip_range.in_pct);
      base.clip_range.out_pct = clampPct(saved.clip_range.out_pct ?? base.clip_range.out_pct);
    }

    if (Array.isArray(saved.segments) && saved.segments.length) {
      base.segments = saved.segments.map((s, i) => ({
        id: String(s.id || 'seg' + (i + 1)),
        type: s.type === 'off' ? 'off' : 'izjava',
        label: String(s.label || 'Segment'),
        start_pct: clampPct(s.start_pct ?? 0),
        width_pct: clampPct(s.width_pct ?? 10),
      }));
    }

    if (Array.isArray(saved.virtual_clips) && saved.virtual_clips.length) {
      base.virtual_clips = saved.virtual_clips.map((vc, i) => ({
        id: String(vc.id || 'vc' + (i + 1)),
        segment_id: String(vc.segment_id || ''),
        label: String(vc.label || 'VC'),
        left_pct: clampPct(vc.left_pct ?? 0),
        width_pct: clampPct(vc.width_pct ?? 8),
        role: String(vc.role || 'primary'),
      }));
    }

    if (saved.editorial?.markers?.length) {
      base.editorial.markers = saved.editorial.markers.map((m, i) => ({
        id: String(m.id || 'm' + (i + 1)),
        pct: clampPct(m.pct ?? 0),
        label: String(m.label ?? 'M'),
      }));
    }

    if (saved.lanes && typeof saved.lanes === 'object') {
      LANE_IO_IDS.forEach((laneId) => {
        const src = saved.lanes[laneId];
        if (!src) return;
        base.lanes[laneId] = {
          in_pct: clampPct(src.in_pct ?? base.clip_range.in_pct),
          out_pct: clampPct(src.out_pct ?? base.clip_range.out_pct),
          markers: Array.isArray(src.markers)
            ? src.markers.map((m, i) => ({
                id: String(m.id || laneId + '-m' + (i + 1)),
                pct: clampPct(m.pct ?? 0),
                label: String(m.label ?? 'M'),
              }))
            : [],
        };
      });
    }

    if (saved.scopes) {
      if (Array.isArray(saved.scopes.stabilization)) {
        base.scopes.stabilization = saved.scopes.stabilization.map((s, i) => ({
          id: String(s.id || 's' + (i + 1)),
          left_pct: clampPct(s.left_pct ?? 0),
          width_pct: clampPct(s.width_pct ?? 10),
        }));
      }
      if (Array.isArray(saved.scopes.transcript)) {
        base.scopes.transcript = saved.scopes.transcript.map((t, i) => ({
          id: String(t.id || 't' + (i + 1)),
          left_pct: clampPct(t.left_pct ?? 0),
          width_pct: clampPct(t.width_pct ?? 20),
          text: String(t.text ?? 'Segment …'),
        }));
      }
    }

    rebuildMarkerSlotsOn(base);
    return base;
  }

  function rebuildMarkerSlotsOn(model) {
    const markers = [...(model.editorial?.markers || [])].sort((a, b) => a.pct - b.pct);
    const slots = [];
    for (let i = 0; i < markers.length - 1; i++) {
      const start = markers[i].pct;
      const end = markers[i + 1].pct;
      if (end <= start + MIN_INOUT_GAP * 0.5) continue;
      slots.push({ index: i, start_pct: start, end_pct: end });
    }
    model.slots = slots;
  }

  function activeSegment() {
    const segs = timelineItems?.segments || [];
    const idx = timelineItems?.axis?.segment_index ?? 0;
    return segs[idx] || segs[0] || null;
  }

  function segmentViewWindow() {
    const seg = activeSegment();
    if (!seg || axisMode !== 'segment_local') return { start: 0, end: 100 };
    return { start: seg.start_pct, end: seg.start_pct + seg.width_pct };
  }

  function globalPctToViewPct(globalPct) {
    if (axisMode !== 'segment_local') return globalPct;
    const win = segmentViewWindow();
    const span = win.end - win.start;
    if (span <= 0) return 0;
    return clampPct(((globalPct - win.start) / span) * 100);
  }

  function viewPctToGlobalPct(viewPct) {
    if (axisMode !== 'segment_local') return viewPct;
    const win = segmentViewWindow();
    const span = win.end - win.start;
    return clampPct(win.start + (viewPct / 100) * span);
  }

  function isOverlayVisible(overlayId) {
    if (!isOverlayAvailable(overlayId)) return false;
    return overlayStates[overlayId] === 'on-visible';
  }

  function isOverlayAvailable(overlayId) {
    const p = profile();
    if (!p || !Array.isArray(p.available_overlays)) return OVERLAY_IDS.includes(overlayId);
    return p.available_overlays.includes(overlayId);
  }

  function collectTimelinePrefs() {
    const states = {};
    Object.keys(TRACK_LABELS).forEach((trackId) => {
      if (trackId === 'play') return;
      states[trackId] = trackStates[trackId] || 'off';
    });
    const oStates = {};
    OVERLAY_IDS.forEach((id) => {
      oStates[id] = overlayStates[id] || 'off';
    });
    return {
      version: 1,
      active_profile_id: activeProfileId,
      axis_mode: axisMode,
      label_display: labelDisplayMode,
      video_presentation: videoPresentation,
      playhead_pct: Number(timelineHost?.getAttribute('data-playhead-pct') || 0),
      track_states: states,
      overlay_states: oStates,
      style: { ...timelineStyle },
      items: JSON.parse(JSON.stringify(timelineItems || defaultTimelineItems())),
    };
  }

  function schedulePersist() {
    if (prefsHydrating) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      persistTimelinePrefs();
    }, 150);
  }

  async function loadTimelinePrefs() {
    try {
      const res = await fetch(PREFS_API, { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      return data.prefs || null;
    } catch (err) {
      console.warn('[timeline-lab] prefs load', err);
      return null;
    }
  }

  async function persistTimelinePrefs() {
    if (prefsHydrating || !timelineHost) return;
    try {
      const res = await fetch(PREFS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefs: collectTimelinePrefs() }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
    } catch (err) {
      console.warn('[timeline-lab] prefs save', err);
    }
  }

  function applyPrefsToHost(host, prefs) {
    if (!host || !prefs) return;
    if (prefs.label_display) setLabelDisplay(host, prefs.label_display);
    if (prefs.video_presentation) setVideoPresentation(host, prefs.video_presentation);
    if (prefs.axis_mode && AXIS_MODES.includes(prefs.axis_mode)) {
      setAxisMode(host, prefs.axis_mode, false);
    }
    if (prefs.track_states && typeof prefs.track_states === 'object') {
      Object.entries(prefs.track_states).forEach(([trackId, state]) => {
        if (trackId === 'play' || !isAvailable(trackId)) return;
        if (TRACK_STATES.includes(state)) setTrackState(host, trackId, state);
      });
    }
    if (prefs.overlay_states && typeof prefs.overlay_states === 'object') {
      Object.entries(prefs.overlay_states).forEach(([oid, state]) => {
        if (!isOverlayAvailable(oid)) return;
        if (TRACK_STATES.includes(state)) overlayStates[oid] = state;
      });
    }
    if (prefs.playhead_pct != null && !Number.isNaN(Number(prefs.playhead_pct))) {
      setPlayheadPct(host, Number(prefs.playhead_pct));
    }
    if (prefs.style && typeof prefs.style === 'object') {
      timelineStyle = mergeTimelineStyle(prefs.style);
    } else {
      timelineStyle = mergeTimelineStyle({});
    }
    applyStyleTokens(host, timelineStyle);
    if (prefs.items && typeof prefs.items === 'object') {
      timelineItems = mergeTimelineItems(prefs.items);
    } else if (!timelineItems) {
      timelineItems = mergeTimelineItems(null);
    }
    rebuildMarkerSlots();
    syncAllDom(host);
  }

  function mergeTimelineStyle(saved) {
    const merged = {};
    const defaults = styleSchema?.defaults || {};
    Object.keys(defaults).forEach((name) => {
      const base = defaults[name] == null ? '' : String(defaults[name]);
      const override = saved && saved[name] != null ? String(saved[name]) : base;
      merged[name] = override;
    });
    return merged;
  }

  function applyStyleTokens(host, style) {
    if (!host || !styleSchema) return;
    const defaults = styleSchema.defaults || {};
    Object.keys(defaults).forEach((name) => {
      const value = style[name];
      const defaultVal = defaults[name] == null ? '' : String(defaults[name]);
      if (value == null || value === '' || String(value) === defaultVal) {
        host.style.removeProperty(name);
      } else {
        host.style.setProperty(name, String(value));
      }
    });
  }

  function styleInputKind(tokenName) {
    if (
      tokenName.includes('-h-') ||
      tokenName.includes('-w') ||
      tokenName.includes('opacity') ||
      tokenName.includes('font-size') ||
      tokenName.endsWith('-bg')
    ) {
      return 'text';
    }
    if (tokenName.endsWith('-color') || tokenName.endsWith('-border') || tokenName.includes('stripe')) {
      return 'color';
    }
    return 'text';
  }

  function renderStyleControls(parts) {
    if (!styleSchema || !styleSchema.groups) return;
    parts.push('<h4>Stil timelinea</h4>');
    parts.push('<p class="muted qnc-design-hint">Promjene odmah na previewu · automatski se pamte.</p>');
    Object.values(styleSchema.groups).forEach((group) => {
      parts.push('<p class="qnc-design-style-group">' + esc(group.label || '') + '</p>');
      (group.tokens || []).forEach((tokenName) => {
        const val = timelineStyle[tokenName] ?? styleSchema.defaults[tokenName] ?? '';
        const label = (styleSchema.labels && styleSchema.labels[tokenName]) || tokenName;
        const hint = styleSchema.hints && styleSchema.hints[tokenName];
        const kind = styleInputKind(tokenName);
        parts.push('<div class="qnc-design-token-row' + (kind === 'color' ? ' qnc-design-token-row--color' : '') + '">');
        parts.push('<code title="' + esc(tokenName) + '">' + esc(label) + '</code>');
        if (kind === 'color') {
          const colorVal = /^#[0-9a-f]{3,8}$/i.test(val) ? val : '#e85d04';
          parts.push('<div class="qnc-design-style-color-wrap">');
          parts.push(
            '<input type="color" data-timeline-style="' +
              esc(tokenName) +
              '" value="' +
              esc(colorVal) +
              '" aria-label="' +
              esc(label) +
              '">'
          );
          parts.push(
            '<input type="text" class="qnc-ui-input" data-timeline-style-text="' +
              esc(tokenName) +
              '" value="' +
              esc(val) +
              '" placeholder="tema"' +
              (hint ? ' title="' + esc(hint) + '"' : '') +
              '>'
          );
          parts.push('</div>');
        } else {
          parts.push(
            '<input type="text" class="qnc-ui-input" data-timeline-style="' +
              esc(tokenName) +
              '" value="' +
              esc(val) +
              '"' +
              (hint ? ' title="' + esc(hint) + '"' : '') +
              '>'
          );
        }
        parts.push('</div>');
      });
    });
  }

  function bindStyleControls(sidebar, host) {
    if (!sidebar || !host) return;
    sidebar.querySelectorAll('input[data-timeline-style][type="color"]').forEach((input) => {
      input.addEventListener('input', () => {
        const name = input.getAttribute('data-timeline-style');
        timelineStyle[name] = input.value;
        const text = sidebar.querySelector('[data-timeline-style-text="' + name + '"]');
        if (text) text.value = input.value;
        applyStyleTokens(host, timelineStyle);
        schedulePersist();
      });
    });
    sidebar.querySelectorAll('[data-timeline-style-text]').forEach((input) => {
      input.addEventListener('change', () => {
        const name = input.getAttribute('data-timeline-style-text');
        timelineStyle[name] = input.value.trim();
        applyStyleTokens(host, timelineStyle);
        const color = sidebar.querySelector('[data-timeline-style="' + name + '"]');
        if (color && /^#[0-9a-f]{3,8}$/i.test(timelineStyle[name])) {
          color.value = timelineStyle[name];
        }
        schedulePersist();
      });
    });
    sidebar.querySelectorAll('input[data-timeline-style]:not([type="color"])').forEach((input) => {
      input.addEventListener('change', () => {
        const name = input.getAttribute('data-timeline-style');
        timelineStyle[name] = input.value.trim();
        applyStyleTokens(host, timelineStyle);
        schedulePersist();
      });
    });
  }

  function bindOverlayLiveSave(host) {
    const body = overlay()?.getBody();
    if (!body || !host) return;
    body.querySelectorAll('input[type="radio"]').forEach((input) => {
      input.addEventListener('change', () => {
        applyTimelineOverlayFromBody(host, body);
        const sidebar = document.querySelector('[data-qnc-slot="component-controls"]');
        if (sidebar) renderControls(sidebar);
      });
    });
  }

  function applyTimelineOverlayFromBody(host, body) {
    if (!body || !host) return;
    Object.keys(TRACK_LABELS).forEach((trackId) => {
      if (trackId === 'play' || !isAvailable(trackId)) return;
      const stateInput = body.querySelector('input[name="timeline-state-' + trackId + '"]:checked');
      if (stateInput) setTrackState(host, trackId, stateInput.value);
    });
    OVERLAY_IDS.forEach((oid) => {
      if (!isOverlayAvailable(oid)) return;
      const stateInput = body.querySelector('input[name="timeline-overlay-' + oid + '"]:checked');
      if (stateInput) setOverlayState(host, oid, stateInput.value);
    });
    const labelInput = body.querySelector('input[name="timeline-label-display"]:checked');
    if (labelInput) setLabelDisplay(host, labelInput.value);
  }

  function isAvailable(trackId) {
    if (trackId === 'play') return true;
    const p = profile();
    if (!p || !Array.isArray(p.available_tracks)) return true;
    return p.available_tracks.includes(trackId);
  }

  function syncTrackDom(host, trackId, state) {
    host.querySelectorAll('.qnc-timeline-row[data-track-id="' + trackId + '"]').forEach((node) => {
      node.setAttribute('data-track-state', state);
    });
    const row = host.querySelector('.qnc-timeline-row[data-track-id="' + trackId + '"]');
    if (!row) return;
    const avail = isAvailable(trackId);
    const btn = row.querySelector('[data-timeline-track-state]');
    if (btn) {
      btn.textContent = toggleIcon(avail ? state : 'off');
    }
    const label = row.querySelector('.qnc-timeline-label-cycle');
    if (label) label.classList.toggle('is-muted', state === 'off' || !avail);
    const labelCell = row.querySelector('.qnc-timeline-label');
    if (labelCell && trackId !== 'play') {
      labelCell.setAttribute('data-track-id', trackId);
    }
    if (!avail && trackId !== 'play') {
      row.setAttribute('data-track-unavailable', 'true');
    } else {
      row.removeAttribute('data-track-unavailable');
    }
  }

  function decorateLabels(host) {
    host.querySelectorAll('.qnc-timeline-name[data-track-id]').forEach((el) => {
      const id = el.getAttribute('data-track-id');
      const names = TRACK_NAMES[id];
      if (!names) return;
      el.setAttribute('data-full', names.full);
      el.setAttribute('data-short', names.short);
      el.setAttribute('data-icon', names.icon);
      const cell = el.closest('.qnc-timeline-label');
      if (cell) cell.setAttribute('data-short', names.short);
      const cycle = el.closest('[data-timeline-label-cycle]');
      if (cycle) {
        cycle.setAttribute('title', names.full + ' — lijevi klik: prikaz oznake (tekst / kratko / ikona)');
      }
    });
    setLabelDisplay(host, labelDisplayMode);
    ensurePlayRowHidden(host);
    host.setAttribute('tabindex', '0');
    host.setAttribute('data-play-state', 'paused');
    host.setAttribute(
      'title',
      'Space — play/pause · ←→ pomak elementa · Tab sljedeći · Esc odabir · T overlay'
    );
  }

  function clampPct(value) {
    return Math.max(0, Math.min(100, Math.round(Number(value) * 10) / 10));
  }

  function laneIoData(laneId) {
    return timelineItems?.lanes?.[laneId] || null;
  }

  function resolveLaneInOut(laneId) {
    const t = laneIoData(laneId);
    if (!t) return { in_pct: DEFAULT_IO_IN_PCT, out_pct: DEFAULT_IO_OUT_PCT };
    let inPct = clampPct(t.in_pct ?? DEFAULT_IO_IN_PCT);
    let outPct = clampPct(t.out_pct ?? DEFAULT_IO_OUT_PCT);
    if (outPct < inPct + MIN_INOUT_GAP) outPct = clampPct(inPct + MIN_INOUT_GAP);
    return { in_pct: inPct, out_pct: outPct };
  }

  function clipRangeBounds() {
    const cr = timelineItems?.clip_range || { in_pct: 0, out_pct: 100 };
    let inPct = clampPct(cr.in_pct ?? 0);
    let outPct = clampPct(cr.out_pct ?? 100);
    if (outPct < inPct + MIN_INOUT_GAP) outPct = clampPct(inPct + MIN_INOUT_GAP);
    return { in_pct: inPct, out_pct: outPct };
  }

  function clampScopeToClipRange(leftPct, widthPct) {
    if (axisMode !== 'source_clip') return { left_pct: leftPct, width_pct: widthPct };
    const cr = clipRangeBounds();
    const start = Math.max(leftPct, cr.in_pct);
    const end = Math.min(leftPct + widthPct, cr.out_pct);
    return { left_pct: start, width_pct: Math.max(MIN_INOUT_GAP, end - start) };
  }

  function isTrackInteractive(trackId) {
    return isAvailable(trackId) && trackStates[trackId] === 'on-visible';
  }

  function isItemInteractive(trackId) {
    if (trackId === EDITORIAL_TRACK) return true;
    return trackId && isTrackInteractive(trackId);
  }

  function clientXToPct(lane, clientX) {
    if (!lane) return 0;
    const rect = lane.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    const viewPct = clampPct(((clientX - rect.left) / rect.width) * 100);
    return viewPctToGlobalPct(viewPct);
  }

  function editorialLane(host) {
    return host?.querySelector('[data-timeline-editorial]') || host?.querySelector('.qnc-timeline-canvas');
  }

  function buildLaneIoHtml(laneId) {
    const t = laneIoData(laneId);
    if (!t) return '';
    const parts = [];
    parts.push(
      '<span class="qnc-timeline-inout-range" data-timeline-item="inout-range" data-track-id="' +
        esc(laneId) +
        '" data-item-id="range" tabindex="-1"></span>'
    );
    parts.push(
      '<span class="qnc-timeline-in-handle" data-timeline-item="inout-in" data-track-id="' +
        esc(laneId) +
        '" data-item-id="in" tabindex="-1" title="In"></span>'
    );
    parts.push(
      '<span class="qnc-timeline-out-handle" data-timeline-item="inout-out" data-track-id="' +
        esc(laneId) +
        '" data-item-id="out" tabindex="-1" title="Out"></span>'
    );
    (t.markers || []).forEach((m) => {
      parts.push(
        '<span class="qnc-editorial-marker qnc-timeline-lane-marker" data-timeline-item="marker" data-track-id="' +
          esc(laneId) +
          '" data-item-id="' +
          esc(m.id) +
          '" tabindex="-1">' +
          esc(m.label || 'M') +
          '</span>'
      );
    });
    return parts.join('');
  }

  function ensureLaneIoLayers(host, rebuild) {
    LANE_IO_IDS.forEach((laneId) => {
      if (!isAvailable(laneId)) return;
      const row = host.querySelector('.qnc-timeline-row[data-track-id="' + laneId + '"]');
      if (!row) return;
      const lane = row.querySelector('.qnc-timeline-lane:not(.qnc-timeline-ruler)');
      if (!lane) return;
      let layer = lane.querySelector('.qnc-timeline-lane-io');
      if (!layer) {
        layer = document.createElement('div');
        layer.className = 'qnc-timeline-lane-io';
        layer.setAttribute('data-track-lane-io', laneId);
        lane.appendChild(layer);
        rebuild = true;
      }
      if (rebuild) layer.innerHTML = buildLaneIoHtml(laneId);
    });
  }

  function syncOneLaneIoDom(host, laneId) {
    const layer = host.querySelector('.qnc-timeline-lane-io[data-track-lane-io="' + laneId + '"]');
    if (!layer) return;
    const { in_pct: inPct, out_pct: outPct } = resolveLaneInOut(laneId);
    const viewIn = globalPctToViewPct(inPct);
    const viewOut = globalPctToViewPct(outPct);
    const width = viewOut - viewIn;
    const range = layer.querySelector('[data-timeline-item="inout-range"]');
    if (range) {
      if (width >= MIN_INOUT_GAP) {
        range.style.left = viewIn + '%';
        range.style.width = width + '%';
        range.hidden = false;
      } else {
        range.hidden = true;
      }
    }
    const inEl = layer.querySelector('[data-timeline-item="inout-in"]');
    const outEl = layer.querySelector('[data-timeline-item="inout-out"]');
    if (inEl) inEl.style.left = viewIn + '%';
    if (outEl) outEl.style.left = viewOut + '%';
    (laneIoData(laneId)?.markers || []).forEach((m) => {
      const el = layer.querySelector('[data-item-id="' + m.id + '"]');
      if (el) {
        el.style.left = globalPctToViewPct(m.pct) + '%';
        el.textContent = m.label || 'M';
      }
    });
  }

  function syncEditorialDom(host) {
    if (!host || !timelineItems) return;
    const stack = host.querySelector('[data-timeline-editorial]');
    if (!stack) return;

    const anyOverlayOn = OVERLAY_IDS.some((id) => isOverlayVisible(id));
    stack.hidden = !anyOverlayOn && axisMode !== 'source_clip';

    const segLayer = stack.querySelector('[data-editorial-layer="segments"]');
    const slotLayer = stack.querySelector('[data-editorial-layer="slots"]');
    const vcLayer = stack.querySelector('[data-editorial-layer="virtual_clips"]');
    const markerLayer = stack.querySelector('[data-editorial-layer="markers"]');
    const dim = stack.querySelector('[data-timeline-clip-range-dim]');

    if (segLayer) {
      segLayer.hidden = !isOverlayVisible('segments') || axisMode !== 'montage_global';
      if (!segLayer.hidden) {
        segLayer.innerHTML = (timelineItems.segments || [])
          .map((seg) => {
            const left = globalPctToViewPct(seg.start_pct);
            const right = globalPctToViewPct(seg.start_pct + seg.width_pct);
            const width = right - left;
            const active = axisMode === 'segment_local' && activeSegment()?.id === seg.id;
            return (
              '<div class="qnc-timeline-segment-block' +
              (seg.type === 'off' ? ' type-off' : '') +
              (active ? ' is-active' : '') +
              '" data-timeline-item="segment" data-track-id="' +
              EDITORIAL_TRACK +
              '" data-item-id="' +
              esc(seg.id) +
              '" style="left:' +
              left +
              '%;width:' +
              width +
              '%" tabindex="-1">' +
              '<span class="qnc-timeline-segment-block-label">' +
              esc(seg.label || seg.type) +
              '</span></div>'
            );
          })
          .join('');
      }
    }

    if (slotLayer) {
      slotLayer.hidden = !isOverlayVisible('slots');
      if (!slotLayer.hidden) {
        rebuildMarkerSlots();
        slotLayer.innerHTML = (timelineItems.slots || [])
          .map((slot) => {
            const left = globalPctToViewPct(slot.start_pct);
            const right = globalPctToViewPct(slot.end_pct);
            return (
              '<button type="button" class="qnc-timeline-slot-btn" data-timeline-item="slot" data-track-id="' +
              EDITORIAL_TRACK +
              '" data-item-id="' +
              slot.index +
              '" style="left:' +
              left +
              '%;width:' +
              (right - left) +
              '%" title="Slot ' +
              (slot.index + 1) +
              '"></button>'
            );
          })
          .join('');
      }
    }

    if (markerLayer) {
      markerLayer.hidden = !isOverlayVisible('markers');
      if (!markerLayer.hidden) {
        markerLayer.innerHTML = (timelineItems.editorial?.markers || [])
          .map((m) => {
            return (
              '<span class="qnc-editorial-marker" data-timeline-item="marker" data-track-id="' +
              EDITORIAL_TRACK +
              '" data-item-id="' +
              esc(m.id) +
              '" style="left:' +
              globalPctToViewPct(m.pct) +
              '%" tabindex="-1">' +
              esc(m.label || 'M') +
              '</span>'
            );
          })
          .join('');
      }
    }

    if (vcLayer) {
      vcLayer.hidden = !isOverlayVisible('virtual_clips');
      if (!vcLayer.hidden) {
        let clips = timelineItems.virtual_clips || [];
        if (axisMode === 'segment_local') {
          const seg = activeSegment();
          if (seg) clips = clips.filter((vc) => vc.segment_id === seg.id);
        }
        vcLayer.innerHTML = clips
          .map((vc) => {
            const left = globalPctToViewPct(vc.left_pct);
            const right = globalPctToViewPct(vc.left_pct + vc.width_pct);
            return (
              '<span class="qnc-timeline-virtual-clip-chip' +
              (vc.role === 'cover' ? ' role-cover' : '') +
              '" data-timeline-item="virtual_clip" data-track-id="' +
              EDITORIAL_TRACK +
              '" data-item-id="' +
              esc(vc.id) +
              '" style="left:' +
              left +
              '%;width:' +
              (right - left) +
              '%" tabindex="-1">' +
              esc(vc.label) +
              '</span>'
            );
          })
          .join('');
      }
    }

    if (dim) {
      const showDim = axisMode === 'source_clip';
      dim.hidden = !showDim;
      if (showDim) {
        const cr = clipRangeBounds();
        host.style.setProperty('--qnc-timeline-clip-dim-left', globalPctToViewPct(cr.in_pct) + '%');
        host.style.setProperty(
          '--qnc-timeline-clip-dim-right',
          100 - globalPctToViewPct(cr.out_pct) + '%'
        );
      }
    }
  }

  function syncScopesDom(host) {
    if (!host || !timelineItems) return;
    timelineItems.scopes.stabilization.forEach((s) => {
      const el = host.querySelector('[data-timeline-item="stab"][data-item-id="' + s.id + '"]');
      if (!el) return;
      const c = clampScopeToClipRange(s.left_pct, s.width_pct);
      el.style.left = globalPctToViewPct(c.left_pct) + '%';
      el.style.width = globalPctToViewPct(c.left_pct + c.width_pct) - globalPctToViewPct(c.left_pct) + '%';
    });
    timelineItems.scopes.transcript.forEach((t) => {
      const el = host.querySelector('[data-timeline-item="transcript"][data-item-id="' + t.id + '"]');
      if (!el) return;
      const c = clampScopeToClipRange(t.left_pct, t.width_pct);
      el.style.left = globalPctToViewPct(c.left_pct) + '%';
      el.style.width = globalPctToViewPct(c.left_pct + c.width_pct) - globalPctToViewPct(c.left_pct) + '%';
      el.textContent = t.text;
    });
  }

  function syncAllDom(host) {
    if (!host || !timelineItems) return;
    ensureLaneIoLayers(host, !dragState);
    LANE_IO_IDS.forEach((laneId) => {
      if (isAvailable(laneId)) syncOneLaneIoDom(host, laneId);
    });
    syncEditorialDom(host);
    syncScopesDom(host);
    syncItemSelectionDom(host);
  }

  function itemDom(host, trackId, kind, id) {
    if (!host) return null;
    return host.querySelector(
      '[data-track-id="' + trackId + '"][data-timeline-item="' + kind + '"][data-item-id="' + id + '"]'
    );
  }

  function syncItemSelectionDom(host) {
    if (!host) return;
    host.querySelectorAll('[data-timeline-item].is-item-selected').forEach((el) => {
      el.classList.remove('is-item-selected');
      el.setAttribute('aria-selected', 'false');
    });
    if (!selectedItem) return;
    const el = itemDom(host, selectedItem.trackId, selectedItem.kind, selectedItem.id);
    if (el) {
      el.classList.add('is-item-selected');
      el.setAttribute('aria-selected', 'true');
    }
  }

  function selectTimelineItem(host, trackId, kind, id, focusHost) {
    if (!isItemInteractive(trackId)) return;
    if (trackId !== EDITORIAL_TRACK && !isTrackInteractive(trackId)) return;
    selectedItem = { trackId, kind, id };
    if (trackId !== EDITORIAL_TRACK) selectTrack(host, trackId);
    syncItemSelectionDom(host);
    if (focusHost !== false) host.focus();
  }

  function clearItemSelection(host) {
    selectedItem = null;
    syncItemSelectionDom(host);
  }

  function listSelectableItems() {
    const list = [];
    LANE_IO_IDS.forEach((laneId) => {
      if (!isTrackInteractive(laneId)) return;
      list.push({ trackId: laneId, kind: 'inout-in', id: 'in' });
      list.push({ trackId: laneId, kind: 'inout-range', id: 'range' });
      list.push({ trackId: laneId, kind: 'inout-out', id: 'out' });
      (laneIoData(laneId)?.markers || []).forEach((m) =>
        list.push({ trackId: laneId, kind: 'marker', id: m.id })
      );
    });
    if (isOverlayVisible('markers')) {
      (timelineItems.editorial?.markers || []).forEach((m) =>
        list.push({ trackId: EDITORIAL_TRACK, kind: 'marker', id: m.id })
      );
    }
    if (isOverlayVisible('slots')) {
      (timelineItems.slots || []).forEach((s) =>
        list.push({ trackId: EDITORIAL_TRACK, kind: 'slot', id: String(s.index) })
      );
    }
    if (isOverlayVisible('virtual_clips')) {
      (timelineItems.virtual_clips || []).forEach((vc) =>
        list.push({ trackId: EDITORIAL_TRACK, kind: 'virtual_clip', id: vc.id })
      );
    }
    if (isTrackInteractive('stabilization')) {
      timelineItems.scopes.stabilization.forEach((s) =>
        list.push({ trackId: 'stabilization', kind: 'stab', id: s.id })
      );
    }
    if (isTrackInteractive('transcript')) {
      timelineItems.scopes.transcript.forEach((t) =>
        list.push({ trackId: 'transcript', kind: 'transcript', id: t.id })
      );
    }
    return list;
  }

  function applyItemPosition(trackId, kind, id, globalPct, dragCtx) {
    if (!timelineItems) return;

    if (trackId === EDITORIAL_TRACK && kind === 'marker') {
      const m = timelineItems.editorial.markers.find((x) => x.id === id);
      if (!m) return;
      const sorted = [...timelineItems.editorial.markers].sort((a, b) => a.pct - b.pct);
      if (sorted.length >= 2) {
        const isLeft = m.id === sorted[0].id;
        if (isLeft) m.pct = clampPct(Math.min(globalPct, sorted[1].pct - MIN_INOUT_GAP));
        else m.pct = clampPct(Math.max(globalPct, sorted[0].pct + MIN_INOUT_GAP));
      } else {
        m.pct = clampPct(globalPct);
      }
      rebuildMarkerSlots();
      return;
    }

    if (trackId === EDITORIAL_TRACK && kind === 'virtual_clip') {
      const vc = timelineItems.virtual_clips.find((x) => x.id === id);
      if (vc) vc.left_pct = clampPct(Math.min(globalPct, 100 - vc.width_pct));
      return;
    }

    const lane = laneIoData(trackId);
    if (kind === 'marker' && lane) {
      const m = lane.markers.find((x) => x.id === id);
      if (m) m.pct = clampPct(globalPct);
    } else if (kind === 'inout-in' && lane) {
      lane.in_pct = clampPct(Math.min(globalPct, (lane.out_pct ?? DEFAULT_IO_OUT_PCT) - MIN_INOUT_GAP));
      if (trackId === 'video' || trackId === 'inout') {
        timelineItems.clip_range.in_pct = lane.in_pct;
      }
    } else if (kind === 'inout-out' && lane) {
      lane.out_pct = clampPct(Math.max(globalPct, (lane.in_pct ?? DEFAULT_IO_IN_PCT) + MIN_INOUT_GAP));
      if (trackId === 'video' || trackId === 'inout') {
        timelineItems.clip_range.out_pct = lane.out_pct;
      }
    } else if (kind === 'inout-range' && lane && dragCtx) {
      const width = dragCtx.startOut - dragCtx.startIn;
      let newIn = clampPct(globalPct - dragCtx.grabOffset);
      let newOut = newIn + width;
      if (newOut > 100) {
        newOut = 100;
        newIn = clampPct(100 - width);
      }
      if (newIn < 0) {
        newIn = 0;
        newOut = clampPct(width);
      }
      lane.in_pct = newIn;
      lane.out_pct = newOut;
      if (trackId === 'video' || trackId === 'inout') {
        timelineItems.clip_range.in_pct = newIn;
        timelineItems.clip_range.out_pct = newOut;
      }
    } else if (kind === 'stab') {
      const s = timelineItems.scopes.stabilization.find((x) => x.id === id);
      if (s) {
        s.left_pct = clampPct(Math.min(globalPct, 100 - s.width_pct));
        const c = clampScopeToClipRange(s.left_pct, s.width_pct);
        s.left_pct = c.left_pct;
        s.width_pct = c.width_pct;
      }
    } else if (kind === 'transcript') {
      const tx = timelineItems.scopes.transcript.find((x) => x.id === id);
      if (tx) {
        tx.left_pct = clampPct(Math.min(globalPct, 100 - tx.width_pct));
        const c = clampScopeToClipRange(tx.left_pct, tx.width_pct);
        tx.left_pct = c.left_pct;
        tx.width_pct = c.width_pct;
      }
    }
  }

  function nudgeSelectedItem(host, deltaPct) {
    if (!selectedItem || !timelineItems) return;
    const { trackId, kind, id } = selectedItem;

    if (trackId === EDITORIAL_TRACK && kind === 'marker') {
      const m = timelineItems.editorial.markers.find((x) => x.id === id);
      if (m) applyItemPosition(trackId, kind, id, m.pct + deltaPct);
    } else if (trackId === EDITORIAL_TRACK && kind === 'virtual_clip') {
      const vc = timelineItems.virtual_clips.find((x) => x.id === id);
      if (vc) applyItemPosition(trackId, kind, id, vc.left_pct + deltaPct);
    } else {
      const lane = laneIoData(trackId);
      if (kind === 'marker' && lane) {
        const m = lane.markers.find((x) => x.id === id);
        if (m) applyItemPosition(trackId, kind, id, m.pct + deltaPct);
      } else if (kind === 'inout-in' && lane) {
        applyItemPosition(trackId, kind, id, (lane.in_pct ?? DEFAULT_IO_IN_PCT) + deltaPct);
      } else if (kind === 'inout-out' && lane) {
        applyItemPosition(trackId, kind, id, (lane.out_pct ?? DEFAULT_IO_OUT_PCT) + deltaPct);
      } else if (kind === 'inout-range' && lane) {
        applyItemPosition(trackId, kind, id, (lane.in_pct ?? DEFAULT_IO_IN_PCT) + deltaPct, {
          startIn: lane.in_pct ?? DEFAULT_IO_IN_PCT,
          startOut: lane.out_pct ?? DEFAULT_IO_OUT_PCT,
          grabOffset: 0,
        });
      } else if (kind === 'stab') {
        const s = timelineItems.scopes.stabilization.find((x) => x.id === id);
        if (s) applyItemPosition(trackId, kind, id, s.left_pct + deltaPct);
      } else if (kind === 'transcript') {
        const tx = timelineItems.scopes.transcript.find((x) => x.id === id);
        if (tx) applyItemPosition(trackId, kind, id, tx.left_pct + deltaPct);
      }
    }
    syncAllDom(host);
    schedulePersist();
  }

  function cycleSelectedItem(host, reverse) {
    const list = listSelectableItems();
    if (!list.length) return;
    if (!selectedItem) {
      selectTimelineItem(host, list[0].trackId, list[0].kind, list[0].id, false);
      return;
    }
    const key = selectedItem.trackId + ':' + selectedItem.kind + ':' + selectedItem.id;
    let idx = list.findIndex((x) => x.trackId + ':' + x.kind + ':' + x.id === key);
    if (idx < 0) idx = 0;
    else idx = (idx + (reverse ? -1 : 1) + list.length) % list.length;
    selectTimelineItem(host, list[idx].trackId, list[idx].kind, list[idx].id, false);
  }

  function bindItemInteractions(host) {
    if (host.getAttribute('data-items-bound') === 'true') return;
    host.setAttribute('data-items-bound', 'true');

    host.addEventListener('pointerdown', (ev) => {
      const el = ev.target.closest('[data-timeline-item]');
      if (!el || ev.button !== 0) return;
      const kind = el.getAttribute('data-timeline-item');
      const trackId = el.getAttribute('data-track-id');
      const id = el.getAttribute('data-item-id') || kind;
      if (!trackId) return;
      if (kind === 'segment') {
        const segIdx = (timelineItems.segments || []).findIndex((s) => s.id === id);
        if (segIdx >= 0) {
          timelineItems.axis.segment_index = segIdx;
          if (axisMode === 'montage_global') {
            setAxisMode(host, 'segment_local', true);
          }
        }
        return;
      }
      if (kind === 'slot') {
        selectTimelineItem(host, trackId, kind, id, false);
        ev.preventDefault();
        return;
      }
      if (!isItemInteractive(trackId)) return;
      if (trackId !== EDITORIAL_TRACK && !isTrackInteractive(trackId)) return;
      ev.preventDefault();
      ev.stopPropagation();
      stopPlayback(host);
      selectTimelineItem(host, trackId, kind, id, false);
      const lane = el.closest('.qnc-timeline-lane') || editorialLane(host);
      const globalPct = clientXToPct(lane, ev.clientX);
      const ctx = { lane, pointerId: ev.pointerId, trackId, kind, id, startPct: globalPct };
      if (kind === 'inout-range') {
        const io = resolveLaneInOut(trackId);
        ctx.startIn = io.in_pct;
        ctx.startOut = io.out_pct;
        ctx.grabOffset = globalPct - io.in_pct;
      }
      dragState = ctx;
      el.setPointerCapture(ev.pointerId);
    });

    host.addEventListener('pointermove', (ev) => {
      if (!dragState || dragState.pointerId !== ev.pointerId) return;
      const globalPct = clientXToPct(dragState.lane, ev.clientX);
      applyItemPosition(dragState.trackId, dragState.kind, dragState.id, globalPct, dragState);
      syncAllDom(host);
    });

    host.addEventListener('pointerup', (ev) => {
      if (!dragState || dragState.pointerId !== ev.pointerId) return;
      const el = itemDom(host, dragState.trackId, dragState.kind, dragState.id);
      dragState = null;
      schedulePersist();
      if (el) {
        try {
          el.releasePointerCapture(ev.pointerId);
        } catch (err) {
          /* ignore */
        }
      }
    });

    host.addEventListener('pointercancel', () => {
      dragState = null;
      schedulePersist();
    });

    host.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-timeline-item]')) ev.stopPropagation();
    });
  }

  function ensurePlayRowHidden(host) {
    if (!host) return;
    const row = host.querySelector('.qnc-timeline-row[data-track-id="play"]');
    if (!row) return;
    row.setAttribute('data-play-hidden', 'true');
    row.setAttribute('aria-hidden', 'true');
    trackStates.play = 'on-visible';
  }

  function formatTimecodeFromPct(pct) {
    const totalFrames = Math.round((pct / 100) * DEMO_DURATION_SEC * DEMO_FPS);
    const frames = totalFrames % DEMO_FPS;
    const totalSec = Math.floor(totalFrames / DEMO_FPS);
    const sec = totalSec % 60;
    const min = Math.floor(totalSec / 60) % 60;
    const hr = Math.floor(totalSec / 3600);
    const pad = (n, w) => String(n).padStart(w, '0');
    return pad(hr, 2) + ':' + pad(min, 2) + ':' + pad(sec, 2) + ':' + pad(frames, 2);
  }

  function syncTimecodeDisplay(host) {
    const el = host.querySelector('[data-timeline-timecode]');
    if (!el) return;
    const pct = Number(host.getAttribute('data-playhead-pct') || 0);
    el.textContent = formatTimecodeFromPct(pct);
  }

  function syncAxisChip(host) {
    const chip = host.querySelector('[data-timeline-axis-chip]');
    if (!chip) return;
    let label = AXIS_LABELS[axisMode] || axisMode;
    if (axisMode === 'segment_local') {
      const seg = activeSegment();
      if (seg) label += ' · ' + (seg.label || seg.type);
    }
    chip.textContent = label;
    host.setAttribute('data-axis-mode', axisMode);
  }

  function syncPlayUi(host) {
    if (!host) return;
    host.setAttribute('data-play-state', isPlaying ? 'playing' : 'paused');
    const btn = host.querySelector('[data-timeline-play-pause]');
    if (btn) {
      btn.textContent = isPlaying ? '⏸' : '▶';
      btn.setAttribute('aria-pressed', isPlaying ? 'true' : 'false');
    }
  }

  function stopPlayback(host) {
    isPlaying = false;
    if (playTimer) {
      clearInterval(playTimer);
      playTimer = null;
    }
    syncPlayUi(host);
    schedulePersist();
  }

  function startPlayback(host) {
    isPlaying = true;
    syncPlayUi(host);
    if (playTimer) clearInterval(playTimer);
    playTimer = setInterval(() => {
      if (!timelineHost || !isPlaying) return;
      const cur = Number(timelineHost.getAttribute('data-playhead-pct') || 0);
      const next = cur + PLAY_STEP_PCT;
      if (next >= 100) {
        setPlayheadPct(timelineHost, 100);
        stopPlayback(timelineHost);
        schedulePersist();
        return;
      }
      setPlayheadPct(timelineHost, next, false);
    }, PLAY_TICK_MS);
  }

  function togglePlayPause(host) {
    if (!host) return;
    if (isPlaying) stopPlayback(host);
    else startPlayback(host);
  }

  function seekFromLaneClick(host, lane, clientX) {
    if (!host || !lane) return;
    const rect = lane.getBoundingClientRect();
    const viewRatio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    setPlayheadPct(host, viewRatio * 100);
  }

  function trackDisplayName(trackId) {
    return TRACK_NAMES[trackId]?.full || TRACK_LABELS[trackId] || trackId;
  }

  function selectTrack(host, trackId) {
    if (!host || !trackId || trackId === 'play') return;
    host.querySelectorAll('.qnc-timeline-row.is-selected').forEach((row) => {
      row.classList.remove('is-selected');
    });
    const row = host.querySelector('.qnc-timeline-row[data-track-id="' + trackId + '"]');
    if (row && isAvailable(trackId)) {
      row.classList.add('is-selected');
      selectedTrackId = trackId;
    }
  }

  function stateGlyph(st) {
    if (st === 'on-visible') return '◉';
    if (st === 'on-hidden') return '○';
    return '—';
  }

  function buildTimelineOverlayHtml(focusTrackId) {
    const parts = [];
    parts.push('<div class="qnc-design-overlay-stack">');

    parts.push('<section class="qnc-design-overlay-section">');
    parts.push('<h4 class="qnc-design-overlay-section-title">Oznake traka</h4>');
    parts.push('<div class="qnc-design-overlay-label-picks" data-overlay-row="labels">');
    const labelCells = [
      { mode: 'full', sample: 'Video' },
      { mode: 'short', sample: 'V1' },
      { mode: 'icon', sample: TRACK_NAMES.video?.icon || '▦' },
    ];
    labelCells.forEach((cell) => {
      const checked = labelDisplayMode === cell.mode;
      parts.push('<label class="qnc-design-overlay-pick">');
      parts.push(
        '<input type="radio" name="timeline-label-display" value="' +
          esc(cell.mode) +
          '"' +
          (checked ? ' checked' : '') +
          ' />'
      );
      parts.push('<span class="qnc-design-overlay-pick-preview">' + esc(cell.sample) + '</span>');
      parts.push('</label>');
    });
    parts.push('</div></section>');

    parts.push('<section class="qnc-design-overlay-section qnc-design-overlay-section--states">');
    parts.push('<div class="qnc-design-overlay-matrix">');
    parts.push('<div class="qnc-design-overlay-matrix-row qnc-design-overlay-matrix-head">');
    parts.push('<span class="qnc-design-overlay-matrix-label">Laneovi</span>');
    parts.push('<span class="qnc-design-overlay-matrix-col">◉</span>');
    parts.push('<span class="qnc-design-overlay-matrix-col">○</span>');
    parts.push('<span class="qnc-design-overlay-matrix-col">—</span>');
    parts.push('</div>');

    Object.entries(TRACK_LABELS).forEach(([trackId]) => {
      if (trackId === 'play' || !isAvailable(trackId)) return;
      const state = trackStates[trackId] || 'off';
      parts.push(
        '<div class="qnc-design-overlay-matrix-row qnc-design-overlay-matrix-row--track" data-overlay-track="' +
          esc(trackId) +
          '">'
      );
      parts.push('<span class="qnc-design-overlay-matrix-label">' + esc(trackDisplayName(trackId)) + '</span>');
      OVERLAY_STATE_COLS.forEach((st) => {
        const ui = STATE_UI[st] || { label: st, hint: '' };
        const checked = state === st;
        parts.push(
          '<label class="qnc-design-overlay-pick qnc-design-overlay-pick--state" data-state="' +
            esc(st) +
            '" title="' +
            esc(ui.hint) +
            '">'
        );
        parts.push(
          '<input type="radio" name="timeline-state-' +
            esc(trackId) +
            '" value="' +
            esc(st) +
            '"' +
            (checked ? ' checked' : '') +
            ' />'
        );
        parts.push('<span class="qnc-design-overlay-state-mark">' + esc(stateGlyph(st)) + '</span>');
        parts.push('</label>');
      });
      parts.push('</div>');
    });

    parts.push('</div></section>');

    parts.push('<section class="qnc-design-overlay-section qnc-design-overlay-section--states">');
    parts.push('<div class="qnc-design-overlay-matrix">');
    parts.push('<div class="qnc-design-overlay-matrix-row qnc-design-overlay-matrix-head">');
    parts.push('<span class="qnc-design-overlay-matrix-label">Overlay slojevi</span>');
    parts.push('<span class="qnc-design-overlay-matrix-col">◉</span>');
    parts.push('<span class="qnc-design-overlay-matrix-col">○</span>');
    parts.push('<span class="qnc-design-overlay-matrix-col">—</span>');
    parts.push('</div>');

    OVERLAY_IDS.forEach((oid) => {
      if (!isOverlayAvailable(oid)) return;
      const state = overlayStates[oid] || 'off';
      parts.push(
        '<div class="qnc-design-overlay-matrix-row qnc-design-overlay-matrix-row--overlay" data-overlay-layer="' +
          esc(oid) +
          '">'
      );
      parts.push('<span class="qnc-design-overlay-matrix-label">' + esc(OVERLAY_LABELS[oid] || oid) + '</span>');
      OVERLAY_STATE_COLS.forEach((st) => {
        const ui = STATE_UI[st] || { label: st, hint: '' };
        const checked = state === st;
        parts.push(
          '<label class="qnc-design-overlay-pick qnc-design-overlay-pick--state" data-state="' +
            esc(st) +
            '" title="' +
            esc(ui.hint) +
            '">'
        );
        parts.push(
          '<input type="radio" name="timeline-overlay-' +
            esc(oid) +
            '" value="' +
            esc(st) +
            '"' +
            (checked ? ' checked' : '') +
            ' />'
        );
        parts.push('<span class="qnc-design-overlay-state-mark">' + esc(stateGlyph(st)) + '</span>');
        parts.push('</label>');
      });
      parts.push('</div>');
    });

    parts.push('</div></section></div>');
    return parts.join('');
  }

  function openTimelineOverlay(host, focusTrackId) {
    const ov = overlay();
    if (!host || !ov) return;
    stopPlayback(host);
    if (focusTrackId && focusTrackId !== 'play' && isAvailable(focusTrackId)) {
      selectTrack(host, focusTrackId);
    }
    overlayFocusTrackId = focusTrackId || selectedTrackId || null;
    ov.open({
      component: 'timeline',
      title: 'Timeline',
      subtitle: overlayFocusTrackId ? trackDisplayName(overlayFocusTrackId) : 'Komponenta',
      hint: 'Promjene se pamte automatski · Space play/pause · Esc zatvara',
      applyLabel: 'Zatvori',
      renderBody: (body) => {
        body.innerHTML = buildTimelineOverlayHtml(overlayFocusTrackId);
        if (overlayFocusTrackId) {
          body.querySelector('[data-overlay-track="' + overlayFocusTrackId + '"]')?.scrollIntoView({
            block: 'nearest',
          });
        }
      },
      onBodyReady: () => {
        bindOverlayLiveSave(host);
      },
      onApply: () => {
        overlayFocusTrackId = null;
        host.focus();
      },
      onClose: () => {
        overlayFocusTrackId = null;
        host.focus();
      },
      focusSelector: overlayFocusTrackId
        ? '[data-overlay-track="' + overlayFocusTrackId + '"] input:checked'
        : 'input[name="timeline-label-display"]:checked',
    });
  }

  function resolveTrackFromEvent(ev) {
    const row = ev.target.closest('.qnc-timeline-row');
    if (!row) return null;
    const trackId = row.getAttribute('data-track-id');
    if (!trackId || trackId === 'play' || !isAvailable(trackId)) return null;
    return trackId;
  }

  function setLabelDisplay(host, mode) {
    if (!LABEL_DISPLAY_MODES.includes(mode)) mode = 'full';
    labelDisplayMode = mode;
    host.setAttribute('data-label-display', mode);
    schedulePersist();
  }

  function cycleLabelDisplay(host) {
    const i = LABEL_DISPLAY_MODES.indexOf(labelDisplayMode);
    setLabelDisplay(host, LABEL_DISPLAY_MODES[(i + 1) % LABEL_DISPLAY_MODES.length]);
  }

  function setPlayheadPct(host, pct, persist) {
    const clamped = Math.max(0, Math.min(100, pct));
    host.style.setProperty('--qnc-timeline-playhead', clamped + '%');
    host.setAttribute('data-playhead-pct', String(Math.round(clamped * 10) / 10));
    syncTimecodeDisplay(host);
    if (persist !== false) schedulePersist();
  }

  function setVideoPresentation(host, mode) {
    if (!VIDEO_MODES.includes(mode)) return;
    videoPresentation = mode;
    const lane = host.querySelector('.qnc-timeline-video');
    if (!lane) return;
    lane.classList.remove('qnc-timeline-video--filmstrip', 'qnc-timeline-video--inout', 'qnc-timeline-video--poster');
    const cls =
      mode === 'inout-thumbs'
        ? 'qnc-timeline-video--inout'
        : mode === 'poster'
          ? 'qnc-timeline-video--poster'
          : 'qnc-timeline-video--filmstrip';
    lane.classList.add(cls);
    const select = host.querySelector('[data-timeline-video-mode]');
    if (select) select.value = mode;
    schedulePersist();
  }

  function setAxisMode(host, mode, persist) {
    if (!AXIS_MODES.includes(mode)) return;
    axisMode = mode;
    if (timelineItems) timelineItems.axis.mode = mode;
    syncAxisChip(host);
    syncAllDom(host);
    if (persist !== false) schedulePersist();
  }

  function setOverlayState(host, overlayId, state) {
    if (!isOverlayAvailable(overlayId)) {
      overlayStates[overlayId] = 'off';
    } else if (TRACK_STATES.includes(state)) {
      overlayStates[overlayId] = state;
    }
    syncAllDom(host);
    schedulePersist();
  }

  function applyProfile(host) {
    const p = profile();
    if (!p || !host) return;
    const chip = host.querySelector('[data-timeline-profile-chip]');
    if (chip) chip.textContent = p.label || activeProfileId;

    if (p.axis_mode && AXIS_MODES.includes(p.axis_mode)) {
      setAxisMode(host, p.axis_mode, false);
    }

    const available = new Set(p.available_tracks || []);
    Object.keys(TRACK_LABELS).forEach((trackId) => {
      if (trackId === 'play') {
        trackStates[trackId] = 'on-visible';
        syncTrackDom(host, trackId, 'on-visible');
        ensurePlayRowHidden(host);
        return;
      }
      if (!available.has(trackId)) {
        trackStates[trackId] = 'off';
      } else {
        const state = p.default_track_states?.[trackId] || 'on-visible';
        trackStates[trackId] = TRACK_STATES.includes(state) ? state : 'on-visible';
      }
      syncTrackDom(host, trackId, trackStates[trackId]);
    });

    const availOverlays = new Set(p.available_overlays || OVERLAY_IDS);
    OVERLAY_IDS.forEach((oid) => {
      if (!availOverlays.has(oid)) {
        overlayStates[oid] = 'off';
      } else {
        const state = p.default_overlay_states?.[oid] || 'on-visible';
        overlayStates[oid] = TRACK_STATES.includes(state) ? state : 'on-visible';
      }
    });

    if (p.default_video_presentation) {
      setVideoPresentation(host, p.default_video_presentation);
    }
    syncAllDom(host);
  }

  function setTrackState(host, trackId, state) {
    if (trackId === 'play') return;
    if (!isAvailable(trackId)) {
      trackStates[trackId] = 'off';
    } else if (TRACK_STATES.includes(state)) {
      trackStates[trackId] = state;
    }
    syncTrackDom(host, trackId, trackStates[trackId]);
    syncAllDom(host);
    if (selectedItem && selectedItem.trackId === trackId && trackStates[trackId] !== 'on-visible') {
      clearItemSelection(host);
    }
    schedulePersist();
  }

  function bindTimeline(host) {
    host.querySelectorAll('[data-timeline-label-cycle]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        cycleLabelDisplay(host);
        const sidebar = document.querySelector('[data-qnc-slot="component-controls"]');
        if (sidebar) renderControls(sidebar);
      });
    });

    host.querySelectorAll('.qnc-timeline-row').forEach((row) => {
      const trackId = row.getAttribute('data-track-id');
      if (!trackId || trackId === 'play') return;

      row.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-timeline-label-cycle]')) return;
        if (ev.target.closest('[data-timeline-video-mode]')) return;
        if (ev.target.closest('[data-timeline-item]')) return;
        if (ev.target.closest('.qnc-timeline-ruler')) return;
        selectTrack(host, trackId);
      });

      row.addEventListener('contextmenu', (ev) => {
        const id = resolveTrackFromEvent(ev);
        if (!id) return;
        ev.preventDefault();
        openTimelineOverlay(host, id);
      });
    });

    host.addEventListener('keydown', (ev) => {
      if (overlay()?.isOpen()) return;
      if (ev.target.closest('select, textarea')) return;
      if (ev.code === 'Space' || ev.key === ' ') {
        ev.preventDefault();
        togglePlayPause(host);
        return;
      }
      if (ev.key === 'Escape' && selectedItem) {
        ev.preventDefault();
        clearItemSelection(host);
        return;
      }
      if ((ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && selectedItem) {
        ev.preventDefault();
        const step = ev.shiftKey ? ITEM_KEY_STEP_SHIFT : ITEM_KEY_STEP;
        const delta = ev.key === 'ArrowLeft' ? -step : step;
        nudgeSelectedItem(host, delta);
        return;
      }
      if (ev.key === 'Tab' && !ev.altKey) {
        const list = listSelectableItems();
        if (list.length) {
          ev.preventDefault();
          cycleSelectedItem(host, ev.shiftKey);
        }
        return;
      }
      const key = ev.key?.length === 1 ? ev.key.toLowerCase() : ev.key;
      if (key === TRACK_OVERLAY_KEY && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        const target = selectedTrackId && isAvailable(selectedTrackId) ? selectedTrackId : null;
        if (target) {
          ev.preventDefault();
          openTimelineOverlay(host, target);
        }
      }
    });

    host.querySelector('[data-timeline-play-pause]')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      togglePlayPause(host);
    });

    host.querySelector('[data-timeline-canvas]')?.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-timeline-label-cycle], [data-timeline-video-mode], [data-timeline-play-pause]')) return;
      if (ev.target.closest('[data-timeline-item]')) return;
      clearItemSelection(host);
      const lane = ev.target.closest('.qnc-timeline-lane');
      if (!lane) return;
      seekFromLaneClick(host, lane, ev.clientX);
    });

    const videoSelect = host.querySelector('[data-timeline-video-mode]');
    if (videoSelect) {
      videoSelect.addEventListener('change', () => setVideoPresentation(host, videoSelect.value));
    }
    const ruler = host.querySelector('[data-timeline-ruler]');
    if (ruler) {
      ruler.addEventListener('click', (ev) => {
        seekFromLaneClick(host, ruler, ev.clientX);
      });
    }
    const initial = Number(host.getAttribute('data-playhead-pct') || 0);
    setPlayheadPct(host, initial);
    syncPlayUi(host);
    syncAxisChip(host);
    syncAllDom(host);
    bindItemInteractions(host);
    selectTrack(host, selectedTrackId);
  }

  function renderControls(sidebar) {
    if (!sidebar) return;
    const parts = [];
    parts.push('<div class="qnc-design-component-lab">');
    parts.push('<h4>Build profile (developer)</h4>');
    parts.push('<label class="qnc-ui-label" for="qnc-design-timeline-profile">Modul</label>');
    parts.push('<select id="qnc-design-timeline-profile" class="qnc-ui-select" data-design-timeline-profile>');
    Object.entries(profiles).forEach(([id, prof]) => {
      parts.push(
        '<option value="' +
          esc(id) +
          '"' +
          (id === activeProfileId ? ' selected' : '') +
          '>' +
          esc(prof.label || id) +
          '</option>'
      );
    });
    parts.push('</select>');

    parts.push('<label class="qnc-ui-label" for="qnc-design-timeline-axis">Axis mode</label>');
    parts.push('<select id="qnc-design-timeline-axis" class="qnc-ui-select" data-design-timeline-axis>');
    AXIS_MODES.forEach((mode) => {
      parts.push(
        '<option value="' +
          esc(mode) +
          '"' +
          (mode === axisMode ? ' selected' : '') +
          '>' +
          esc(AXIS_LABELS[mode] || mode) +
          '</option>'
      );
    });
    parts.push('</select>');

    if (axisMode === 'segment_local' && timelineItems?.segments?.length) {
      parts.push('<label class="qnc-ui-label" for="qnc-design-timeline-segment">Segment</label>');
      parts.push('<select id="qnc-design-timeline-segment" class="qnc-ui-select" data-design-timeline-segment>');
      timelineItems.segments.forEach((seg, i) => {
        parts.push(
          '<option value="' +
            i +
            '"' +
            (i === (timelineItems.axis.segment_index || 0) ? ' selected' : '') +
            '>' +
            esc(seg.label || seg.type) +
            '</option>'
        );
      });
      parts.push('</select>');
    }

    renderStyleControls(parts);

    parts.push('<h4>Laneovi (korisnik)</h4>');
    parts.push(
      '<button type="button" class="qnc-ui-button qnc-ui-button-primary qnc-design-overlay-open-all" data-design-timeline-overlay>Postavke u overlayu</button>'
    );
    parts.push(
      '<p class="muted qnc-design-hint"><kbd>Space</kbd> play · <kbd>←</kbd><kbd>→</kbd> pomak · <kbd>Tab</kbd> odabir · klik segmenta → lokalni pogled.</p>'
    );
    Object.entries(TRACK_LABELS).forEach(([trackId, label]) => {
      if (trackId === 'play') return;
      const avail = isAvailable(trackId);
      const state = trackStates[trackId] || 'off';
      parts.push(
        '<div class="qnc-design-track-row' +
          (avail ? '' : ' is-unavailable') +
          '" data-design-track-row="' +
          esc(trackId) +
          '">'
      );
      parts.push('<span>' + esc(label) + ' <code>' + esc(trackId) + '</code></span>');
      parts.push('<span class="qnc-ui-chip">' + esc(state) + '</span>');
      parts.push('</div>');
    });

    parts.push('<h4>Overlay slojevi</h4>');
    OVERLAY_IDS.forEach((oid) => {
      if (!isOverlayAvailable(oid)) return;
      const state = overlayStates[oid] || 'off';
      parts.push(
        '<div class="qnc-design-track-row qnc-design-track-row--clickable" data-design-overlay-row="' +
          esc(oid) +
          '">'
      );
      parts.push('<span>' + esc(OVERLAY_LABELS[oid] || oid) + '</span>');
      parts.push('<span class="qnc-ui-chip">' + esc(state) + '</span>');
      parts.push('</div>');
    });

    parts.push('</div>');
    sidebar.innerHTML = parts.join('');

    sidebar.querySelector('[data-design-timeline-profile]')?.addEventListener('change', (ev) => {
      activeProfileId = ev.target.value;
      applyProfile(timelineHost);
      renderControls(sidebar);
      schedulePersist();
    });

    sidebar.querySelector('[data-design-timeline-axis]')?.addEventListener('change', (ev) => {
      setAxisMode(timelineHost, ev.target.value);
      renderControls(sidebar);
    });

    sidebar.querySelector('[data-design-timeline-segment]')?.addEventListener('change', (ev) => {
      if (timelineItems) timelineItems.axis.segment_index = Number(ev.target.value) || 0;
      syncAllDom(timelineHost);
      syncAxisChip(timelineHost);
      schedulePersist();
      renderControls(sidebar);
    });

    sidebar.querySelector('[data-design-timeline-overlay]')?.addEventListener('click', () => {
      if (timelineHost) openTimelineOverlay(timelineHost, selectedTrackId);
    });

    sidebar.querySelectorAll('[data-design-track-row]').forEach((row) => {
      row.addEventListener('click', () => {
        const trackId = row.getAttribute('data-design-track-row');
        if (trackId && timelineHost && isAvailable(trackId)) openTimelineOverlay(timelineHost, trackId);
      });
      row.setAttribute('title', 'Klik — overlay postavke (fokus na traku)');
      row.classList.add('qnc-design-track-row--clickable');
    });

    sidebar.querySelectorAll('[data-design-overlay-row]').forEach((row) => {
      row.addEventListener('click', () => {
        if (timelineHost) openTimelineOverlay(timelineHost, null);
      });
      row.setAttribute('title', 'Klik — overlay postavke slojeva');
    });

    bindStyleControls(sidebar, timelineHost);
  }

  async function loadStyleSchema() {
    const res = await fetch(STYLE_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('Style tokeni nisu učitani');
    styleSchema = await res.json();
    timelineStyle = mergeTimelineStyle({});
  }

  async function loadProfiles() {
    const res = await fetch(PROFILES_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('Build profili nisu učitani');
    const data = await res.json();
    profiles = data.profiles || {};
  }

  async function mount(previewEl, sidebarEl) {
    if (!previewEl) throw new Error('Nema preview elementa');
    await loadProfiles();
    await loadStyleSchema();
    const prefs = await loadTimelinePrefs();
    if (prefs?.active_profile_id) {
      const pid = prefs.active_profile_id === 'story' ? 'story-montage' : prefs.active_profile_id;
      if (profiles[pid]) activeProfileId = pid;
    }
    const res = await fetch(MOCK_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('Timeline mock nije učitan');
    previewEl.innerHTML =
      '<div class="qnc-design-timeline-host">' + (await res.text()) + '</div>';
    timelineHost = previewEl.querySelector('[data-qnc-design-timeline]');
    if (!timelineHost) throw new Error('Timeline root nije pronađen');
    trackStates = {};
    overlayStates = {};
    timelineItems = mergeTimelineItems(null);
    initDefaultLanes(timelineItems);
    prefsHydrating = true;
    decorateLabels(timelineHost);
    applyProfile(timelineHost);
    if (prefs) applyPrefsToHost(timelineHost, prefs);
    prefsHydrating = false;
    bindTimeline(timelineHost);
    renderControls(sidebarEl);
    selectTrack(timelineHost, selectedTrackId);
    return timelineHost;
  }

  window.QNCDesignTimeline = {
    mount,
    TRACK_STATES,
    VIDEO_MODES,
    LABEL_DISPLAY_MODES,
    TRACK_NAMES,
    AXIS_MODES,
    AXIS_LABELS,
    OVERLAY_IDS,
  };
})();
