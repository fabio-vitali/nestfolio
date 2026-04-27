#!/usr/bin/env node
// build-prod-manifest.mjs — emit production federation.manifest.json
// from MFE_CATALOG. Maps each <mfe-name> to /mfe/<key>/remoteEntry.json
// (CloudFront-relative paths discovered via the unified topology — see
// charter §7 R6).
//
// Usage:
//   node tools/scripts/build-prod-manifest.mjs --out <path>
//
// MFE_CATALOG is read via the existing list-mfe-catalog.mjs helper. The
// mapping <mfe-name> ↔ <key> is mechanical: <key>-mfe.

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const catalogScript = join(here, 'list-mfe-catalog.mjs');

function parseArgs(argv) {
  let out = null;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--out') out = argv[++i];
    else if (argv[i].startsWith('--out=')) out = argv[i].slice('--out='.length);
  }
  if (!out) {
    console.error('build-prod-manifest: --out <path> is required');
    process.exit(2);
  }
  return { out };
}

function readCatalog() {
  const r = spawnSync('node', [catalogScript], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`build-prod-manifest: failed to read MFE catalog: ${r.stderr || r.stdout}`);
    process.exit(1);
  }
  return JSON.parse(r.stdout);
}

function buildManifest(catalog) {
  const manifest = {};
  for (const entry of catalog) {
    const mfeName = `${entry.key}-mfe`;
    manifest[mfeName] = `/mfe/${entry.key}/remoteEntry.json`;
  }
  return manifest;
}

function main() {
  const { out } = parseArgs(process.argv);
  const catalog = readCatalog();
  const manifest = buildManifest(catalog);
  // Two-space indent + trailing newline — matches the committed dev manifest.
  const text = JSON.stringify(manifest, null, 2) + '\n';
  writeFileSync(out, text, 'utf8');
  console.log(`build-prod-manifest: wrote ${Object.keys(manifest).length} entries to ${out}`);
}

main();
