# Resiliency Checker — Installation Guide

A local dashboard that turns the output of the **RelAZ_Assess** PowerShell script into an interactive view of your Azure resiliency posture: score, tier distribution, resource groups, VM groups, progress tracking across runs, exclusions with justification, and Excel export.

The app is a self-contained Node.js project — **no database, no cloud dependency, no external services**. All data stays on your machine.

---

## 1. Prerequisites

| Requirement | Version | Where to get it |
|---|---|---|
| Windows 10/11 or Windows Server 2019+ | any | — |
| Node.js | 18 or newer (20 LTS recommended) | https://nodejs.org/en/download |
| Modern browser | Edge, Chrome, or Firefox | already installed |
| RelAZ_Assess PowerShell script | v2.18 or newer | provided by Microsoft |

Verify Node is installed:

```powershell
node --version
```

Expected output: `v20.x.x` or similar.

---

## 2. Get the app

Extract the `resiliency-checker` folder anywhere on the machine, e.g. `C:\Tools\resiliency-checker`.

The folder should look like:

```
resiliency-checker\
    server\
    public\
    data\                 (created on first run, holds config.json + exclusions.json)
    package.json
    README.md
    INSTALL.md            (this file)
```

There are **zero npm dependencies** — nothing to install. All third-party libraries (Chart.js, ExcelJS, FileSaver) are loaded from CDN by the browser when needed.

---

## 3. Prepare the dataset

The app expects your `RelAZ_Assess` output organized like this:

```
<DATA_ROOT>\
    <Entity1>\
        <YYYY-MM-DD>\
            MasterReport.csv
            pipReport.csv
            lbReport.csv
            asr_backup.csv
            zonemapping.csv
            CustomerAzRetirements.csv
    <Entity2>\
        <YYYY-MM-DD>\
            MasterReport.csv
            ...
```

Where:

- **`<DATA_ROOT>`** is the top folder holding all entities (e.g. `C:\ADGE Resiliency\Assessment Reports`).
- **`<EntityN>`** is a short code / name per government entity (e.g. `DOH`, `ADAFSA`, `KF`).
- **`<YYYY-MM-DD>`** is a folder per script run. Use the date on which the RelAZ script was executed.

### Multi-tenant entities

If an entity has more than one Azure tenant, insert a tenant folder between the entity and the run-date folder:

```
<DATA_ROOT>\<Entity>\<Tenant>\<YYYY-MM-DD>\MasterReport.csv
```

The app will display these as `<Entity>-<Tenant>` (for example `DMT-ADM`, `DMT-ITC`).

### The critical file

The app reads **`MasterReport.csv`** from each dated folder. Everything else is optional (kept only for the Power BI companion template). Do not rename this file.

### Adding new runs later

When RelAZ_Assess is re-run after remediations, simply create a new dated folder next to the previous one:

```
DOH\
    2026-07-10\   ← original run
        MasterReport.csv
    2026-08-15\   ← post-remediation run
        MasterReport.csv
```

Click **↻ Refresh** in the app's top bar (or POST `/api/refresh`) and the new snapshot appears in Entity Deep Dive, Progress, and everywhere else — **no config change required**.

### Cleanup script

Attached with this app: **`prepare-dataset.ps1`** (see next section). Run it once against a folder of zipped `RelAZ_Assess` outputs to unzip and re-arrange everything into the expected layout.

---

## 4. First run

Open PowerShell in the project folder:

```powershell
cd C:\Tools\resiliency-checker
node server/index.js
```

You should see:

```
[appConfig] no C:\Tools\resiliency-checker\data\config.json, using defaults.
[exclusions] loaded 0 entries.
[dataStore] Loaded 30 entities · 30 snapshots · 26555 rows.
Resiliency Checker running -> http://localhost:5173
```

Then open **http://localhost:5173** in a browser.

If the app reports **0 entities · 0 rows**, jump to *Section 6 — Troubleshooting*.

---

## 5. Pointing the app to your data folder

You have four ways to tell the app where `<DATA_ROOT>` lives, in this priority order (higher wins):

### A. CLI flag — good for one-off runs

```powershell
node server/index.js --data-root="D:\Assessment Data"
```

### B. Environment variable — good for scripted/service setups

```powershell
$env:DATA_ROOT = "D:\Assessment Data"
node server/index.js
```

### C. Settings UI — persistent, easiest for end users

1. Open the app → **Settings** (last nav item)
2. First panel: **Data source path**
3. Paste the absolute path into "Config value" and click **Save & re-score**

The value is stored in `data\config.json` and survives restarts. The Settings panel refuses to save a path that doesn't exist.

### D. Hardcoded default — factory setting

Edit `server\config.js` and change the `DEFAULT_DATA_ROOT` constant.

The footer of every page shows the currently-loaded path and where it came from (`cli` / `env` / `config` / `default`).

---

## 6. Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| `0 entities · 0 rows` | Data root points at a folder that doesn't contain the expected layout. Confirm `<DATA_ROOT>\<Entity>\<YYYY-MM-DD>\MasterReport.csv` exists. |
| `EACCES` / permission errors on startup | The user running Node needs read access to the data folder. If it's on OneDrive, right-click → **Always keep on this device**. |
| Browser shows "API offline" | Server crashed. Check the terminal for a stack trace, restart with `node server/index.js`. |
| Wrong entity date | The date is taken from the `<YYYY-MM-DD>` folder name if present, otherwise from the CSV's `reportdate` column. Rename the folder if it's wrong. |
| Port 5173 already in use | Set `PORT` env var (e.g. `$env:PORT=8080; node server/index.js`) or pass `--port=8080`. |
| CSV parse error for one entity | Check the terminal log — the app skips that entity but keeps loading the rest. Re-run RelAZ_Assess for that entity or fix the CSV manually. |

To fully reset the app to factory scoring rules: delete `data\config.json`, restart.
To clear all manual exclusions: delete `data\exclusions.json`, restart.

---

## 7. Optional — Run as a background service

If you want the app to start automatically on boot without a visible PowerShell window, register it as a Windows service using [nssm](https://nssm.cc/):

```powershell
# Install nssm from https://nssm.cc/ then:
nssm install ResiliencyChecker "C:\Program Files\nodejs\node.exe" "C:\Tools\resiliency-checker\server\index.js"
nssm set ResiliencyChecker AppDirectory "C:\Tools\resiliency-checker"
nssm set ResiliencyChecker AppEnvironmentExtra "DATA_ROOT=D:\Assessment Data"
nssm start ResiliencyChecker
```

The app will then be permanently available at `http://localhost:5173`.

---

## 8. Next steps

- Read **README.md** for a description of every view.
- Open **Settings** to tune scoring rules, cluster-aware Zonal VM overrides, Public IP overrides, prod-classifier regexes, and the VM Group detection threshold.
- Use the **⬇ Export to Excel** button on the Entity Deep Dive view to produce a 5-tab workbook per entity (Overview + Attention + VM Groups + Progress + Methodology).
- Track remediations over time via the **Progress** view — just drop each new RelAZ run into a new dated folder.

For questions or issues, contact the tool owner.
