// Minimal CSV parser — handles the well-defined format the RelAZ_Assess script
// emits (RFC-4180 style: comma-separated, double-quoted fields, "" escapes).
// Deliberately dependency-free so the project runs with just Node.
function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }

    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') {
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = []; i++; continue;
    }
    field += ch; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];

  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => {
    const o = {};
    for (let j = 0; j < headers.length; j++) o[headers[j]] = (r[j] ?? '').trim();
    return o;
  });
}

module.exports = { parseCsv };
