// Resource Explorer — free-form slicing across all entities.
// Includes a column chooser so users can toggle which fields are visible.
import { api } from '../api.js';
import { el, tierBadge, fmt, multiSelect } from '../ui.js';

// -------- Column registry ----------------------------------------------------
// Each column: { key, label, default, render(row) -> DOM node or string }
const COLUMNS = [
  { key: 'entity',           label: 'Entity',            default: true,
    render: r => r.entity },
  { key: 'name',             label: 'Name',              default: true,
    render: r => el('b', {}, r.name || '—') },
  { key: 'resourceType',     label: 'Type',              default: true,
    render: r => (r.resourceType || '').replace(/^Microsoft\./, '') },
  { key: 'location',         label: 'Location',          default: true,
    render: r => r.location || '—' },
  { key: 'resourceGroup',    label: 'Resource Group',    default: true,
    render: r => r.resourceGroup || '—' },
  { key: 'subscription',     label: 'Subscription',      default: false,
    render: r => r.subscription || '—' },
  { key: 'zones',            label: 'Zones',             default: true,
    render: r => r.zones || el('span', { class: 'muted' }, '—') },
  { key: 'sku',              label: 'SKU',               default: true,
    render: r => r.sku || '—' },
  { key: 'kind',             label: 'Kind',              default: false,
    render: r => r.kind || '—' },
  { key: 'resiliencyConfig', label: 'resiliencyconfig',  default: true,
    render: r => r.resiliencyConfig || el('span', { class: 'muted' }, '—') },
  { key: 'resiliencyDetail', label: 'resiliencydetail',  default: true,
    render: r => r.resiliencyDetail || el('span', { class: 'muted' }, '—') },
  { key: 'tier',             label: 'Tier',              default: true,
    render: r => tierBadge(r.tier) },
  { key: 'score',            label: 'Score',             default: false,
    render: r => r.score == null ? el('span', { class: 'muted' }, '—') : String(r.score) },
  { key: 'configLabel',      label: 'Config Label',      default: false,
    render: r => r.configLabel || '—' },
  { key: 'environment',      label: 'Environment (tag)', default: false,
    render: r => r.environment || el('span', { class: 'muted' }, '—') },
  { key: 'application',      label: 'Application',       default: false,
    render: r => r.application || el('span', { class: 'muted' }, '—') },
  { key: 'assetClassification', label: 'Asset Classification', default: false,
    render: r => r.assetClassification || el('span', { class: 'muted' }, '—') },
  { key: 'businessUnit',     label: 'Business Unit',     default: false,
    render: r => r.businessUnit || el('span', { class: 'muted' }, '—') },
  { key: 'prodClass',        label: 'Prod Class',        default: false,
    render: r => el('span', { class: 'pill', title: `Source: ${r.prodSource || 'n/a'}` }, r.prodClass || '—') },
  { key: 'backupDetails',    label: 'Backup',            default: false,
    render: r => r.backupDetails || el('span', { class: 'muted' }, '—') },
  { key: 'lastBackup',       label: 'Last Backup',       default: false,
    render: r => r.lastBackup || el('span', { class: 'muted' }, '—') },
  { key: 'asrDetails',       label: 'ASR Details',       default: false,
    render: r => r.asrDetails || el('span', { class: 'muted' }, '—') },
  { key: 'diskAttachedTo',   label: 'Disk → VM',         default: false,
    render: r => r.diskAttachedTo || el('span', { class: 'muted' }, '—') },
  { key: 'clusterStatus',    label: 'VM Group Status', default: false,
    render: r => r.clusterStatus
      ? el('span', { class: `badge ${({ GOOD: 'HIGH', PARTIAL: 'MEDIUM', BAD: 'LOW', MISSING: 'LOW', STANDALONE: 'NA' })[r.clusterStatus]}` }, r.clusterStatus)
      : el('span', { class: 'muted' }, '—') },
  { key: 'clusterStem',      label: 'Group Role',      default: false,
    render: r => r.clusterStem || el('span', { class: 'muted' }, '—') },
  { key: 'clusterZonesCovered', label: 'Group Zones', default: false,
    render: r => r.clusterZonesCovered || el('span', { class: 'muted' }, '—') },
  { key: 'reportDate',       label: 'Report Date',       default: false,
    render: r => r.reportDate || '—' },
  { key: 'resourceId',       label: 'Resource ID',       default: false,
    render: r => el('span', { class: 'muted', style: { fontSize: '11px' } }, r.resourceId || '—') },
];

const COL_PREFS_KEY = 'rc.explorer.cols.v2';

function loadColPrefs() {
  try {
    const stored = JSON.parse(localStorage.getItem(COL_PREFS_KEY));
    if (stored && typeof stored === 'object') {
      const out = {};
      for (const c of COLUMNS) out[c.key] = stored[c.key] ?? c.default;
      return out;
    }
  } catch {}
  const out = {};
  for (const c of COLUMNS) out[c.key] = c.default;
  return out;
}
function saveColPrefs(prefs) { localStorage.setItem(COL_PREFS_KEY, JSON.stringify(prefs)); }

// -------- View state ---------------------------------------------------------
const state = {
  entity: '', resourceType: '', location: '', environment: '', tier: '', search: '',
  prodClass: '', subscription: [], page: 0, pageSize: 200, cols: loadColPrefs(),
};

async function render(host, params = []) {
  if (params[0]) state.resourceType = decodeURIComponent(params[0]);

  host.append(
    el('h2', {}, 'Resource Explorer'),
    el('div', { class: 'subtitle' }, 'Slice-and-dice every assessed resource across all entities. Use the Columns button to pick what to show.')
  );

  const toolbar = el('div', { class: 'toolbar panel tight' });
  host.append(toolbar);

  const resultsPanel = el('div');
  host.append(resultsPanel);

  // Controls are created empty; their options are (re)populated by
  // updateFacetOptions() so every filter narrows the others (cascading facets).
  const entitySel = el('select', {});
  const typeSel = el('select', {});
  const locSel = el('select', {});
  const envSel = el('select', {});
  const tierSel = el('select', {}, [
    el('option', { value: '' }, 'All Tiers'),
    ...['HIGH', 'MEDIUM', 'LOW', 'NA'].map(t => el('option', { value: t, ...(t === state.tier ? { selected: 'true' } : {}) }, t)),
  ]);
  const prodClassSel = el('select', {}, [
    el('option', { value: '' }, 'Any Prod Class'),
    ...['prod', 'nonprod', 'unknown'].map(v =>
      el('option', { value: v, ...(v === state.prodClass ? { selected: 'true' } : {}) }, v)),
  ]);
  const searchInput = el('input', { type: 'text', placeholder: 'Search name / RG / app…', value: state.search });

  // Subscription MULTI-select (empty = all subscriptions)
  const subMs = multiSelect({
    options: [],
    selected: state.subscription,
    allLabel: 'All Subscriptions',
    noun: 'subscriptions',
    onClose: () => { state.subscription = subMs.getValues(); applyFilterChange(); },
  });

  // Repopulate a native <select>, preserving the current value even if it now
  // has 0 matches under the other filters (so the user can still clear it).
  function fillSelect(sel, placeholder, options, currentVal) {
    sel.innerHTML = '';
    sel.append(el('option', { value: '' }, placeholder));
    const seen = new Set();
    for (const o of options) {
      sel.append(el('option', { value: o.value }, `${o.label} (${fmt.n(o.count)})`));
      seen.add(o.value);
    }
    if (currentVal && !seen.has(currentVal)) sel.append(el('option', { value: currentVal }, `${currentVal} (0)`));
    sel.value = currentVal || '';
  }

  const colBtn = el('button', { class: 'btn ghost' }, 'Columns ▾');
  const colPanel = el('div', { class: 'col-panel', hidden: 'true' });
  for (const c of COLUMNS) {
    const cb = el('input', { type: 'checkbox', ...(state.cols[c.key] ? { checked: 'true' } : {}) });
    cb.addEventListener('change', () => {
      state.cols[c.key] = cb.checked;
      saveColPrefs(state.cols);
      renderResults();
    });
    colPanel.append(el('label', {}, [cb, ' ', c.label]));
  }
  const colWrap = el('div', { class: 'col-picker' }, [colBtn, colPanel]);
  colBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    colPanel.hidden = !colPanel.hidden;
  });
  document.addEventListener('click', () => { colPanel.hidden = true; });
  colPanel.addEventListener('click', e => e.stopPropagation());

  toolbar.append(
    el('label', {}, 'Entity'), entitySel,
    el('label', {}, 'Type'), typeSel,
    el('label', {}, 'Location'), locSel,
    el('label', {}, 'Env'), envSel,
    el('label', {}, 'Subscription'), subMs.el,
    el('label', {}, 'Tier'), tierSel,
    el('label', {}, 'Prod'), prodClassSel,
    searchInput,
    el('button', {
      class: 'btn ghost',
      onclick: () => {
        state.entity = state.resourceType = state.location = state.environment = state.tier = state.prodClass = state.search = '';
        state.subscription = [];
        state.page = 0;
        entitySel.value = typeSel.value = locSel.value = envSel.value = tierSel.value = prodClassSel.value = '';
        searchInput.value = '';
        subMs.setValues([]);
        applyFilterChange();
      },
    }, 'Reset'),
    el('span', { class: 'spacer' }),
    colWrap,
    el('button', { class: 'btn', onclick: () => exportCsv() }, 'Export CSV'),
  );

  function currentFilters() {
    return {
      entity: state.entity, resourceType: state.resourceType, location: state.location,
      environment: state.environment, tier: state.tier, search: state.search,
      prodClass: state.prodClass,
      ...(state.subscription.length ? { subscription: state.subscription.join(',') } : {}),
    };
  }

  function syncStateFromControls() {
    state.entity = entitySel.value;
    state.resourceType = typeSel.value;
    state.location = locSel.value;
    state.environment = envSel.value;
    state.tier = tierSel.value;
    state.prodClass = prodClassSel.value;
    state.search = searchInput.value.trim();
    // subscription is maintained by the multi-select's onClose handler
  }

  const omitKey = (obj, key) => { const o = { ...obj }; delete o[key]; return o; };

  // Cascading facets: each filter's option list is computed from ALL the OTHER
  // active filters (its own value is excluded so it never collapses to one option).
  async function updateFacetOptions() {
    const base = currentFilters();
    const [ents, fType, fLoc, fEnv, fSub] = await Promise.all([
      api.entities(omitKey(base, 'entity')),
      api.facets(omitKey(base, 'resourceType')),
      api.facets(omitKey(base, 'location')),
      api.facets(omitKey(base, 'environment')),
      api.facets(omitKey(base, 'subscription')),
    ]);
    fillSelect(entitySel, 'All Entities',
      ents.map(e => ({ value: e.id, label: e.displayName, count: e.total })), state.entity);
    fillSelect(typeSel, 'All Resource Types',
      fType.resourceTypes.map(x => ({ value: x.name, label: x.name.replace(/^Microsoft\./, ''), count: x.count })), state.resourceType);
    fillSelect(locSel, 'All Locations',
      fLoc.locations.map(x => ({ value: x.name, label: x.name || '(blank)', count: x.count })), state.location);
    fillSelect(envSel, 'All Environments',
      fEnv.environments.map(x => ({ value: x.name, label: x.name || '(blank)', count: x.count })), state.environment);
    subMs.setOptions(
      (fSub.subscriptions || []).map(x => ({ value: x.name, label: `${x.name || '(blank)'} (${fmt.n(x.count)})` })), true);
  }

  async function renderResults() {
    resultsPanel.innerHTML = '';
    const [summary, pageData] = await Promise.all([
      api.summary(currentFilters()),
      api.resources({ ...currentFilters(), page: state.page, pageSize: state.pageSize }),
    ]);

    resultsPanel.append(el('div', {
      class: 'panel tight',
      style: { marginTop: '14px', marginBottom: '10px', display: 'flex', gap: '20px', flexWrap: 'wrap' },
    }, [
      el('div', {}, [el('b', {}, fmt.n(pageData.total)), ' matching resources']),
      el('div', { class: 'muted' }, ['Score: ', el('b', {}, summary.resiliencyScore == null ? '—' : String(summary.resiliencyScore))]),
      el('div', {}, [
        tierBadge('HIGH'), ' ', fmt.n(summary.tierCounts.HIGH), ' · ',
        tierBadge('MEDIUM'), ' ', fmt.n(summary.tierCounts.MEDIUM), ' · ',
        tierBadge('LOW'), ' ', fmt.n(summary.tierCounts.LOW), ' · ',
        tierBadge('NA'), ' ', fmt.n(summary.tierCounts.NA),
      ]),
    ]));

    const activeCols = COLUMNS.filter(c => state.cols[c.key]);
    const tableWrap = el('div', { class: 'table-wrap' });
    const table = el('table');
    const thead = el('thead');
    const trHead = el('tr');
    for (const c of activeCols) trHead.append(el('th', {}, c.label));
    thead.append(trHead);
    table.append(thead);

    const tbody = el('tbody');
    for (const r of pageData.rows) {
      const tr = el('tr', {
        onclick: () => location.hash = `#/resource-groups/${encodeURIComponent(r.entityId)}/${encodeURIComponent(r.resourceGroup)}`,
      });
      for (const c of activeCols) {
        const cell = el('td', {});
        const val = c.render(r);
        if (val instanceof Node) cell.append(val);
        else cell.textContent = val ?? '';
        tr.append(cell);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    tableWrap.append(table);
    resultsPanel.append(tableWrap);

    const totalPages = Math.ceil(pageData.total / state.pageSize) || 1;
    resultsPanel.append(el('div', { class: 'toolbar', style: { marginTop: '10px' } }, [
      el('button', {
        class: 'btn ghost',
        onclick: () => { if (state.page > 0) { state.page--; renderResults(); } },
      }, '‹ Prev'),
      el('span', { class: 'muted' }, `Page ${state.page + 1} / ${totalPages}`),
      el('button', {
        class: 'btn ghost',
        onclick: () => { if (state.page + 1 < totalPages) { state.page++; renderResults(); } },
      }, 'Next ›'),
    ]));
  }

  // Any filter change: sync state, reset paging, recompute cascading options, re-query.
  async function applyFilterChange() {
    syncStateFromControls();
    state.page = 0;
    await updateFacetOptions();
    await renderResults();
  }

  async function exportCsv() {
    const data = await api.resources({ ...currentFilters(), page: 0, pageSize: 100000 });
    const activeCols = COLUMNS.filter(c => state.cols[c.key]);
    const PLACEHOLDER = '\u2014'; // em-dash used on screen to mark a blank cell
    const cellText = (r, c) => {
      const val = c.render(r);
      let s = (val instanceof Node) ? val.textContent : (val == null ? '' : String(val));
      if (s.trim() === PLACEHOLDER) s = ''; // export UI blank markers as truly empty
      return s;
    };
    // RFC 4180 quoting: only quote when needed, and double any embedded quotes.
    const csvCell = (s) => (/[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
    const header = activeCols.map(c => csvCell(c.label)).join(',');
    const csv = [header].concat(
      data.rows.map(r => activeCols.map(c => csvCell(cellText(r, c))).join(','))
    ).join('\r\n');
    // Prepend a UTF-8 BOM so Excel decodes unicode correctly (fixes the "â€"" glitch).
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `resiliency-explorer-${Date.now()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  for (const s of [entitySel, typeSel, locSel, envSel, tierSel, prodClassSel]) {
    s.addEventListener('change', () => { applyFilterChange(); });
  }
  let searchDebounce = 0;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => applyFilterChange(), 250);
  });

  await updateFacetOptions();
  await renderResults();
}

export default { render };
