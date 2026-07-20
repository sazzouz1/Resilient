// Small reusable UI helpers used across all views.

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'style') Object.assign(node.style, v);
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function kpi(label, value, sub) {
  return el('div', { class: 'panel kpi' }, [
    el('div', { class: 'label' }, label),
    el('div', { class: 'value' }, String(value ?? '—')),
    sub ? el('div', { class: 'sub' }, sub) : null,
  ]);
}

export function tierBadge(tier) {
  return el('span', { class: `badge ${tier}` }, tier);
}

export function scoreBar(score, tier = 'HIGH') {
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score));
  const wrap = el('div', { class: 'score-bar' });
  wrap.append(el('span', { class: `score-fill-${tier}`, style: { width: pct + '%' } }));
  return wrap;
}

const NUM = new Intl.NumberFormat('en-US');
export const fmt = {
  n: (v) => v == null ? '—' : NUM.format(v),
  pct: (v) => v == null ? '—' : `${v}%`,
};

// Score → tier bucket for coloring
export function scoreTier(score) {
  if (score == null) return 'NA';
  if (score >= 80) return 'HIGH';
  if (score >= 50) return 'MEDIUM';
  return 'LOW';
}

// Chart.js dark defaults
export function chartOpts(overrides = {}) {
  return Object.assign({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#e6ecff', font: { size: 11 } } },
    },
    scales: {
      x: { ticks: { color: '#8fa0c8', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
      y: { ticks: { color: '#8fa0c8', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
    },
  }, overrides);
}

export const TIER_COLORS = {
  HIGH:   '#34c58a',
  MEDIUM: '#f0b84a',
  LOW:    '#ef5b6b',
  NA:     '#6c7794',
};

// -------- Modal dialog ------------------------------------------------------
// Returns a promise: resolves with the collected values on Confirm, resolves
// with null on Cancel. `fields` is an array of { key, label, type, placeholder, value, required }.
export function modal({ title, description, fields = [], confirmText = 'Confirm', cancelText = 'Cancel' }) {
  return new Promise(resolve => {
    const overlay = el('div', { class: 'modal-overlay' });
    const box = el('div', { class: 'modal' });
    box.append(el('h3', {}, title));
    if (description) box.append(el('p', { class: 'muted' }, description));

    const inputs = {};
    for (const f of fields) {
      const label = el('label', { class: 'modal-label' }, f.label);
      let input;
      if (f.type === 'textarea') {
        input = el('textarea', { rows: 4, placeholder: f.placeholder || '', value: f.value || '' });
      } else {
        input = el('input', { type: f.type || 'text', placeholder: f.placeholder || '', value: f.value || '' });
      }
      inputs[f.key] = input;
      box.append(label, input);
    }

    const err = el('div', { class: 'modal-err' });
    const cancelBtn = el('button', { class: 'btn ghost' }, cancelText);
    const okBtn = el('button', { class: 'btn' }, confirmText);
    box.append(err, el('div', { class: 'modal-actions' }, [cancelBtn, okBtn]));
    overlay.append(box);
    document.body.append(overlay);

    // Focus first input
    setTimeout(() => Object.values(inputs)[0]?.focus(), 30);

    function close(value) {
      overlay.remove();
      resolve(value);
    }
    cancelBtn.addEventListener('click', () => close(null));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    okBtn.addEventListener('click', () => {
      const values = {};
      for (const f of fields) {
        const v = (inputs[f.key].value || '').trim();
        if (f.required && !v) {
          err.textContent = `${f.label} is required.`;
          inputs[f.key].focus();
          return;
        }
        values[f.key] = v;
      }
      close(values);
    });
  });
}

export function toast(message, type = 'info') {
  const node = el('div', { class: `toast toast-${type}` }, message);
  document.body.append(node);
  setTimeout(() => node.classList.add('show'), 10);
  setTimeout(() => {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 300);
  }, 2600);
}
