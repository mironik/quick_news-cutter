# QNC v2 — pravila razvoja

**Ovo je obavezno za sve izmjene u `QNC_v2/quick_news_cutter`.**

## Primarni target

| Što | Gdje |
|-----|------|
| **Produkt** | **Rust `qnc-host`** — `run_host.bat` / `run_host.sh` |
| **Kod** | **Developer stroj** — repo `quick_news_cutter` (Win / macOS / Linux) |
| **Python `run_server.sh`** | samo dev referenca na **Linux / macOS / Jetson** — **ne** na Windowsu |

### Windows (obavezno)

- Pokretanje: `run_host.bat` ili `run_host.ps1` — **bez Pythona**
- Test: `test.ps1` — samo Rust host
- **Zabranjeno:** instalirati Python radi QNC-a, pokretati `run_server.sh`, `pytest`, `server.py`
- Novi backend/API ide u **`qnc-host`** (Rust), ne u `shell/*.py`

**Cursor workspace mora biti taj folder na tvom PC/Macu** — ne Jetson, ne edge server.

## Jetson i QNC_v1 — samo referenca

| Izvor | Pravilo |
|-------|---------|
| `QNC_v1` / Jetson kod | **Primjer** — čitaj za ideje, API oblik, workflow |
| Prepisivanje v1 → v2 | **Zabranjeno** — piši multiplatform iznova u pluginima |
| Jetson AI (CUDA, Riva, …) | **Kasnije** — izvan trenutnog scopea |

Ne portati monolite. Ne kopirati `server_storage`, ingest SMB, setup skripte u shell.

## AI

- **Sada:** core bez AI — shell, project, komponente na laptopu (Win / macOS / Linux)
- **Kasnije:** AI capability plugini; Jetson AI build testira se odvojeno na Jetsonu
- Core **ne smije** čekati AI niti ovisiti o GPU/CUDA

## Zabranjeno u v2 (bez izričitog odobrenja)

- Pretpostavka da server radi na Jetsonu
- `QNC_DEPLOYMENT=jetson` kao default ili auto-detect koji mijenja ponašanje
- Jetson-specific ingest/SMB u shellu ili globalnom kodu
- Ovisnost core funkcija o CUDA, Riva, Dockeru
- Razvoj na bilo kojem stroju **osim** developer PC/Mac/Linux repoa

## Dozvoljeno

- `hardware_hints` (informativno, npr. `nvidia_tegra`) — ne mijenja logiku
- Eksplicitni **AI plugin** s Jetson test planom (odvojeno od core)
- Env flagovi: `QNC_AI_ENABLED`, `QNC_HW_ENCODE`, `QNC_INGEST_REMOTE` — default **off**

## Redoslijed rada

1. Stabilan shell (Shell Spec v1)
2. Plugini komponentno, jedan korak po korak
3. Laptop-first QA
4. AI / Jetson test — tek kad core radi na laptopu

## Reference

- [shell-spec-v1.md](shell-spec-v1.md)
