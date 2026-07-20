// Persistent exclusion store — user can mark specific resources (by Azure
// resourceId) as excluded from scoring, with a justification and audit trail.
//
// State is written to disk on every mutation so it survives server restarts
// and CSV re-imports. The file lives OUTSIDE the assessment data folder so
// re-running the RelAZ_Assess script won't touch it.

const fs = require('fs');
const path = require('path');

const STORE_DIR = path.join(__dirname, '..', 'data');
const STORE_FILE = path.join(STORE_DIR, 'exclusions.json');

let state = { version: 1, exclusions: [] };
let byId = new Map(); // resourceId -> exclusion record

function ensureDir() {
  if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
}

function load() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      state = { version: parsed.version || 1, exclusions: parsed.exclusions || [] };
    } else {
      state = { version: 1, exclusions: [] };
    }
  } catch (err) {
    console.error('[exclusions] failed to load, starting empty:', err.message);
    state = { version: 1, exclusions: [] };
  }
  byId = new Map(state.exclusions.map(e => [e.resourceId, e]));
  console.log(`[exclusions] loaded ${state.exclusions.length} entries.`);
}

function save() {
  ensureDir();
  fs.writeFileSync(STORE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function list() {
  return state.exclusions.slice().sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
}

function get(resourceId) {
  return byId.get(resourceId) || null;
}

function isExcluded(resourceId) {
  return byId.has(resourceId);
}

// Add or overwrite an exclusion. Justification is required and stored verbatim.
function add({ resourceId, resourceName, resourceType, entity, resourceGroup, justification, addedBy }) {
  if (!resourceId) throw new Error('resourceId is required');
  if (!justification || !justification.trim()) throw new Error('justification is required');

  const record = {
    resourceId,
    resourceName: resourceName || null,
    resourceType: resourceType || null,
    entity: entity || null,
    resourceGroup: resourceGroup || null,
    justification: justification.trim(),
    addedBy: (addedBy || 'unknown').trim(),
    addedAt: new Date().toISOString(),
  };

  const existingIdx = state.exclusions.findIndex(e => e.resourceId === resourceId);
  if (existingIdx >= 0) {
    // Preserve original addedAt / addedBy when updating; only justification refreshes
    record.addedAt = state.exclusions[existingIdx].addedAt;
    record.addedBy = state.exclusions[existingIdx].addedBy;
    record.updatedAt = new Date().toISOString();
    record.updatedBy = (addedBy || 'unknown').trim();
    state.exclusions[existingIdx] = record;
  } else {
    state.exclusions.push(record);
  }
  byId.set(resourceId, record);
  save();
  return record;
}

function remove(resourceId) {
  const idx = state.exclusions.findIndex(e => e.resourceId === resourceId);
  if (idx < 0) return false;
  state.exclusions.splice(idx, 1);
  byId.delete(resourceId);
  save();
  return true;
}

module.exports = { load, list, get, add, remove, isExcluded };
