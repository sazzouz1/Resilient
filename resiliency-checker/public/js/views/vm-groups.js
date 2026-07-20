// VM Groups view — cross-government scan for VMs that share a role stem
// (e.g. vm-app01/02/03) and their AZ spread. Called "groups" to avoid
// confusion with real Azure clusters (AKS, HDInsight, VMSS, etc.).
import { api } from '../api.js';
import { el, kpi, fmt } from '../ui.js';

const GROUP_TIER = { GOOD: 'HIGH', PARTIAL: 'MEDIUM', BAD: 'LOW', MISSING: 'LOW' };
const state = { entity: '', status: '' };

function badge(status, label) {
  const t = GROUP_TIER[status] || 'NA';
  return el('span', { class: `badge ${t}`, title: label || status }, status);
}

async function render(host) {
  host.append(
    el('h2', {}, 'VM Groups — Zone Check'),
    el('div', { class: 'subtitle' }, 'Detects VMs that share a role (e.g. vm-app01/02/03) and checks whether the group is spread across 3 Availability Zones. Independent of any Azure “cluster” resource (AKS, HDInsight, VMSS).')
  );

  const entities = await api.entities();
  const entitySel = el('select', {}, [
    el('option', { value: '' }, 'All Entities'),
    ...entities.map(e => el('option', { value: e.id }, e.displayName)),
  ]);
  const statusSel = el('select', {}, ['', 'BAD', 'MISSING', 'PARTIAL', 'GOOD'].map(s =>
    el('option', { value: s }, s || 'All Statuses')
  ));

  host.append(el('div', { class: 'toolbar panel tight' }, [
    el('label', {}, 'Entity'), entitySel,
    el('label', {}, 'Status'), statusSel,
  ]));

  const out = el('div');
  host.append(out);

  async function refresh() {
    state.entity = entitySel.value;
    state.status = statusSel.value;
    out.innerHTML = 'Loading…';
    const data = await api.vmGroups({ entity: state.entity });
    let groups = data.clusters;
    if (state.status) groups = groups.filter(c => c.status === state.status);
    out.innerHTML = '';

    out.append(el('div', { class: 'grid cols-5', style: { marginTop: '10px' } }, [
      kpi('Groups', fmt.n(data.stats.total)),
      kpi('BAD (single AZ)', fmt.n(data.stats.BAD)),
      kpi('MISSING (no zones)', fmt.n(data.stats.MISSING)),
      kpi('PARTIAL (2 AZ)', fmt.n(data.stats.PARTIAL)),
      kpi('GOOD (3 AZ)', fmt.n(data.stats.GOOD)),
    ]));

    out.append(el('div', { class: 'panel tight', style: { marginTop: '10px' } },
      `${fmt.n(groups.length)} groups shown`));

    for (const c of groups.slice(0, 200)) {
      const t = GROUP_TIER[c.status] || 'NA';
      const panel = el('div', { class: 'panel', style: { marginTop: '10px', padding: '0' } });
      panel.append(el('div', {
        style: { display: 'flex', gap: '14px', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)', cursor: 'pointer' },
        onclick: () => location.hash = `#/resource-groups/${encodeURIComponent(c.entityId)}/${encodeURIComponent(c.resourceGroup)}`,
      }, [
        el('span', { class: `badge ${t}` }, c.status),
        el('b', {}, c.stem),
        el('span', { class: 'muted' }, `${c.memberCount} VMs`),
        el('span', { class: 'pill' }, c.entity),
        el('span', { class: 'muted' }, c.resourceGroup),
        el('span', { class: 'spacer' }),
        el('span', { class: 'muted' }, c.statusLabel),
      ]));
      const table = el('table');
      table.innerHTML = `
        <thead><tr>
          <th>VM Name</th><th>Zone(s)</th><th>SKU</th>
          <th>resiliencyconfig</th><th>resiliencydetail</th>
        </tr></thead>`;
      const tbody = el('tbody');
      for (const m of c.members) {
        tbody.append(el('tr', {}, [
          el('td', {}, [el('b', {}, m.name)]),
          el('td', {}, m.zones || el('span', { class: 'muted' }, '—')),
          el('td', {}, m.sku || '—'),
          el('td', {}, m.resiliencyconfig || el('span', { class: 'muted' }, '—')),
          el('td', {}, m.resiliencydetail || el('span', { class: 'muted' }, '—')),
        ]));
      }
      table.append(tbody);
      panel.append(el('div', { class: 'table-wrap', style: { maxHeight: '240px', border: 'none', borderRadius: '0' } }, table));
      out.append(panel);
    }
    if (groups.length > 200) {
      out.append(el('div', { class: 'muted', style: { marginTop: '10px' } },
        `Showing first 200 of ${fmt.n(groups.length)} — narrow with Entity or Status filter.`));
    }
  }

  entitySel.addEventListener('change', refresh);
  statusSel.addEventListener('change', refresh);
  refresh();
}

export default { render };
