// Central config — resolution order for DATA_ROOT (highest wins):
//   1. --data-root=<path>  CLI argument
//   2. DATA_ROOT           environment variable
//   3. paths.dataRoot      in data/config.json (via Settings UI)
//   4. hardcoded default   below
//
// The static value here is exported as DEFAULT_DATA_ROOT. Runtime code should
// use the resolveDataRoot() helper (server/appConfig.getEffectiveDataRoot).

function argValue(name) {
  const prefix = `--${name}=`;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith(prefix)) return a.slice(prefix.length);
    if (a === `--${name}` || a === `-${name.charAt(0)}`) {
      const idx = process.argv.indexOf(a);
      if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
    }
  }
  return null;
}

const DEFAULT_DATA_ROOT = 'C:\\ADGE Resiliency\\ADGEs Assessment Reports';

module.exports = {
  DEFAULT_DATA_ROOT,
  // Baseline chosen at process start — before appConfig loads its JSON.
  // appConfig.getEffectiveDataRoot() computes the final value including
  // any override written via the Settings UI.
  DATA_ROOT_FROM_CLI: argValue('data-root'),
  DATA_ROOT_FROM_ENV: process.env.DATA_ROOT || null,
  MASTER_FILE: 'MasterReport.csv',
  PORT: process.env.PORT || argValue('port') || 5173,
  CACHE_TTL_MS: 5 * 60 * 1000, // Re-scan disk every 5 min
};

