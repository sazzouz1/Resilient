// API surface — each endpoint returns pure JSON so views can be swapped/added freely.
const store = require('../dataStore');
const { aggregate, classify, CONFIG_MAP } = require('../scoring');
const { detectClusters } = require('../clusters');
const { makeRouter } = require('../httpServer');
const exclusions = require('../exclusions');
const appConfig = require('../appConfig');

const router = makeRouter();

// Resolve which row set the request wants:
//   - runDate=YYYY-MM-DD + entity=X   → that specific snapshot
//   - runDate=YYYY-MM-DD (no entity)  → every row from any entity at that date
//   - no runDate                      → latest snapshot per entity (default)
function baseRows(q = {}) {
  if (q.runDate && q.entity) return store.getRowsForSnapshot(q.entity, q.runDate);
  if (q.runDate) {
    return store.getAllRowsAllSnapshots().filter(r => r.__runDate === q.runDate);
  }
  return store.getLatestRows();
}

// ---- helpers ----------------------------------------------------------------
function applyFilters(rows, q = {}) {
  const prodOnly = q.prodOnly === 'true' || q.prodOnly === true;
  return rows.filter(r => {
    if (prodOnly && r.__prodClass !== 'prod') return false;
    if (q.entity && r.__entityId !== q.entity) return false;
    if (q.tier && r.__tier !== q.tier) return false;
    if (q.resourceType && r.resourcesubtype !== q.resourceType) return false;
    if (q.location && r.location !== q.location) return false;
    if (q.environment && (r.environment || 'N/A') !== q.environment) return false;
    if (q.subscription && r.subscription !== q.subscription) return false;
    if (q.resourceGroup && (r.resourcegroup || '').toLowerCase() !== q.resourceGroup.toLowerCase()) return false;
    if (q.prodClass && r.__prodClass !== q.prodClass) return false;
    if (q.search) {
      const s = q.search.toLowerCase();
      if (!(r.name || '').toLowerCase().includes(s) &&
          !(r.resourcegroup || '').toLowerCase().includes(s) &&
          !(r.application || '').toLowerCase().includes(s)) return false;
    }
    return true;
  });
}

function groupCount(rows, key) {
  const map = new Map();
  for (const r of rows) {
    const k = (r[key] ?? '').toString() || '(blank)';
    map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

// Row -> shape returned by /resources: always includes raw resiliencyconfig +
// resiliencydetail so the UI can surface them alongside the score.
function projectRow(r) {
  return {
    entity: r.__displayName,
    entityId: r.__entityId,
    runDate: r.__runDate,
    name: r.name,
    resourceType: r.resourcesubtype,
    location: r.location,
    resourceGroup: r.resourcegroup,
    subscription: r.subscription,
    resiliencyConfig: r.resiliencyconfig,
    resiliencyDetail: r.resiliencydetail,
    tier: r.__tier,
    score: r.__score,
    configLabel: r.__configLabel,
    zones: r.zones,
    sku: r.skuname,
    kind: r.kind,
    environment: r.environment,
    application: r.application,
    assetClassification: r.assetclassification,
    businessUnit: r['business unit'],
    resourceId: r.resourceid,
    backupDetails: r.backupdetails,
    lastBackup: r.lastbackup,
    asrDetails: r.asrdetails,
    asrConfig: r.asrconfig,
    reportDate: r.reportdate,
    prodClass: r.__prodClass,
    prodSource: r.__prodSource,
    diskAttachedTo: r.__diskAttachedTo,
    diskAdjusted: !!r.__diskAdjusted,
    pipOverridden: !!r.__pipOverridden,
    zonalAdjusted: !!r.__zonalAdjusted,
    excluded: !!r.__excluded,
    exclusion: r.__exclusion || null,
    clusterStatus: r.__clusterStatus || null,
    clusterStem: r.__clusterStem || null,
    clusterMemberCount: r.__clusterMemberCount || null,
    clusterZonesCovered: r.__clusterZonesCovered ? r.__clusterZonesCovered.join(', ') : null,
  };
}

// ---- endpoints --------------------------------------------------------------

router.get('/api/meta', () => ({
  ...store.getMeta(),
  dataRoot: appConfig.getEffectiveDataRoot(),
  scoringConfig: Object.entries(CONFIG_MAP).map(([k, v]) => ({ key: k, ...v })),
}));

router.get('/api/entities', ({ query }) => {
  const rows = applyFilters(baseRows(query), query);
  const entities = store.getEntities();
  const byEnt = new Map(entities.map(e => [e.id, { ...e, rows: [] }]));
  for (const r of rows) byEnt.get(r.__entityId)?.rows.push(r);

  return [...byEnt.values()]
    .filter(e => e.rows.length > 0)
    .map(e => {
      const agg = aggregate(e.rows);
      return {
        id: e.id, entity: e.entity, tenant: e.tenant,
        displayName: e.displayName,
        reportDate: e.latestRunDate,
        latestRunDate: e.latestRunDate,
        snapshotCount: e.snapshots.length,
        ...agg,
      };
    })
    .sort((a, b) => (b.resiliencyScore ?? -1) - (a.resiliencyScore ?? -1));
});

router.get('/api/summary', ({ query }) => aggregate(applyFilters(baseRows(query), query)));

router.get('/api/breakdown', ({ query }) => {
  const rows = applyFilters(baseRows(query), query);
  const groupBy = query.groupBy || 'resourcesubtype';
  const buckets = new Map();
  for (const r of rows) {
    const k = (r[groupBy] ?? '').toString() || '(blank)';
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(r);
  }
  return [...buckets.entries()].map(([name, bucketRows]) => ({
    name,
    count: bucketRows.length,
    ...aggregate(bucketRows),
  })).sort((a, b) => b.count - a.count);
});

router.get('/api/resources', ({ query }) => {
  const rows = applyFilters(baseRows(query), query);
  const page = parseInt(query.page || '0', 10);
  const pageSize = Math.min(parseInt(query.pageSize || '200', 10), 100000);
  const start = page * pageSize;
  const slice = rows.slice(start, start + pageSize).map(projectRow);
  return { total: rows.length, page, pageSize, rows: slice };
});

router.get('/api/facets', ({ query }) => {
  const rows = applyFilters(baseRows(query), query);
  return {
    resourceTypes: groupCount(rows, 'resourcesubtype'),
    locations:     groupCount(rows, 'location'),
    environments:  groupCount(rows, 'environment'),
    subscriptions: groupCount(rows, 'subscription'),
    tiers:         groupCount(rows, '__tier'),
    configs:       groupCount(rows, '__configLabel'),
  };
});

// Resource-group view: aggregate per (entity, resourceGroup)
router.get('/api/resource-groups', ({ query }) => {
  const rows = applyFilters(baseRows(query), query);
  const map = new Map();
  for (const r of rows) {
    const rg = r.resourcegroup || '(none)';
    const key = `${r.__entityId}||${rg}`;
    if (!map.has(key)) map.set(key, { entityId: r.__entityId, entity: r.__displayName, resourceGroup: rg, rows: [] });
    map.get(key).rows.push(r);
  }
  return [...map.values()].map(g => {
    const clusters = detectClusters(g.rows);
    const clusterFlags = { GOOD: 0, PARTIAL: 0, BAD: 0, MISSING: 0 };
    for (const c of clusters) clusterFlags[c.status]++;
    return {
      entityId: g.entityId,
      entity: g.entity,
      resourceGroup: g.resourceGroup,
      clusterCount: clusters.length,
      clusterFlags,
      ...aggregate(g.rows),
    };
  }).sort((a, b) => {
    const aRisk = (a.clusterFlags.BAD || 0) + (a.clusterFlags.MISSING || 0);
    const bRisk = (b.clusterFlags.BAD || 0) + (b.clusterFlags.MISSING || 0);
    if (aRisk !== bRisk) return bRisk - aRisk;
    return b.total - a.total;
  });
});

// All resources for a specific (entity, resourceGroup)
router.get('/api/resource-group', ({ query }) => {
  const { entity, resourceGroup } = query;
  if (!entity || !resourceGroup) return { error: 'entity + resourceGroup required' };
  const rows = baseRows({ ...query, entity }).filter(r =>
    r.__entityId === entity && (r.resourcegroup || '').toLowerCase() === resourceGroup.toLowerCase()
  );
  const clusters = detectClusters(rows);
  return {
    entityId: entity,
    resourceGroup,
    runDate: rows[0]?.__runDate || null,
    summary: aggregate(rows),
    resources: rows.map(projectRow),
    clusters,
  };
});

// Cross-government VM group scan (kept /vm-clusters as an alias for backward compat)
const vmGroupsHandler = ({ query }) => {
  const rows = applyFilters(baseRows(query), query);
  const clusters = detectClusters(rows);
  const stats = { total: clusters.length, GOOD: 0, PARTIAL: 0, BAD: 0, MISSING: 0 };
  for (const c of clusters) stats[c.status]++;
  return { stats, clusters };
};
router.get('/api/vm-groups',   vmGroupsHandler);
router.get('/api/vm-clusters', vmGroupsHandler); // legacy alias

// ---- Snapshots & progress --------------------------------------------------

// All snapshots (across all entities) with per-snapshot aggregate score
router.get('/api/snapshots', ({ query }) => {
  const entities = store.getEntities();
  const filter = query.entity;
  const out = [];
  for (const e of entities) {
    if (filter && e.id !== filter) continue;
    for (const s of e.snapshots) {
      const rows = store.getRowsForSnapshot(e.id, s.runDate);
      out.push({
        entityId: e.id,
        entity: e.entity,
        tenant: e.tenant,
        displayName: e.displayName,
        runDate: s.runDate,
        rowCount: rows.length,
        isLatest: s.runDate === e.latestRunDate,
        ...aggregate(rows),
      });
    }
  }
  // newest first per entity
  out.sort((a, b) =>
    a.displayName.localeCompare(b.displayName) || b.runDate.localeCompare(a.runDate));
  return out;
});

// Time series + last-vs-first diff for one entity.
// If ?entity is omitted, returns aggregated government-wide series.
router.get('/api/progress', ({ query }) => {
  const q = query || {};
  const prodOnly = q.prodOnly === 'true' || q.prodOnly === true;

  const entities = store.getEntities();
  const wantedEntities = q.entity ? entities.filter(e => e.id === q.entity) : entities;
  if (!wantedEntities.length) return { entityId: q.entity || null, series: [], diff: null };

  // Build per-runDate series. If a single entity is picked, use its own snapshots;
  // otherwise use the union of all distinct runDates across the selection and
  // aggregate rows from every entity that has a snapshot on that date.
  const dateSet = new Set();
  for (const e of wantedEntities) for (const s of e.snapshots) dateSet.add(s.runDate);
  const dates = [...dateSet].sort();

  const series = dates.map(runDate => {
    let rows = [];
    for (const e of wantedEntities) {
      const has = e.snapshots.find(s => s.runDate === runDate);
      if (!has) continue;
      rows = rows.concat(store.getRowsForSnapshot(e.id, runDate));
    }
    if (prodOnly) rows = rows.filter(r => r.__prodClass === 'prod');
    const agg = aggregate(rows);
    return {
      runDate,
      rowCount: rows.length,
      ...agg,
    };
  });

  // Diff between first and latest snapshots (only meaningful for single-entity view)
  let diff = null;
  if (q.entity && series.length >= 2) {
    const first = series[0];
    const last  = series[series.length - 1];
    diff = {
      fromDate: first.runDate,
      toDate: last.runDate,
      scoreDelta: (last.resiliencyScore ?? 0) - (first.resiliencyScore ?? 0),
      totalDelta: last.total - first.total,
      highDelta: last.tierCounts.HIGH - first.tierCounts.HIGH,
      mediumDelta: last.tierCounts.MEDIUM - first.tierCounts.MEDIUM,
      lowDelta: last.tierCounts.LOW - first.tierCounts.LOW,
      naDelta: last.tierCounts.NA - first.tierCounts.NA,
    };
  }

  return { entityId: q.entity || null, series, diff };
});

// Per-resource diff between two snapshots of the same entity.
// Returns which resources moved tier, appeared (new), or disappeared (removed).
router.get('/api/snapshot-diff', ({ query }) => {
  const { entity, from, to } = query || {};
  if (!entity || !from || !to) return { error: 'entity, from, to are required' };

  const oldRows = store.getRowsForSnapshot(entity, from);
  const newRows = store.getRowsForSnapshot(entity, to);
  const oldMap = new Map(oldRows.map(r => [r.resourceid, r]));
  const newMap = new Map(newRows.map(r => [r.resourceid, r]));

  const improved = [];
  const regressed = [];
  const unchanged = [];
  const added = [];
  const removed = [];
  const tierRank = { HIGH: 3, MEDIUM: 2, LOW: 1, NA: 0 };

  for (const [rid, nr] of newMap) {
    const or = oldMap.get(rid);
    if (!or) { added.push(projectRow(nr)); continue; }
    const before = { tier: or.__tier, score: or.__score, config: or.resiliencyconfig };
    const after  = { tier: nr.__tier, score: nr.__score, config: nr.resiliencyconfig };
    const item = { ...projectRow(nr), before, after };
    if (before.tier !== after.tier) {
      (tierRank[after.tier] > tierRank[before.tier] ? improved : regressed).push(item);
    } else if ((before.score ?? -1) !== (after.score ?? -1)) {
      ((after.score ?? 0) > (before.score ?? 0) ? improved : regressed).push(item);
    } else {
      unchanged.push(item);
    }
  }
  for (const [rid, or] of oldMap) {
    if (!newMap.has(rid)) removed.push(projectRow(or));
  }

  return {
    entity, from, to,
    counts: {
      improved: improved.length,
      regressed: regressed.length,
      unchanged: unchanged.length,
      added: added.length,
      removed: removed.length,
    },
    improved, regressed, added, removed,
    // unchanged omitted to keep payload manageable — count is enough
  };
});

router.post('/api/refresh', () => { store.refresh(); return store.getMeta(); });

// Prod classification breakdown — powers the header badge & disclaimer.
router.get('/api/prod-stats', ({ query }) => {
  const rows = baseRows(query);
  const counts = { prod: 0, nonprod: 0, unknown: 0 };
  for (const r of rows) counts[r.__prodClass] = (counts[r.__prodClass] || 0) + 1;
  return { total: rows.length, ...counts };
});

// ---- Exclusions -------------------------------------------------------------
router.get('/api/exclusions', () => ({
  count: exclusions.list().length,
  exclusions: exclusions.list(),
}));

router.post('/api/exclusions', ({ body }) => {
  if (!body || !body.resourceId) return { error: 'resourceId is required' };
  if (!body.justification || !body.justification.trim()) return { error: 'justification is required' };
  // Enrich with row context if the resource is known
  let extra = {};
  const rows = store.getLatestRows();
  const row = rows.find(r => r.resourceid === body.resourceId);
  if (row) {
    extra = {
      resourceName: row.name,
      resourceType: row.resourcesubtype,
      entity: row.__displayName,
      resourceGroup: row.resourcegroup,
    };
  }
  const record = exclusions.add({ ...extra, ...body });
  store.reapplyExclusions();
  return { ok: true, exclusion: record };
});

router.post('/api/exclusions/delete', ({ body }) => {
  if (!body || !body.resourceId) return { error: 'resourceId is required' };
  const removed = exclusions.remove(body.resourceId);
  if (removed) store.reapplyExclusions();
  return { ok: removed };
});

// ---- App config -------------------------------------------------------------

router.get('/api/config', () => ({
  config: appConfig.get(),
  defaults: appConfig.getDefaults(),
  dataRoot: appConfig.getEffectiveDataRoot(),
}));

router.post('/api/config', ({ body }) => {
  if (!body || typeof body !== 'object') return { error: 'body must be a JSON object' };
  // Validate regex fields — invalid regex would silently break prod classification.
  const pc = body.prodClassifier;
  if (pc) {
    for (const key of ['prodPattern', 'nonProdPattern']) {
      if (pc[key]) {
        try { new RegExp(pc[key], 'i'); }
        catch (e) { return { error: `Invalid regex in prodClassifier.${key}: ${e.message}` }; }
      }
    }
  }
  // Validate data root — a non-existent path silently produces zero snapshots,
  // so we refuse to save one that clearly won't work.
  const newDataRoot = body?.paths?.dataRoot;
  if (newDataRoot && newDataRoot.trim()) {
    const fs = require('fs');
    if (!fs.existsSync(newDataRoot)) {
      return { error: `Data root path does not exist: ${newDataRoot}` };
    }
  }
  const saved = appConfig.save(body);
  store.refresh(); // re-score everything under the new config
  return { ok: true, config: saved, dataRoot: appConfig.getEffectiveDataRoot() };
});

router.post('/api/config/reset', () => {
  const reset = appConfig.reset();
  store.refresh();
  return { ok: true, config: reset };
});

module.exports = router;
