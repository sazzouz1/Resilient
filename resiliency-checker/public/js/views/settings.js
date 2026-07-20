// Settings view — edit scoring rules, cluster-aware overrides, Public IP
// override, disk-alignment, prod-classifier regexes, and cluster detection.
// Changes are POSTed to /api/config and trigger a server-side re-score.
import { api } from '../api.js';
import { el, toast } from '../ui.js';

async function render(host) {
  host.append(
    el('h2', {}, 'Settings'),
    el('div', { class: 'subtitle' }, 'Tune scoring rules and detection parameters. Changes are saved to data/config.json, take effect immediately, and trigger a full re-score of every snapshot.')
  );

  const { config, defaults, dataRoot } = await api.config();
  // Deep clone so edits don't mutate the loaded object until Save
  const working = JSON.parse(JSON.stringify(config));

  const rootPanel = el('div');
  host.append(rootPanel);

  function rerender() {
    rootPanel.innerHTML = '';
    rootPanel.append(
      renderDataRoot(working, defaults, dataRoot),
      renderScoringMap(working, defaults),
      renderClusterAware(working, defaults),
      renderPublicIp(working, defaults),
      renderDiskAlignment(working, defaults),
      renderProdClassifier(working, defaults),
      renderClusterDetection(working, defaults),
      renderActions(working, defaults),
    );
  }

  function renderActions() {
    const panel = el('div', { class: 'panel', style: { marginTop: '14px', position: 'sticky', bottom: '10px' } });
    const info = el('div', { class: 'muted', style: { flex: '1' } },
      'Saving triggers a re-score of every snapshot. Changes to prod-classifier regex are validated before save.');
    const saveBtn = el('button', { class: 'btn' }, 'Save & re-score');
    const cancelBtn = el('button', { class: 'btn ghost' }, 'Discard changes');
    const resetBtn = el('button', { class: 'btn ghost' }, 'Reset all to defaults');

    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      const result = await api.saveConfig(working);
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save & re-score';
      if (result.ok) { toast('Config saved. Data re-scored.', 'ok'); }
      else            { toast(`Save failed: ${result.error || 'unknown'}`, 'error'); }
    });
    cancelBtn.addEventListener('click', async () => {
      const fresh = await api.config();
      Object.assign(working, JSON.parse(JSON.stringify(fresh.config)));
      rerender();
      toast('Reloaded from server.', 'info');
    });
    resetBtn.addEventListener('click', async () => {
      if (!confirm('Reset ALL config to shipped defaults? This clears any customization you saved.')) return;
      const result = await api.resetConfig();
      if (result.ok) {
        Object.assign(working, JSON.parse(JSON.stringify(result.config)));
        rerender();
        toast('Reset to defaults.', 'ok');
      }
    });

    panel.append(el('div', { class: 'toolbar' }, [info, resetBtn, cancelBtn, saveBtn]));
    return panel;
  }

  rerender();
}

// -------- Data source (folder path) -----------------------------------------
function renderDataRoot(working, defaults, dataRoot) {
  const panel = el('div', { class: 'panel', style: { marginTop: '14px' } });
  panel.append(el('h3', {}, 'Data source path'));

  const sourceLabels = {
    cli:     '--data-root=… CLI argument (overrides everything)',
    env:     'DATA_ROOT environment variable (overrides config)',
    config:  'data/config.json',
    default: 'shipped default in server/config.js',
  };
  panel.append(el('div', { class: 'muted', style: { marginBottom: '10px' } }, [
    'Folder that holds ',
    el('code', {}, '<Entity>/<RunDate>/MasterReport.csv'),
    '. Currently loaded from: ',
    el('b', {}, sourceLabels[dataRoot.source] || dataRoot.source),
    '. Precedence: CLI arg → env var → config → default. Path is validated on save.',
  ]));

  // Read-only "effective" line
  panel.append(el('div', { class: 'toolbar' }, [
    el('label', {}, 'Effective path:'),
    el('code', { style: { padding: '6px 10px', background: 'var(--panel-2)', borderRadius: '6px' } }, dataRoot.path || '(empty)'),
  ]));

  // Editable "config value" line — only useful if not overridden by CLI/env
  const overridden = dataRoot.source === 'cli' || dataRoot.source === 'env';
  const dataRootInput = el('input', {
    type: 'text',
    value: (working.paths && working.paths.dataRoot) || '',
    style: { minWidth: '520px' },
    placeholder: defaults.paths.dataRoot ? `default: ${defaults.paths.dataRoot}` : '(leave empty to use shipped default)',
    ...(overridden ? { disabled: 'true' } : {}),
  });
  dataRootInput.addEventListener('change', () => {
    if (!working.paths) working.paths = {};
    working.paths.dataRoot = dataRootInput.value;
  });

  panel.append(el('div', { class: 'toolbar' }, [
    el('label', {}, 'Config value:'),
    dataRootInput,
    overridden
      ? el('span', { class: 'muted', style: { fontSize: '12px' } },
          `Field disabled — this session is using the ${dataRoot.source.toUpperCase()} override. Remove it and restart to edit from here.`)
      : el('span', { class: 'muted', style: { fontSize: '12px' } },
          'Leave blank to fall back to the shipped default.'),
  ]));

  return panel;
}

// -------- Scoring map -------------------------------------------------------
function renderScoringMap(working, defaults) {
  const panel = el('div', { class: 'panel', style: { marginTop: '14px' } });
  panel.append(el('h3', {}, 'Base scoring — resiliencyconfig → tier + score'));
  panel.append(el('div', { class: 'muted', style: { marginBottom: '10px' } },
    'Each row: the exact resiliencyconfig value from the RelAZ_Assess script → its tier, 0-100 score, and human label. Leave score blank for N/A. Blank key = "unclassified" fallback.'));

  const map = working.scoring.configMap;
  const table = el('table');
  table.innerHTML = `
    <thead><tr>
      <th style="width:24%;">resiliencyconfig</th>
      <th style="width:12%;">Tier</th>
      <th style="width:12%;">Score</th>
      <th>Label</th>
      <th style="width:8%;">Action</th>
    </tr></thead>`;
  const tbody = el('tbody');

  function addRow(key, entry) {
    const tr = el('tr');
    const keyInput = el('input', { type: 'text', value: key });
    const tierSel  = el('select', {}, ['HIGH', 'MEDIUM', 'LOW', 'NA'].map(t =>
      el('option', { value: t, ...(t === entry.tier ? { selected: 'true' } : {}) }, t)));
    const scoreInput = el('input', { type: 'number', value: entry.score == null ? '' : entry.score, placeholder: 'N/A' });
    const labelInput = el('input', { type: 'text', value: entry.label || '' });
    const rmBtn = el('button', { class: 'icon-btn' }, '✕');

    keyInput.addEventListener('change',   () => { delete map[key]; key = keyInput.value; map[key] = readRow(); });
    tierSel.addEventListener('change',    () => { map[keyInput.value] = readRow(); });
    scoreInput.addEventListener('change', () => { map[keyInput.value] = readRow(); });
    labelInput.addEventListener('change', () => { map[keyInput.value] = readRow(); });
    rmBtn.addEventListener('click', () => { delete map[keyInput.value]; tr.remove(); });

    function readRow() {
      const s = scoreInput.value.trim();
      return {
        tier: tierSel.value,
        score: s === '' ? null : Number(s),
        label: labelInput.value,
      };
    }

    tr.append(
      el('td', {}, [keyInput]),
      el('td', {}, [tierSel]),
      el('td', {}, [scoreInput]),
      el('td', {}, [labelInput]),
      el('td', {}, [rmBtn]),
    );
    tbody.append(tr);
  }
  for (const [k, v] of Object.entries(map)) addRow(k, v);
  table.append(tbody);
  panel.append(el('div', { class: 'table-wrap', style: { maxHeight: 'none' } }, table));

  const addBtn = el('button', { class: 'btn ghost', style: { marginTop: '8px' } }, '+ Add row');
  addBtn.addEventListener('click', () => {
    const newKey = 'NewValue_' + Date.now().toString(36).slice(-4);
    map[newKey] = { tier: 'NA', score: null, label: '' };
    addRow(newKey, map[newKey]);
  });
  panel.append(addBtn);
  return panel;
}

// -------- Cluster-aware Zonal -----------------------------------------------
function renderClusterAware(working, defaults) {
  const panel = el('div', { class: 'panel', style: { marginTop: '14px' } });
  panel.append(el('h3', {}, 'Cluster-aware Zonal VMs'));
  panel.append(el('div', { class: 'muted', style: { marginBottom: '10px' } },
    'Overrides applied to a Zonal VM based on the AZ spread of the VM group it belongs to. STANDALONE means the VM has no peers.'));

  const rules = working.clusterAware;
  const table = el('table');
  table.innerHTML = `
    <thead><tr>
      <th style="width:18%;">Status</th>
      <th style="width:15%;">Tier</th>
      <th style="width:15%;">Score</th>
      <th>Label suffix</th>
    </tr></thead>`;
  const tbody = el('tbody');
  for (const status of ['GOOD', 'PARTIAL', 'BAD', 'MISSING', 'STANDALONE']) {
    const entry = rules[status] || defaults.clusterAware[status];
    const tierSel = el('select', {}, ['HIGH', 'MEDIUM', 'LOW', 'NA'].map(t =>
      el('option', { value: t, ...(t === entry.tier ? { selected: 'true' } : {}) }, t)));
    const scoreInput = el('input', { type: 'number', value: entry.score });
    const suffixInput = el('input', { type: 'text', value: entry.suffix });
    tierSel.addEventListener('change',    () => { rules[status] = readRow(); });
    scoreInput.addEventListener('change', () => { rules[status] = readRow(); });
    suffixInput.addEventListener('change',() => { rules[status] = readRow(); });
    function readRow() {
      return {
        tier: tierSel.value,
        score: scoreInput.value === '' ? null : Number(scoreInput.value),
        suffix: suffixInput.value,
      };
    }
    tbody.append(el('tr', {}, [
      el('td', {}, [el('b', {}, status)]),
      el('td', {}, [tierSel]),
      el('td', {}, [scoreInput]),
      el('td', {}, [suffixInput]),
    ]));
  }
  table.append(tbody);
  panel.append(el('div', { class: 'table-wrap', style: { maxHeight: 'none' } }, table));
  return panel;
}

// -------- Public IP override ------------------------------------------------
function renderPublicIp(working, defaults) {
  const panel = el('div', { class: 'panel', style: { marginTop: '14px' } });
  panel.append(el('h3', {}, 'Public IP override'));
  panel.append(el('div', { class: 'muted', style: { marginBottom: '10px' } },
    'Public IPs are zone-redundant by default at the Azure platform layer; the script often mis-classifies them. When enabled, every publicIPAddresses row is force-set to the tier/score below.'));

  const pip = working.publicIpOverride;
  const enabledCb = el('input', { type: 'checkbox', ...(pip.enabled ? { checked: 'true' } : {}) });
  const tierSel = el('select', {}, ['HIGH', 'MEDIUM', 'LOW', 'NA'].map(t =>
    el('option', { value: t, ...(t === pip.tier ? { selected: 'true' } : {}) }, t)));
  const scoreInput = el('input', { type: 'number', value: pip.score });
  const labelInput = el('input', { type: 'text', value: pip.label, style: { minWidth: '360px' } });

  enabledCb.addEventListener('change',   () => pip.enabled = enabledCb.checked);
  tierSel.addEventListener('change',     () => pip.tier = tierSel.value);
  scoreInput.addEventListener('change',  () => pip.score = Number(scoreInput.value));
  labelInput.addEventListener('change',  () => pip.label = labelInput.value);

  panel.append(el('div', { class: 'toolbar', style: { flexWrap: 'wrap' } }, [
    el('label', {}, [enabledCb, ' Enable override']),
    el('label', {}, 'Tier:'), tierSel,
    el('label', {}, 'Score:'), scoreInput,
    el('label', {}, 'Label:'), labelInput,
  ]));
  return panel;
}

// -------- Disk alignment ----------------------------------------------------
function renderDiskAlignment(working, defaults) {
  const panel = el('div', { class: 'panel', style: { marginTop: '14px' } });
  panel.append(el('h3', {}, 'Disk alignment with Zonal VM'));
  panel.append(el('div', { class: 'muted', style: { marginBottom: '10px' } },
    'When enabled, an LRS disk attached to a Zonal VM is moved to N/A tier (excluded from the score). Rationale: requiring ZRS on a Zonal-VM disk adds cost with no real resilience gain.'));

  const da = working.diskAlignment;
  const enabledCb = el('input', { type: 'checkbox', ...(da.enabled ? { checked: 'true' } : {}) });
  const suffixInput = el('input', { type: 'text', value: da.labelSuffix, style: { minWidth: '360px' } });
  enabledCb.addEventListener('change',  () => da.enabled = enabledCb.checked);
  suffixInput.addEventListener('change',() => da.labelSuffix = suffixInput.value);

  panel.append(el('div', { class: 'toolbar' }, [
    el('label', {}, [enabledCb, ' Enable alignment override']),
    el('label', {}, 'Config-label suffix:'), suffixInput,
  ]));
  return panel;
}

// -------- Prod classifier ---------------------------------------------------
function renderProdClassifier(working, defaults) {
  const panel = el('div', { class: 'panel', style: { marginTop: '14px' } });
  panel.append(el('h3', {}, 'Production classifier'));
  panel.append(el('div', { class: 'muted', style: { marginBottom: '10px' } },
    'Regex patterns applied case-insensitively. First matching source wins. Invalid regex is rejected on save.'));

  const pc = working.prodClassifier;
  const sourcesInput = el('input', { type: 'text', value: (pc.sources || []).join(','), style: { minWidth: '360px' } });
  const prodInput = el('input', { type: 'text', value: pc.prodPattern, style: { minWidth: '520px' } });
  const nonprodInput = el('input', { type: 'text', value: pc.nonProdPattern, style: { minWidth: '520px' } });

  sourcesInput.addEventListener('change', () => pc.sources = sourcesInput.value.split(',').map(s => s.trim()).filter(Boolean));
  prodInput.addEventListener('change',    () => pc.prodPattern = prodInput.value);
  nonprodInput.addEventListener('change', () => pc.nonProdPattern = nonprodInput.value);

  panel.append(
    el('div', { class: 'toolbar' }, [el('label', {}, 'Sources (comma-separated field names):'), sourcesInput]),
    el('div', { class: 'toolbar' }, [el('label', {}, 'Non-prod regex:'), nonprodInput]),
    el('div', { class: 'toolbar' }, [el('label', {}, 'Prod regex:'), prodInput]),
    el('div', { class: 'muted', style: { fontSize: '12px' } },
      'Ordering matters: non-prod is checked first so "preprod" doesn\'t incorrectly match "prod".'),
  );
  return panel;
}

// -------- Cluster detection -------------------------------------------------
function renderClusterDetection(working, defaults) {
  const panel = el('div', { class: 'panel', style: { marginTop: '14px' } });
  panel.append(el('h3', {}, 'VM Group detection'));
  panel.append(el('div', { class: 'muted', style: { marginBottom: '10px' } },
    'Minimum number of VMs sharing a role stem for a VM Group to be formed. Default is 2 (a pair is enough).'));

  const cd = working.clusterDetection;
  const minInput = el('input', { type: 'number', value: cd.minMembers, min: 2 });
  minInput.addEventListener('change', () => cd.minMembers = Math.max(2, Number(minInput.value) || 2));
  panel.append(el('div', { class: 'toolbar' }, [
    el('label', {}, 'Minimum members per group:'), minInput,
  ]));
  return panel;
}

export default { render };
