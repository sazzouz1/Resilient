// Central app configuration — everything a user might tune lives here.
// Persisted to data/config.json. Missing/partial config falls back to defaults
// so an incomplete file never bricks the server.

const fs = require('fs');
const path = require('path');
const { DEFAULT_DATA_ROOT, DATA_ROOT_FROM_CLI, DATA_ROOT_FROM_ENV } = require('./config');

const STORE_DIR = path.join(__dirname, '..', 'data');
const STORE_FILE = path.join(STORE_DIR, 'config.json');

// Deep, exhaustive defaults — mirror the previously-hardcoded values so
// behaviour is identical out of the box.
const DEFAULTS = {
  scoring: {
    configMap: {
      ZoneRedundant:          { tier: 'HIGH',   score: 100,  label: 'Zone Redundant' },
      ZoneRedundant_StanbyHA: { tier: 'HIGH',   score: 100,  label: 'Zone Redundant (Standby HA)' },
      SameZoneHA:             { tier: 'HIGH',   score:  90,  label: 'Same-Zone HA' },
      GeoRedundant:           { tier: 'HIGH',   score:  85,  label: 'Geo Redundant' },
      GeoRedundantbyDefault:  { tier: 'HIGH',   score:  85,  label: 'Geo Redundant (Default)' },
      Zonal:                  { tier: 'MEDIUM', score:  60,  label: 'Zonal (Single AZ)' },
      PartiallyAzRedundant:   { tier: 'MEDIUM', score:  55,  label: 'Partially AZ Redundant' },
      LocallyRedundant:       { tier: 'LOW',    score:  20,  label: 'Locally Redundant (LRS)' },
      NonZonal:               { tier: 'LOW',    score:  25,  label: 'Non-Zonal' },
      RedundantbyDefault:     { tier: 'NA',     score: null, label: 'Redundant by Default (Platform)' },
      NotApply:               { tier: 'NA',     score: null, label: 'Not Applicable' },
      NoInfo:                 { tier: 'NA',     score: null, label: 'No Info' },
      '':                     { tier: 'NA',     score: null, label: 'Unclassified' },
    },
  },
  clusterAware: {
    GOOD:       { tier: 'HIGH',   score: 95, suffix: 'cluster spans 3+ AZs' },
    PARTIAL:    { tier: 'MEDIUM', score: 70, suffix: 'cluster spans 2 AZs' },
    BAD:        { tier: 'LOW',    score: 30, suffix: 'cluster pinned to 1 AZ' },
    MISSING:    { tier: 'LOW',    score: 30, suffix: 'cluster has no zones' },
    STANDALONE: { tier: 'MEDIUM', score: 55, suffix: 'single VM in AZ' },
  },
  publicIpOverride: {
    enabled: true,
    tier: 'HIGH',
    score: 85,
    label: 'Public IP — zone-redundant by default (override)',
  },
  diskAlignment: {
    enabled: true,
    labelSuffix: ' (aligned with Zonal VM)',
  },
  prodClassifier: {
    // Order of columns tried; first match wins.
    sources: ['environment', 'subscription', 'resourcegroup'],
    // ECMAScript regex bodies (no leading/trailing slashes, no flags)
    nonProdPattern: '\\b(nonprod|non[\\-_ ]?prod|non[\\-_ ]?production|pre[\\-_ ]?prod|preprod|pre[\\-_ ]?production|dev|develop|development|test|qa|uat|sit|stg|staging|ppr|sandbox|poc|training)\\b',
    prodPattern:    '(^|[^a-z])(prod|production|prd)([^a-z]|$)',
  },
  clusterDetection: {
    // Minimum number of VMs required to form a "group" (default 2).
    minMembers: 2,
  },
  paths: {
    // Absolute path to the folder that holds <Entity>/<RunDate>/MasterReport.csv.
    // Overridden by DATA_ROOT env var or --data-root=<path> CLI arg.
    // Leave empty to use the hardcoded default in server/config.js.
    dataRoot: '',
  },
};

let cache = null;

function ensureDir() {
  if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
}

// Merge user overrides onto defaults recursively. Only replaces keys the user
// actually set, so removing a field from config.json falls back to default.
function deepMerge(base, override) {
  if (override === null || override === undefined) return base;
  if (typeof override !== 'object' || Array.isArray(override)) return override;
  const out = Array.isArray(base) ? [...base] : { ...(base || {}) };
  for (const [k, v] of Object.entries(override)) {
    out[k] = (v && typeof v === 'object' && !Array.isArray(v))
      ? deepMerge(base?.[k], v)
      : v;
  }
  return out;
}

function load() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
      cache = deepMerge(DEFAULTS, raw || {});
      console.log(`[appConfig] loaded ${STORE_FILE}`);
    } else {
      cache = deepMerge(DEFAULTS, {});
      console.log(`[appConfig] no ${STORE_FILE}, using defaults.`);
    }
  } catch (err) {
    console.error('[appConfig] failed to load, using defaults:', err.message);
    cache = deepMerge(DEFAULTS, {});
  }
  return cache;
}

function get() {
  if (!cache) load();
  return cache;
}

function save(newConfig) {
  ensureDir();
  const merged = deepMerge(DEFAULTS, newConfig || {});
  fs.writeFileSync(STORE_FILE, JSON.stringify(merged, null, 2), 'utf8');
  cache = merged;
  return merged;
}

function reset() {
  ensureDir();
  fs.writeFileSync(STORE_FILE, JSON.stringify(DEFAULTS, null, 2), 'utf8');
  cache = deepMerge(DEFAULTS, {});
  return cache;
}

// Read-only defaults so the UI can offer a "reset to default" per section.
function getDefaults() { return DEFAULTS; }

// Resolve the effective data root by combining, in precedence order:
//   CLI > env > config.json > hardcoded default.
// Returns { path, source } so the UI can surface where it came from.
function getEffectiveDataRoot() {
  if (DATA_ROOT_FROM_CLI) return { path: DATA_ROOT_FROM_CLI, source: 'cli' };
  if (DATA_ROOT_FROM_ENV) return { path: DATA_ROOT_FROM_ENV, source: 'env' };
  const cfg = get();
  const fromConfig = cfg?.paths?.dataRoot;
  if (fromConfig && fromConfig.trim()) return { path: fromConfig.trim(), source: 'config' };
  return { path: DEFAULT_DATA_ROOT, source: 'default' };
}

module.exports = { load, get, save, reset, getDefaults, getEffectiveDataRoot };
