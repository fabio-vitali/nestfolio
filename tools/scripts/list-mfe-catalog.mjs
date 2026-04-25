#!/usr/bin/env node
// Prints services/investor/investor-web/src/mfe-catalog.ts as JSON
// suitable for jq consumption by deploy.sh.
//
// Usage: node tools/scripts/list-mfe-catalog.mjs
// Output (one JSON array on stdout):
//   [{"key":"investor","service":"investor-bff","hasFacade":true}, ...]
//
// Why a separate helper instead of importing the .ts at deploy time:
// deploy.sh runs in bash before any ts-node bootstrap; node + a regex
// extraction is faster + has zero deps.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const catalogPath = join(here, '..', '..', 'services', 'investor', 'investor-web', 'src', 'mfe-catalog.ts');
const source = readFileSync(catalogPath, 'utf-8');

// The catalog is a simple `as const` array of object literals. We extract
// the key/service/hasFacade triples. If anyone adds fields, the script
// keeps working as long as these three remain.
const re = /\{\s*key:\s*'([^']+)'[^}]*service:\s*'([^']+)'[^}]*hasFacade:\s*(true|false)\s*[^}]*\}/g;
const entries = [];
for (const m of source.matchAll(re)) {
  entries.push({ key: m[1], service: m[2], hasFacade: m[3] === 'true' });
}

if (entries.length === 0) {
  console.error(`list-mfe-catalog: no entries found in ${catalogPath}`);
  process.exit(1);
}

process.stdout.write(JSON.stringify(entries));
