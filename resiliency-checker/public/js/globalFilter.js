// Global filter state — persisted to localStorage so it survives reloads.
// Currently controls the "Production only" toggle; extendable for future globals.

const KEY = 'rc.globalFilter.v1';

function load() {
  try { return { prodOnly: false, ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; }
  catch { return { prodOnly: false }; }
}

let state = load();
const subscribers = new Set();

function save() { localStorage.setItem(KEY, JSON.stringify(state)); }

export const globalFilter = {
  get() { return { ...state }; },
  set(patch) {
    state = { ...state, ...patch };
    save();
    subscribers.forEach(fn => fn(state));
  },
  subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
  // Params to append to every API request.
  toQuery() {
    const q = {};
    if (state.prodOnly) q.prodOnly = 'true';
    return q;
  },
};
