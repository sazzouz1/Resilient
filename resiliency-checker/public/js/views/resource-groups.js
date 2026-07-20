// Resource Groups view — list every RG with its resiliency posture + VM group flags.
// Drill in on a row to see the RG's resources + VM group verdicts.
import { api } from '../api.js';
import { el, kpi, tierBadge, scoreBar, scoreTier, fmt } from '../ui.js';

const state = { entity: '', search: '' };

const GROUP_TIER = { GOOD: 'HIGH', PARTIAL: 'MEDIUM', BAD: 'LOW', MISSING: 'LOW' };

function groupBadge(status, label) {
  const t = GROUP_TIER[status] || 'NA';
  return el('span', { class: `badge ${t}`, title: label || status }, status);
}

async function render(host, params = []) {
  const [entity, rg] = params.map(p => p ? decodeURIComponent(p) : '');
  if (entity && rg) return renderDetail(host, entity, rg);
  return renderList(host, entity);
}

async function renderList(host, preselectEntity) {
  host.append(
    el('h2', {}, 'Resource Groups'),
    el('div', { class: 'subtitle' }, 'Every resource group ranked by risk — VM group flags surface where same-role VMs are not 3-AZ spread.')
  );

  const entities = await api.entities();
  state.entity = preselectEntity || state.entity;

  const entitySel = el('select', {},
    [el('option', { value: '' }, 'All Entities')].concat(
      entities.map(e => el('option', { value: e.id, ...(e.id === state.entity ? { selected: 'true' } : {}) }, e.displayName))
    )
  );
  const searchInput = el('input', { type: 'text', placeholder: 'Filter by RG / name…', value: state.search });

  const toolbar = el('div', { class: 'toolbar panel tight' }, [
    el('label', {}, 'Entity'), entitySel,
    el('label', {}, 'Search'), searchInput,
  ]);
  host.append(toolbar);

  const tableHost = el('div');
  host.append(tableHost);

  async function refresh() {
    state.entity = entitySel.value;
    state.search = searchInput.value.trim();
    tableHost.innerHTML = 'Loading…';

    const rgs = await api.resourceGroups({ entity: state.entity, search: state.search });
    tableHost.innerHTML = '';

    tableHost.append(el('div', { class: 'panel tight', style: { marginBottom: '10px' } },
      `${fmt.n(rgs.length)} resource groups`));

    const tableWrap = el('div', { class: 'table-wrap' });
    const table = el('table');
    table.innerHTML = `
      <thead><tr>
        <th>Entity</th>
        <th>Resource Group</th>
        <th class="right">Resources</th>
        <th class="right">Score</th>
        <th style="width:140px;">Distribution</th>
        <th class="right">VM Groups</th>
        <th>Group Flags</th>
      </tr></thead>`;
    const tbody = el('tbody');
    for (const g of rgs.slice(0, 500)) {
      const t = scoreTier(g.resiliencyScore);
      const flags = [];
      if (g.clusterFlags.BAD)     flags.push(groupBadge('BAD',     `${g.clusterFlags.BAD} same-zone group(s)`));
      if (g.clusterFlags.MISSING) flags.push(groupBadge('MISSING', `${g.clusterFlags.MISSING} group(s) with no zones`));
      if (g.clusterFlags.PARTIAL) flags.push(groupBadge('PARTIAL', `${g.clusterFlags.PARTIAL} 2-zone group(s)`));
      if (g.clusterFlags.GOOD)    flags.push(groupBadge('GOOD',    `${g.clusterFlags.GOOD} 3-AZ group(s)`));

      tbody.append(el('tr', {
        onclick: () => location.hash = `#/resource-groups/${encodeURIComponent(g.entityId)}/${encodeURIComponent(g.resourceGroup)}`,
      }, [
        el('td', {}, g.entity),
        el('td', {}, [el('b', {}, g.resourceGroup)]),
        el('td', { class: 'right nowrap' }, fmt.n(g.total)),
        el('td', { class: 'right' }, [el('span', { class: `tier-${t}` }, g.resiliencyScore == null ? '—' : String(g.resiliencyScore))]),
        el('td', {}, [scoreBar(g.resiliencyScore ?? 0, t)]),
        el('td', { class: 'right' }, g.clusterCount ? String(g.clusterCount) : '—'),
        el('td', {}, flags.length ? flags.reduce((acc, b, i) => (i === 0 ? [b] : [...acc, ' ', b]), []) : el('span', { class: 'muted' }, '—')),
      ]));
    }
    table.append(tbody);
    tableWrap.append(table);
    tableHost.append(tableWrap);
    if (rgs.length > 500) {
      tableHost.append(el('div', { class: 'muted', style: { marginTop: '6px' } },
        `Showing top 500 of ${fmt.n(rgs.length)} — narrow with Entity filter or Search.`));
    }
  }

  entitySel.addEventListener('change', refresh);
  let debounce = 0;
  searchInput.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(refresh, 200); });
  refresh();
}

async function renderDetail(host, entityId, resourceGroup) {
  host.append(el('div', { class: 'toolbar' }, [
    el('a', { href: '#/resource-groups' }, '‹ Back to Resource Groups'),
  ]));
  host.append(
    el('h2', {}, resourceGroup),
    el('div', { class: 'subtitle' }, `Resource group inside ${decodeURIComponent(entityId)}`)
  );

  const data = await api.resourceGroup({ entity: entityId, resourceGroup });

  const s = data.summary;
  const t = scoreTier(s.resiliencyScore);
  host.append(el('div', { class: 'grid cols-5' }, [
    kpi('Resources', fmt.n(s.total)),
    kpi('Score', s.resiliencyScore == null ? '—' : s.resiliencyScore + '/100', `${fmt.n(s.inScope)} in-scope`),
    kpi('High',   fmt.n(s.tierCounts.HIGH),   fmt.pct(s.highPct)),
    kpi('Medium', fmt.n(s.tierCounts.MEDIUM), fmt.pct(s.mediumPct)),
    kpi('Low (at risk)', fmt.n(s.tierCounts.LOW), fmt.pct(s.lowPct)),
  ]));

  // ---- VM groups section --------------------------------------------------
  if (data.clusters.length) {
    host.append(el('h3', {}, `VM Groups (${data.clusters.length})`));
    const panel = el('div', { class: 'panel', style: { padding: '0' } });
    for (const c of data.clusters) {
      const t = GROUP_TIER[c.status] || 'NA';
      const header = el('div', {
        style: { display: 'flex', gap: '14px', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)' },
      }, [
        el('span', { class: `badge ${t}` }, c.status),
        el('b', {}, c.stem),
        el('span', { class: 'muted' }, `${c.memberCount} VMs`),
        el('span', { class: 'pill' }, `Zones: ${c.zonesCovered.length ? c.zonesCovered.join(', ') : '—'}`),
        el('span', { class: 'muted' }, c.statusLabel),
      ]);
      const memTable = el('table');
      memTable.innerHTML = `
        <thead><tr>
          <th>VM Name</th><th>Zone(s)</th><th>SKU</th>
          <th>resiliencyconfig</th><th>resiliencydetail</th>
        </tr></thead>`;
      const memBody = el('tbody');
      for (const m of c.members) {
        memBody.append(el('tr', {}, [
          el('td', {}, [el('b', {}, m.name)]),
          el('td', {}, m.zones || el('span', { class: 'muted' }, '—')),
          el('td', {}, m.sku || '—'),
          el('td', {}, m.resiliencyconfig || el('span', { class: 'muted' }, '—')),
          el('td', {}, m.resiliencydetail || el('span', { class: 'muted' }, '—')),
        ]));
      }
      memTable.append(memBody);
      const wrap = el('div', { class: 'table-wrap', style: { maxHeight: '260px', border: 'none', borderRadius: '0' } }, memTable);
      panel.append(header, wrap);
    }
    host.append(panel);
  }

  // ---- All resources in this RG --------------------------------------------
  host.append(el('h3', {}, `All Resources (${data.resources.length})`));
  const tableWrap = el('div', { class: 'table-wrap' });
  const table = el('table');
  table.innerHTML = `
    <thead><tr>
      <th>Name</th><th>Type</th><th>Location</th><th>Zones</th>
      <th>SKU</th><th>resiliencyconfig</th><th>resiliencydetail</th><th>Tier</th>
    </tr></thead>`;
  const tbody = el('tbody');
  for (const r of data.resources) {
    tbody.append(el('tr', {}, [
      el('td', {}, [el('b', {}, r.name || '—')]),
      el('td', {}, (r.resourceType || '').replace(/^Microsoft\./, '')),
      el('td', {}, r.location || '—'),
      el('td', {}, r.zones || el('span', { class: 'muted' }, '—')),
      el('td', {}, r.sku || '—'),
      el('td', {}, r.resiliencyConfig || el('span', { class: 'muted' }, '—')),
      el('td', {}, r.resiliencyDetail || el('span', { class: 'muted' }, '—')),
      el('td', {}, [tierBadge(r.tier)]),
    ]));
  }
  table.append(tbody);
  tableWrap.append(table);
  host.append(tableWrap);
}

function qs() { /* deprecated — kept for potential future use */ return ''; }

export default { render };
