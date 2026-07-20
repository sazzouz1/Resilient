// Service View — how each Azure resource type is doing across the whole government.
import { api } from '../api.js';
import { el, kpi, tierBadge, scoreBar, scoreTier, fmt, chartOpts, TIER_COLORS } from '../ui.js';

async function render(host) {
  host.append(
    el('h2', {}, 'Service View'),
    el('div', { class: 'subtitle' }, 'Cross-government posture per Azure resource type — identifies systemic gaps.')
  );

  const [summary, byType] = await Promise.all([
    api.summary(),
    api.breakdown({ groupBy: 'resourcesubtype' }),
  ]);

  // Filter: only show types with a meaningful volume (>= 20)
  const meaningful = byType.filter(t => t.count >= 20);

  host.append(el('div', { class: 'grid cols-4' }, [
    kpi('Resource Types', byType.length, `${meaningful.length} with ≥ 20 resources`),
    kpi('Total Resources', fmt.n(summary.total)),
    kpi('Government Score', summary.resiliencyScore == null ? '—' : summary.resiliencyScore + '/100'),
    kpi('Low-Tier Resources', fmt.n(summary.tierCounts.LOW)),
  ]));

  // Chart: high% by resource type
  host.append(el('h3', {}, 'High-Resiliency % by Resource Type'));
  const panel = el('div', { class: 'panel' });
  const canvas = el('canvas');
  panel.append(el('div', { class: 'chart-wrap tall' }, canvas));
  host.append(panel);

  const forChart = meaningful.slice(0, 20);
  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: forChart.map(x => x.name.replace(/^Microsoft\./, '')),
      datasets: [{
        label: 'High %', data: forChart.map(x => x.highPct),
        backgroundColor: forChart.map(x =>
          x.highPct >= 70 ? TIER_COLORS.HIGH : x.highPct >= 40 ? TIER_COLORS.MEDIUM : TIER_COLORS.LOW),
      }],
    },
    options: chartOpts({
      indexAxis: 'y',
      scales: {
        x: { min: 0, max: 100, ticks: { color: '#8fa0c8', callback: v => v + '%' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#8fa0c8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
      },
      plugins: { legend: { display: false } },
    }),
  });

  // Table
  host.append(el('h3', {}, 'All Resource Types'));
  const tableWrap = el('div', { class: 'table-wrap' });
  const table = el('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Resource Type</th>
        <th class="right">Total</th>
        <th class="right">Score</th>
        <th style="width:160px;">Distribution</th>
        <th class="right">High %</th>
        <th class="right">Med %</th>
        <th class="right">Low %</th>
      </tr>
    </thead>`;
  const tbody = el('tbody');
  for (const t of byType) {
    const tier = scoreTier(t.resiliencyScore);
    tbody.append(el('tr', {
      onclick: () => location.hash = `#/explorer/${encodeURIComponent(t.name)}`,
    }, [
      el('td', {}, [el('b', {}, t.name.replace(/^Microsoft\./, '')), ' ', el('span', { class: 'muted' }, '')]),
      el('td', { class: 'right nowrap' }, fmt.n(t.count)),
      el('td', { class: 'right' }, [el('span', { class: `tier-${tier}` }, t.resiliencyScore == null ? '—' : String(t.resiliencyScore))]),
      el('td', {}, [scoreBar(t.resiliencyScore ?? 0, tier)]),
      el('td', { class: 'right' }, fmt.pct(t.highPct)),
      el('td', { class: 'right' }, fmt.pct(t.mediumPct)),
      el('td', { class: 'right' }, fmt.pct(t.lowPct)),
    ]));
  }
  table.append(tbody);
  tableWrap.append(table);
  host.append(tableWrap);
}

export default { render };
