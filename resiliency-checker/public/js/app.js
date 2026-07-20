// Router + view registry — add a view by dropping a module in js/views/ and
// registering it here. Everything else (nav rendering, active state) is automatic.
import { api } from './api.js';
import { globalFilter } from './globalFilter.js';
import overview from './views/overview.js';
import entity from './views/entity.js';
import explorer from './views/explorer.js';
import services from './views/services.js';
import compare from './views/compare.js';
import resourceGroups from './views/resource-groups.js';
import vmGroups from './views/vm-groups.js';
import progress from './views/progress.js';
import exclusionsView from './views/exclusions.js';
import settings from './views/settings.js';

const VIEWS = [
  { id: 'overview',        label: 'Executive Overview',  module: overview },
  { id: 'entity',          label: 'Entity Deep Dive',    module: entity   },
  { id: 'progress',        label: 'Progress',            module: progress },
  { id: 'services',        label: 'Service View',        module: services },
  { id: 'resource-groups', label: 'Resource Groups',     module: resourceGroups },
  { id: 'vm-groups',       label: 'VM Groups',           module: vmGroups },
  { id: 'explorer',        label: 'Resource Explorer',   module: explorer },
  { id: 'compare',         label: 'Compare Entities',    module: compare  },
  { id: 'exclusions',      label: 'Exclusions',          module: exclusionsView },
  { id: 'settings',        label: 'Settings',            module: settings },
];

const nav = document.getElementById('nav');
const viewHost = document.getElementById('view');
const metaEl = document.getElementById('meta');
const prodToggle = document.getElementById('prodToggle');
const prodBanner = document.getElementById('prodBanner');
const prodBannerDismiss = document.getElementById('prodBannerDismiss');

function applyProdUi(state) {
  prodToggle.checked = !!state.prodOnly;
  prodBanner.hidden = !state.prodOnly;
}

function renderNav(activeId) {
  nav.innerHTML = '';
  for (const v of VIEWS) {
    const a = document.createElement('a');
    a.href = `#/${v.id}`;
    a.textContent = v.label;
    if (v.id === activeId) a.className = 'active';
    nav.appendChild(a);
  }
}

async function refreshMeta() {
  try {
    const [m, ps] = await Promise.all([api.meta(), api.prodStats()]);
    const g = globalFilter.get();
    const prodBit = g.prodOnly
      ? ` · prod-only: ${ps.prod.toLocaleString()} of ${ps.total.toLocaleString()} resources`
      : ` · ${ps.prod.toLocaleString()} prod / ${ps.nonprod.toLocaleString()} non-prod / ${ps.unknown.toLocaleString()} unknown`;
    metaEl.textContent = `${m.entityCount} entities · ${m.rowCount.toLocaleString()} resources${prodBit} · loaded ${new Date(m.loadedAt).toLocaleTimeString()}`;
    // Footer path
    const dr = document.getElementById('dataRootFooter');
    if (dr && m.dataRoot) {
      dr.textContent = m.dataRoot.path;
      dr.title = `Source: ${m.dataRoot.source}`;
    }
  } catch (e) {
    metaEl.textContent = 'API offline';
  }
}

async function route() {
  const hash = location.hash.replace(/^#\/?/, '') || 'overview';
  const [id, ...rest] = hash.split('/');
  const view = VIEWS.find(v => v.id === id) || VIEWS[0];
  renderNav(view.id);
  viewHost.innerHTML = '';
  try {
    await view.module.render(viewHost, rest);
  } catch (e) {
    console.error(e);
    viewHost.innerHTML = `<div class="panel"><h4>View failed to load</h4><pre>${e.stack || e.message}</pre></div>`;
  }
  refreshMeta();
}

document.getElementById('refreshBtn').addEventListener('click', async () => {
  await api.refresh();
  await refreshMeta();
  route();
});

// Prod toggle wiring
applyProdUi(globalFilter.get());
prodToggle.addEventListener('change', () => {
  globalFilter.set({ prodOnly: prodToggle.checked });
});
prodBannerDismiss.addEventListener('click', (e) => {
  e.preventDefault();
  globalFilter.set({ prodOnly: false });
});
globalFilter.subscribe(state => {
  applyProdUi(state);
  route(); // re-render current view under new filter
});

window.addEventListener('hashchange', route);
route();
