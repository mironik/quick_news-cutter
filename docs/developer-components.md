# QNC Developer Components

Globalne UI komponente su javni building blocks za sve QNC plugin-app-tabove.

Za puni tab orchestrator s Plugin SDK v1 vidi [plugin-sdk-v1.md](plugin-sdk-v1.md).

## Pravila

- Komponente zive u `app/components/<component-id>/`.
- Plugin ih ne kopira u svoj direktorij i ne drzi vlastiti `components/` folder.
- Plugin ih deklarira u `plugin.json` kroz `uses_components`.
- Shell ih izlaže kroz `GET /api/shell/components`.
- Komponenta ne posjeduje poslovni state. `contract.owns_state` mora ostati `false`, osim ako komponenta nije eksplicitni system service.
- Komponenta prima agregirani model od plugin orchestratora.
- Komponenta emitira evente preko `QNC.componentBus`.
- Plugin orchestrator slusa evente, poziva svoj API i zapisuje u projektnu bazu.
- Komponenta ne komunicira direktno s drugim plugin-app-tabovima.
- Komponenta ne smije koristiti pomocne JSON datoteke kao runtime source of truth.

## Javni core set

Ove komponente su stabilna osnova za developere:

| Component ID | Namjena |
|--------------|---------|
| `media-thumb` | Jedna video slicica ili poster frame |
| `filmstrip-viewer` | Filmstrip prikaz klipa |
| `timeline-sequence` | Lista timeline redova s filmstripom |
| `folder-picker` | System service za odabir foldera/datoteka |

Komponente oznacene s `portable: true` smiju koristiti svi plugin-app-tabovi i buduci eksterni developeri.

## Ugovor komponente

Svaka javna komponenta mora imati zapis u `app/components/registry.json`:

```json
{
  "global_id": "timeline-sequence",
  "component_id": "timeline-sequence",
  "source_plugin_id": "core",
  "embeddable": true,
  "portable": true,
  "contract": {
    "inputs": ["clips", "selected_ids"],
    "events": [{ "action": "filmstrip.seek", "payload": { "clip_id": "string", "seconds": "number" } }],
    "requires_components": ["filmstrip-viewer"],
    "owns_state": false
  }
}
```

`inputs` su podaci koje plugin vec procita iz baze ili API snapshot-a. `events` su samo namjera korisnika. Event nije zapis u bazu dok ga plugin backend ne obradi.

## Media Pool timeline smjer

Media Pool treba koristiti javne komponente ovako:

| Dio UI-a | Komponenta |
|----------|------------|
| Lista clipova | `timeline-sequence` |
| Video lane | `filmstrip-viewer` |
| Thumbnail frame | `media-thumb` |
| Buduci clip label | `timeline-clip-label` |
| Buduci virtual timeline | `qnc-timeline` ili `virtual-timeline` |
| Buduci marker overlay | `timeline-marker-layer` |

Buduce komponente treba prvo registrirati kao globalne `app/components/*` komponente, zatim ih Media Pool ili Story plugin koriste kroz `uses_components`.
