/* Story segment — komponenta s punim katalogom. Build profil određuje available_tracks / available_layers. */
(function () {
  const MOCK_URL = '/plugins/design-tools/story-segment/mock.html';
  const PROFILES_URL = '/plugins/design-tools/story-segment/build-profiles.json';
  const STYLE_URL = '/plugins/design-tools/timeline/style-tokens.json';
  const PREFS_API = '/api/design-tools/timeline-lab';

  const TRACK_STATES = ['off', 'on-visible', 'on-hidden'];
  const OVERLAY_STATE_COLS = ['on-visible', 'on-hidden', 'off'];
  const LABEL_DISPLAY_MODES = ['full', 'short', 'icon'];
  const MEDIA_LANE_IDS = ['video', 'audio-1', 'audio-2', 'audio-3', 'audio-4'];
  const AUDIO_LANE_IDS = ['audio-1', 'audio-2', 'audio-3', 'audio-4'];

  const TRACK_LABELS = {
    play: 'Play',
    video: 'Video',
    'audio-1': 'Audio 1',
    'audio-2': 'Audio 2',
    'audio-3': 'Audio 3',
    'audio-4': 'Audio 4',
  };

  const TRACK_NAMES = {
    play: { full: 'Play', short: 'PL', icon: '▶' },
    video: { full: 'Video', short: 'V', icon: '▦' },
    'audio-1': { full: 'Audio 1', short: 'A1', icon: '♪' },
    'audio-2': { full: 'Audio 2', short: 'A2', icon: '♪' },
    'audio-3': { full: 'Audio 3', short: 'A3', icon: '♪' },
    'audio-4': { full: 'Audio 4', short: 'A4', icon: '♪' },
  };

  /** Pun katalog slojeva komponente (developer bira podskup u build profilu). */
  const ALL_LAYER_IDS = ['inout', 'transcript', 'stabilization', 'markers'];
  const LAYER_LABELS = {
    inout: 'In–Out',
    transcript: 'Transkript',
    stabilization: 'Stabilizacija',
    markers: 'Markeri',
  };

  const SEGMENT_TYPE_LABELS = { izjava: 'Izjava', off: 'Off' };

  let profiles = {};
  let styleSchema = null;
  let timelineStyle = {};
  let activeProfileId = 'izjava';
  let trackStates = {};
  let layerStates = {};
  let audioWaveStates = {};
  let segmentHost = null;
  let selectedTrackId = 'video';
  let isPlaying = false;
  let playTimer = null;
  let prefsHydrating = false;
  let saveTimer = null;
  let labelDisplayMode = 'full';
  let segmentModel = null;
  let selectedItem = null;
  let dragState = null;

  const DEMO_FPS = 25;
  const PLAY_TICK_MS = 40;
  const PLAY_STEP_PCT = 0.12;
  const MIN_INOUT_GAP = 2;
  const DEFAULT_IO_IN_PCT = 0;
  const DEFAULT_IO_OUT_PCT = 10;
  const ITEM_KEY_STEP = 0.5;
  const ITEM_KEY_STEP_SHIFT = 2.5;

  const overlay = () => window.QNCDesignOverlay;

  function esc(v) {
    return String(v || '')
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

  function profile() {
    return profiles[activeProfileId] || null;
  }

  function clampPct(v) {
    return Math.max(0, Math.min(100, Math.round(Number(v) * 10) / 10));
  }

  function defaultSegmentModel(type) {
    const t = type === 'off' ? 'off' : 'izjava';
    return {
      version: 1,
      type: t,
      label: t === 'off' ? 'Off 1' : 'Izjava 1',
      duration_sec: t === 'off' ? 18 : 45,
      in_pct: DEFAULT_IO_IN_PCT,
      out_pct: DEFAULT_IO_OUT_PCT,
      scopes: {
        stabilization: [{ id: 's1', left_pct: 0, width_pct: 10 }],
        transcript: [{ id: 't1', left_pct: 0, width_pct: 10, text: 'Transkript isječka …' }],
        markers: [{ id: 'm1', pct: 35, label: 'M' }],
      },
    };
  }

  function mergeSegmentModel(saved, typeHint) {
    const base = defaultSegmentModel(typeHint || profile()?.segment_type || 'izjava');
    if (!saved || typeof saved !== 'object') return base;
    const src = saved.segment || saved;
    if (src.type === 'off' || src.type === 'izjava') base.type = src.type;
    if (src.label) base.label = String(src.label);
    if (src.duration_sec != null) base.duration_sec = Number(src.duration_sec) || base.duration_sec;
    if (src.in_pct != null) base.in_pct = clampPct(src.in_pct);
    if (src.out_pct != null) base.out_pct = clampPct(src.out_pct);
    if (base.out_pct >= 95 && base.in_pct <= 1) base.out_pct = DEFAULT_IO_OUT_PCT;
    if (src.scopes?.stabilization) {
      base.scopes.stabilization = src.scopes.stabilization.map((s, i) => ({
        id: String(s.id || 's' + (i + 1)),
        left_pct: clampPct(s.left_pct ?? 0),
        width_pct: clampPct(s.width_pct ?? 10),
      }));
    }
    if (src.scopes?.transcript) {
      base.scopes.transcript = src.scopes.transcript.map((t, i) => ({
        id: String(t.id || 't' + (i + 1)),
        left_pct: clampPct(t.left_pct ?? 0),
        width_pct: clampPct(t.width_pct ?? 10),
        text: String(t.text ?? '…'),
      }));
    }
    if (src.scopes?.markers) {
      base.scopes.markers = src.scopes.markers.map((m, i) => ({
        id: String(m.id || 'm' + (i + 1)),
        pct: clampPct(m.pct ?? 0),
        label: String(m.label ?? 'M'),
      }));
    }
    if (base.out_pct < base.in_pct + MIN_INOUT_GAP) {
      base.out_pct = clampPct(base.in_pct + MIN_INOUT_GAP);
    }
    return base;
  }

  function isAvailableTrack(id) {
    if (id === 'play') return true;
    return (profile()?.available_tracks || []).includes(id);
  }

  function isAvailableLayer(id) {
    return ALL_LAYER_IDS.includes(id) && (profile()?.available_layers || []).includes(id);
  }

  function isLayerVisible(id) {
    return isAvailableLayer(id) && layerStates[id] === 'on-visible';
  }

  function isTrackInteractive(id) {
    return isAvailableTrack(id) && trackStates[id] === 'on-visible';
  }

  function isAudioLane(id) {
    return AUDIO_LANE_IDS.includes(id);
  }

  function defaultAudioWaveStates() {
    const out = {};
    AUDIO_LANE_IDS.forEach((id) => {
      out[id] = profile()?.default_audio_wave_states?.[id] === true;
    });
    return out;
  }

  function collectPrefs() {
    const tracks = {};
    Object.keys(TRACK_LABELS).forEach((id) => {
      if (id !== 'play') tracks[id] = trackStates[id] || 'off';
    });
    const layers = {};
    ALL_LAYER_IDS.forEach((id) => {
      layers[id] = layerStates[id] || 'off';
    });
    const waves = {};
    AUDIO_LANE_IDS.forEach((id) => {
      waves[id] = audioWaveStates[id] === true;
    });
    return {
      version: 2,
      component: 'story-segment',
      active_profile_id: activeProfileId,
      label_display: labelDisplayMode,
      playhead_pct: Number(segmentHost?.getAttribute('data-playhead-pct') || 0),
      track_states: tracks,
      layer_states: layers,
      audio_wave_states: waves,
      style: { ...timelineStyle },
      segment: JSON.parse(JSON.stringify(segmentModel)),
    };
  }

  function schedulePersist() {
    if (prefsHydrating) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistPrefs, 150);
  }

  async function loadPrefs() {
    try {
      const res = await fetch(PREFS_API, { cache: 'no-store' });
      if (!res.ok) return null;
      return (await res.json()).prefs || null;
    } catch {
      return null;
    }
  }

  async function persistPrefs() {
    if (prefsHydrating || !segmentHost) return;
    try {
      await fetch(PREFS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefs: collectPrefs() }),
      });
    } catch (err) {
      console.warn('[story-segment]', err);
    }
  }

  function mergeTimelineStyle(saved) {
    const merged = {};
    const defaults = styleSchema?.defaults || {};
    Object.keys(defaults).forEach((name) => {
      merged[name] = saved?.[name] != null ? String(saved[name]) : String(defaults[name] ?? '');
    });
    return merged;
  }

  function applyStyleTokens(host, style) {
    if (!host || !styleSchema) return;
    Object.keys(styleSchema.defaults || {}).forEach((name) => {
      const val = style[name];
      const def = String(styleSchema.defaults[name] ?? '');
      if (val == null || val === '' || String(val) === def) host.style.removeProperty(name);
      else host.style.setProperty(name, String(val));
    });
  }

  function setLabelDisplay(host, mode) {
    if (!LABEL_DISPLAY_MODES.includes(mode)) mode = 'full';
    labelDisplayMode = mode;
    host.setAttribute('data-label-display', mode);
    host.querySelectorAll('.qnc-timeline-name[data-track-id]').forEach((el) => {
      const n = TRACK_NAMES[el.getAttribute('data-track-id')];
      if (!n) return;
      el.textContent = mode === 'icon' ? n.icon : mode === 'short' ? n.short : n.full;
    });
    schedulePersist();
  }

  function syncTrackDom(host, trackId, state) {
    host.querySelectorAll('.qnc-timeline-row[data-track-id="' + trackId + '"]').forEach((row) => {
      row.setAttribute('data-track-state', state);
      const btn = row.querySelector('[data-timeline-track-state]');
      if (btn) btn.textContent = toggleIcon(isAvailableTrack(trackId) ? state : 'off');
      if (!isAvailableTrack(trackId) && trackId !== 'play') {
        row.setAttribute('data-track-unavailable', 'true');
      } else {
        row.removeAttribute('data-track-unavailable');
      }
    });
  }

  function setTrackState(host, trackId, state) {
    if (trackId === 'play') return;
    trackStates[trackId] = isAvailableTrack(trackId) && TRACK_STATES.includes(state) ? state : 'off';
    syncTrackDom(host, trackId, trackStates[trackId]);
    syncAllDom(host);
    schedulePersist();
  }

  function setLayerState(host, layerId, state) {
    layerStates[layerId] = isAvailableLayer(layerId) && TRACK_STATES.includes(state) ? state : 'off';
    syncAllDom(host);
    schedulePersist();
  }

  function setAudioWave(host, trackId, on) {
    if (!isAudioLane(trackId) || !isAvailableTrack(trackId)) return;
    audioWaveStates[trackId] = on === true;
    syncAudioWaveDom(host, trackId);
    schedulePersist();
  }

  function syncAudioWaveDom(host, trackId) {
    if (!isAudioLane(trackId)) return;
    const lane = mediaLaneEl(host, trackId);
    if (!lane) return;
    const show = audioWaveStates[trackId] === true && trackStates[trackId] !== 'off';
    let wave = lane.querySelector('.qnc-timeline-audio-wave');
    if (show) {
      if (!wave) {
        wave = document.createElement('div');
        wave.className = 'qnc-timeline-audio-wave';
        wave.setAttribute('aria-hidden', 'true');
        const io = lane.querySelector('.qnc-timeline-lane-io');
        if (io) lane.insertBefore(wave, io);
        else lane.appendChild(wave);
      }
      lane.setAttribute('data-audio-wave', 'on');
    } else {
      wave?.remove();
      lane.removeAttribute('data-audio-wave');
    }
  }

  function syncAllAudioWaves(host) {
    AUDIO_LANE_IDS.forEach((id) => {
      if (isAvailableTrack(id)) syncAudioWaveDom(host, id);
    });
  }

  function syncSegmentChrome(host) {
    if (!segmentModel) return;
    host.setAttribute('data-segment-type', segmentModel.type);
    const pt = profile()?.primary_track;
    if (pt) host.setAttribute('data-primary-track', pt);
    const kind = host.querySelector('[data-segment-kind-chip]');
    if (kind) kind.textContent = 'Story segment · ' + (SEGMENT_TYPE_LABELS[segmentModel.type] || segmentModel.type);
    const dur = host.querySelector('[data-segment-duration-chip]');
    if (dur) {
      const sec = segmentModel.duration_sec || 45;
      dur.textContent = Math.floor(sec / 60) + ':' + String(Math.floor(sec % 60)).padStart(2, '0');
    }
  }

  function isMediaLane(id) {
    return MEDIA_LANE_IDS.includes(id);
  }

  function primaryTrack() {
    return profile()?.primary_track || 'video';
  }

  function mediaLaneEl(host, laneId) {
    const row = host.querySelector('.qnc-timeline-row[data-track-id="' + laneId + '"]');
    return row?.querySelector('.qnc-timeline-lane:not(.qnc-timeline-ruler)') || null;
  }

  function laneIoVisible(laneId) {
    return isAvailableTrack(laneId) && trackStates[laneId] !== 'off' && isLayerVisible('inout');
  }

  function buildLaneIoHtml(laneId) {
    return (
      '<span class="qnc-timeline-inout-range" data-timeline-item="inout-range" data-track-id="' +
      esc(laneId) +
      '" data-item-id="range" tabindex="-1"></span>' +
      '<span class="qnc-timeline-in-handle" data-timeline-item="inout-in" data-track-id="' +
      esc(laneId) +
      '" data-item-id="in" tabindex="-1" title="In"></span>' +
      '<span class="qnc-timeline-out-handle" data-timeline-item="inout-out" data-track-id="' +
      esc(laneId) +
      '" data-item-id="out" tabindex="-1" title="Out"></span>'
    );
  }

  function ensureLaneIoLayers(host, rebuild) {
    host.querySelectorAll('.qnc-timeline-lane-io').forEach((el) => {
      const laneId = el.getAttribute('data-track-lane-io');
      if (!laneIoVisible(laneId)) el.remove();
    });
    if (!isLayerVisible('inout')) return;
    MEDIA_LANE_IDS.forEach((laneId) => {
      if (!laneIoVisible(laneId)) return;
      const lane = mediaLaneEl(host, laneId);
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
    if (!layer || !segmentModel) return;
    const { in_pct: i, out_pct: o } = segmentModel;
    const w = o - i;
    const range = layer.querySelector('[data-timeline-item="inout-range"]');
    if (range) {
      if (w >= MIN_INOUT_GAP) {
        range.style.left = i + '%';
        range.style.width = w + '%';
        range.hidden = false;
      } else {
        range.hidden = true;
      }
    }
    const inEl = layer.querySelector('[data-timeline-item="inout-in"]');
    const outEl = layer.querySelector('[data-timeline-item="inout-out"]');
    if (inEl) inEl.style.left = i + '%';
    if (outEl) outEl.style.left = o + '%';
    layer.style.setProperty('--qnc-io-in', i + '%');
    layer.style.setProperty('--qnc-io-out', o + '%');
  }

  function buildLaneScopesHtml() {
    const pt = primaryTrack();
    const parts = [];
    if (isLayerVisible('stabilization')) {
      segmentModel.scopes.stabilization.forEach((s) => {
        parts.push(
          '<span class="qnc-timeline-stab-segment" data-timeline-item="stab" data-track-id="' +
            esc(pt) +
            '" data-item-id="' +
            esc(s.id) +
            '" tabindex="-1"></span>'
        );
      });
    }
    if (isLayerVisible('transcript')) {
      segmentModel.scopes.transcript.forEach((t) => {
        parts.push(
          '<span class="qnc-editorial-transcript-line" data-timeline-item="transcript" data-track-id="' +
            esc(pt) +
            '" data-item-id="' +
            esc(t.id) +
            '" tabindex="-1">' +
            esc(t.text) +
            '</span>'
        );
      });
    }
    return parts.join('');
  }

  function ensureLaneScopeLayer(host, rebuild) {
    host.querySelectorAll('.qnc-timeline-lane-scopes').forEach((el) => el.remove());
    const pt = primaryTrack();
    const showScopes = isLayerVisible('stabilization') || isLayerVisible('transcript');
    if (!showScopes) return;
    const lane = mediaLaneEl(host, pt);
    if (!lane || trackStates[pt] === 'off') return;
    let layer = lane.querySelector('.qnc-timeline-lane-scopes');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'qnc-timeline-lane-scopes';
      layer.setAttribute('data-track-lane-scopes', pt);
      lane.appendChild(layer);
      rebuild = true;
    }
    if (rebuild) layer.innerHTML = buildLaneScopesHtml();
  }

  function syncLaneScopesDom(host) {
    const pt = primaryTrack();
    const layer = host.querySelector('.qnc-timeline-lane-scopes[data-track-lane-scopes="' + pt + '"]');
    if (!layer || !segmentModel) return;
    segmentModel.scopes.stabilization.forEach((s) => {
      const el = layer.querySelector('[data-timeline-item="stab"][data-item-id="' + s.id + '"]');
      if (el) {
        el.style.left = s.left_pct + '%';
        el.style.width = s.width_pct + '%';
        el.hidden = !isLayerVisible('stabilization');
      }
    });
    segmentModel.scopes.transcript.forEach((t) => {
      const el = layer.querySelector('[data-timeline-item="transcript"][data-item-id="' + t.id + '"]');
      if (el) {
        el.style.left = t.left_pct + '%';
        el.style.width = t.width_pct + '%';
        el.textContent = t.text;
        el.hidden = !isLayerVisible('transcript');
      }
    });
  }

  function buildLaneMarkersHtml() {
    const pt = primaryTrack();
    return (segmentModel.scopes.markers || [])
      .map(
        (m) =>
          '<span class="qnc-editorial-marker qnc-timeline-lane-marker" data-timeline-item="marker" data-track-id="' +
          esc(pt) +
          '" data-item-id="' +
          esc(m.id) +
          '" tabindex="-1">' +
          esc(m.label || 'M') +
          '</span>'
      )
      .join('');
  }

  function ensureLaneMarkerLayer(host, rebuild) {
    host.querySelectorAll('.qnc-timeline-lane-markers').forEach((el) => el.remove());
    if (!isLayerVisible('markers')) return;
    const pt = primaryTrack();
    const lane = mediaLaneEl(host, pt);
    if (!lane || trackStates[pt] === 'off') return;
    let layer = lane.querySelector('.qnc-timeline-lane-markers');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'qnc-timeline-lane-markers';
      layer.setAttribute('data-track-lane-markers', pt);
      lane.appendChild(layer);
      rebuild = true;
    }
    if (rebuild) layer.innerHTML = buildLaneMarkersHtml();
  }

  function syncLaneMarkersDom(host) {
    const pt = primaryTrack();
    const layer = host.querySelector('.qnc-timeline-lane-markers[data-track-lane-markers="' + pt + '"]');
    if (!layer || !segmentModel) return;
    (segmentModel.scopes.markers || []).forEach((m) => {
      const el = layer.querySelector('[data-timeline-item="marker"][data-item-id="' + m.id + '"]');
      if (el) {
        el.style.left = m.pct + '%';
        el.textContent = m.label || 'M';
        el.hidden = !isLayerVisible('markers');
      }
    });
  }

  function syncOverlaysDom(host) {
    if (!segmentModel) return;
    ensureLaneIoLayers(host, !dragState);
    MEDIA_LANE_IDS.forEach((laneId) => {
      if (laneIoVisible(laneId)) syncOneLaneIoDom(host, laneId);
    });
    ensureLaneScopeLayer(host, !dragState);
    syncLaneScopesDom(host);
    ensureLaneMarkerLayer(host, !dragState);
    syncLaneMarkersDom(host);
    syncItemSelectionDom(host);
  }

  function syncAllDom(host) {
    syncAllAudioWaves(host);
    syncOverlaysDom(host);
    syncSegmentChrome(host);
  }

  function itemDom(host, trackId, kind, id) {
    return host.querySelector(
      '[data-track-id="' + trackId + '"][data-timeline-item="' + kind + '"][data-item-id="' + id + '"]'
    );
  }

  function syncItemSelectionDom(host) {
    host.querySelectorAll('[data-timeline-item].is-item-selected').forEach((el) => el.classList.remove('is-item-selected'));
    if (!selectedItem) return;
    const { trackId, kind, id } = selectedItem;
    if (kind.startsWith('inout-')) {
      MEDIA_LANE_IDS.forEach((laneId) => {
        const el = itemDom(host, laneId, kind, id);
        if (el) el.classList.add('is-item-selected');
      });
      return;
    }
    const el = itemDom(host, trackId, kind, id);
    if (el) el.classList.add('is-item-selected');
  }

  function listSelectableItems() {
    const list = [];
    const pt = primaryTrack();
    if (isLayerVisible('inout')) {
      MEDIA_LANE_IDS.forEach((laneId) => {
        if (!laneIoVisible(laneId)) return;
        list.push({ trackId: laneId, kind: 'inout-in', id: 'in' });
        list.push({ trackId: laneId, kind: 'inout-range', id: 'range' });
        list.push({ trackId: laneId, kind: 'inout-out', id: 'out' });
      });
    }
    if (isLayerVisible('stabilization')) {
      segmentModel.scopes.stabilization.forEach((s) => list.push({ trackId: pt, kind: 'stab', id: s.id }));
    }
    if (isLayerVisible('transcript')) {
      segmentModel.scopes.transcript.forEach((t) => list.push({ trackId: pt, kind: 'transcript', id: t.id }));
    }
    if (isLayerVisible('markers')) {
      (segmentModel.scopes.markers || []).forEach((m) => list.push({ trackId: pt, kind: 'marker', id: m.id }));
    }
    return list;
  }

  function applyItemPosition(kind, id, pct, dragCtx) {
    if (!segmentModel) return;
    if (kind === 'inout-in') {
      segmentModel.in_pct = clampPct(Math.min(pct, segmentModel.out_pct - MIN_INOUT_GAP));
    } else if (kind === 'inout-out') {
      segmentModel.out_pct = clampPct(Math.max(pct, segmentModel.in_pct + MIN_INOUT_GAP));
    } else if (kind === 'inout-range' && dragCtx) {
      const w = dragCtx.startOut - dragCtx.startIn;
      let ni = clampPct(pct - dragCtx.grabOffset);
      let no = ni + w;
      if (no > 100) {
        no = 100;
        ni = clampPct(100 - w);
      }
      if (ni < 0) {
        ni = 0;
        no = clampPct(w);
      }
      segmentModel.in_pct = ni;
      segmentModel.out_pct = no;
    } else if (kind === 'stab') {
      const s = segmentModel.scopes.stabilization.find((x) => x.id === id);
      if (s) s.left_pct = clampPct(Math.min(pct, 100 - s.width_pct));
    } else if (kind === 'transcript') {
      const t = segmentModel.scopes.transcript.find((x) => x.id === id);
      if (t) t.left_pct = clampPct(Math.min(pct, 100 - t.width_pct));
    } else if (kind === 'marker') {
      const m = (segmentModel.scopes.markers || []).find((x) => x.id === id);
      if (m) m.pct = clampPct(pct);
    }
  }

  function clientXToPct(lane, clientX) {
    if (!lane) return 0;
    const rect = lane.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return clampPct(((clientX - rect.left) / rect.width) * 100);
  }

  function bindInteractions(host) {
    if (host.dataset.bound) return;
    host.dataset.bound = '1';

    host.addEventListener('pointerdown', (ev) => {
      const el = ev.target.closest('[data-timeline-item]');
      if (!el || ev.button !== 0) return;
      const kind = el.getAttribute('data-timeline-item');
      const id = el.getAttribute('data-item-id');
      const trackId = el.getAttribute('data-track-id');
      if (kind.startsWith('inout-')) {
        if (!isMediaLane(trackId) || !laneIoVisible(trackId)) return;
      } else if (kind === 'stab') {
        if (!isLayerVisible('stabilization') || trackId !== primaryTrack()) return;
      } else if (kind === 'transcript') {
        if (!isLayerVisible('transcript') || trackId !== primaryTrack()) return;
      } else if (kind === 'marker') {
        if (!isLayerVisible('markers') || trackId !== primaryTrack()) return;
      } else {
        return;
      }
      ev.preventDefault();
      stopPlayback(host);
      const lane = el.closest('.qnc-timeline-lane');
      selectedItem = { trackId, kind, id };
      syncItemSelectionDom(host);
      const pct = clientXToPct(lane, ev.clientX);
      dragState = {
        pointerId: ev.pointerId,
        kind,
        id,
        trackId,
        lane,
        grabOffset: 0,
        startIn: segmentModel.in_pct,
        startOut: segmentModel.out_pct,
      };
      if (kind === 'inout-range') dragState.grabOffset = pct - segmentModel.in_pct;
      el.setPointerCapture(ev.pointerId);
    });

    host.addEventListener('pointermove', (ev) => {
      if (!dragState || dragState.pointerId !== ev.pointerId) return;
      applyItemPosition(dragState.kind, dragState.id, clientXToPct(dragState.lane, ev.clientX), dragState);
      syncOverlaysDom(host);
    });

    host.addEventListener('pointerup', () => {
      dragState = null;
      schedulePersist();
    });

    host.addEventListener('keydown', (ev) => {
      if (ev.code === 'Space') {
        ev.preventDefault();
        togglePlayPause(host);
      }
      if (ev.key === 'Escape') {
        selectedItem = null;
        syncItemSelectionDom(host);
      }
      if ((ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && selectedItem) {
        ev.preventDefault();
        const step = ev.shiftKey ? ITEM_KEY_STEP_SHIFT : ITEM_KEY_STEP;
        const d = ev.key === 'ArrowLeft' ? -step : step;
        const { kind, id } = selectedItem;
        if (kind === 'inout-in') applyItemPosition(kind, id, segmentModel.in_pct + d);
        else if (kind === 'inout-out') applyItemPosition(kind, id, segmentModel.out_pct + d);
        else if (kind === 'inout-range') applyItemPosition(kind, id, segmentModel.in_pct + d, dragState);
        else if (kind === 'stab') {
          const s = segmentModel.scopes.stabilization.find((x) => x.id === id);
          if (s) applyItemPosition(kind, id, s.left_pct + d);
        } else if (kind === 'transcript') {
          const t = segmentModel.scopes.transcript.find((x) => x.id === id);
          if (t) applyItemPosition(kind, id, t.left_pct + d);
        } else if (kind === 'marker') {
          const m = (segmentModel.scopes.markers || []).find((x) => x.id === id);
          if (m) applyItemPosition(kind, id, m.pct + d);
        }
        syncOverlaysDom(host);
        schedulePersist();
      }
    });

    host.querySelector('[data-timeline-play-pause]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePlayPause(host);
    });

    host.querySelector('[data-timeline-canvas]')?.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-timeline-item], select, button')) return;
      selectedItem = null;
      syncItemSelectionDom(host);
      const lane = ev.target.closest('.qnc-timeline-lane');
      if (lane) setPlayheadPct(host, clientXToPct(lane, ev.clientX));
    });

    host.querySelectorAll('[data-timeline-label-cycle]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const i = LABEL_DISPLAY_MODES.indexOf(labelDisplayMode);
        setLabelDisplay(host, LABEL_DISPLAY_MODES[(i + 1) % LABEL_DISPLAY_MODES.length]);
      });
    });

    host.querySelectorAll('.qnc-timeline-row').forEach((row) => {
      const trackId = row.getAttribute('data-track-id');
      if (!trackId || trackId === 'play' || !isAvailableTrack(trackId)) return;
      row.addEventListener('contextmenu', (ev) => {
        if (ev.target.closest('[data-timeline-label-cycle]')) return;
        ev.preventDefault();
        openSettingsOverlay(host, trackId);
      });
    });
  }

  function formatTc(pct) {
    const sec = segmentModel?.duration_sec || 45;
    const total = Math.round((pct / 100) * sec * DEMO_FPS);
    const f = total % DEMO_FPS;
    const ts = Math.floor(total / DEMO_FPS);
    const pad = (n) => String(n).padStart(2, '0');
    return pad(Math.floor(ts / 3600)) + ':' + pad(Math.floor(ts / 60) % 60) + ':' + pad(ts % 60) + ':' + pad(f);
  }

  function setPlayheadPct(host, pct, persist) {
    const c = Math.max(0, Math.min(100, pct));
    host.style.setProperty('--qnc-timeline-playhead', c + '%');
    host.setAttribute('data-playhead-pct', String(Math.round(c * 10) / 10));
    const tc = host.querySelector('[data-timeline-timecode]');
    if (tc) tc.textContent = formatTc(c);
    if (persist !== false) schedulePersist();
  }

  function togglePlayPause(host) {
    if (isPlaying) stopPlayback(host);
    else startPlayback(host);
  }

  function stopPlayback(host) {
    isPlaying = false;
    clearInterval(playTimer);
    playTimer = null;
    host.setAttribute('data-play-state', 'paused');
    const btn = host.querySelector('[data-timeline-play-pause]');
    if (btn) {
      btn.textContent = '▶';
      btn.setAttribute('aria-pressed', 'false');
    }
  }

  function startPlayback(host) {
    isPlaying = true;
    host.setAttribute('data-play-state', 'playing');
    const btn = host.querySelector('[data-timeline-play-pause]');
    if (btn) {
      btn.textContent = '⏸';
      btn.setAttribute('aria-pressed', 'true');
    }
    playTimer = setInterval(() => {
      const cur = Number(host.getAttribute('data-playhead-pct') || 0);
      if (cur >= 100) stopPlayback(host);
      else setPlayheadPct(host, cur + PLAY_STEP_PCT, false);
    }, PLAY_TICK_MS);
  }

  function applyProfile(host) {
    const p = profile();
    if (!p) return;
    segmentModel.type = p.segment_type || segmentModel.type;
    segmentModel.duration_sec = p.demo_duration_sec || segmentModel.duration_sec;

    Object.keys(TRACK_LABELS).forEach((id) => {
      if (id === 'play') return;
      if (!isAvailableTrack(id)) {
        trackStates[id] = 'off';
        syncTrackDom(host, id, 'off');
        return;
      }
      const st = p.default_track_states?.[id] || 'off';
      trackStates[id] = TRACK_STATES.includes(st) ? st : 'off';
      syncTrackDom(host, id, trackStates[id]);
    });
    trackStates.play = 'on-visible';
    syncTrackDom(host, 'play', 'on-visible');

    audioWaveStates = defaultAudioWaveStates();
    AUDIO_LANE_IDS.forEach((id) => {
      if (p.default_audio_wave_states && id in p.default_audio_wave_states) {
        audioWaveStates[id] = p.default_audio_wave_states[id] === true;
      }
    });

    ALL_LAYER_IDS.forEach((id) => {
      if (!isAvailableLayer(id)) {
        layerStates[id] = 'off';
        return;
      }
      const st = p.default_layer_states?.[id] || 'off';
      layerStates[id] = TRACK_STATES.includes(st) ? st : 'off';
    });

    syncAllDom(host);
  }

  function openSettingsOverlay(host, focusTrackId) {
    const ov = overlay();
    if (!ov) return;
    const parts = [];
    parts.push('<div class="qnc-design-overlay-stack">');
    parts.push('<section><h4>Trake (medij)</h4><p class="muted qnc-design-hint">◉ vidljivo · ○ skriveno · — isključeno</p><div class="qnc-design-overlay-matrix">');
    Object.keys(TRACK_LABELS).forEach((id) => {
      if (id === 'play' || !isAvailableTrack(id)) return;
      parts.push(
        '<div class="qnc-design-overlay-matrix-row"' +
          (focusTrackId === id ? ' data-overlay-track="' + esc(id) + '"' : '') +
          '><span>' +
          esc(TRACK_LABELS[id]) +
          '</span>'
      );
      OVERLAY_STATE_COLS.forEach((st) => {
        parts.push(
          '<label><input type="radio" name="track-' +
            id +
            '" value="' +
            st +
            '"' +
            (trackStates[id] === st ? ' checked' : '') +
            '> ' +
            toggleIcon(st) +
            '</label>'
        );
      });
      parts.push('</div>');
    });
    parts.push('</div></section>');

    parts.push('<section><h4>Audio — waveform</h4><div class="qnc-design-overlay-matrix">');
    AUDIO_LANE_IDS.forEach((id) => {
      if (!isAvailableTrack(id)) return;
      parts.push('<div class="qnc-design-overlay-matrix-row"><span>' + esc(TRACK_LABELS[id]) + '</span>');
      parts.push(
        '<label><input type="radio" name="wave-' +
          id +
          '" value="on"' +
          (audioWaveStates[id] === true ? ' checked' : '') +
          '> Val</label>'
      );
      parts.push(
        '<label><input type="radio" name="wave-' +
          id +
          '" value="off"' +
          (audioWaveStates[id] !== true ? ' checked' : '') +
          '> Bez vala</label>'
      );
      parts.push('</div>');
    });
    parts.push('</div></section>');

    parts.push('<section><h4>Slojevi (u build profilu)</h4><div class="qnc-design-overlay-matrix">');
    ALL_LAYER_IDS.forEach((id) => {
      if (!isAvailableLayer(id)) return;
      parts.push('<div class="qnc-design-overlay-matrix-row"><span>' + esc(LAYER_LABELS[id]) + '</span>');
      OVERLAY_STATE_COLS.forEach((st) => {
        parts.push(
          '<label><input type="radio" name="layer-' +
            id +
            '" value="' +
            st +
            '"' +
            (layerStates[id] === st ? ' checked' : '') +
            '> ' +
            toggleIcon(st) +
            '</label>'
        );
      });
      parts.push('</div>');
    });
    parts.push('</div></section></div>');

    ov.open({
      component: 'story-segment',
      title: 'Story segment',
      subtitle: focusTrackId ? TRACK_LABELS[focusTrackId] || 'Trake + slojevi' : 'Trake + slojevi',
      applyLabel: 'Zatvori',
      renderBody: (body) => {
        body.innerHTML = parts.join('');
        if (focusTrackId) {
          body.querySelector('[data-overlay-track="' + focusTrackId + '"]')?.scrollIntoView({ block: 'nearest' });
        }
        body.querySelectorAll('input[type="radio"]').forEach((input) => {
          input.addEventListener('change', () => {
            const name = input.name;
            if (name.startsWith('track-')) setTrackState(host, name.slice(6), input.value);
            if (name.startsWith('layer-')) setLayerState(host, name.slice(6), input.value);
            if (name.startsWith('wave-')) setAudioWave(host, name.slice(5), input.value === 'on');
            renderControls(document.querySelector('[data-qnc-slot="component-lab-sidebar"]'));
          });
        });
      },
    });
  }

  function renderControls(sidebar) {
    if (!sidebar) return;
    const p = profile();
    const parts = [];
    parts.push('<div class="qnc-design-component-lab">');
    parts.push('<h4>Story segment</h4>');
    parts.push(
      '<p class="qnc-story-segment-hint muted">Komponenta sadrži <strong>sve trake i slojeve</strong>. Developer u <code>build-profiles.json</code> određuje <code>available_tracks</code> i <code>available_layers</code> za primjenu. Korisnik bira vidljivost unutar toga.</p>'
    );

    parts.push('<label class="qnc-ui-label">Tip segmenta</label>');
    parts.push('<select class="qnc-ui-select" data-ss-profile>');
    Object.entries(profiles).forEach(([id, prof]) => {
      parts.push(
        '<option value="' + id + '"' + (id === activeProfileId ? ' selected' : '') + '>' + esc(prof.label) + '</option>'
      );
    });
    parts.push('</select>');

    parts.push('<h4>Trake (medij)</h4>');
    parts.push('<button type="button" class="qnc-ui-button qnc-ui-button-primary" data-ss-settings">Trake i slojevi…</button>');
    MEDIA_LANE_IDS.forEach((id) => {
      if (!isAvailableTrack(id)) return;
      const waveHint = isAudioLane(id) ? (audioWaveStates[id] ? ' · val' : ' · bez vala') : '';
      parts.push(
        '<div class="qnc-design-track-row"><span>' +
          esc(TRACK_LABELS[id]) +
          '</span><span class="qnc-ui-chip">' +
          esc(trackStates[id] || 'off') +
          esc(waveHint) +
          '</span></div>'
      );
    });

    parts.push('<h4>Slojevi (build profil)</h4>');
    ALL_LAYER_IDS.forEach((id) => {
      if (!isAvailableLayer(id)) return;
      parts.push(
        '<div class="qnc-design-track-row"><span>' +
          esc(LAYER_LABELS[id]) +
          '</span><span class="qnc-ui-chip">' +
          esc(layerStates[id] || 'off') +
          '</span></div>'
      );
    });

    parts.push(
      '<p class="muted qnc-design-hint">In ' +
        segmentModel.in_pct +
        '% · Out ' +
        segmentModel.out_pct +
        '% · Space play</p>'
    );
    parts.push('</div>');
    sidebar.innerHTML = parts.join('');

    sidebar.querySelector('[data-ss-profile]')?.addEventListener('change', (ev) => {
      activeProfileId = ev.target.value;
      applyProfile(segmentHost);
      renderControls(sidebar);
      schedulePersist();
    });
    sidebar.querySelector('[data-ss-settings]')?.addEventListener('click', () => {
      if (segmentHost) openSettingsOverlay(segmentHost);
    });
  }

  function applyPrefs(host, prefs) {
    if (!prefs) return;
    if (prefs.active_profile_id && profiles[prefs.active_profile_id]) activeProfileId = prefs.active_profile_id;
    if (prefs.track_states) {
      Object.entries(prefs.track_states).forEach(([id, st]) => {
        if (TRACK_STATES.includes(st)) setTrackState(host, id, st);
      });
    }
    if (prefs.layer_states) {
      Object.entries(prefs.layer_states).forEach(([id, st]) => {
        if (!ALL_LAYER_IDS.includes(id) || !isAvailableLayer(id)) return;
        if (TRACK_STATES.includes(st)) setLayerState(host, id, st);
      });
    } else if (prefs.track_states?.inout) {
      layerStates.inout = prefs.track_states.inout;
    }
    if (prefs.audio_wave_states) {
      Object.entries(prefs.audio_wave_states).forEach(([id, on]) => {
        if (isAudioLane(id)) audioWaveStates[id] = on === true;
      });
    }
    segmentModel = mergeSegmentModel(prefs.segment, profile()?.segment_type);
    if (prefs.style) {
      timelineStyle = mergeTimelineStyle(prefs.style);
      applyStyleTokens(host, timelineStyle);
    }
    if (prefs.playhead_pct != null) setPlayheadPct(host, Number(prefs.playhead_pct), false);
    syncAllDom(host);
  }

  async function loadProfiles() {
    const res = await fetch(PROFILES_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('Build profili nisu učitani');
    const data = await res.json();
    profiles = data.profiles || {};
  }

  async function mount(previewEl, sidebarEl) {
    await loadProfiles();
    const res = await fetch(STYLE_URL, { cache: 'no-store' });
    if (res.ok) {
      styleSchema = await res.json();
      timelineStyle = mergeTimelineStyle({});
    }
    const prefs = await loadPrefs();
    const mock = await fetch(MOCK_URL, { cache: 'no-store' });
    if (!mock.ok) throw new Error('Mock nije učitan');
    previewEl.innerHTML = '<div class="qnc-design-timeline-host">' + (await mock.text()) + '</div>';
    segmentHost = previewEl.querySelector('[data-qnc-design-story-segment]');
    if (!segmentHost) throw new Error('Nema story segment root');

    trackStates = {};
    layerStates = {};
    audioWaveStates = defaultAudioWaveStates();
    segmentModel = defaultSegmentModel('izjava');
    prefsHydrating = true;
    Object.keys(TRACK_NAMES).forEach((id) => {
      const el = segmentHost.querySelector('.qnc-timeline-name[data-track-id="' + id + '"]');
      if (el) el.textContent = TRACK_NAMES[id].full;
    });
    const playRow = segmentHost.querySelector('.qnc-timeline-row--play');
    if (playRow) {
      playRow.setAttribute('data-play-hidden', 'true');
      playRow.setAttribute('aria-hidden', 'true');
    }
    applyProfile(segmentHost);
    if (prefs) applyPrefs(segmentHost, prefs);
    prefsHydrating = false;

    bindInteractions(segmentHost);
    setPlayheadPct(segmentHost, 0, false);
    renderControls(sidebarEl);
    return segmentHost;
  }

  window.QNCDesignStorySegment = { mount, ALL_LAYER_IDS, TRACK_LABELS, LAYER_LABELS };
})();
