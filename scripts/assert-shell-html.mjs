#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const distDir = args.find((a) => !a.startsWith('--'));
const kindArg = args.find((a) => a.startsWith('--kind='));
const kind = kindArg ? kindArg.slice('--kind='.length) : null;

if (!distDir || !kind || !['shell', 'mfe'].includes(kind)) {
  console.error('Usage: assert-shell-html.mjs <dist-dir> --kind=<shell|mfe>');
  process.exit(2);
}

const fail = (rule, msg) => {
  console.error(`assert-shell-html (${kind}) ${rule} FAILED: ${msg}`);
  process.exit(1);
};

let html;
try {
  html = readFileSync(join(distDir, 'index.html'), 'utf8');
} catch (e) {
  fail('preflight', `cannot read ${join(distDir, 'index.html')}: ${e.message}`);
}

// Rule 1 — exactly one polyfills.js as type="module"
const polyfills = [...html.matchAll(/<script\s+type="module"\s+src="(polyfills-[^"]+\.js)"\s*><\/script>/g)];
if (polyfills.length !== 1) {
  fail('rule-1', `expected 1 <script type="module" src="polyfills-*.js">, found ${polyfills.length}`);
}

// Rule 2 — exactly one main.js as type="module-shim"
const mainShim = [...html.matchAll(/<script\s+type="module-shim"\s+src="(main-[^"]+\.js)"\s*><\/script>/g)];
if (mainShim.length !== 1) {
  fail('rule-2', `expected 1 <script type="module-shim" src="main-*.js">, found ${mainShim.length}`);
}

// Rule 3 — exactly one esms-options inline script with valid JSON body
const esmsTags = [...html.matchAll(/<script\s+type="esms-options"\s*>([\s\S]*?)<\/script>/g)];
if (esmsTags.length !== 1) {
  fail('rule-3', `expected 1 <script type="esms-options">, found ${esmsTags.length}`);
}
const esmsBody = esmsTags[0][1];
let esmsParsed;
try {
  esmsParsed = JSON.parse(esmsBody);
} catch (e) {
  fail('rule-3', `esms-options body is not valid JSON: ${e.message}`);
}

// Rule 4 — esms-options body equals {"shimMode":true}
if (JSON.stringify(esmsParsed) !== '{"shimMode":true}') {
  fail('rule-4', `esms-options body must equal {"shimMode":true}, got ${JSON.stringify(esmsParsed)}`);
}

// Rule 5 — shell only: CSP script-src must contain
//   (a) sha256(esms-options body) — the federation runtime <script type="esms-options"> body
//   (b) sha256("this.media='all'") — the Angular CLI stylesheet-preload onload handler
//   (c) sha256-wmGp6DJKu9FEjYplt1pD5S9HnB97ZkkEVu1HdQQTp90= — es-module-shims feature-detect #1
//       (runtime-injected by polyfills, runs in detection iframes)
//   (d) sha256-izTwo107zhmJU/OGynC9oqY8cpGias3IQEYVLua+oWc= — es-module-shims feature-detect #2
//       (runtime-injected during the same probe sequence)
//   (e) the 'unsafe-hashes' keyword — required for sha256 to apply to event handlers
//   (f) the blob: keyword — Native Federation loads remote MFE chunks via blob: URLs
const ESMS_FEATURE_DETECT_HASH_1 = 'wmGp6DJKu9FEjYplt1pD5S9HnB97ZkkEVu1HdQQTp90=';
const ESMS_FEATURE_DETECT_HASH_2 = 'izTwo107zhmJU/OGynC9oqY8cpGias3IQEYVLua+oWc=';
if (kind === 'shell') {
  const cspMatch = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
  if (!cspMatch) fail('rule-5', 'no <meta http-equiv="Content-Security-Policy"> tag found');
  const csp = cspMatch[1];
  const scriptSrcMatch = csp.match(/script-src([^;]+)/);
  if (!scriptSrcMatch) fail('rule-5', `no script-src directive: ${csp}`);
  const scriptSrc = scriptSrcMatch[1];

  const hashTokens = [...scriptSrc.matchAll(/'sha256-([A-Za-z0-9+/=]+)'/g)].map(m => m[1]);

  const expectedEsmsHash = createHash('sha256').update(esmsBody).digest('base64');
  if (!hashTokens.includes(expectedEsmsHash)) {
    fail('rule-5a', `script-src missing sha256 of esms-options body — expected 'sha256-${expectedEsmsHash}', script-src has: ${hashTokens.map(h => `'sha256-${h}'`).join(', ') || '(none)'}`);
  }

  const expectedOnloadHash = createHash('sha256').update("this.media='all'").digest('base64');
  if (!hashTokens.includes(expectedOnloadHash)) {
    fail('rule-5b', `script-src missing sha256 of Angular preload onload handler — expected 'sha256-${expectedOnloadHash}' (sha256 of "this.media='all'"), script-src has: ${hashTokens.map(h => `'sha256-${h}'`).join(', ') || '(none)'}`);
  }

  if (!hashTokens.includes(ESMS_FEATURE_DETECT_HASH_1)) {
    fail('rule-5c', `script-src missing es-module-shims feature-detect hash #1 — expected 'sha256-${ESMS_FEATURE_DETECT_HASH_1}', script-src has: ${hashTokens.map(h => `'sha256-${h}'`).join(', ') || '(none)'}`);
  }

  if (!hashTokens.includes(ESMS_FEATURE_DETECT_HASH_2)) {
    fail('rule-5d', `script-src missing es-module-shims feature-detect hash #2 — expected 'sha256-${ESMS_FEATURE_DETECT_HASH_2}', script-src has: ${hashTokens.map(h => `'sha256-${h}'`).join(', ') || '(none)'}`);
  }

  if (!/'unsafe-hashes'/.test(scriptSrc)) {
    fail('rule-5e', `script-src must include 'unsafe-hashes' keyword (required for sha256 hashes to apply to inline event handlers)`);
  }

  if (!/\bblob:/.test(scriptSrc)) {
    fail('rule-5f', `script-src must include 'blob:' keyword (Native Federation loads remote MFE chunks via blob: URLs)`);
  }

  // Rule 5g — meta-tag CSP must NOT include frame-ancestors (browsers ignore it
  // there and emit a console warning). The CloudFront ResponseHeadersPolicy
  // delivers frame-ancestors via the response header, where it is effective.
  if (/frame-ancestors\b/.test(csp)) {
    fail('rule-5g', `meta-tag CSP must NOT include frame-ancestors (ignored in <meta>; delivered via CloudFront ResponseHeadersPolicy header instead)`);
  }
}

console.log(`assert-shell-html (${kind}) OK: all rules passed for ${distDir}/index.html`);
