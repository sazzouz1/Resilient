// Resiliency scoring engine — plug-in module.
//
// The tier/score table is loaded from the runtime appConfig so it can be
// tuned at runtime (Settings view / config.json) without a code change.
// A hardcoded fallback keeps behaviour sane if the config is missing.
const appConfig = require('./appConfig');

function getMap() {
  return appConfig.get()?.scoring?.configMap || {};
}

function classify(resiliencyconfig) {
  const key = (resiliencyconfig || '').trim();
  const map = getMap();
  return map[key] || { tier: 'NA', score: null, label: key || 'Unclassified' };
}

// Aggregate a set of rows into a single scored bucket.
function aggregate(rows) {
  let scored = 0;
  let totalScore = 0;
  const tierCounts = { HIGH: 0, MEDIUM: 0, LOW: 0, NA: 0 };
  const configCounts = {};

  for (const r of rows) {
    const tier = r.__tier || 'NA';
    const score = r.__score;
    const label = r.__configLabel || '';
    tierCounts[tier] = (tierCounts[tier] || 0) + 1;
    configCounts[label] = (configCounts[label] || 0) + 1;
    if (score !== null && score !== undefined) {
      totalScore += score;
      scored++;
    }
  }

  const inScope = rows.length - tierCounts.NA;
  return {
    total: rows.length,
    inScope,
    naCount: tierCounts.NA,
    resiliencyScore: scored > 0 ? Math.round(totalScore / scored) : null,
    highPct:   inScope > 0 ? Math.round((tierCounts.HIGH   / inScope) * 100) : 0,
    mediumPct: inScope > 0 ? Math.round((tierCounts.MEDIUM / inScope) * 100) : 0,
    lowPct:    inScope > 0 ? Math.round((tierCounts.LOW    / inScope) * 100) : 0,
    tierCounts,
    configCounts,
  };
}

module.exports = { classify, aggregate, get CONFIG_MAP() { return getMap(); } };

