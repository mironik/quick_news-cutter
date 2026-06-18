# QNC Timeline — specifikacija komponente v1

**Status:** dizajn u **Design plugin tabu** — nije u `registry.json`, nije u produkcijskim modulima  
**Radni folder:** `plugins/design-tools/timeline/` + `plugins/design-tools/static/timeline-design.*`  
**Spec (ugovor):** `docs/components/timeline-spec-v1.md`  

---

## 1. Cilj

Jedan **univerzalni timeline** za sve module: media pool (source klip / filmstrip), story segment (lokalni pogled), virtualni montažni timeline.

Developer u build profilu određuje **laneove** (medijske trake) i **overlay slojeve** (editorial prikaz). Korisnik u runtimeu određuje vidljivost.

Timeline je **orchestrator osi i prikaza** — ne poslovna logika modula. Plugin puni model (`virtual_clips`, `segments`, …) i sluša događaje.

**Virtual klip** = atom akcije: `clip_id` + in/out (ili raspon na montažnoj osi). In/out kreira virtual klip; sve akcije (stab, TX, export, cover) rade na virtual klipu ili slotu.

---

## 2. Axis mode (viewport)

Isti renderer, tri načina osi:

| Mode | Kod | Prikaz |
|------|-----|--------|
| Source klip | `source_clip` | Media pool / OFF — jedan dugi klip, trim in/out |
| Story segment | `segment_local` | Jedan Off/Izjava segment — lokalna os 0–100% unutar segmenta |
| Virtual timeline | `montage_global` | Cijeli montažni lanac — segmenti + marker slotovi |

```json
{
  "axis": {
    "mode": "montage_global",
    "duration_sec": 120,
    "offset_sec": 0,
    "segment_index": 0
  }
}
```

Story cut stack = `segment_local`; story traka na dnu = `montage_global`. Media pool = `source_clip`.

---

## 3. Laneovi (medijske trake)

| ID | Naziv | Sadržaj |
|----|-------|---------|
| `play` | Play / ruler | Playhead, ruler (skriven u labu, sync ostaje) |
| `video` | Video | Filmstrip / in-out thumbs / poster |
| `audio-1` … `audio-4` | Audio | Valovi / clip segmenti |
| `stabilization` | Stabilizacija | Scope lane — prikaz raspona (vidi §5) |
| `transcript` | Transkript | Scope lane — tekst po rasponu |
| `inout` | In–Out | Ručke trim-a (source / lane) |

Redoslijed:

```
play → video → audio-1 … audio-4 → stabilization → transcript → inout
```

`play` je uvijek prisutan kad je timeline aktivan.

**Markeri nisu lane.** Marker i slot su **overlay slojevi** (§4).

---

## 4. Overlay slojevi (editorial)

| ID | Sadržaj |
|----|---------|
| `segments` | Story segmenti (Off / Izjava) na virtualnom timelineu |
| `virtual_clips` | Virtualni kadrovi unutar segmenta ili source klipa |
| `markers` | M tickovi na globalnoj osi |
| `slots` | Rasponi M–M (virtualni slotovi; mogu presijecati segmente) |

Build profile: `available_overlays`, `default_overlay_states` (`on-visible` / `on-hidden` / `off`).

DOM: `.qnc-timeline-editorial-overlay` — absolute preko lane stupca, ne zaseban red u gridu.

---

## 5. Podatkovni model (v3)

```json
{
  "version": 3,
  "axis": { "mode": "montage_global", "duration_sec": 120, "segment_index": 0 },
  "clip_range": { "in_pct": 0, "out_pct": 100 },
  "virtual_clips": [
    { "id": "vc1", "segment_id": "seg1", "label": "Kadar", "left_pct": 5, "width_pct": 30, "role": "primary" }
  ],
  "segments": [
    { "id": "seg1", "type": "izjava", "label": "Izjava 1", "start_pct": 0, "width_pct": 38 }
  ],
  "editorial": { "markers": [{ "id": "m1", "pct": 18, "label": "M" }] },
  "slots": [{ "index": 0, "start_pct": 18, "end_pct": 62 }],
  "scopes": {
    "stabilization": [{ "id": "s1", "left_pct": 18, "width_pct": 44 }],
    "transcript": [{ "id": "t1", "left_pct": 20, "width_pct": 20, "text": "…" }]
  },
  "lanes": {
    "video": { "in_pct": 0, "out_pct": 100 },
    "inout": { "in_pct": 0, "out_pct": 100 }
  }
}
```

- **Segment** = regija virtualnog timelinea (Off/Izjava); sadrži **više** virtual klipova.
- **Slot** = M–M na istoj osi; ne poštuje granice segmenata.
- **Scopes** (stab/TX) = rasponi na osi; u `source_clip` clamp unutar `clip_range`.

Referenca: `plugins/design-tools/timeline/demo-model.json`.

---

## 6. Stanja trake (tri razine)

Svaka traka (osim `play` koja je uvijek vidljiva kad je timeline aktivan) ima **tri stanja**:

| Stanje | Kod | Ponašanje |
|--------|-----|-----------|
| **Isključen** | `off` | Traka se ne renderira; ne troši visinu; ne sudjeluje u interakciji |
| **Uključen — vidljiv** | `on-visible` | Puna visina, interaktivna, sinhronizirana s playheadom |
| **Uključen — nevidljiv** | `on-hidden` | Collapsed red u track headeru (≈24px); podaci se drže u syncu; korisnik može ponovo otvoriti |

### 3.1 Tko postavlja što

| Sloj | Odgovornost |
|------|-------------|
| **Build profile (developer)** | Koje trake **uopće postoje** u ovoj instanci (`available_tracks`) |
| **Module preset (developer)** | Početno stanje po modulu (npr. Story: transcript `on-visible`, audio-3/4 `off`) |
| **User prefs (korisnik)** | Per-projekt ili globalno: `on-visible` / `on-hidden` / `off` unutar `available_tracks` |
| **Component (timeline)** | Enforce stanja, persist prefs, emit promjene |

Traka koja nije u `available_tracks` ne smije se pojaviti u UI-u — korisnik je ne može uključiti.

---

## 7. Video traka — tri načina prikaza

Kad je `video` u stanju `on-visible`, način prikaza je zaseban enum (ne miješa se s on/off):

| Način | Kod | Prikaz |
|-------|-----|--------|
| **Filmstrip** | `filmstrip` | N sličica duž trake (reuse `filmstrip-viewer` logike) |
| **In–Out sličice** | `inout-thumbs` | Točno dvije sličice: na in i na out |
| **Početna sličica** | `poster` | Jedna sličica na početku klipa |

Default po modulu (developer preset):

| Modul | Tipični default |
|-------|-----------------|
| Media pool | `filmstrip` |
| OFF | `inout-thumbs` |
| Story | `poster` ili `filmstrip` (preset) |

Korisnik može promijeniti način ako je traka `on-visible` (track header menu).

---

## 8. Arhitektura UI

```
┌─────────────────────────────────────────────────────────────┐
│ qnc-timeline-toolbar  [zoom] [snap] [track menu ▾]         │
├──────────┬──────────────────────────────────────────────────┤
│ track    │  scrollable timeline body (shared time axis)      │
│ headers  │  ┌ play ruler ────────────────────────────────┐  │
│ (fixed)  │  ├ video lane ────────────────────────────────┤  │
│          │  ├ audio-1 ─────────────────────────────────────┤  │
│          │  │ …                                            │  │
│          │  └ inout lane ──────────────────────────────────┘  │
└──────────┴──────────────────────────────────────────────────┘
```

- **Lijevo:** fiksni stupac s imenom trake + toggle vidljivosti + ikona stanja  
- **Desno:** horizontalni scroll; sve vidljive trake dijele istu **time scale** i **playhead**  
- **Play traka:** ruler + playhead linija koja proteže kroz sve `on-visible` trake (vertical sync line)

CSS korijen: `.qnc-timeline` (komponenta posjeduje izgled; modul samo layout oko nje).

---

## 9. Build profile (developer)

Plugin ili parent panel prosljeđuje `build_profile` pri mountu:

```json
{
  "axis_mode": "montage_global",
  "available_tracks": ["play", "video", "audio-1", "inout"],
  "available_overlays": ["segments", "markers", "slots", "virtual_clips"],
  "default_track_states": { "video": "on-visible", "inout": "on-visible" },
  "default_overlay_states": { "markers": "on-visible", "slots": "on-visible" },
  "default_video_presentation": "filmstrip",
  "duration_sec": 120,
  "fps": 25
}
```

Primjeri profila (Design lab):

| Profil | Tko bira | `available_tracks` | `available_layers` |
|--------|----------|--------------------|--------------------|
| `design-lab` | developer (cijeli katalog) | video, audio-1…4 | inout, transcript, stabilization, markers |
| `izjava` | developer (story plugin) | video, audio-1…4 | inout, transcript, stabilization |
| `off` | developer (story plugin) | video, audio-1…4 | inout, transcript, stabilization |
| `story-montage` | developer (montaža) | … | segments, markers, slots (virtual timeline) |

Komponenta **story segment** u sebi ima pun katalog traka i slojeva; build profil određuje što je uključeno u pojedinoj primjeni. Korisnik unutar toga bira `on-visible` / `on-hidden` / `off`.

---

## 10. Ulazni podaci (inputs)

Timeline prima **agregirani model** — plugin skuplja iz backenda:

```json
{
  "clip_id": "c1",
  "duration_sec": 120.5,
  "in_sec": 10.0,
  "out_sec": 95.0,
  "playhead_sec": 42.0,
  "video": { "filmstrip": { "seeks": [], "status": "ready" } },
  "audio_lanes": [
    { "track_id": "audio-1", "label": "NAT", "clips": [] },
    { "track_id": "audio-2", "label": "MUS", "clips": [] }
  ],
  "markers": [{ "id": "m1", "sec": 30, "label": "Beat", "kind": "story" }],
  "stabilization": [{ "start_sec": 0, "end_sec": 15, "enabled": true }],
  "transcript": [{ "start_sec": 5, "end_sec": 8, "text": "…" }]
}
```

Timeline **ne** zove API direktno osim za thumbs/waveforms preko delegiranih child renderera (kao `filmstrip-viewer`).

---

## 11. Događaji (component events)

| Akcija | Payload | Opis |
|--------|---------|------|
| `timeline.seek` | `{ clip_id, seconds }` | Klik/drag na traku |
| `timeline.inout.change` | `{ clip_id, in_sec, out_sec }` | Promjena in/out |
| `timeline.marker.click` | `{ marker_id, seconds }` | Selekcija markera |
| `timeline.marker.add` | `{ seconds, kind? }` | Novi marker |
| `timeline.slot.select` | `{ slot_index, start_sec, end_sec }` | Odabir M–M slota |
| `timeline.axis.mode` | `{ mode, segment_index? }` | Promjena viewporta |
| `timeline.virtual_clip.save` | `{ virtual_clip }` | Spremi kadar (in/out) |
| `timeline.track.state` | `{ track_id, state }` | Korisnik promijenio vidljivost |
| `timeline.video.presentation` | `{ presentation }` | filmstrip / inout-thumbs / poster |
| `timeline.zoom` | `{ px_per_sec }` | Zoom promjena |

---

## 12. Odnos prema `filmstrip-viewer`

- `filmstrip-viewer` ostaje **samostalna** komponenta (portable).
- Video traka timelinea **delegira** render na isti renderer / shared util (`seeksFromTimeline`, thumb URL, …).
- Ne duplicirati DOM logiku — timeline video lane = host + `filmstrip-viewer` variant ili internal slot `[data-qnc-timeline-lane="video"]`.

---

## 13. Persistencija korisničkih prefs

| Scope | Put | Sadržaj |
|-------|-----|---------|
| Per-projekt | SQLite / project settings | `timeline.track_states`, `timeline.video_presentation` |
| Global fallback | `data/` ili module_settings | default kad projekt nema prefs |

Timeline emitira `timeline.track.state` → plugin sprema u project store.

---

## 14. Faze implementacije

| Faza | Opis |
|------|------|
| **1 (sada)** | Design lab: v3 model, axis modes, overlay slojevi, build profili |
| **2** | Play ruler + seek; video lane (`poster` + `filmstrip`) |
| **3** | Virtual klip in/out + clip_range; scope clamp (stab/TX) |
| **4** | Audio lanes (1–4), persist, module presets |
| **5** | Integracija: media pool → OFF → Story (isti timeline komponent) |

---

## 15. Klase (component contract)

Nove editorial/timeline klase u `component.css`:

- `.qnc-timeline` — root
- `.qnc-timeline-toolbar`
- `.qnc-timeline-track-header` — lijevi stupac
- `.qnc-timeline-lane` — jedna traka desno
- `.qnc-timeline-lane.is-collapsed` — `on-hidden`
- `.qnc-timeline-lane.is-off` — ne renderira se
- `.qnc-timeline-ruler` — play traka
- `.qnc-timeline-playhead`
- `.qnc-timeline-video--filmstrip` | `--inout` | `--poster`
- `.qnc-timeline-editorial-overlay` — overlay stack preko laneova
- `.qnc-timeline-segment` — story segment blok
- `.qnc-timeline-slot` — M–M slot
- `.qnc-timeline-virtual-clip` — virtual klip chip

Vidi `app/components/timeline/component.html` za strukturalni mock.
