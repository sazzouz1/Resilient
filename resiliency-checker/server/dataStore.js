// Snapshot-aware dataStore.
//
// A "snapshot" = one run of the RelAZ_Assess script for one entity/tenant.
// Physical layout on disk:
//     <DATA_ROOT>/<Entity>/<RunDate>/MasterReport.csv               (single-tenant)
//     <DATA_ROOT>/<Entity>/<Tenant>/<RunDate>/MasterReport.csv      (multi-tenant)
// Legacy layout (no <RunDate> folder) is still tolerated — the CSV's own
// `reportdate` column supplies the date.
//
// Internally we keep every row from every snapshot. Every API request accepts
// an optional `runDate`; when omitted it defaults to the LATEST snapshot per
// entity (so all existing UI keeps working after the upgrade).

const fs = require('fs');
const path = require('path');
const { parseCsv } = require('./csv');
const { MASTER_FILE, CACHE_TTL_MS } = require('./config');
const { classify } = require('./scoring');
const { classify: classifyProd } = require('./prodClassifier');
const { detectClusters } = require('./clusters');
const exclusions = require('./exclusions');
const appConfig = require('./appConfig');

let state = {
  rows: [],
  entities: [],         // [{ id, entity, tenant, displayName, latestRunDate, snapshots: [{ runDate, path, rowCount }] }]
  snapshotIndex: null,  // Map: "entityId||runDate" -> { rowCount, score, ...aggregate }
  loadedAt: null,
};

const isDateFolder = name => /^\d{4}-\d{2}-\d{2}$/.test(name);

// -------- Discover snapshots on disk ----------------------------------------
function findSnapshots() {
  const out = [];
  const DATA_ROOT = appConfig.getEffectiveDataRoot().path;
  if (!DATA_ROOT || !fs.existsSync(DATA_ROOT)) return out;

  for (const ent of fs.readdirSync(DATA_ROOT, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const entityDir = path.join(DATA_ROOT, ent.name);

    // Two shapes to look for:
    //   entityDir/<RunDate>/MasterReport.csv              (single-tenant, new layout)
    //   entityDir/<Tenant>/<RunDate>/MasterReport.csv     (multi-tenant,  new layout)
    //   entityDir/MasterReport.csv                        (legacy)
    //   entityDir/<Tenant>/MasterReport.csv               (legacy multi)
    const legacyLeaf = path.join(entityDir, MASTER_FILE);
    if (fs.existsSync(legacyLeaf)) {
      out.push(makeSnapshot(ent.name, null, entityDir, legacyLeaf));
      continue;
    }

    for (const sub of fs.readdirSync(entityDir, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue;
      const subPath = path.join(entityDir, sub.name);

      if (isDateFolder(sub.name)) {
        const csv = path.join(subPath, MASTER_FILE);
        if (fs.existsSync(csv)) {
          out.push(makeSnapshot(ent.name, null, subPath, csv, sub.name));
        }
        continue;
      }

      // sub might be a tenant folder — look for date folders inside it,
      // or a legacy leaf directly inside.
      const legacyTenantLeaf = path.join(subPath, MASTER_FILE);
      if (fs.existsSync(legacyTenantLeaf)) {
        out.push(makeSnapshot(ent.name, sub.name, subPath, legacyTenantLeaf));
        continue;
      }
      for (const dateEntry of fs.readdirSync(subPath, { withFileTypes: true })) {
        if (!dateEntry.isDirectory() || !isDateFolder(dateEntry.name)) continue;
        const csv = path.join(subPath, dateEntry.name, MASTER_FILE);
        if (fs.existsSync(csv)) {
          out.push(makeSnapshot(ent.name, sub.name, path.join(subPath, dateEntry.name), csv, dateEntry.name));
        }
      }
    }
  }
  return out;
}

function makeSnapshot(entity, tenant, dir, csvPath, folderDate = null) {
  const id = tenant ? `${entity}-${tenant}` : entity;
  return {
    entityId: id,
    entity, tenant,
    displayName: id,
    dir, csvPath,
    folderDate,       // Date from folder name (authoritative when present)
  };
}

// -------- CSV loading -------------------------------------------------------
function loadCsv(file) {
  return parseCsv(fs.readFileSync(file, 'utf8'));
}

// -------- Scoring adjustments (per-snapshot, so cross-refs stay local) ------
function isZonalVm(vm) {
  if (!vm) return false;
  const zones = (vm.zones || '').trim();
  if (zones && /\d/.test(zones)) return true;
  const c = (vm.resiliencyconfig || '').trim();
  return c === 'Zonal' || c.startsWith('ZoneRedundant');
}

function adjustPublicIpScoring(rows) {
  const cfg = appConfig.get().publicIpOverride || {};
  if (!cfg.enabled) return 0;
  let count = 0;
  for (const r of rows) {
    if (r.resourcesubtype !== 'Microsoft.Network/publicIPAddresses') continue;
    r.__tier = cfg.tier || 'HIGH';
    r.__score = (cfg.score !== undefined && cfg.score !== null) ? cfg.score : 85;
    r.__configLabel = cfg.label || 'Public IP — zone-redundant by default (override)';
    r.__pipOverridden = true;
    count++;
  }
  return count;
}

const CLUSTER_AWARE_FALLBACK = {
  GOOD:       { tier: 'HIGH',   score: 95, suffix: 'cluster spans 3+ AZs' },
  PARTIAL:    { tier: 'MEDIUM', score: 70, suffix: 'cluster spans 2 AZs' },
  BAD:        { tier: 'LOW',    score: 30, suffix: 'cluster pinned to 1 AZ' },
  MISSING:    { tier: 'LOW',    score: 30, suffix: 'cluster has no zones' },
  STANDALONE: { tier: 'MEDIUM', score: 55, suffix: 'single VM in AZ' },
};

function adjustZonalVmScoring(rows) {
  const rules = { ...CLUSTER_AWARE_FALLBACK, ...(appConfig.get().clusterAware || {}) };
  const clusters = detectClusters(rows);
  const vmCluster = new Map();
  for (const c of clusters) {
    for (const m of c.members) {
      vmCluster.set(`${c.entityId}||${m.name.toLowerCase()}`, {
        status: c.status, clusterStem: c.stem, resourceGroup: c.resourceGroup,
        memberCount: c.memberCount, zonesCovered: c.zonesCovered,
      });
    }
  }
  for (const r of rows) {
    if (r.resourcesubtype !== 'Microsoft.Compute/virtualMachines') continue;
    if ((r.resiliencyconfig || '').trim() !== 'Zonal') continue;
    const key = `${r.__entityId}||${(r.name || '').toLowerCase()}`;
    const cluster = vmCluster.get(key);
    const bucket = cluster ? cluster.status : 'STANDALONE';
    const rule = rules[bucket];
    if (!rule) continue;
    r.__tier = rule.tier;
    r.__score = rule.score;
    r.__configLabel = `Zonal — ${rule.suffix}`;
    r.__clusterStatus = bucket;
    r.__clusterStem = cluster?.clusterStem || null;
    r.__clusterMemberCount = cluster?.memberCount || 1;
    r.__clusterZonesCovered = cluster?.zonesCovered || [];
    r.__zonalAdjusted = true;
  }
}

function adjustDiskScoring(rows) {
  const cfg = appConfig.get().diskAlignment || {};
  if (!cfg.enabled) return;
  const suffix = cfg.labelSuffix || ' (aligned with Zonal VM)';
  const vmByKey = new Map();
  for (const r of rows) {
    if (r.resourcesubtype === 'Microsoft.Compute/virtualMachines') {
      vmByKey.set(`${r.__entityId}||${(r.name || '').toLowerCase()}`, r);
    }
  }
  for (const r of rows) {
    if (r.resourcesubtype !== 'Microsoft.Compute/disks') continue;
    r.__diskAttachedTo = null;
    r.__diskAdjusted = false;
    const parentName = (r.resiliencydetail || '').trim();
    if (!parentName) continue;
    const parent = vmByKey.get(`${r.__entityId}||${parentName.toLowerCase()}`);
    if (!parent) continue;
    r.__diskAttachedTo = parent.name;
    r.__diskParentZonal = isZonalVm(parent);
    if (r.__diskParentZonal && (r.resiliencyconfig || '').trim() === 'LocallyRedundant') {
      r.__tier = 'NA';
      r.__score = null;
      r.__configLabel = `${r.__configLabel}${suffix}`;
      r.__diskAdjusted = true;
    }
  }
}

function applyExclusions(rows) {
  let count = 0;
  for (const r of rows) {
    r.__excluded = false;
    r.__exclusion = null;
    const rec = r.resourceid && exclusions.get(r.resourceid);
    if (!rec) continue;
    r.__excluded = true;
    r.__exclusion = rec;
    r.__tier = 'NA';
    r.__score = null;
    r.__configLabel = `[Excluded] ${rec.justification}`;
    count++;
  }
  return count;
}

// -------- Full refresh -----------------------------------------------------
function refresh() {
  const snapshots = findSnapshots();
  const allRows = [];
  // group snapshots by entity to compute latestRunDate later
  const byEntity = new Map();

  for (const snap of snapshots) {
    let rows;
    try { rows = loadCsv(snap.csvPath); }
    catch (err) { console.error(`[dataStore] Failed to parse ${snap.csvPath}:`, err.message); continue; }

    // Determine runDate for this snapshot
    let runDate = snap.folderDate;
    if (!runDate && rows.length) {
      runDate = (rows[0].reportdate || '').trim() || 'unknown-date';
    }
    if (!runDate) runDate = 'unknown-date';

    // Tag every row with snapshot metadata + baseline scoring
    for (const r of rows) {
      r.__entityId    = snap.entityId;
      r.__entity      = snap.entity;
      r.__tenant      = snap.tenant || '';
      r.__displayName = snap.displayName;
      r.__runDate     = runDate;
      r.__snapshotKey = `${snap.entityId}||${runDate}`;
      const c = classify(r.resiliencyconfig);
      r.__tier        = c.tier;
      r.__score       = c.score;
      r.__configLabel = c.label;
      const p = classifyProd(r);
      r.__prodClass   = p.classification;
      r.__prodSource  = p.source;
      allRows.push(r);
    }

    if (!byEntity.has(snap.entityId)) {
      byEntity.set(snap.entityId, {
        id: snap.entityId,
        entity: snap.entity,
        tenant: snap.tenant,
        displayName: snap.displayName,
        snapshots: [],
      });
    }
    byEntity.get(snap.entityId).snapshots.push({
      runDate,
      path: snap.csvPath,
      rowCount: rows.length,
    });
  }

  // Per-snapshot adjustments — cluster + disk logic must be local to the snapshot
  const grouped = new Map();
  for (const r of allRows) {
    if (!grouped.has(r.__snapshotKey)) grouped.set(r.__snapshotKey, []);
    grouped.get(r.__snapshotKey).push(r);
  }
  for (const bucket of grouped.values()) {
    adjustPublicIpScoring(bucket);
    adjustZonalVmScoring(bucket);
    adjustDiskScoring(bucket);
  }

  applyExclusions(allRows); // exclusions are cross-snapshot by design

  // Sort each entity's snapshots newest-first + record latestRunDate
  const entities = [...byEntity.values()].map(e => {
    e.snapshots.sort((a, b) => b.runDate.localeCompare(a.runDate));
    e.latestRunDate = e.snapshots[0]?.runDate || null;
    return e;
  }).sort((a, b) => a.displayName.localeCompare(b.displayName));

  state = { rows: allRows, entities, loadedAt: new Date().toISOString() };
  const totalSnapshots = [...byEntity.values()].reduce((s, e) => s + e.snapshots.length, 0);
  console.log(`[dataStore] Loaded ${entities.length} entities · ${totalSnapshots} snapshots · ${allRows.length} rows.`);
}

function maybeRefresh() {
  if (!state.loadedAt) return refresh();
  const age = Date.now() - new Date(state.loadedAt).getTime();
  if (age > CACHE_TTL_MS) refresh();
}

// -------- Public API -------------------------------------------------------
// Rows for the LATEST snapshot per entity (default view for most endpoints)
function getLatestRows() {
  maybeRefresh();
  const latestByEntity = new Map(state.entities.map(e => [e.id, e.latestRunDate]));
  return state.rows.filter(r => r.__runDate === latestByEntity.get(r.__entityId));
}

// Rows for a specific runDate on one entity (used for historical views)
function getRowsForSnapshot(entityId, runDate) {
  maybeRefresh();
  return state.rows.filter(r => r.__entityId === entityId && r.__runDate === runDate);
}

// Every row across every snapshot (used for /progress)
function getAllRowsAllSnapshots() {
  maybeRefresh();
  return state.rows;
}

function getEntities() { maybeRefresh(); return state.entities; }

function getSnapshotsForEntity(entityId) {
  maybeRefresh();
  const e = state.entities.find(x => x.id === entityId);
  return e ? e.snapshots : [];
}

module.exports = {
  refresh,
  maybeRefresh,
  // Legacy name kept for existing callers — now returns the latest-per-entity slice.
  getAllRows: getLatestRows,
  getLatestRows,
  getAllRowsAllSnapshots,
  getRowsForSnapshot,
  getEntities,
  getSnapshotsForEntity,
  getMeta: () => ({
    loadedAt: state.loadedAt,
    entityCount: state.entities.length,
    rowCount: getLatestRows().length,
    snapshotCount: state.entities.reduce((s, e) => s + e.snapshots.length, 0),
    totalRowCount: state.rows.length,
  }),
  reapplyExclusions() { applyExclusions(state.rows); },
};
