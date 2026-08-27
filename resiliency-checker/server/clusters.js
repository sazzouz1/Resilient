// Detects VM clusters based on name suffix patterns (xx01/xx02, node1/node2, -a/-b, etc.)
// and evaluates whether cluster members are spread across Availability Zones.
//
// A "cluster" = 2+ VMs in the same resource group whose names differ only in a
// trailing numeric or role suffix. Zone-distribution rules:
//   - GOOD:     unique zones cover ≥ 3 different AZs (or match member count)
//   - PARTIAL:  spread across 2 zones (some HA, but not 3-zone)
//   - BAD:      all members in the same zone
//   - MISSING:  none of the members have a zone assigned
//
// The stem-extraction heuristic strips a trailing counter (digits or -a/-b)
// and returns null if no meaningful stem remains.

// Strip trailing numeric or alphabetic role suffix. Returns the "stem" or null.
function stem(name) {
  if (!name) return null;
  const n = name.toLowerCase();

  // Common patterns to strip from the end:
  //   -01, _01, 01              → digits (1-3)
  //   -node01, -vm01, -srv1     → also handled
  //   -a, -b                    → letter cluster (last)
  const patterns = [
    /^(.*?)[-_]?(\d{1,3})$/,          // foo01, foo-01, foo_1
    /^(.*?)[-_](a|b|c|d)$/i,          // foo-a, foo_b
  ];
  for (const p of patterns) {
    const m = n.match(p);
    if (m && m[1] && m[1].length >= 2) return m[1].replace(/[-_]+$/, '');
  }
  return null;
}

// Normalize a `zones` field ("1", "1 2 3", "2 -stdby") to a Set of zone numbers.
function parseZones(z) {
  if (!z) return new Set();
  const tokens = z.toString().split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
  const out = new Set();
  for (const t of tokens) {
    const m = t.match(/^\d+/);
    if (m) out.add(m[0]);
  }
  return out;
}

function verdict(members) {
  const zoneSets = members.map(v => parseZones(v.zones));
  const allZones = new Set();
  zoneSets.forEach(s => s.forEach(z => allZones.add(z)));

  if (allZones.size === 0) return { status: 'MISSING', label: 'No zones assigned' };
  const eachHasZone = zoneSets.every(s => s.size > 0);
  if (!eachHasZone) return { status: 'PARTIAL', label: 'Some members have no zone' };

  // If every VM lives in exactly one zone, we check spread of those unique zones.
  const distinctPinnedZones = new Set(members.map(v => {
    const s = parseZones(v.zones);
    return s.size === 1 ? [...s][0] : null;
  }).filter(Boolean));

  if (allZones.size >= 3) return { status: 'GOOD', label: '3-AZ spread' };
  if (allZones.size === 2) return { status: 'PARTIAL', label: `Only 2 zones (${[...allZones].join(', ')})` };
  return { status: 'BAD', label: `All in zone ${[...allZones][0]}` };
}

const appConfig = require('./appConfig');

// rows: MasterReport rows already tagged with __entityId etc.
// Returns clusters grouped by { entity, resourceGroup, stem }
function detectClusters(rows) {
  const minMembers = Math.max(2, appConfig.get()?.clusterDetection?.minMembers || 2);
  const vms = rows.filter(r => r.resourcesubtype === 'Microsoft.Compute/virtualMachines');
  const groups = new Map();

  for (const v of vms) {
    const s = stem(v.name);
    if (!s) continue;
    const key = `${v.__entityId}||${(v.resourcegroup || '').toLowerCase()}||${s}`;
    if (!groups.has(key)) {
      groups.set(key, {
        entityId: v.__entityId,
        entity: v.__displayName,
        resourceGroup: v.resourcegroup,
        stem: s,
        members: [],
      });
    }
    groups.get(key).members.push({
      name: v.name,
      location: v.location,
      zones: v.zones,
      resiliencyconfig: v.resiliencyconfig,
      resiliencydetail: v.resiliencydetail,
      sku: v.skuname,
      subscription: v.subscription,
    });
  }

  const clusters = [...groups.values()].filter(g => g.members.length >= minMembers);
  for (const c of clusters) {
    c.memberCount = c.members.length;
    const v = verdict(c.members);
    c.status = v.status;
    c.statusLabel = v.label;
    c.zonesCovered = [...new Set(c.members.flatMap(m => [...parseZones(m.zones)]))].sort();
  }
  return clusters.sort((a, b) => {
    const rank = { BAD: 0, MISSING: 1, PARTIAL: 2, GOOD: 3 };
    return rank[a.status] - rank[b.status] || b.memberCount - a.memberCount;
  });
}

module.exports = { detectClusters, stem, parseZones };
