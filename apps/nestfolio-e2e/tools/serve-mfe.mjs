#!/usr/bin/env node
// Tiny static file server with SPA fallback + CORS, used by Playwright's
// webServer array to serve each MFE's dist/ folder.
//
// Replaces `pnpm exec http-server --proxy ...?` because http-server@14's
// proxy code uses the deprecated `util._extend` API and returns HTTP 431
// on Node 24. We need <50 lines of vanilla Node anyway.
//
// Usage: node tools/serve-mfe.mjs <dir> <port>

import { createServer } from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';

const [, , dirArg, portArg] = process.argv;
if (!dirArg || !portArg) {
  console.error('Usage: serve-mfe.mjs <dir> <port>');
  process.exit(2);
}
const ROOT = resolve(dirArg);
const PORT = Number(portArg);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

async function tryFile(path) {
  try {
    const s = await stat(path);
    if (s.isFile()) return { body: await readFile(path), path };
    if (s.isDirectory()) {
      const resolved = join(path, 'index.html');
      return { body: await readFile(resolved), path: resolved };
    }
  } catch {
    /* not found */
  }
  return null;
}

const server = createServer(async (req, res) => {
  const cors = {
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,HEAD,OPTIONS' });
    res.end();
    return;
  }
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const filePath = join(ROOT, decodeURIComponent(url.pathname));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, cors);
    res.end('Forbidden');
    return;
  }
  // Try the requested path first; fall back to /index.html for SPA routes.
  const hit = (await tryFile(filePath)) ?? (await tryFile(join(ROOT, 'index.html')));
  if (!hit) {
    res.writeHead(404, cors);
    res.end('Not found');
    return;
  }
  const ct = MIME[extname(hit.path).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { ...cors, 'content-type': ct });
  res.end(hit.body);
});

server.listen(PORT, () => {
  console.log(`serve-mfe ${ROOT} on http://localhost:${PORT}`);
});
