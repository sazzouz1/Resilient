// Entity Excel export — builds a 4-tab .xlsx workbook.
//
//   Tab 1 "Overview"     — KPI header, tier distribution table, config mix table,
//                          PLUS three embedded PNG charts rendered off-screen via Chart.js
//   Tab 2 "Attention"    — LOW + MEDIUM tier resources with score & justification
//   Tab 3 "VM Groups"    — VM role groups grouped by verdict, each with its members
//   Tab 4 "Methodology"  — how scores are computed and what actions to take
//
// Uses ExcelJS (from CDN) for real formatting, freeze panes, image embedding.
// Charts are Chart.js PNGs generated in a hidden <canvas> then embedded.

import { api } from './api.js';
import { TIER_COLORS, el, multiSelect } from './ui.js';

const TIER_ORDER = ['HIGH', 'MEDIUM', 'LOW', 'NA'];
const GROUP_TIER = { GOOD: 'HIGH', PARTIAL: 'MEDIUM', BAD: 'LOW', MISSING: 'LOW', STANDALONE: 'NA' };

function needsExcelJs() {
  if (typeof ExcelJS === 'undefined') throw new Error('ExcelJS not loaded yet — please wait a moment and retry.');
}

// -------- Chart rendering to PNG ---------------------------------------------
// Draws a Chart.js chart on an off-screen canvas and returns a PNG base64 URL.
async function renderChartPng({ type, data, options = {}, width = 900, height = 480 }) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  // Chart.js needs the canvas to be in-DOM in some browsers; place hidden.
  canvas.style.position = 'fixed';
  canvas.style.left = '-10000px';
  canvas.style.top = '-10000px';
  document.body.appendChild(canvas);

  const mergedOptions = {
    responsive: false,
    animation: false,
    devicePixelRatio: 2,
    plugins: {
      legend: { labels: { color: '#222', font: { size: 13 } } },
      title: options.plugins?.title || { display: false },
    },
    scales: options.scales || {
      x: { ticks: { color: '#222' } },
      y: { ticks: { color: '#222' } },
    },
    ...options,
  };
  const chart = new Chart(canvas, { type, data, options: mergedOptions });
  // Give the browser a paint tick so the chart is fully drawn
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const dataUrl = canvas.toDataURL('image/png');
  chart.destroy();
  canvas.remove();
  return dataUrl;
}

// -------- Cell helpers -------------------------------------------------------
function h1(cell, text) {
  cell.value = text;
  cell.font = { bold: true, size: 16, color: { argb: 'FF1F3864' } };
}
function h2(cell, text) {
  cell.value = text;
  cell.font = { bold: true, size: 12, color: { argb: 'FF1F3864' } };
}
function headerRow(row) {
  row.eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
    c.alignment = { vertical: 'middle', horizontal: 'left' };
  });
}
function tierFill(argb) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}
const TIER_FILLS = {
  HIGH:   'FFDFF5E7',
  MEDIUM: 'FFFFF3D6',
  LOW:    'FFFDE2E4',
  NA:     'FFE6EAF2',
};
const TIER_TEXT = {
  HIGH:   'FF1E7F52',
  MEDIUM: 'FF8A6D1E',
  LOW:    'FFB01F2B',
  NA:     'FF4C5A78',
};

// -------- Main exporter ------------------------------------------------------
async function exportEntity(entityId, displayName, runDate = null, options = {}) {
  needsExcelJs();

  const tabs = {
    overview: true, attention: true, vmGroups: true, progress: true, methodology: true,
    ...(options.tabs || {}),
  };
  const wantTiers = (options.tiers && options.tiers.length) ? options.tiers : ['LOW', 'MEDIUM'];

  // Subscription scope may be a single string or an array of subscriptions.
  const subsArr = Array.isArray(options.subscription)
    ? options.subscription
    : (options.subscription ? [options.subscription] : []);
  const subLabel = subsArr.length
    ? (subsArr.length <= 2 ? subsArr.join(', ') : `${subsArr.length} subscriptions`)
    : '';

  const q = { entity: entityId };
  if (runDate) q.runDate = runDate;
  if (subsArr.length) q.subscription = subsArr.join(',');

  const [summary, resources, clusters, byType, byLoc, byConfig, byRg, progress] = await Promise.all([
    api.summary(q),
    api.resources({ ...q, pageSize: 100000 }),
    api.vmGroups(q),
    api.breakdown({ ...q, groupBy: 'resourcesubtype' }),
    api.breakdown({ ...q, groupBy: 'location' }),
    api.breakdown({ ...q, groupBy: '__configLabel' }),
    api.breakdown({ ...q, groupBy: 'resourcegroup' }),
    // Progress ignores runDate — it needs the full timeline
    api.progress({ entity: entityId }),
  ]);
  const currentRunDate = runDate
    || (resources.rows[0]?.runDate)
    || (progress.series[progress.series.length - 1]?.runDate)
    || null;

  // ---- Render the three charts to PNGs in parallel (only when Overview kept) -
  const [tierChartPng, typeChartPng, configChartPng] = tabs.overview ? await Promise.all([
    // 1) Doughnut of tier distribution
    renderChartPng({
      type: 'doughnut',
      data: {
        labels: TIER_ORDER,
        datasets: [{
          data: TIER_ORDER.map(t => summary.tierCounts[t] || 0),
          backgroundColor: TIER_ORDER.map(t => TIER_COLORS[t]),
          borderColor: '#ffffff',
          borderWidth: 2,
        }],
      },
      options: {
        cutout: '55%',
        plugins: {
          title: { display: true, text: 'Resiliency tier distribution', font: { size: 16 } },
          legend: { position: 'right', labels: { color: '#222', font: { size: 13 } } },
        },
        scales: {},
      },
      width: 900, height: 480,
    }),
    // 2) Stacked bar of top resource types
    renderChartPng({
      type: 'bar',
      data: {
        labels: byType.slice(0, 12).map(t => t.name.replace(/^Microsoft\./, '')),
        datasets: [
          { label: 'High',   data: byType.slice(0, 12).map(t => t.tierCounts.HIGH),   backgroundColor: TIER_COLORS.HIGH,   stack: 's' },
          { label: 'Medium', data: byType.slice(0, 12).map(t => t.tierCounts.MEDIUM), backgroundColor: TIER_COLORS.MEDIUM, stack: 's' },
          { label: 'Low',    data: byType.slice(0, 12).map(t => t.tierCounts.LOW),    backgroundColor: TIER_COLORS.LOW,    stack: 's' },
          { label: 'N/A',    data: byType.slice(0, 12).map(t => t.tierCounts.NA),     backgroundColor: TIER_COLORS.NA,     stack: 's' },
        ],
      },
      options: {
        indexAxis: 'y',
        scales: {
          x: { stacked: true, ticks: { color: '#222' } },
          y: { stacked: true, ticks: { color: '#222' } },
        },
        plugins: {
          title: { display: true, text: 'Top resource types by resiliency mix', font: { size: 16 } },
          legend: { labels: { color: '#222', font: { size: 12 } } },
        },
      },
      width: 1100, height: 600,
    }),
    // 3) Config mix bar
    renderChartPng({
      type: 'bar',
      data: {
        labels: byConfig.map(c => c.name),
        datasets: [{
          label: 'Resources',
          data: byConfig.map(c => c.count),
          backgroundColor: '#4F81BD',
        }],
      },
      options: {
        indexAxis: 'y',
        scales: {
          x: { ticks: { color: '#222' } },
          y: { ticks: { color: '#222', font: { size: 11 } } },
        },
        plugins: {
          title: { display: true, text: 'Resiliency configuration mix', font: { size: 16 } },
          legend: { display: false },
        },
      },
      width: 1100, height: Math.max(400, byConfig.length * 40),
    }),
  ]) : [null, null, null];

  // ---- Build the workbook ---------------------------------------------------
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Resiliency Checker';
  wb.created = new Date();

  // ============ Tab 1: Overview ============
  if (tabs.overview) {
  const ov = wb.addWorksheet('Overview', { views: [{ showGridLines: false }] });
  ov.columns = [
    { width: 42 }, { width: 18 }, { width: 14 }, { width: 12 }, { width: 12 }, { width: 12 },
    { width: 4 },  // spacer column before charts
    { width: 20 }, { width: 20 }, { width: 20 }, { width: 20 }, { width: 20 }, { width: 20 },
  ];

  h1(ov.getCell('A1'), `Resiliency Assessment — ${displayName}` + (currentRunDate ? ` — ${currentRunDate}` : ''));
  ov.getCell('A2').value = `Generated: ${new Date().toLocaleString()}`;
  ov.getCell('A2').font = { italic: true, color: { argb: 'FF666666' } };
  ov.getCell('A3').value = 'Source: MasterReport.csv (RelAZ_Assess script)';
  ov.getCell('A3').font = { italic: true, color: { argb: 'FF666666' } };

  h2(ov.getCell('A5'), 'Headline metrics');
  const kpi = [
    ['Total resources',        summary.total],
    ['In-scope resources',     summary.inScope],
    ['Resiliency score (0-100)', summary.resiliencyScore ?? '—'],
    ['High resiliency %',      summary.highPct + '%'],
    ['Medium resiliency %',    summary.mediumPct + '%'],
    ['Low resiliency %',       summary.lowPct + '%'],
    ['Not applicable (excluded)', summary.tierCounts.NA],
  ];
  kpi.forEach((r, i) => {
    ov.getCell(`A${6 + i}`).value = r[0];
    ov.getCell(`B${6 + i}`).value = r[1];
    ov.getCell(`A${6 + i}`).font = { bold: true };
  });

  // Tier distribution table (this is what feeds the doughnut chart image)
  const tierStart = 14;
  h2(ov.getCell(`A${tierStart}`), 'Tier distribution');
  ov.getRow(tierStart + 1).values = ['Tier', 'Count', 'Percent of in-scope'];
  headerRow(ov.getRow(tierStart + 1));
  TIER_ORDER.forEach((t, i) => {
    const row = ov.getRow(tierStart + 2 + i);
    row.values = [
      t,
      summary.tierCounts[t] || 0,
      t === 'NA' ? '—'
        : summary.inScope
          ? Math.round(((summary.tierCounts[t] || 0) / summary.inScope) * 100) + '%'
          : '0%',
    ];
    row.getCell(1).fill = tierFill(TIER_FILLS[t]);
    row.getCell(1).font = { bold: true, color: { argb: TIER_TEXT[t] } };
  });

  // Config mix table
  const cfgStart = tierStart + 8;
  h2(ov.getCell(`A${cfgStart}`), 'Resiliency configuration mix');
  ov.getRow(cfgStart + 1).values = ['Configuration', 'Resource count'];
  headerRow(ov.getRow(cfgStart + 1));
  byConfig.forEach((c, i) => {
    ov.getRow(cfgStart + 2 + i).values = [c.name, c.count];
  });

  // Top RGs (risk-first)
  const rgStart = cfgStart + byConfig.length + 4;
  h2(ov.getCell(`A${rgStart}`), 'Top resource groups (risk-first)');
  ov.getRow(rgStart + 1).values = ['Resource Group', 'Resources', 'Score', 'Low %'];
  headerRow(ov.getRow(rgStart + 1));
  byRg.slice(0, 25).forEach((g, i) => {
    ov.getRow(rgStart + 2 + i).values = [
      g.name || '(blank)', g.count, g.resiliencyScore ?? '—', g.lowPct + '%',
    ];
  });

  // Embed the charts on the right-hand side of the sheet.
  // Anchor with { tl, ext } (pixel-width) — the most reliable ExcelJS pattern.
  // We also drop invisible marker cells into the chart columns so the sheet's
  // used range includes them, which prevents Excel from flagging drawings as
  // anchored outside the sheet content.
  ov.getCell('H1').value = ''; ov.getCell('N60').value = '';

  const tierImgId = wb.addImage({ base64: tierChartPng, extension: 'png' });
  ov.addImage(tierImgId, {
    tl: { col: 7, row: 1 },
    ext: { width: 480, height: 260 },
  });
  const typeImgId = wb.addImage({ base64: typeChartPng, extension: 'png' });
  ov.addImage(typeImgId, {
    tl: { col: 7, row: 16 },
    ext: { width: 580, height: 320 },
  });
  const configImgId = wb.addImage({ base64: configChartPng, extension: 'png' });
  ov.addImage(configImgId, {
    tl: { col: 7, row: 34 },
    ext: { width: 580, height: Math.max(240, Math.min(560, byConfig.length * 22)) },
  });

  // Note: no explicit frozen view — Excel treats { ySplit: 0, xSplit: 0 } as
  // corrupted and issues a repair on open. The showGridLines toggle stays via
  // the constructor.
  } // end Overview tab

  // ============ Tab 2: Attention ============
  if (tabs.attention) {
  const att = wb.addWorksheet('Attention', { views: [{ state: 'frozen', ySplit: 4 }] });
  const attentionRows = resources.rows
    .filter(r => wantTiers.includes(r.tier))
    .sort((a, b) => (a.score ?? 999) - (b.score ?? 999));

  const tierBreakdown = ['HIGH', 'MEDIUM', 'LOW', 'NA']
    .filter(t => wantTiers.includes(t))
    .map(t => `${t}: ${attentionRows.filter(r => r.tier === t).length}`)
    .join(', ');

  att.columns = [
    { width: 28 }, { width: 22 }, { width: 30 }, { width: 12 }, { width: 10 }, { width: 20 },
    { width: 20 }, { width: 32 }, { width: 8 },  { width: 8 },  { width: 40 }, { width: 14 },
    { width: 22 }, { width: 14 }, { width: 20 }, { width: 14 }, { width: 24 }, { width: 60 },
  ];
  h1(att.getCell('A1'), `Resources Requiring Attention — ${displayName}`);
  att.getCell('A2').value = `${attentionRows.length} rows — ${tierBreakdown}`
    + (subLabel ? `  ·  Subscription: ${subLabel}` : '');
  att.getCell('A2').font = { italic: true, color: { argb: 'FF666666' } };

  const attHeader = [
    'Name', 'Type', 'Resource Group', 'Location', 'Zones', 'SKU',
    'resiliencyconfig', 'resiliencydetail', 'Score', 'Tier', 'Justification',
    'VM Group Status', 'VM Group Role', 'VM Group Zones',
    'Application', 'Environment', 'Subscription', 'Resource ID',
  ];
  const headerRowRef = att.getRow(4);
  headerRowRef.values = attHeader;
  headerRow(headerRowRef);

  attentionRows.forEach((r, i) => {
    const row = att.getRow(5 + i);
    row.values = [
      r.name || '',
      (r.resourceType || '').replace(/^Microsoft\./, ''),
      r.resourceGroup || '',
      r.location || '',
      r.zones || '',
      r.sku || '',
      r.resiliencyConfig || '',
      r.resiliencyDetail || '',
      r.score ?? '',
      r.tier || '',
      r.configLabel || '',
      r.clusterStatus || '',
      r.clusterStem || '',
      r.clusterZonesCovered || '',
      r.application || '',
      r.environment || '',
      r.subscription || '',
      r.resourceId || '',
    ];
    // Color the Tier cell
    const tierCell = row.getCell(10);
    tierCell.fill = tierFill(TIER_FILLS[r.tier] || TIER_FILLS.NA);
    tierCell.font = { bold: true, color: { argb: TIER_TEXT[r.tier] || TIER_TEXT.NA } };
    tierCell.alignment = { horizontal: 'center' };
    // Cluster cell coloring
    if (r.clusterStatus) {
      const cc = row.getCell(12);
      const t = GROUP_TIER[r.clusterStatus] || 'NA';
      cc.fill = tierFill(TIER_FILLS[t]);
      cc.font = { color: { argb: TIER_TEXT[t] } };
    }
  });
  att.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + attentionRows.length, column: attHeader.length } };
  } // end Attention tab

  // ============ Tab 3: VM Groups ============
  if (tabs.vmGroups) {
  const cl = wb.addWorksheet('VM Groups', { views: [{ state: 'frozen', ySplit: 4 }] });
  cl.columns = [
    { width: 10 }, { width: 34 }, { width: 26 }, { width: 34 }, { width: 8 },
    { width: 14 }, { width: 28 }, { width: 30 }, { width: 8 }, { width: 20 }, { width: 22 }, { width: 32 },
  ];
  h1(cl.getCell('A1'), `VM Groups — ${displayName}`);
  cl.getCell('A2').value = `${clusters.stats.total} groups — GOOD ${clusters.stats.GOOD} · PARTIAL ${clusters.stats.PARTIAL} · BAD ${clusters.stats.BAD} · MISSING ${clusters.stats.MISSING}`;
  cl.getCell('A2').font = { italic: true, color: { argb: 'FF666666' } };
  cl.getCell('A3').value = 'Note: "VM Group" = VMs that share a role stem (e.g. vm-app01/02/03). Not related to Azure clusters (AKS, HDInsight, VMSS).';
  cl.getCell('A3').font = { italic: true, color: { argb: 'FF666666' }, size: 10 };
  const clHeader = ['Status', 'Verdict', 'Group Stem (role)', 'Resource Group', 'Member Count',
    'Zones Covered', 'Member Name', 'Subscription', 'Zone(s)', 'SKU', 'resiliencyconfig', 'resiliencydetail'];
  const clHeaderRow = cl.getRow(4);
  clHeaderRow.values = clHeader;
  headerRow(clHeaderRow);

  let rowIdx = 5;
  for (const c of clusters.clusters) {
    const groupTier = GROUP_TIER[c.status] || 'NA';
    for (const [i, m] of c.members.entries()) {
      const row = cl.getRow(rowIdx++);
      row.values = [
        i === 0 ? c.status : '',
        i === 0 ? c.statusLabel : '',
        i === 0 ? c.stem : '',
        i === 0 ? c.resourceGroup : '',
        i === 0 ? c.memberCount : '',
        i === 0 ? (c.zonesCovered.join(', ') || '—') : '',
        m.name || '',
        m.subscription || '',
        m.zones || '',
        m.sku || '',
        m.resiliencyconfig || '',
        m.resiliencydetail || '',
      ];
      if (i === 0) {
        row.getCell(1).fill = tierFill(TIER_FILLS[groupTier]);
        row.getCell(1).font = { bold: true, color: { argb: TIER_TEXT[groupTier] } };
        row.getCell(1).alignment = { horizontal: 'center' };
      }
    }
  }
  } // end VM Groups tab

  // ============ Tab 4 (optional): Progress ============
  if (tabs.progress && progress.series && progress.series.length >= 2) {
    await buildProgressSheet(wb, displayName, progress);
  }

  // ============ Tab 5: Methodology & Actions ============
  if (tabs.methodology) buildMethodologySheet(wb, displayName);

  // Excel requires at least one worksheet — guard against an all-unchecked export.
  if (wb.worksheets.length === 0) {
    const s = wb.addWorksheet('Export');
    s.getCell('A1').value = `No sheets were selected for ${displayName}.`;
  }

  // ---- Save ---------------------------------------------------------------
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const dateSlug = currentRunDate || new Date().toISOString().slice(0, 10);
  const filename = `resiliency-${displayName.replace(/[^\w-]+/g, '_')}-${dateSlug}.xlsx`;
  if (typeof saveAs === 'function') {
    saveAs(blob, filename);
  } else {
    // Fallback if FileSaver isn't loaded
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export { exportEntity, promptExportOptions };

// -------- Pre-export options dialog -----------------------------------------
// Lets the user pick which sheets to include, which tiers land on the Attention
// sheet, and which subscription scope to export. Resolves to an options object
// { tabs, tiers, subscription } or null if cancelled.
function promptExportOptions({ subscriptions = [], currentSubscriptions = [], currentTiers = ['LOW', 'MEDIUM'] } = {}) {
  return new Promise(resolve => {
    const overlay = el('div', { class: 'modal-overlay' });
    const box = el('div', { class: 'modal' });
    box.append(el('h3', {}, 'Export to Excel — options'));
    box.append(el('p', { class: 'muted' }, 'Choose what to include. The workbook reflects the current page filters (subscription, run, production-only).'));

    const rowStyle = { display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 'normal', margin: '2px 0' };
    const groupStyle = { display: 'flex', flexWrap: 'wrap', gap: '4px 18px', margin: '4px 0 12px' };
    const mkCheck = (label, checked) => {
      const input = el('input', { type: 'checkbox' });
      input.checked = !!checked;
      const wrap = el('label', { style: rowStyle }, [input, el('span', {}, label)]);
      return { wrap, input };
    };

    // Sheets to include
    box.append(el('div', { class: 'modal-label' }, 'Sheets to include'));
    const cOverview  = mkCheck('Overview (KPIs + charts)', true);
    const cAttention = mkCheck('Attention (resources needing action)', true);
    const cVm        = mkCheck('VM Groups', true);
    const cProgress  = mkCheck('Progress (if multiple runs)', true);
    const cMethod    = mkCheck('Methodology', true);
    box.append(el('div', { style: groupStyle }, [cOverview.wrap, cAttention.wrap, cVm.wrap, cProgress.wrap, cMethod.wrap]));

    // Attention tiers
    box.append(el('div', { class: 'modal-label' }, 'Attention sheet — tiers'));
    const tHigh = mkCheck('HIGH', currentTiers.includes('HIGH'));
    const tMed  = mkCheck('MEDIUM', currentTiers.includes('MEDIUM'));
    const tLow  = mkCheck('LOW', currentTiers.includes('LOW'));
    const tNa   = mkCheck('N/A', currentTiers.includes('NA'));
    box.append(el('div', { style: groupStyle }, [tHigh.wrap, tMed.wrap, tLow.wrap, tNa.wrap]));

    // Subscription scope — multi-select (empty = all subscriptions)
    box.append(el('div', { class: 'modal-label' }, 'Subscription scope'));
    const subMs = multiSelect({
      options: subscriptions.map(s => ({ value: s.name, label: `${s.name} (${(s.count ?? 0).toLocaleString()})` })),
      selected: currentSubscriptions,
      allLabel: 'All subscriptions',
      noun: 'subscriptions',
    });
    box.append(subMs.el);

    const err = el('div', { class: 'modal-err' });
    const cancelBtn = el('button', { class: 'btn ghost' }, 'Cancel');
    const okBtn = el('button', { class: 'btn' }, 'Export');
    box.append(err, el('div', { class: 'modal-actions' }, [cancelBtn, okBtn]));
    overlay.append(box);
    document.body.append(overlay);

    function close(v) { overlay.remove(); resolve(v); }
    cancelBtn.addEventListener('click', () => close(null));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    okBtn.addEventListener('click', () => {
      const tabs = {
        overview: cOverview.input.checked,
        attention: cAttention.input.checked,
        vmGroups: cVm.input.checked,
        progress: cProgress.input.checked,
        methodology: cMethod.input.checked,
      };
      if (!Object.values(tabs).some(Boolean)) { err.textContent = 'Select at least one sheet.'; return; }
      const tiers = [
        tHigh.input.checked && 'HIGH',
        tMed.input.checked && 'MEDIUM',
        tLow.input.checked && 'LOW',
        tNa.input.checked && 'NA',
      ].filter(Boolean);
      if (tabs.attention && !tiers.length) { err.textContent = 'Pick at least one tier for the Attention sheet.'; return; }
      close({ tabs, tiers, subscription: subMs.getValues() });
    });
  });
}

// -------- Progress tab -----------------------------------------------------
async function buildProgressSheet(wb, displayName, progress) {
  const s = wb.addWorksheet('Progress', { views: [{ showGridLines: false }] });
  s.columns = [
    { width: 14 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 },
    { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 },
  ];
  const h1cell = s.getCell('A1');
  h1cell.value = `Progress — ${displayName}`;
  h1cell.font = { bold: true, size: 16, color: { argb: 'FF1F3864' } };

  s.getCell('A2').value = `${progress.series.length} runs · ${progress.series[0].runDate} → ${progress.series.at(-1).runDate}`;
  s.getCell('A2').font = { italic: true, color: { argb: 'FF666666' } };
  if (progress.diff) {
    s.getCell('A3').value = `Score change: ${progress.diff.scoreDelta >= 0 ? '+' : ''}${progress.diff.scoreDelta}  ·  HIGH ${progress.diff.highDelta >= 0 ? '+' : ''}${progress.diff.highDelta}  ·  LOW ${progress.diff.lowDelta >= 0 ? '+' : ''}${progress.diff.lowDelta}`;
    s.getCell('A3').font = { italic: true, color: { argb: 'FF666666' } };
  }

  // Series table
  const startRow = 5;
  const hdr = s.getRow(startRow);
  hdr.values = ['Run date', 'Resources', 'Score', 'High %', 'Med %', 'Low %', 'High', 'Med', 'Low', 'N/A'];
  hdr.eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
  });
  progress.series.forEach((p, i) => {
    const row = s.getRow(startRow + 1 + i);
    row.values = [
      p.runDate, p.total, p.resiliencyScore ?? '—',
      (p.highPct || 0) + '%', (p.mediumPct || 0) + '%', (p.lowPct || 0) + '%',
      p.tierCounts.HIGH, p.tierCounts.MEDIUM, p.tierCounts.LOW, p.tierCounts.NA,
    ];
  });

  // Charts — score line + tier stacked bar
  const points = progress.series;
  const scorePng = await renderChartPng({
    type: 'line',
    data: {
      labels: points.map(p => p.runDate),
      datasets: [{
        label: 'Score',
        data: points.map(p => p.resiliencyScore),
        borderColor: '#34c58a',
        backgroundColor: 'rgba(52,197,138,0.25)',
        fill: true, tension: 0.25, pointRadius: 6,
      }],
    },
    options: {
      plugins: { title: { display: true, text: 'Resiliency score over time', font: { size: 16 } } },
      scales: {
        x: { ticks: { color: '#222' } },
        y: { min: 0, max: 100, ticks: { color: '#222' } },
      },
    },
    width: 1000, height: 400,
  });

  const tierPng = await renderChartPng({
    type: 'bar',
    data: {
      labels: points.map(p => p.runDate),
      datasets: [
        { label: 'High',   data: points.map(p => p.tierCounts.HIGH),   backgroundColor: '#34c58a', stack: 's' },
        { label: 'Medium', data: points.map(p => p.tierCounts.MEDIUM), backgroundColor: '#f0b84a', stack: 's' },
        { label: 'Low',    data: points.map(p => p.tierCounts.LOW),    backgroundColor: '#ef5b6b', stack: 's' },
        { label: 'N/A',    data: points.map(p => p.tierCounts.NA),     backgroundColor: '#6c7794', stack: 's' },
      ],
    },
    options: {
      plugins: { title: { display: true, text: 'Tier distribution over time', font: { size: 16 } } },
      scales: {
        x: { stacked: true, ticks: { color: '#222' } },
        y: { stacked: true, ticks: { color: '#222' } },
      },
    },
    width: 1000, height: 400,
  });

  // Anchor after the series table (leave 2 rows of spacing)
  const chartStartRow = startRow + points.length + 3;
  s.getCell(`A${chartStartRow}`).value = ''; // used-range guard
  const scoreImgId = wb.addImage({ base64: scorePng, extension: 'png' });
  s.addImage(scoreImgId, {
    tl: { col: 0, row: chartStartRow },
    ext: { width: 580, height: 260 },
  });
  const tierImgId = wb.addImage({ base64: tierPng, extension: 'png' });
  s.addImage(tierImgId, {
    tl: { col: 6, row: chartStartRow },
    ext: { width: 580, height: 260 },
  });
}

// -------- Methodology tab ----------------------------------------------------
// Explains scoring rules and lists actions per attention item / VM group verdict.
function buildMethodologySheet(wb, displayName) {
  const s = wb.addWorksheet('Methodology', { views: [{ showGridLines: false }] });
  s.columns = [{ width: 28 }, { width: 22 }, { width: 12 }, { width: 78 }];

  let r = 1;
  const h = (row, text, size = 16) => {
    const c = s.getCell(`A${row}`);
    c.value = text;
    c.font = { bold: true, size, color: { argb: 'FF1F3864' } };
  };
  const bar = (row) => {
    // full-row light-gray separator
    for (const col of ['A', 'B', 'C', 'D']) s.getCell(`${col}${row}`).border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } };
  };
  const p = (row, text) => {
    const c = s.getCell(`A${row}`);
    c.value = text;
    c.alignment = { wrapText: true, vertical: 'top' };
    s.mergeCells(`A${row}:D${row}`);
    s.getRow(row).height = Math.max(20, Math.ceil(text.length / 100) * 18);
  };
  const table = (startRow, header, rows, widths) => {
    const hdr = s.getRow(startRow);
    hdr.values = header;
    hdr.eachCell(c => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
      c.alignment = { vertical: 'middle' };
    });
    rows.forEach((row, i) => {
      const rw = s.getRow(startRow + 1 + i);
      rw.values = row;
      rw.eachCell(c => { c.alignment = { wrapText: true, vertical: 'top' }; });
      rw.height = Math.max(18, Math.ceil(Math.max(...row.map(v => String(v ?? '').length)) / 60) * 16);
    });
    return startRow + 1 + rows.length;
  };

  h(r, `Methodology & Actions — ${displayName}`, 18); r += 2;

  // ---- Score & tier basics --------------------------------------------------
  h(r, 'How the resiliency score is computed', 14); r++;
  p(r, 'Each Azure resource in the MasterReport carries a "resiliencyconfig" value produced by the RelAZ_Assess script (Zone Redundant, Zonal, LocallyRedundant, etc.). We map each value to a TIER (HIGH / MEDIUM / LOW / N/A) and a 0-100 SCORE, then average the score across every in-scope resource.'); r += 2;
  p(r, 'N/A tier resources (platform-default configs, disks attached to Zonal VMs, etc.) are excluded from the score denominator so they don\'t skew results in either direction.'); r += 2;

  h(r, 'Base tier / score table', 12); r++;
  r = table(r, ['resiliencyconfig', 'Tier', 'Score', 'Meaning'], [
    ['ZoneRedundant / ZoneRedundant_StanbyHA', 'HIGH', 100, 'Deployed across all 3 Availability Zones — best possible.'],
    ['SameZoneHA', 'HIGH', 90, 'HA within a single zone (e.g. availability set).'],
    ['GeoRedundant / GeoRedundantbyDefault', 'HIGH', 85, 'Cross-region replication (RA-GRS, GRS).'],
    ['Zonal (see cluster-aware rule below)', 'HIGH / MEDIUM / LOW', '95 / 70 / 55 / 30', 'Adjusted by VM-group AZ spread.'],
    ['PartiallyAzRedundant', 'MEDIUM', 55, 'Some AZ awareness, incomplete.'],
    ['LocallyRedundant', 'LOW', 20, '3 copies in one datacenter — no zone or geo resilience.'],
    ['NonZonal', 'LOW', 25, 'Regional resource without any zone tag.'],
    ['RedundantbyDefault / NotApply / NoInfo / blank', 'N/A', '—', 'Excluded from the score denominator.'],
  ]);
  r += 1; bar(r); r += 1;

  // ---- Overrides ------------------------------------------------------------
  h(r, 'Special-case adjustments', 14); r++;

  h(r, '1. Public IP override (all PIPs = HIGH)', 12); r++;
  p(r, 'Standard-SKU Public IPs are zone-redundant by default at the Azure platform layer, but the script often labels them "NonZonal" simply because they don\'t carry an explicit zones property. To reflect the platform reality every Microsoft.Network/publicIPAddresses row is scored HIGH / 85 with justification "Public IP — zone-redundant by default (override)". The raw resiliencyconfig is preserved on the row for auditability.'); r += 2;

  h(r, '2. Cluster-aware Zonal VMs (the "1000 Zonal VMs" fix)', 12); r++;
  p(r, 'A Zonal VM is only truly resilient if peers with the same role live in other AZs. Instead of flat-scoring every Zonal VM the same, the engine looks up its VM Group (VMs in the same RG sharing a name stem like vm-app01/02/03) and grades it accordingly:'); r += 2;
  r = table(r, ['VM Group state', 'Tier', 'Score', 'Justification label'], [
    ['GOOD — group spans 3+ AZs',      'HIGH',   95, 'Zonal — cluster spans 3+ AZs'],
    ['PARTIAL — group spans 2 AZs',    'MEDIUM', 70, 'Zonal — cluster spans 2 AZs'],
    ['BAD — group pinned to 1 AZ',     'LOW',    30, 'Zonal — cluster pinned to 1 AZ'],
    ['MISSING — group members have no zones', 'LOW', 30, 'Zonal — cluster has no zones'],
    ['STANDALONE — single Zonal VM, no peers', 'MEDIUM', 55, 'Zonal — single VM in AZ'],
  ]);
  r += 1;
  p(r, 'Group detection: two or more VMs in the same resource group whose names differ only in a trailing counter (01/02, node1/node2, -a/-b, ...). "VM Group" is deliberately not called a "cluster" here to avoid confusion with real Azure clusters (AKS, HDInsight, VMSS).'); r += 2;

  h(r, '3. Disk-attachment-aware scoring', 12); r++;
  p(r, 'The script writes each attached disk\'s parent VM name into the disk\'s resiliencydetail column. We use this linkage:'); r += 2;
  r = table(r, ['Disk situation', 'Tier', 'Score', 'Justification label'], [
    ['LRS disk attached to a Zonal VM',  'N/A', '—', 'Locally Redundant (LRS) (aligned with Zonal VM)'],
    ['LRS disk attached to a NonZonal VM', 'LOW', 20, 'Locally Redundant (LRS)'],
    ['Unattached / orphan LRS disk',      'LOW', 20, 'Locally Redundant (LRS)'],
  ]);
  r += 1;
  p(r, 'Rationale: a Zonal VM already lives in one AZ; requiring its disks to be ZRS adds cost with no real resilience benefit until the VM itself becomes zone-redundant. NonZonal-VM disks stay LOW because ZRS there would meaningfully add resilience.'); r += 2;
  bar(r); r += 1;

  // ---- Actions: Attention tab ----------------------------------------------
  h(r, 'Actions for the "Attention" tab', 14); r++;
  p(r, 'The Attention tab lists every LOW and MEDIUM resource for this entity, sorted by score (worst first). Combine the Justification column with the columns below to decide next steps.'); r += 2;

  r = table(r, ['Justification pattern', 'What it means', 'Recommended action'], [
    ['Locally Redundant (LRS) — Storage / SQL',
     'Data has only in-datacenter replicas. A zone or region failure loses the data.',
     'Change SKU to ZRS (Zone Redundant Storage) for zone resilience, or GZRS for zone + geo. For SQL, target Zone-Redundant / Business Critical premium.'],
    ['Locally Redundant (LRS) — attached to NonZonal VM',
     'Both the VM and its disk are single-datacenter. Full loss on zone failure.',
     'First: replace VM with Zonal + ZRS-capable disks (Premium SSD v2 / Ultra), or move workload into a VM Scale Set spanning 3 AZs. Only worth swapping disks after VM is Zonal.'],
    ['NonZonal — VM, App Service, VNet peering, etc.',
     'Regional resource with no AZ tag. Not automatically zone-resilient.',
     'Re-deploy with zones set (VM: `zones` property; App Service: Premium v3 with zoneRedundant=true; Load Balancer / Public IP: Standard SKU). For network resources, plan for cross-zone deployment.'],
    ['Zonal — cluster pinned to 1 AZ  (BAD group)',
     'Multiple VMs sharing a role are all in the same zone — false sense of HA.',
     'Rebalance: destroy and recreate at least one peer in each of zones 1 / 2 / 3, or move to a Flexible Orchestration VMSS across zones. See the VM Groups tab for the exact member list.'],
    ['Zonal — cluster spans 2 AZs  (PARTIAL group)',
     'Group survives 1-zone failure but capacity drops significantly.',
     'Add a member in the third zone (or move an existing peer). Capacity planning: each remaining zone must handle 1/3 of the load, so verify SKU sizing.'],
    ['Zonal — single VM in AZ  (STANDALONE)',
     'A lone Zonal VM has no peer to fail over to — zone loss = outage.',
     'If the workload requires HA: deploy at least 2 more peers in the other zones and put them behind a Load Balancer / App Gateway. If not HA-critical: accept and document.'],
    ['Zonal — cluster has no zones  (MISSING group)',
     'Peers exist but none carry zone info — usually a data/tag hygiene problem.',
     'Verify in Azure Portal whether the VMs actually have zones set. If yes, re-run RelAZ_Assess. If no, treat the group as Non-Zonal and follow those actions.'],
    ['Partially AZ Redundant',
     'Resource has some zone awareness but not full replication.',
     'Check the resiliencydetail field for the specific gap (e.g. "primary in zone 1, secondary missing"). Complete the zone-redundant deployment per the resource type\'s docs.'],
  ]);
  r += 1; bar(r); r += 1;

  // ---- Actions: VM Groups tab ----------------------------------------------
  h(r, 'Actions for the "VM Groups" tab', 14); r++;
  p(r, 'Each row block on the VM Groups tab represents 2+ VMs that share a role stem. The first row of a block carries the group verdict; subsequent rows list its members.'); r += 2;

  r = table(r, ['Status', 'What it means', 'Recommended action'], [
    ['GOOD', 'Members span all 3 AZs — target state.', 'No action needed. Confirm the Load Balancer / App Gateway in front of the group is Standard-SKU and zone-redundant so traffic can survive zone failure.'],
    ['PARTIAL', 'Members are spread across only 2 AZs.',
     'Add a member in the missing zone, then rebalance capacity. Watch out for licensing: some agents (SQL, SAP, Oracle) are per-instance.'],
    ['BAD', 'Every member is in the same AZ. Highest risk — 1-zone failure removes the whole role.',
     'Priority remediation: destroy and recreate at least (n-1) peers in the other two zones. If the app can\'t tolerate re-deploy: build parallel peers in zones 2 & 3, add them to LB, drain zone 1.'],
    ['MISSING', 'Group has 2+ VMs but none carry a zone value.',
     'Confirm in the Portal — is the zones property actually blank, or is the script mis-reading it? If blank, apply the BAD-group remediation. If not, re-run the assessment.'],
  ]);
  r += 1;
  p(r, 'Group detection heuristic: two or more VMs in the same resource group whose names differ only by a trailing counter (01/02, node1/node2, -a/-b, ...). This will occasionally miss looser naming or match unrelated VMs — always sanity-check the Group Role column before acting.'); r += 2;
  bar(r); r += 1;

  h(r, 'Where to change the rules', 14); r++;
  p(r, 'server/scoring.js  — base resiliencyconfig → tier/score table.'); r++;
  p(r, 'server/dataStore.js  — special-case adjustments (Public IP override, cluster-aware Zonal, disk linkage).'); r++;
  p(r, 'server/clusters.js  — VM Group detection heuristic (stem stripping, zone-spread verdict).'); r++;
}
