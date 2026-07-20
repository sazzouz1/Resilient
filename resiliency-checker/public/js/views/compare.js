// Compare Entities — side-by-side of up to 5 entities.
import { api } from '../api.js';
import { el, kpi, fmt, scoreTier, chartOpts, TIER_COLORS } from '../ui.js';

async function render(host) {
  host.append(
    el('h2', {}, 'Compare Entities'),
    el('div', { class: 'subtitle' }, 'Pick 2–5 entities and see them side by side.')
  );

  const entities = await api.entities();
  const state = { selected: entities.slice(0, 3).map(e => e.id) };

  const toolbar = el('div', { class: 'panel tight toolbar' });
  const multi = el('select', { multiple: 'true', size: '6', style: { minWidth: '320px', height: '160px' } },
    entities.map(e => el('option', { value: e.id, ...(state.selected.includes(e.id) ? { selected: 'true' } : {}) },
      `${e.displayName}  (${fmt.n(e.total)} resources)`))
  );
  const compareBtn = el('button', { class: 'btn', onclick: () => refresh() }, 'Compare');
  toolbar.append(el('label', {}, 'Entities (Ctrl/Cmd-click for multi-select):'), multi, compareBtn);
  host.append(toolbar);

  const out = el('div');
  host.append(out);

  async function refresh() {
    state.selected = [...multi.selectedOptions].map(o => o.value).slice(0, 5);
    out.innerHTML = '';
    if (!state.selected.length) { out.append(el('div', { class: 'panel' }, 'Select at least one entity.')); return; }

    const summaries = await Promise.all(state.selected.map(id => api.summary({ entity: id }).then(s => ({ id, ...s }))));
    const named = summaries.map(s => ({
      ...s,
      name: entities.find(e => e.id === s.id)?.displayName || s.id,
    }));

    // KPI card per entity
    const kpiRow = el('div', { class: 'grid', style: { gridTemplateColumns: `repeat(${named.length}, 1fr)`, marginTop: '14px' } });
    for (const s of named) {
      const t = scoreTier(s.resiliencyScore);
      kpiRow.append(el('div', { class: 'panel' }, [
        el('h4', {}, s.name),
        el('div', { class: 'kpi', style: { marginTop: '10px' } }, [
          el('div', { class: 'label' }, 'Score'),
          el('div', { class: `value tier-${t}` }, s.resiliencyScore == null ? '—' : String(s.resiliencyScore)),
          el('div', { class: 'sub' }, `${fmt.n(s.total)} resources · ${fmt.pct(s.highPct)} high`),
        ]),
      ]));
    }
    out.append(kpiRow);

    // Grouped bar chart
    const chartPanel = el('div', { class: 'panel', style: { marginTop: '14px' } }, [el('h4', {}, 'Resiliency Tier Distribution')]);
    const canvas = el('canvas');
    chartPanel.append(el('div', { class: 'chart-wrap tall' }, canvas));
    out.append(chartPanel);

    new Chart(canvas, {
      type: 'bar',
      data: {
        labels: named.map(s => s.name),
        datasets: [
          { label: 'High',   data: named.map(s => s.tierCounts.HIGH),   backgroundColor: TIER_COLORS.HIGH   },
          { label: 'Medium', data: named.map(s => s.tierCounts.MEDIUM), backgroundColor: TIER_COLORS.MEDIUM },
          { label: 'Low',    data: named.map(s => s.tierCounts.LOW),    backgroundColor: TIER_COLORS.LOW    },
          { label: 'N/A',    data: named.map(s => s.tierCounts.NA),     backgroundColor: TIER_COLORS.NA     },
        ],
      },
      options: chartOpts({
        scales: {
          x: { ticks: { color: '#8fa0c8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { beginAtZero: true, ticks: { color: '#8fa0c8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        },
      }),
    });

    // Detail table
    const tableWrap = el('div', { class: 'table-wrap', style: { marginTop: '14px' } });
    const table = el('table');
    table.innerHTML = `
      <thead><tr>
        <th>Metric</th>${named.map(s => `<th class="right">${s.name}</th>`).join('')}
      </tr></thead>`;
    const rows = [
      ['Resources', s => fmt.n(s.total)],
      ['In-scope', s => fmt.n(s.inScope)],
      ['Score',    s => s.resiliencyScore ?? '—'],
      ['High %',   s => fmt.pct(s.highPct)],
      ['Medium %', s => fmt.pct(s.mediumPct)],
      ['Low %',    s => fmt.pct(s.lowPct)],
      ['High',     s => fmt.n(s.tierCounts.HIGH)],
      ['Medium',   s => fmt.n(s.tierCounts.MEDIUM)],
      ['Low',      s => fmt.n(s.tierCounts.LOW)],
      ['N/A',      s => fmt.n(s.tierCounts.NA)],
    ];
    const tbody = el('tbody');
    for (const [label, fn] of rows) {
      tbody.append(el('tr', {}, [
        el('td', {}, [el('b', {}, label)]),
        ...named.map(s => el('td', { class: 'right' }, String(fn(s)))),
      ]));
    }
    table.append(tbody);
    tableWrap.append(table);
    out.append(tableWrap);
  }

  refresh();
}

export default { render };
