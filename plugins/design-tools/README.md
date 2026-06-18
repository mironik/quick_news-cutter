# Design add-on (samostalan modul)

**Windows / produkcija:** Rust `qnc-host` — **nema Pythona**.

| Sloj | Put |
|------|-----|
| UI | `static/panel.html`, `qnc-design.js`, `qnc-design.css` |
| Base tokeni | `design/tokens.json` |
| API | `/api/design-tools/*` (implementacija: `qnc-host/src/design.rs`) |
| Korisničke teme | `data/design_overrides/themes/*.json` |
| Aktivna tema | `data/design_overrides/active_theme.json` |

Shell **ne** učitava design kod pri bootu osim kad se učitaju plugin skripte (`entry_js`).

## Component lab (timeline)

Dizajn komponenti razvija se ovdje — **ne** u `app/components/registry` dok nije spremno.

| | |
|--|--|
| Mock | `timeline/mock.html` |
| Build profili | `timeline/build-profiles.json` (axis mode + overlayi) |
| Demo model | `timeline/demo-model.json` |
| Lab JS/CSS | `static/timeline-design.js`, `timeline-design.css` |
| Spec | `docs/components/timeline-spec-v1.md` |

Design tab → **Components** → timeline: **axis mode** (source / segment / montage), laneovi, overlay slojevi (markeri, slotovi, segmenti, virtual klipovi).

Python `backend/routes.py` = samo dev referenca na Jetsonu (`run_server.sh`).
