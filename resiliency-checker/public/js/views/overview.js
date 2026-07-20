// Executive Overview — government-wide KPIs and entity ranking.
import { api } from '../api.js';
import { el, kpi, tierBadge, scoreBar, scoreTier, fmt, chartOpts, TIER_COLORS } from '../ui.js';

async function render(host) {
  host.append(
    el('h2', {}, 'Executive Overview'),
    el('div', { class: 'subtitle' }, 'Government-wide Azure resiliency posture across all entities.')
  );

  const [summary, entities] = await Promise.all([api.summary(), api.entities()]);

  // ---- KPIs -----------------------------------------------------------------
  const scoreTierColor = scoreTier(summary.resiliencyScore);
  const kpiRow = el('div', { class: 'grid cols-5' }, [
    kpi('Entities', entities.length, `${entities.filter(e => e.tenant).length} multi-tenant sub-entries`),
    kpi('Resources Assessed', fmt.n(summary.total)),
    kpi('Resiliency Score', summary.resiliencyScore == null ? '—' : summary.resiliencyScore + '/100',
      `${fmt.n(summary.inScope)} in-scope resources`),
    kpi('High Resiliency', fmt.pct(summary.highPct), `${fmt.n(summary.tierCounts.HIGH)} resources`),
    kpi('Low Resiliency', fmt.pct(summary.lowPct), `${fmt.n(summary.tierCounts.LOW)} at risk`),
  ]);
  host.append(kpiRow);

  // ---- Charts row -----------------------------------------------------------
  const chartsRow = el('div', { class: 'grid cols-2', style: { marginTop: '14px' } });
  const donutPanel = el('div', { class: 'panel' }, [el('h4', {}, 'Resiliency Tier Mix')]);
  const donutCanvas = el('canvas');
  donutPanel.append(el('div', { class: 'chart-wrap' }, donutCanvas));

  const barPanel = el('div', { class: 'panel' }, [el('h4', {}, 'Top 10 Resource Types by Volume')]);
  const barCanvas = el('canvas');
  barPanel.append(el('div', { class: 'chart-wrap' }, barCanvas));

  chartsRow.append(donutPanel, barPanel);
  host.append(chartsRow);

  new Chart(donutCanvas, {
    type: 'doughnut',
    data: {
      labels: ['High', 'Medium', 'Low', 'N/A'],
      datasets: [{
        data: [summary.tierCounts.HIGH, summary.tierCounts.MEDIUM, summary.tierCounts.LOW, summary.tierCounts.NA],
        backgroundColor: [TIER_COLORS.HIGH, TIER_COLORS.MEDIUM, TIER_COLORS.LOW, TIER_COLORS.NA],
        borderColor: '#0b1220', borderWidth: 2,
      }],
    },
    options: chartOpts({ scales: {}, cutout: '65%' }),
  });

  const typeBreakdown = await api.breakdown({ groupBy: 'resourcesubtype' });
  const top10 = typeBreakdown.slice(0, 10);
  new Chart(barCanvas, {
    type: 'bar',
    data: {
      labels: top10.map(t => t.name.replace(/^Microsoft\./, '')),
      datasets: [
        { label: 'High',   data: top10.map(t => t.tierCounts.HIGH),   backgroundColor: TIER_COLORS.HIGH,   stack: 's' },
        { label: 'Medium', data: top10.map(t => t.tierCounts.MEDIUM), backgroundColor: TIER_COLORS.MEDIUM, stack: 's' },
        { label: 'Low',    data: top10.map(t => t.tierCounts.LOW),    backgroundColor: TIER_COLORS.LOW,    stack: 's' },
        { label: 'N/A',    data: top10.map(t => t.tierCounts.NA),     backgroundColor: TIER_COLORS.NA,     stack: 's' },
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

  // ---- Entity ranking table -------------------------------------------------
  host.append(el('h3', {}, 'Entity Ranking'));
  const tableWrap = el('div', { class: 'table-wrap' });
  const table = el('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>#</th>
        <th>Entity</th>
        <th class="right">Resources</th>
        <th class="right">Score</th>
        <th style="width:180px;">Resiliency Distribution</th>
        <th class="right">High %</th>
        <th class="right">Low %</th>
        <th>Report Date</th>
      </tr>
    </thead>`;
  const tbody = el('tbody');
  entities.forEach((e, i) => {
    const t = scoreTier(e.resiliencyScore);
    const row = el('tr', { onclick: () => location.hash = `#/entity/${encodeURIComponent(e.id)}` }, [
      el('td', {}, String(i + 1)),
      el('td', {}, [el('b', {}, e.displayName)]),
      el('td', { class: 'right nowrap' }, fmt.n(e.total)),
      el('td', { class: 'right' }, [
        el('span', { class: `tier-${t}` }, e.resiliencyScore == null ? '—' : String(e.resiliencyScore)),
      ]),
      el('td', {}, [scoreBar(e.resiliencyScore ?? 0, t)]),
      el('td', { class: 'right' }, [tierBadge('HIGH'), ' ', fmt.pct(e.highPct)]),
      el('td', { class: 'right' }, [tierBadge('LOW'), ' ', fmt.pct(e.lowPct)]),
      el('td', {}, e.reportDate || '—'),
    ]);
    tbody.append(row);
  });
  table.append(tbody);
  tableWrap.append(table);
  host.append(tableWrap);
}

export default { render };
