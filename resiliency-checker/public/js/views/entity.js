// Entity Deep Dive — pick one entity/tenant, see technical breakdown.
import { api } from '../api.js';
import { el, kpi, tierBadge, scoreBar, scoreTier, fmt, chartOpts, TIER_COLORS, modal, toast, multiSelect } from '../ui.js';
import { exportEntity, promptExportOptions } from '../exportExcel.js';

async function render(host, params = []) {
  const [entities, allSnapshots] = await Promise.all([
    api.entities(),
    api.snapshots(),
  ]);
  const preselect = params[0] ? decodeURIComponent(params[0]) : (entities[0]?.id || '');

  const select = el('select', { id: 'entitySel' },
    entities.map(e => el('option', { value: e.id, ...(e.id === preselect ? { selected: 'true' } : {}) }, e.displayName))
  );

  // Snapshot selector — populated based on selected entity
  const snapshotSel = el('select', { id: 'snapshotSel' });
  function fillSnapshots(entityId) {
    const forEntity = allSnapshots.filter(s => s.entityId === entityId)
      .sort((a, b) => b.runDate.localeCompare(a.runDate));
    snapshotSel.innerHTML = '';
    for (const s of forEntity) {
      const label = `${s.runDate}${s.isLatest ? ' (latest)' : ''}  ·  ${s.rowCount.toLocaleString()} rows`;
      snapshotSel.append(el('option', { value: s.runDate }, label));
    }
    snapshotSel.disabled = forEntity.length <= 1;
  }
  fillSnapshots(preselect);

  // Subscription MULTI-select — filters the WHOLE page. Options depend on the
  // selected entity + run and come from /api/facets.
  const subMs = multiSelect({
    options: [], selected: [], allLabel: 'All subscriptions', noun: 'subscriptions',
    onClose: () => renderEntity(contentHost, select.value, snapshotSel.value, subMs.getValues(), shared),
  });
  let facetCache = null;
  async function fillSubscriptions(entityId, runDate) {
    let f = { subscriptions: [] };
    try { f = await api.facets({ entity: entityId, ...(runDate ? { runDate } : {}) }); }
    catch (e) { console.error('facets failed', e); }
    facetCache = f;
    const options = (f.subscriptions || []).map(s => ({
      value: s.name,
      label: `${s.name} (${(s.count ?? 0).toLocaleString()})`,
    }));
    subMs.setOptions(options, true); // keep still-valid selections across entity/run changes
  }

  // Shared state so the Export button can mirror the on-screen attention tiers.
  const shared = { tiers: 'LOW,MEDIUM' };

  select.addEventListener('change', async () => {
    fillSnapshots(select.value);
    await fillSubscriptions(select.value, snapshotSel.value);
    renderEntity(contentHost, select.value, snapshotSel.value, subMs.getValues(), shared);
    location.hash = `#/entity/${encodeURIComponent(select.value)}`;
  });
  snapshotSel.addEventListener('change', async () => {
    await fillSubscriptions(select.value, snapshotSel.value);
    renderEntity(contentHost, select.value, snapshotSel.value, subMs.getValues(), shared);
  });

  const exportBtn = el('button', { class: 'btn', title: 'Choose sheets & scope, then export an Excel workbook' }, '⬇ Export to Excel');
  exportBtn.addEventListener('click', async () => {
    const current = select.value;
    const label = entities.find(e => e.id === current)?.displayName || current;
    const tierVal = shared.tiers; // '' => all tiers on screen
    const opts = await promptExportOptions({
      subscriptions: facetCache?.subscriptions || [],
      currentSubscriptions: subMs.getValues(),
      currentTiers: tierVal ? tierVal.split(',') : ['HIGH', 'MEDIUM', 'LOW', 'NA'],
    });
    if (!opts) return;
    const originalText = exportBtn.textContent;
    exportBtn.textContent = 'Building…';
    exportBtn.disabled = true;
    try {
      await exportEntity(current, label, snapshotSel.value || null, opts);
    } catch (err) {
      alert(`Export failed: ${err.message}`);
      console.error(err);
    } finally {
      exportBtn.textContent = originalText;
      exportBtn.disabled = false;
    }
  });

  host.append(
    el('h2', {}, 'Entity Deep Dive'),
    el('div', { class: 'subtitle' }, 'Technical view of resiliency posture inside one entity or tenant.'),
    el('div', { class: 'toolbar' }, [
      el('label', {}, 'Entity:'), select,
      el('label', {}, 'Run:'), snapshotSel,
      el('label', {}, 'Subscription:'), subMs.el,
      el('span', { class: 'spacer' }),
      exportBtn,
    ])
  );

  const contentHost = el('div');
  host.append(contentHost);

  await fillSubscriptions(preselect, snapshotSel.value);
  await renderEntity(contentHost, preselect, snapshotSel.value, subMs.getValues(), shared);
}

async function renderEntity(host, entityId, runDate, subs = [], shared = { tiers: 'LOW,MEDIUM' }) {
  host.innerHTML = '';
  if (!entityId) { host.append(el('div', { class: 'panel' }, 'No entity selected.')); return; }
  const subParam = (subs && subs.length) ? subs.join(',') : '';
  const q = { entity: entityId };
  if (runDate) q.runDate = runDate;
  if (subParam) q.subscription = subParam;

  const [summary, byType, byLocation, byConfig, byEnv] = await Promise.all([
    api.summary(q),
    api.breakdown({ ...q, groupBy: 'resourcesubtype' }),
    api.breakdown({ ...q, groupBy: 'location' }),
    api.breakdown({ ...q, groupBy: '__configLabel' }),
    api.breakdown({ ...q, groupBy: 'environment' }),
  ]);

  const t = scoreTier(summary.resiliencyScore);
  host.append(el('div', { class: 'grid cols-5' }, [
    kpi('Total Resources', fmt.n(summary.total)),
    kpi('Resiliency Score', summary.resiliencyScore == null ? '—' : summary.resiliencyScore + '/100',
      `${fmt.n(summary.inScope)} in-scope`),
    kpi('High',   fmt.n(summary.tierCounts.HIGH),   fmt.pct(summary.highPct)),
    kpi('Medium', fmt.n(summary.tierCounts.MEDIUM), fmt.pct(summary.mediumPct)),
    kpi('Low (at risk)', fmt.n(summary.tierCounts.LOW), fmt.pct(summary.lowPct)),
  ]));

  // Charts row 1: config mix + resource type mix
  const row1 = el('div', { class: 'grid cols-2', style: { marginTop: '14px' } });
  const cfgPanel = el('div', { class: 'panel' }, [el('h4', {}, 'Resiliency Configuration Mix')]);
  const cfgCanvas = el('canvas'); cfgPanel.append(el('div', { class: 'chart-wrap' }, cfgCanvas));
  const typePanel = el('div', { class: 'panel' }, [el('h4', {}, 'Resource Types (Top 15)')]);
  const typeCanvas = el('canvas'); typePanel.append(el('div', { class: 'chart-wrap tall' }, typeCanvas));
  row1.append(cfgPanel, typePanel);
  host.append(row1);

  new Chart(cfgCanvas, {
    type: 'bar',
    data: {
      labels: byConfig.map(x => x.name),
      datasets: [{
        label: 'Resources',
        data: byConfig.map(x => x.count),
        backgroundColor: byConfig.map(x => {
          // color by whichever tier dominates the bucket
          const tiers = x.tierCounts || {};
          const dom = Object.entries(tiers).sort((a, b) => b[1] - a[1])[0]?.[0];
          return TIER_COLORS[dom] || TIER_COLORS.NA;
        }),
      }],
    },
    options: chartOpts({ indexAxis: 'y', plugins: { legend: { display: false } } }),
  });

  const top15 = byType.slice(0, 15);
  new Chart(typeCanvas, {
    type: 'bar',
    data: {
      labels: top15.map(t => t.name.replace(/^Microsoft\./, '')),
      datasets: [
        { label: 'High',   data: top15.map(t => t.tierCounts.HIGH),   backgroundColor: TIER_COLORS.HIGH,   stack: 's' },
        { label: 'Medium', data: top15.map(t => t.tierCounts.MEDIUM), backgroundColor: TIER_COLORS.MEDIUM, stack: 's' },
        { label: 'Low',    data: top15.map(t => t.tierCounts.LOW),    backgroundColor: TIER_COLORS.LOW,    stack: 's' },
        { label: 'N/A',    data: top15.map(t => t.tierCounts.NA),     backgroundColor: TIER_COLORS.NA,     stack: 's' },
      ],
    },
    options: chartOpts({
      indexAxis: 'y',
      scales: {
        x: { stacked: true, ticks: { color: '#8fa0c8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { stacked: true, ticks: { color: '#8fa0c8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
      },
    }),
  });

  // Charts row 2: locations + environments
  const row2 = el('div', { class: 'grid cols-2', style: { marginTop: '14px' } });
  const locPanel = el('div', { class: 'panel' }, [el('h4', {}, 'By Location')]);
  const locCanvas = el('canvas'); locPanel.append(el('div', { class: 'chart-wrap' }, locCanvas));
  const envPanel = el('div', { class: 'panel' }, [el('h4', {}, 'By Environment')]);
  const envCanvas = el('canvas'); envPanel.append(el('div', { class: 'chart-wrap' }, envCanvas));
  row2.append(locPanel, envPanel);
  host.append(row2);

  new Chart(locCanvas, {
    type: 'bar',
    data: {
      labels: byLocation.slice(0, 10).map(x => x.name || '(blank)'),
      datasets: [{
        label: 'Resources', data: byLocation.slice(0, 10).map(x => x.count),
        backgroundColor: '#4f8cff',
      }],
    },
    options: chartOpts({ plugins: { legend: { display: false } } }),
  });
  new Chart(envCanvas, {
    type: 'bar',
    data: {
      labels: byEnv.slice(0, 10).map(x => x.name || '(blank)'),
      datasets: [{
        label: 'Resources', data: byEnv.slice(0, 10).map(x => x.count),
        backgroundColor: '#7f5cff',
      }],
    },
    options: chartOpts({ plugins: { legend: { display: false } } }),
  });

  // ---- Resources requiring attention (LOW + MEDIUM by default) ------------
  const attentionSection = el('div');
  host.append(attentionSection);

  const tierFilter = el('select', {}, [
    el('option', { value: 'LOW,MEDIUM', selected: 'true' }, 'LOW + MEDIUM (needs attention)'),
    el('option', { value: 'LOW' }, 'LOW only'),
    el('option', { value: 'MEDIUM' }, 'MEDIUM only'),
    el('option', { value: '' }, 'All tiers'),
  ]);
  const typeFilter = el('select', {}, [
    el('option', { value: '' }, 'All resource types'),
    ...byType.slice(0, 40).map(t => el('option', { value: t.name }, `${t.name.replace(/^Microsoft\./, '')} (${fmt.n(t.count)})`)),
  ]);
  tierFilter.addEventListener('change', () => { shared.tiers = tierFilter.value; refreshAttention(); });
  typeFilter.addEventListener('change', () => refreshAttention());

  const CLUSTER_TIER = { GOOD: 'HIGH', PARTIAL: 'MEDIUM', BAD: 'LOW', MISSING: 'LOW', STANDALONE: 'NA' };

  async function refreshAttention() {
    attentionSection.innerHTML = '';
    const tiers = tierFilter.value ? tierFilter.value.split(',') : ['HIGH', 'MEDIUM', 'LOW', 'NA'];

    // Server accepts a single tier — pull each in parallel and merge
    const chunks = await Promise.all(tiers.map(t =>
      api.resources({ entity: entityId, ...(runDate ? { runDate } : {}), ...(subParam ? { subscription: subParam } : {}), tier: t, resourceType: typeFilter.value, pageSize: 500 })
    ));
    const merged = chunks.flatMap(c => c.rows);
    const total = chunks.reduce((a, c) => a + c.total, 0);

    // Sort: worst first (lowest score), then Name
    merged.sort((a, b) => (a.score ?? 999) - (b.score ?? 999) || (a.name || '').localeCompare(b.name || ''));

    attentionSection.append(el('h3', {}, `Resources Requiring Attention (${fmt.n(total)} total, showing first ${fmt.n(merged.length)})`));
    attentionSection.append(el('div', { class: 'toolbar' }, [
      el('label', {}, 'Tiers:'), tierFilter,
      el('label', {}, 'Type:'), typeFilter,
    ]));

    const tableWrap = el('div', { class: 'table-wrap' });
    const table = el('table');
    table.innerHTML = `
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          <th>Resource Group</th>
          <th>Location</th>
          <th>Zones</th>
          <th>SKU</th>
          <th>resiliencyconfig</th>
          <th>resiliencydetail</th>
          <th class="right">Score</th>
          <th>Tier</th>
          <th>Justification</th>
          <th>Group</th>
          <th>Action</th>
        </tr>
      </thead>`;
    const tbody = el('tbody');
    for (const r of merged) {
      const clusterCell = r.clusterStatus
        ? el('span', {
            class: `badge ${CLUSTER_TIER[r.clusterStatus] || 'NA'}`,
            title: r.clusterStem ? `Group: ${r.clusterStem} (${r.clusterMemberCount || '?'} VMs), zones: ${r.clusterZonesCovered || '—'}` : r.clusterStatus,
          }, r.clusterStatus)
        : el('span', { class: 'muted' }, '—');

      const excludeBtn = el('button', { class: 'icon-btn', title: 'Exclude from scoring with a justification' }, r.excluded ? '↺ Un-exclude' : '✕ Exclude');
      excludeBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (r.excluded) {
          const ok = confirm(`Un-exclude "${r.name}"? It will be scored normally again.`);
          if (!ok) return;
          const result = await api.removeExclusion(r.resourceId);
          if (result.ok) {
            toast(`Un-excluded: ${r.name}`, 'ok');
            refreshAttention();
          } else {
            toast('Un-exclude failed', 'error');
          }
          return;
        }
        const vals = await modal({
          title: `Exclude "${r.name}" from scoring`,
          description: `${r.resourceType || 'resource'} in ${r.resourceGroup || '—'}. Excluding removes this resource from all resiliency-score calculations. Requires a justification for audit.`,
          fields: [
            { key: 'justification', label: 'Justification (required)', type: 'textarea', required: true,
              placeholder: 'e.g. Legacy system pending retirement in Q4, or Test workload not in scope' },
            { key: 'addedBy', label: 'Your name / user', type: 'text', placeholder: 'you@microsoft.com' },
          ],
          confirmText: 'Exclude',
        });
        if (!vals) return;
        const result = await api.addExclusion({
          resourceId: r.resourceId,
          justification: vals.justification,
          addedBy: vals.addedBy || 'unknown',
        });
        if (result.ok) {
          toast(`Excluded: ${r.name}`, 'ok');
          refreshAttention();
        } else {
          toast(`Exclusion failed: ${result.error || 'unknown'}`, 'error');
        }
      });

      const tr = el('tr', {
        class: r.excluded ? 'row-excluded' : '',
        onclick: () => location.hash = `#/resource-groups/${encodeURIComponent(entityId)}/${encodeURIComponent(r.resourceGroup)}`,
      }, [
        el('td', {}, [
          el('b', {}, r.name || '—'),
          r.excluded ? el('span', { class: 'badge-excluded', style: { marginLeft: '6px' }, title: r.exclusion?.justification || '' }, 'EXCLUDED') : null,
        ]),
        el('td', {}, (r.resourceType || '').replace(/^Microsoft\./, '')),
        el('td', {}, r.resourceGroup || '—'),
        el('td', {}, r.location || '—'),
        el('td', {}, r.zones || el('span', { class: 'muted' }, '—')),
        el('td', {}, r.sku || '—'),
        el('td', {}, r.resiliencyConfig || el('span', { class: 'muted' }, '—')),
        el('td', {}, r.resiliencyDetail || el('span', { class: 'muted' }, '—')),
        el('td', { class: 'right' }, r.score == null ? el('span', { class: 'muted' }, '—') : String(r.score)),
        el('td', {}, [tierBadge(r.tier)]),
        el('td', {}, r.configLabel || '—'),
        el('td', {}, [clusterCell]),
        el('td', {}, [excludeBtn]),
      ]);
      tbody.append(tr);
    }
    table.append(tbody);
    tableWrap.append(table);
    attentionSection.append(tableWrap);
    if (total > merged.length) {
      attentionSection.append(el('div', { class: 'muted', style: { marginTop: '6px' } },
        `Showing first ${merged.length} of ${fmt.n(total)} — use Resource Explorer to page through the rest.`));
    }
  }

  refreshAttention();
}

export default { render };
