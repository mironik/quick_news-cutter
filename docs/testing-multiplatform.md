# Testiranje — laptop (Windows / macOS / Linux)

QNC v2 shell testira se **na svakom stroju gdje želiš pokretati app** — ne samo na Jetsonu.

**Windows:** samo `test.ps1` (Rust). **Ne** koristiti `pytest` ni Python server.

## 1. Preuzmi kod na stroj gdje testiraš

Kod živi u repou `quick_news_cutter` na **developer stroju** (Windows, macOS ili Linux).

**Načini:**

```bash
# git (preporučeno)
git clone <repo> quick_news_cutter && cd quick_news_cutter
```

Svaki stroj **sam** builda i testira — ne kopiraj binary s drugog OS-a.

---

## 2. Jedan test na bilo kojem OS-u (shell host)

### macOS / Linux

```bash
# Jednom: Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

cd quick_news_cutter
./test.sh
```

### Windows (PowerShell)

```powershell
# Jednom: Rust — https://rustup.rs
cd quick_news_cutter
.\test.ps1
```

`test.sh` / `test.ps1` rade isto:

1. build `qnc-host` (ako treba)
2. pokrenu host na privremenom portu
3. provjere Shell API v1 + static + plugin mount
4. ugase host

---

## 3. Ručno — otvori UI

```bash
./run_host.sh          # macOS / Linux
```

```powershell
.\run_host.bat         # Windows
```

Browser: **http://127.0.0.1:8001/app**

Očekuješ: footer **Project** (+ **Design** ako uključen), bez Pythona.

---

## 4. Matrica (što testirati gdje)

| Stroj | Danas / sutra | Što pokriva test |
|-------|----------------|------------------|
| **Tvoj laptop** | danas | primarni UX test |
| **macOS** | sutra | isti `test.sh`, drugi build (aarch64/x64 Mac) |
| **Linux** | sutra | isti `test.sh` |
| **Windows** | kad treba | `test.ps1` |
| **Jetson** | opcionalno | samo ako želiš provjeriti arm64 Linux; **nije** obavezan za app test |

Svaki stroj builda **svoj** `qnc-host` binary (`cargo build --release`). Ne kopiraj binary s Jetsona na Mac/Windows.

---

## 5. Što test **ne** pokriva (još)

- `/api/projects` — Project backend u Rustu dolazi sljedeće
- AI, FFmpeg
- Installer (.dmg / .msi) — kasnije

---

## 6. Ako test padne

| Greška | Rješenje |
|--------|----------|
| `cargo: command not found` | instaliraj rustup |
| port zauzet | `QNC_API_PORT=18082 ./test.sh` |
| prazan tabovi | provjeri `app/components/shell-plugin-tab/` i `plugins/project/plugin.json` |
| `QNC_ROOT` | skripte postavljaju same; ručno: `export QNC_ROOT=$(pwd)` |

---

## 7. Redoslijed sutra (macOS + Linux)

1. Isti folder koda na oba stroja  
2. Na svakom: `./test.sh` → mora biti zeleno  
3. Na svakom: `./run_host.sh` → ručno otvori `/app`  
4. Javi što ne valja po OS-u (screenshot / poruka greške)

To je **pravi** multiplatform test — isti kod, tri builda, tri stroja.
