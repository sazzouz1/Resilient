# Resiliency Checker

Dashboards over the `RelAZ_Assess` script output for all ADGE government entities.

**New user?** See **[INSTALL.md](./INSTALL.md)** for a step-by-step install guide, including how to prepare the dataset from raw script output using **`prepare-dataset.ps1`**.

## Run

Zero dependencies — runs on plain Node.js (18+ recommended):

```
cd "C:\ADGE Resiliency\resiliency-checker"
npm start
```

or equivalently:

```
node server/index.js
```

Then open http://localhost:5173

## Runtime configuration

Everything you might want to tune lives in `data/config.json`, and there's a **Settings** view for editing it in the browser. Changes trigger an immediate re-score of every snapshot.

| Section | What it controls |
|---|---|
| `scoring.configMap` | Base tier + score for every `resiliencyconfig` value from the RelAZ_Assess script |
| `clusterAware` | Score overrides applied to Zonal VMs based on their VM Group's AZ spread (GOOD / PARTIAL / BAD / MISSING / STANDALONE) |
| `publicIpOverride` | Force-set every Public IP to a chosen tier/score (default: HIGH 85). Reflects that Standard-SKU PIPs are platform-zone-redundant. |
| `diskAlignment` | Whether to re-tier LRS disks attached to Zonal VMs to N/A (default: enabled) |
| `prodClassifier` | Sources checked and regex patterns for classifying prod vs non-prod vs unknown |
| `clusterDetection.minMembers` | Minimum number of VMs required to form a VM Group (default: 2) |

Missing/partial keys fall back to shipped defaults, so a broken `config.json` never bricks the app. Regex fields are validated on save.

If a change makes things worse, hit **Reset all to defaults** in the Settings view or delete `data/config.json`.

## Data source

The server reads every `MasterReport.csv` under:

```
C:\ADGE Resiliency\ADGEs Assessment Reports\<Entity>\<RunDate>\MasterReport.csv
C:\ADGE Resiliency\ADGEs Assessment Reports\<Entity>\<Tenant>\<RunDate>\MasterReport.csv
```

`<RunDate>` is a **YYYY-MM-DD** folder representing one run of the RelAZ_Assess script. Adding a new run for an entity is as simple as creating a new dated folder and dropping the CSVs in — no config change required. Legacy layouts without the date folder are also tolerated (the CSV's `reportdate` column supplies the date).

Multi-tenant entities (currently DMT) are surfaced as `DMT-ADM`, `DMT-DMT`, `DMT-ITC Tenant`.

Change the location in `server/config.js`.

## Snapshots and progress tracking

Every run of the assessment script is a **snapshot**. The Resiliency Checker keeps every snapshot in memory and lets you:

- View the latest snapshot per entity by default (all existing dashboards behave the same as before)
- Switch to a historical snapshot from the **Entity Deep Dive** view via the "Run" selector (only shown when 2+ snapshots exist for the entity)
- Track improvements over time in the **Progress** view with score/tier line & bar charts
- Diff any two runs at the resource level — see which specific resources improved, regressed, appeared, or disappeared

## Scoring rules

`server/scoring.js` maps each `resiliencyconfig` value to a **tier** (HIGH / MEDIUM / LOW / NA) and a **score** (0-100). The tier `NA` is excluded from percentage calculations so platform-default configs don't distort the government score.

### Public IP override

Standard-SKU Public IPs in Azure are **zone-redundant by default** at the platform layer, but the `RelAZ_Assess` script often reports them as `NonZonal` because they don't carry an explicit `zones` property. To reflect the platform reality:

- Every `Microsoft.Network/publicIPAddresses` row is force-set to HIGH tier, score **85**, label `Public IP — zone-redundant by default (override)`.
- The raw `resiliencyconfig` value is preserved on the row (visible in Explorer / detail views) so the override is auditable.

Adjust or remove the override in `server/dataStore.js` (`adjustPublicIpScoring`).

### Cluster-aware Zonal scoring

A Zonal VM is only truly resilient if peers with the same role live in other AZs. Instead of scoring every `Zonal` VM the same, the engine looks up its cluster (via `server/clusters.js`) and grades it accordingly:

| Zonal VM situation | Tier | Score | Label |
|---|:-:|:-:|---|
| Part of a **GOOD** cluster (3+ AZs) | HIGH | **95** | `Zonal — cluster spans 3+ AZs` |
| Part of a **PARTIAL** cluster (2 AZs) | MEDIUM | **70** | `Zonal — cluster spans 2 AZs` |
| Part of a **BAD** cluster (all same AZ) | LOW | **30** | `Zonal — cluster pinned to 1 AZ` |
| Part of a **MISSING** cluster (peers, no zones) | LOW | **30** | `Zonal — cluster has no zones` |
| **Standalone** (no peers detected) | MEDIUM | **55** | `Zonal — single VM in AZ` |

This means a fleet of 1,000 Zonal VMs correctly distributed across three AZs shows up as a fleet of 95-scored resources rather than the misleading 60 that pure `resiliencyconfig` classification would give. Conversely, a cluster that's *supposed* to be HA but is pinned to one AZ (false sense of security) is now flagged at 30.

Cluster status, cluster role stem, and covered zones are exposed as columns in the Resource Explorer.

### Disk-attachment-aware scoring

Disks are re-scored based on their parent VM. The `RelAZ_Assess` script writes the parent VM name into the disk's `resiliencydetail` column, which we use to link them.

- LRS disk **attached to a Zonal VM** → treated as N/A (an LRS disk on a single-AZ VM is expected; requiring ZRS would be pointless because the VM is already pinned to one zone). The disk label becomes `Locally Redundant (LRS) (aligned with Zonal VM)`.
- LRS disk **attached to a NonZonal VM** → stays LOW (the VM has no zone anchor, so a ZRS disk would meaningfully add resilience).
- Unattached / orphan disks → keep their original score.

Adjust the linkage logic in `server/dataStore.js` (`adjustDiskScoring`).

### Base `resiliencyconfig` mapping

Everything else uses the base table in `server/scoring.js`:

| resiliencyconfig | Tier | Score |
|---|:-:|:-:|
| ZoneRedundant / ZoneRedundant_StanbyHA | HIGH | 100 |
| SameZoneHA | HIGH | 90 |
| GeoRedundant / GeoRedundantbyDefault | HIGH | 85 |
| Zonal | *cluster-aware* (see above) | — |
| PartiallyAzRedundant | MEDIUM | 55 |
| LocallyRedundant | LOW | 20 |
| NonZonal | LOW | 25 |
| RedundantbyDefault / NotApply / NoInfo / blank | NA | — |

## Production-only filter

The **Production only** toggle in the top bar filters every view. Classification is name-based:

1. Check the `environment` tag/column — match on `prod`/`production`/`prd` (excluding non-/pre-).
2. If missing, fall back to the subscription name.
3. Finally, fall back to the resource-group name.

A yellow banner is shown whenever the filter is active, warning that classification is heuristic. Tune keywords in `server/prodClassifier.js`.

## Views

| View | Audience | Purpose |
|---|---|---|
| Executive Overview | Leadership | Government-wide KPIs, tier mix, entity ranking |
| Entity Deep Dive   | Technical | One entity — historical snapshot picker, Resources Requiring Attention (LOW+MEDIUM), per-row Exclude button, **⬇ Export to Excel** (5-tab workbook) |
| **Progress**       | Both      | Score/tier evolution over multiple runs, resource-level diff between any two snapshots |
| Service View       | Technical | Cross-government posture per Azure resource type |
| Resource Groups    | Technical | Every RG ranked by risk, VM group flags; drill into an RG for members & verdicts |
| VM Groups          | Technical | Detects role-stem groups of VMs (e.g. `vm-app01`/`02`/`03`) and their AZ spread |
| Resource Explorer  | Technical | Filter & search every resource; column chooser; CSV export |
| Compare Entities   | Both      | Side-by-side 2–5 entities |
| **Exclusions**     | Both      | Manually-excluded resources with justification + audit trail |
| **Settings**       | Both      | Edit all scoring parameters — persisted to `data/config.json` and re-scored immediately |

Every table that shows a scored resource also shows the raw `resiliencyconfig` and `resiliencydetail` values so the score never obscures the underlying evidence.

## Manual exclusions

Any resource can be marked as excluded from scoring via the **✕ Exclude** button on the Entity Deep Dive attention table. A modal prompts for a justification (required) and your name. Excluded resources are moved to N/A tier with the label `[Excluded] <justification>` and stop affecting any aggregate score.

Exclusions persist to `data/exclusions.json` and survive:
- Server restarts
- Re-running the RelAZ_Assess script
- Adding new snapshots for the same entity

Manage all exclusions in the **Exclusions** view.

### VM cluster detection logic

A "cluster" = 2+ VMs in the same resource group whose names share a stem after stripping a trailing counter (`01`/`02`, `-a`/`-b`, `node1`/`node2`, etc.).

Verdicts:
- **GOOD** — members span ≥ 3 zones
- **PARTIAL** — spread across 2 zones (some HA, but not 3-zone)
- **BAD** — every member is in the same zone (no zone resilience)
- **MISSING** — members have no zone assigned at all

Tune the stem heuristic in `server/clusters.js`.

## Modularity

Everything is pluggable so you can grow this over time:

- **Scoring** — `server/scoring.js` — edit `CONFIG_MAP` to change how `resiliencyconfig` values map to tier + score. All KPIs update automatically.
- **API** — `server/api/routes.js` — add endpoints; each is thin so a new view can request exactly what it needs.
- **Views** — `public/js/views/<name>.js` — export a `{ render(host, params) }` and register in `public/js/app.js`. The nav bar and router pick it up automatically.
- **Data sources** — extend `server/dataStore.js` if you later want to fold in `pipReport.csv`, `lbReport.csv`, `asr_backup.csv`, etc.

## Refresh

Click **↻ Refresh** in the top bar, or POST `/api/refresh`, to re-scan the CSVs on disk. Otherwise the server re-scans every 5 minutes.
