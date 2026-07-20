// Classifies a row as production / non-prod / unknown using regex patterns
// loaded from the runtime app config. The check is name-based only —
// always show the disclaimer in the UI.

const appConfig = require('./appConfig');

// Compile & cache regexes when the config changes.
let cached = { key: null, prod: null, nonprod: null, sources: null };

function refresh() {
  const cfg = appConfig.get().prodClassifier || {};
  const key = JSON.stringify(cfg);
  if (cached.key === key) return cached;
  try {
    cached = {
      key,
      prod:    new RegExp(cfg.prodPattern || '',    'i'),
      nonprod: new RegExp(cfg.nonProdPattern || '', 'i'),
      sources: Array.isArray(cfg.sources) && cfg.sources.length ? cfg.sources : ['environment', 'subscription', 'resourcegroup'],
    };
  } catch (err) {
    console.error('[prodClassifier] invalid regex in config, using empty:', err.message);
    cached = { key, prod: /(?!)/, nonprod: /(?!)/, sources: ['environment', 'subscription', 'resourcegroup'] };
  }
  return cached;
}

function scan(str) {
  const c = refresh();
  if (!str) return null;
  const s = String(str).trim().toLowerCase();
  if (!s || s === 'n/a') return null;
  if (c.nonprod.test(s)) return 'nonprod';
  if (c.prod.test(s))    return 'prod';
  return null;
}

function classify(row) {
  const c = refresh();
  for (const src of c.sources) {
    const val = row[src];
    const result = scan(val);
    if (result) return { classification: result, source: src };
  }
  return { classification: 'unknown', source: null };
}

module.exports = { classify };

