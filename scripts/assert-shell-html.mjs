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
const polyfills = [...html.matchAll(/<script\s+type="module"\s+src="(polyfills-[^"]+\.js)"\s*>/g)];
if (polyfills.length !== 1) {
  fail('rule-1', `expected 1 <script type="module" src="polyfills-*.js">, found ${polyfills.length}`);
}

// Rule 2 — exactly one main.js as type="module-shim"
const mainShim = [...html.matchAll(/<script\s+type="module-shim"\s+src="(main-[^"]+\.js)"\s*>/g)];
if (mainShim.length !== 1) {
  fail('rule-2', `expected 1 <script type="module-shim" src="main-*.js">, found ${mainShim.length}`);
}

// Rule 3 — exactly one esms-options inline script with valid JSON body
const esmsTags = [...html.matchAll(/<script\s+type="esms-options"\s*>([^<]*)<\/script>/g)];
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

// Rule 5 — shell only: sha256(esms body) matches the CSP script-src hash token
if (kind === 'shell') {
  const cspMatch = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
  if (!cspMatch) fail('rule-5', 'no <meta http-equiv="Content-Security-Policy"> tag found');
  const hashToken = cspMatch[1].match(/script-src[^;]*'sha256-([A-Za-z0-9+/=]+)'/);
  if (!hashToken) fail('rule-5', `no sha256-<hash> token in script-src: ${cspMatch[1]}`);
  const expected = createHash('sha256').update(esmsBody).digest('base64');
  if (hashToken[1] !== expected) {
    fail('rule-5', `CSP hash mismatch — meta has 'sha256-${hashToken[1]}', sha256(esms-body) is 'sha256-${expected}'`);
  }
}

console.log(`assert-shell-html (${kind}) OK: all rules passed for ${distDir}/index.html`);
