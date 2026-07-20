// Progress view — track how an entity's resiliency evolves across script runs.
import { api } from '../api.js';
import { el, kpi, tierBadge, scoreTier, fmt, chartOpts, TIER_COLORS } from '../ui.js';

async function render(host, params = []) {
  host.append(
    el('h2', {}, 'Progress'),
    el('div', { class: 'subtitle' }, 'Track resiliency improvements over multiple RelAZ_Assess runs.')
  );

  const [entities, allSnapshots] = await Promise.all([api.entities(), api.snapshots()]);
  const multiRunEntities = entities.filter(e => e.snapshotCount > 1);

  const entitySel = el('select', {}, [
    el('option', { value: '' }, `Government-wide (${entities.length} entities)`),
    ...entities.map(e => el('option', {
      value: e.id,
      ...(params[0] && decodeURIComponent(params[0]) === e.id ? { selected: 'true' } : {}),
    }, `${e.displayName}  ·  ${e.snapshotCount} run(s)`)),
  ]);
  entitySel.addEventListener('change', () => refresh());

  host.append(el('div', { class: 'toolbar panel tight' }, [
    el('label', {}, 'Scope:'), entitySel,
    el('span', { class: 'muted', style: { marginLeft: 'auto' } },
      `${multiRunEntities.length} of ${entities.length} entities have more than one run`),
  ]));

  const out = el('div');
  host.append(out);

  async function refresh() {
    out.innerHTML = '';
    const entityId = entitySel.value || '';
    const prog = await api.progress(entityId ? { entity: entityId } : {});
    const points = prog.series || [];

    if (points.length === 0) {
      out.append(el('div', { class: 'panel', style: { marginTop: '10px' } }, 'No data.'));
      return;
    }

    // ---- KPIs -------------------------------------------------------------
    const first = points[0];
    const last = points[points.length - 1];
    const scoreDelta = (last.resiliencyScore ?? 0) - (first.resiliencyScore ?? 0);
    const highDelta  = last.tierCounts.HIGH - first.tierCounts.HIGH;
    const lowDelta   = last.tierCounts.LOW - first.tierCounts.LOW;
    const totalDelta = last.total - first.total;

    const arrow = v => v > 0 ? '↑' : v < 0 ? '↓' : '·';
    const color = v => v > 0 ? 'HIGH' : v < 0 ? 'LOW' : 'NA';

    out.append(el('div', { class: 'grid cols-5', style: { marginTop: '10px' } }, [
      kpi('Runs tracked', points.length, `${first.runDate} → ${last.runDate}`),
      kpi('Latest score', last.resiliencyScore == null ? '—' : String(last.resiliencyScore),
        `${arrow(scoreDelta)} ${Math.abs(scoreDelta)} vs first run`),
      kpi('HIGH tier',
        fmt.n(last.tierCounts.HIGH),
        el('span', { class: `tier-${color(highDelta)}` }, `${arrow(highDelta)} ${fmt.n(Math.abs(highDelta))}`)),
      kpi('LOW tier',
        fmt.n(last.tierCounts.LOW),
        el('span', { class: `tier-${color(-lowDelta)}` }, `${arrow(lowDelta)} ${fmt.n(Math.abs(lowDelta))}`)),
      kpi('Resource count',
        fmt.n(last.total),
        `${arrow(totalDelta)} ${fmt.n(Math.abs(totalDelta))} rows`),
    ]));

    // ---- Score line chart --------------------------------------------------
    const scorePanel = el('div', { class: 'panel', style: { marginTop: '14px' } }, [
      el('h4', {}, 'Resiliency score over time'),
    ]);
    const scoreCanvas = el('canvas');
    scorePanel.append(el('div', { class: 'chart-wrap' }, scoreCanvas));

    // ---- Tier stacked area chart ------------------------------------------
    const tierPanel = el('div', { class: 'panel', style: { marginTop: '14px' } }, [
      el('h4', {}, 'Tier distribution over time'),
    ]);
    const tierCanvas = el('canvas');
    tierPanel.append(el('div', { class: 'chart-wrap' }, tierCanvas));

    out.append(el('div', { class: 'grid cols-2' }, [scorePanel, tierPanel]));

    new Chart(scoreCanvas, {
      type: 'line',
      data: {
        labels: points.map(p => p.runDate),
        datasets: [{
          label: 'Score',
          data: points.map(p => p.resiliencyScore),
          borderColor: TIER_COLORS.HIGH,
          backgroundColor: 'rgba(52,197,138,0.15)',
          fill: true, tension: 0.25, pointRadius: 5,
        }],
      },
      options: chartOpts({
        scales: {
          x: { ticks: { color: '#8fa0c8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { min: 0, max: 100, ticks: { color: '#8fa0c8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        },
      }),
    });

    new Chart(tierCanvas, {
      type: 'bar',
      data: {
        labels: points.map(p => p.runDate),
        datasets: [
          { label: 'High',   data: points.map(p => p.tierCounts.HIGH),   backgroundColor: TIER_COLORS.HIGH,   stack: 's' },
          { label: 'Medium', data: points.map(p => p.tierCounts.MEDIUM), backgroundColor: TIER_COLORS.MEDIUM, stack: 's' },
          { label: 'Low',    data: points.map(p => p.tierCounts.LOW),    backgroundColor: TIER_COLORS.LOW,    stack: 's' },
          { label: 'N/A',    data: points.map(p => p.tierCounts.NA),     backgroundColor: TIER_COLORS.NA,     stack: 's' },
        ],
      },
      options: chartOpts({
        scales: {
          x: { stacked: true, ticks: { color: '#8fa0c8' } },
          y: { stacked: true, ticks: { color: '#8fa0c8' } },
        },
      }),
    });

    // ---- Snapshot-to-snapshot diff (only for single-entity) ---------------
    if (entityId && points.length >= 2) {
      const diffPanel = el('div', { class: 'panel', style: { marginTop: '14px' } });
      diffPanel.append(el('h4', {}, 'Compare two runs — resource-level changes'));
      const fromSel = el('select', {},
        points.map(p => el('option', { value: p.runDate }, p.runDate)));
      const toSel = el('select', {},
        points.map(p => el('option', {
          value: p.runDate,
          ...(p.runDate === last.runDate ? { selected: 'true' } : {}),
        }, p.runDate)));
      const compareBtn = el('button', { class: 'btn' }, 'Compare');
      const diffOut = el('div', { style: { marginTop: '10px' } });
      diffPanel.append(el('div', { class: 'toolbar' }, [
        el('label', {}, 'From:'), fromSel,
        el('label', {}, 'To:'), toSel,
        compareBtn,
      ]), diffOut);
      out.append(diffPanel);

      async function runDiff() {
        diffOut.innerHTML = 'Loading…';
        const diff = await api.snapshotDiff({ entity: entityId, from: fromSel.value, to: toSel.value });
        diffOut.innerHTML = '';
        if (diff.error) { diffOut.append(el('div', {}, diff.error)); return; }
        diffOut.append(el('div', { class: 'grid cols-5' }, [
          kpi('Improved', fmt.n(diff.counts.improved), 'tier or score went up'),
          kpi('Regressed', fmt.n(diff.counts.regressed), 'tier or score went down'),
          kpi('Unchanged', fmt.n(diff.counts.unchanged), ''),
          kpi('Added', fmt.n(diff.counts.added), 'new in the later run'),
          kpi('Removed', fmt.n(diff.counts.removed), 'gone in the later run'),
        ]));

        const section = (title, items, showBefore = true) => {
          if (!items.length) return null;
          const wrap = el('div', { style: { marginTop: '14px' } });
          wrap.append(el('h4', {}, `${title} (${items.length})`));
          const tw = el('div', { class: 'table-wrap' });
          const t = el('table');
          t.innerHTML = `
            <thead><tr>
              <th>Name</th><th>Type</th><th>RG</th>
              ${showBefore ? '<th>Before</th>' : ''}
              <th>After</th><th>Config</th>
            </tr></thead>`;
          const b = el('tbody');
          for (const it of items.slice(0, 200)) {
            b.append(el('tr', {}, [
              el('td', {}, [el('b', {}, it.name || '—')]),
              el('td', {}, (it.resourceType || '').replace(/^Microsoft\./, '')),
              el('td', {}, it.resourceGroup || '—'),
              showBefore ? el('td', {}, [tierBadge(it.before?.tier || it.tier), ' ',
                el('span', { class: 'muted' }, it.before ? `(${it.before.score ?? '—'})` : '')]) : null,
              el('td', {}, [tierBadge(it.after?.tier || it.tier), ' ',
                el('span', { class: 'muted' }, it.after ? `(${it.after.score ?? '—'})` : '')]),
              el('td', {}, it.configLabel || '—'),
            ]));
          }
          t.append(b);
          tw.append(t);
          wrap.append(tw);
          if (items.length > 200) wrap.append(el('div', { class: 'muted' }, `+ ${items.length - 200} more`));
          return wrap;
        };

        diffOut.append(...[
          section('✓ Improved', diff.improved),
          section('✗ Regressed', diff.regressed),
          section('+ Added', diff.added, false),
          section('− Removed', diff.removed, false),
        ].filter(Boolean));
      }
      compareBtn.addEventListener('click', runDiff);
      runDiff(); // auto-run first + last
    }

    // ---- All snapshots table ----------------------------------------------
    out.append(el('h3', {}, 'All Runs'));
    const tw = el('div', { class: 'table-wrap' });
    const table = el('table');
    table.innerHTML = `
      <thead><tr>
        <th>Run date</th><th class="right">Resources</th>
        <th class="right">Score</th>
        <th class="right">High %</th><th class="right">Med %</th><th class="right">Low %</th>
        <th class="right">High</th><th class="right">Med</th><th class="right">Low</th><th class="right">N/A</th>
      </tr></thead>`;
    const b = el('tbody');
    for (const p of points.slice().reverse()) {
      const t = scoreTier(p.resiliencyScore);
      b.append(el('tr', {}, [
        el('td', {}, p.runDate),
        el('td', { class: 'right' }, fmt.n(p.total)),
        el('td', { class: 'right' }, [el('span', { class: `tier-${t}` }, p.resiliencyScore == null ? '—' : String(p.resiliencyScore))]),
        el('td', { class: 'right' }, fmt.pct(p.highPct)),
        el('td', { class: 'right' }, fmt.pct(p.mediumPct)),
        el('td', { class: 'right' }, fmt.pct(p.lowPct)),
        el('td', { class: 'right' }, fmt.n(p.tierCounts.HIGH)),
        el('td', { class: 'right' }, fmt.n(p.tierCounts.MEDIUM)),
        el('td', { class: 'right' }, fmt.n(p.tierCounts.LOW)),
        el('td', { class: 'right' }, fmt.n(p.tierCounts.NA)),
      ]));
    }
    table.append(b);
    tw.append(table);
    out.append(tw);
  }

  refresh();
}

export default { render };
