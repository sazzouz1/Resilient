// Zero-dep HTTP server + tiny router. Handles static files under /public
// and JSON API endpoints registered via `router.get/post`.
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

function makeRouter() {
  const handlers = { GET: [], POST: [] };
  return {
    get:  (pattern, fn) => handlers.GET.push({ pattern, fn }),
    post: (pattern, fn) => handlers.POST.push({ pattern, fn }),
    match(method, pathname) {
      for (const h of handlers[method] || []) {
        const params = matchPattern(h.pattern, pathname);
        if (params) return { fn: h.fn, params };
      }
      return null;
    },
  };
}

function matchPattern(pattern, pathname) {
  // Simple: exact string match. (No path params needed for our API.)
  return pattern === pathname ? {} : null;
}

function sendJson(res, obj, status = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function serveStatic(rootDir, pathname, res) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(rootDir, decodeURIComponent(rel));
  if (!filePath.startsWith(rootDir)) { res.writeHead(403); res.end(); return; }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // Dev-friendly: force browsers to revalidate on every load so code edits are visible.
      'Cache-Control': 'no-cache, must-revalidate',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function createServer({ router, staticDir }) {
  return http.createServer(async (req, res) => {
    try {
      const parsed = url.parse(req.url, true);
      const pathname = parsed.pathname;

      if (pathname.startsWith('/api/')) {
        const match = router.match(req.method, pathname);
        if (!match) { sendJson(res, { error: 'Not found' }, 404); return; }
        const body = await readBody(req);
        const result = await match.fn({ query: parsed.query, body, params: match.params });
        sendJson(res, result);
        return;
      }

      if (req.method === 'GET') serveStatic(staticDir, pathname, res);
      else { res.writeHead(405); res.end('Method not allowed'); }
    } catch (err) {
      console.error('[server] error handling', req.url, err);
      sendJson(res, { error: err.message }, 500);
    }
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET') return resolve(null);
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      if (!data) return resolve(null);
      try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
    });
    req.on('error', reject);
  });
}

module.exports = { makeRouter, createServer };
