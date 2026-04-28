#!/usr/bin/env node
// Tiny static file server with SPA fallback + CORS, used by Playwright's
// webServer array to serve each MFE's dist/ folder.
//
// When NF_E2E_PROXY_TARGET is set (e.g. dev CloudFront URL), `/graphql/*`
// and `/realtime/*` HTTP + WSS traffic is forwarded to that origin so the
// frontend's relative-URL Apollo client (Charter §7 R6) reaches AppSync
// the same way it does in production via CloudFront. Without the proxy,
// those paths fall through to the SPA index.html → "Unexpected token '<'".
//
// Usage: node tools/serve-mfe.mjs <dir> <port>

import { createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { stat, readFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';

const [, , dirArg, portArg] = process.argv;
if (!dirArg || !portArg) {
  console.error('Usage: serve-mfe.mjs <dir> <port>');
  process.exit(2);
}
const ROOT = resolve(dirArg);
const PORT = Number(portArg);
const PROXY_TARGET = process.env.NF_E2E_PROXY_TARGET || '';
const proxyOrigin = PROXY_TARGET ? new URL(PROXY_TARGET) : null;

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

function shouldProxy(pathname) {
  return pathname.startsWith('/graphql/') || pathname.startsWith('/realtime/');
}

function proxyHttp(req, res) {
  const opts = {
    method: req.method,
    hostname: proxyOrigin.hostname,
    port: proxyOrigin.port || 443,
    path: req.url,
    headers: { ...req.headers, host: proxyOrigin.hostname },
  };
  const upstream = httpsRequest(opts, (upRes) => {
    res.writeHead(upRes.statusCode || 502, upRes.headers);
    upRes.pipe(res);
  });
  upstream.on('error', (err) => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(`proxy http error: ${err.message}`);
  });
  req.pipe(upstream);
}

function proxyUpgrade(req, clientSocket, head) {
  const upstreamReq = httpsRequest({
    method: 'GET',
    hostname: proxyOrigin.hostname,
    port: proxyOrigin.port || 443,
    path: req.url,
    headers: { ...req.headers, host: proxyOrigin.hostname },
  });
  upstreamReq.on('upgrade', (upRes, upSocket, upHead) => {
    let header = `HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage}\r\n`;
    for (const [k, v] of Object.entries(upRes.headers)) {
      const value = Array.isArray(v) ? v.join(', ') : String(v);
      header += `${k}: ${value}\r\n`;
    }
    header += '\r\n';
    clientSocket.write(header);
    if (upHead?.length) clientSocket.write(upHead);
    upSocket.pipe(clientSocket);
    clientSocket.pipe(upSocket);
  });
  upstreamReq.on('error', () => clientSocket.destroy());
  clientSocket.on('error', () => upstreamReq.destroy());
  if (head?.length) upstreamReq.write(head);
  upstreamReq.end();
}

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
  if (proxyOrigin && shouldProxy(url.pathname)) {
    proxyHttp(req, res);
    return;
  }
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

if (proxyOrigin) {
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    console.log(`[serve-mfe] upgrade ${req.method} ${url.pathname}${url.search}`);
    if (shouldProxy(url.pathname)) {
      proxyUpgrade(req, socket, head);
    } else {
      socket.destroy();
    }
  });
}

server.listen(PORT, () => {
  console.log(
    `serve-mfe ${ROOT} on http://localhost:${PORT}` +
    (proxyOrigin ? ` (proxying /graphql/* and /realtime/* → ${proxyOrigin.origin})` : ''),
  );
});
