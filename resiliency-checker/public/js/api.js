// Thin fetch wrapper — one place to change base URL / auth later.
// Automatically merges the app's global filter (e.g. `prodOnly`) into every request.
import { globalFilter } from './globalFilter.js';

const API = '/api';

async function j(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${url} -> ${res.status}`);
  return res.json();
}

function qs(params = {}) {
  const merged = { ...globalFilter.toQuery(), ...params };
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined && v !== null && v !== '') s.set(k, v);
  }
  const str = s.toString();
  return str ? `?${str}` : '';
}

export const api = {
  meta:            ()             => j(`${API}/meta`),
  prodStats:       ()             => j(`${API}/prod-stats`),
  entities:        (p = {})       => j(`${API}/entities${qs(p)}`),
  snapshots:       (p = {})       => j(`${API}/snapshots${qs(p)}`),
  progress:        (p = {})       => j(`${API}/progress${qs(p)}`),
  snapshotDiff:    (p = {})       => j(`${API}/snapshot-diff${qs(p)}`),
  summary:         (p = {})       => j(`${API}/summary${qs(p)}`),
  breakdown:       (p = {})       => j(`${API}/breakdown${qs(p)}`),
  facets:          (p = {})       => j(`${API}/facets${qs(p)}`),
  resources:       (p = {})       => j(`${API}/resources${qs(p)}`),
  resourceGroups:  (p = {})       => j(`${API}/resource-groups${qs(p)}`),
  resourceGroup:   (p = {})       => j(`${API}/resource-group${qs(p)}`),
  vmClusters:      (p = {})       => j(`${API}/vm-groups${qs(p)}`),
  vmGroups:        (p = {})       => j(`${API}/vm-groups${qs(p)}`),
  refresh:         ()             => fetch(`${API}/refresh`, { method: 'POST' }).then(r => r.json()),
  config:          ()             => j(`${API}/config`),
  saveConfig:      (body)         => fetch(`${API}/config`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }).then(r => r.json()),
  resetConfig:     ()             => fetch(`${API}/config/reset`, { method: 'POST' }).then(r => r.json()),
  exclusions:      ()             => j(`${API}/exclusions`),
  addExclusion:    (body)         => fetch(`${API}/exclusions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }).then(r => r.json()),
  removeExclusion: (resourceId)   => fetch(`${API}/exclusions/delete`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resourceId })
  }).then(r => r.json()),
  // Escape hatch for one-off endpoints; still applies global params.
  get:             (base, p = {}) => j(base + qs(p)),
};
