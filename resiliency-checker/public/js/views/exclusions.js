// Exclusions view — manage manually-excluded resources with audit trail.
import { api } from '../api.js';
import { el, fmt, toast } from '../ui.js';

async function render(host) {
  host.append(
    el('h2', {}, 'Exclusions'),
    el('div', { class: 'subtitle' }, 'Resources manually excluded from scoring, with justification and audit trail. Excluded resources are tiered as N/A and do not affect any resiliency score.')
  );

  const out = el('div');
  host.append(out);

  async function refresh() {
    out.innerHTML = 'Loading…';
    const data = await api.exclusions();
    out.innerHTML = '';

    out.append(el('div', { class: 'panel tight' }, [
      el('b', {}, fmt.n(data.count)), ' resource', data.count === 1 ? '' : 's', ' currently excluded from scoring.',
    ]));

    if (!data.count) {
      out.append(el('div', { class: 'panel', style: { marginTop: '10px' } },
        'No exclusions yet. Use the ✕ Exclude button on any resource in the Entity Deep Dive or Resource Explorer to add one.'));
      return;
    }

    const tw = el('div', { class: 'table-wrap', style: { marginTop: '10px' } });
    const t = el('table');
    t.innerHTML = `
      <thead><tr>
        <th>Entity</th><th>Resource name</th><th>Type</th><th>Resource Group</th>
        <th>Justification</th><th>Added by</th><th>Added at</th><th>Action</th>
      </tr></thead>`;
    const b = el('tbody');
    for (const e of data.exclusions) {
      const removeBtn = el('button', { class: 'icon-btn', title: 'Remove exclusion' }, '↺ Un-exclude');
      removeBtn.addEventListener('click', async () => {
        const ok = confirm(`Un-exclude "${e.resourceName || e.resourceId}"? It will be scored normally again.`);
        if (!ok) return;
        const result = await api.removeExclusion(e.resourceId);
        if (result.ok) { toast('Removed', 'ok'); refresh(); }
        else toast('Failed', 'error');
      });
      b.append(el('tr', {}, [
        el('td', {}, e.entity || '—'),
        el('td', {}, [el('b', {}, e.resourceName || el('code', {}, e.resourceId))]),
        el('td', {}, (e.resourceType || '').replace(/^Microsoft\./, '')),
        el('td', {}, e.resourceGroup || '—'),
        el('td', {}, e.justification || '—'),
        el('td', {}, e.addedBy || '—'),
        el('td', {}, e.addedAt ? new Date(e.addedAt).toLocaleString() : '—'),
        el('td', {}, [removeBtn]),
      ]));
    }
    t.append(b);
    tw.append(t);
    out.append(tw);
  }

  refresh();
}

export default { render };
