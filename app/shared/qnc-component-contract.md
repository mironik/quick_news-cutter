# QNC Component Contract

## Cilj

Svi QNC moduli koriste iste zaključane UI komponente. Developer modula smije slagati prostor i pisati akcije, ali ne smije ručno mijenjati izgled kontrola.

Centralni UI se mora moći promijeniti kasnije bez diranja funkcionalnog koda pojedinih modula.

## Princip: jednom kodiraš, koristiš svugdje

Komponenta se **kodira jednom** u `app/components/<id>/` i registrira u `registry.json`.  
Svaki modul (tab/plugin) ima **samo orchestrator** koji:

- montira iste komponente u svoj layout
- šalje im `update()` snapshot iz baze (API)
- sluša bus događaje i poziva backend

**Ne** kopirati komponentu u `plugins/`. **Ne** forkati `component.js` po modulu — mijenja se orchestrator.

```
app/components/ingest-clip-grid/     ← jedan paket, svi moduli
plugins/ingest/static/qnc-ingest.js  ← ingest orchestrator
plugins/<drugi>/static/qnc-*.js      ← drugi orchestrator, iste komponente ako treba
qnc-host/src/ingest/                 ← baza + API
```

## Pravilo Vlasništva

Komponenta posjeduje:

- padding
- border
- background
- color
- font
- hover state
- focus state
- selected state
- disabled state
- internal alignment

Layout posjeduje:

- margin
- gap
- width
- height
- grid
- flex
- overflow
- position

## Zabranjeno

Modul ne smije lokalno mijenjati izgled zaključanih komponenti:

```css
.my-module .qnc-ui-button {
  background: blue;
  padding: 20px;
  border-radius: 12px;
}
```

Modul ne smije globalno stilizirati:

- `button`
- `input`
- `select`
- `textarea`
- `.qnc-ui-*`
- `.qnc-editorial-*`
- `.qnc-shell`

## Dopušteno

Modul smije definirati layout:

```css
.my-module-layout {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 12px;
}
```

Modul smije slagati gotove komponente:

```html
<div class="qnc-layout-row qnc-layout-gap-sm">
  <button class="qnc-ui-button">Otkrij</button>
  <button class="qnc-ui-button qnc-ui-button-primary">Uvezi</button>
</div>
```

## Osnovne Komponente

- `qnc-ui-button`
- `qnc-ui-button-primary`
- `qnc-ui-button-quiet`
- `qnc-ui-input`
- `qnc-ui-select`
- `qnc-ui-textarea`
- `qnc-ui-checkbox`
- `qnc-ui-field`
- `qnc-ui-label`
- `qnc-ui-list`
- `qnc-ui-row`
- `qnc-ui-card`
- `qnc-ui-picker`
- `qnc-ui-panel`
- `qnc-ui-toolbar`
- `qnc-ui-status`
- `qnc-ui-chip`

## Layout Komponente

- `qnc-layout-row`
- `qnc-layout-column`
- `qnc-layout-grid`
- `qnc-layout-split`
- `qnc-layout-fill`
- `qnc-layout-scroll`
- `qnc-layout-gap-xs`
- `qnc-layout-gap-sm`
- `qnc-layout-gap-md`
- `qnc-layout-tight`

## QNC Editorial Komponente

- `qnc-editorial-story-segment`
- `qnc-editorial-shot-card`
- `qnc-editorial-shot-token`
- `qnc-editorial-media-strip`
- `qnc-editorial-virtual-timeline`
- `qnc-editorial-marker`
- `qnc-editorial-transcript-line`
- `qnc-editorial-timecode`
- `qnc-editorial-badge-real`
- `qnc-editorial-badge-ai`

## QNC Timeline Komponente

Univerzalni timeline — **dizajn u** `plugins/design-tools/timeline/`. Spec: `docs/components/timeline-spec-v1.md`.  
Kad bude spreman → promocija u `app/components/timeline/`.

- `qnc-timeline` — root
- `qnc-timeline-toolbar` / `qnc-timeline-body`
- `qnc-timeline-track-header` / `qnc-timeline-track-toggle`
- `qnc-timeline-lane` — jedna traka; `is-collapsed` = uključen-nevidljiv
- `qnc-timeline-ruler` / `qnc-timeline-playhead`
- `qnc-timeline-video--filmstrip` | `--inout` | `--poster`
- `qnc-timeline-in-handle` / `qnc-timeline-out-handle` / `qnc-timeline-inout-range`

Trake: `play`, `video`, `audio-1`…`audio-4`, `markers`, `stabilization`, `transcript`, `inout`.  
Stanja trake: `off` | `on-visible` | `on-hidden`.

## Standardna Stanja

- `is-selected`
- `is-active`
- `is-disabled`
- `is-loading`
- `is-error`
- `is-warning`
- `is-ok`
- `is-muted`

Primjer:

```html
<button class="qnc-ui-row is-selected">
  Clip 001
</button>
```

## Struktura CSS-a

- `/app/shared/qnc-theme.css`
- `/app/shared/qnc-components.css`
- `/app/shared/qnc-cards.css`
- `/app/shared/qnc-layout.css`
- `/app/shared/qnc-editorial.css`
- `/app/shared/qnc-component-contract.md`

## Prijelazni Sloj

Legacy klase ostaju kompatibilne:

- `.qbtn` -> `qnc-ui-button`
- `.qbtn-primary` -> `qnc-ui-button-primary`

Novi kod mora koristiti `qnc-ui-*` klase.

