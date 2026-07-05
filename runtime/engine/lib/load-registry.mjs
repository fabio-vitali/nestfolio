#!/usr/bin/env node
// load-registry.mjs — loadRegistry(): parse + zod-validate every *.yaml under checksDir.
// Malformed/invalid files are LOCATED in errors[] (never crash); byId is Map<CheckId,CheckEntry>.
// Duplicate ids are a global-uniqueness error. CLI: exit 0 clean, 1 any error, 2 usage.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { listYamlFiles } from './fs-walk.mjs';
import { validateCheck } from '../schema/check.schema.ts';

/** @returns {{checks, byId: Map, errors: {file,error}[]}} */
export function loadRegistry({ checksDir }) {
  const checks = [];
  const byId = new Map();
  const errors = [];
  for (const file of listYamlFiles({ dir: checksDir })) {
    let raw;
    try { raw = parse(readFileSync(file, 'utf8')); }
    catch (e) { errors.push({ file, error: `malformed YAML: ${e.message}` }); continue; }
    const res = validateCheck(raw);
    if (!res.ok) { errors.push({ file, error: res.error }); continue; }
    if (byId.has(res.value.id)) { errors.push({ file, error: `duplicate id: ${res.value.id}` }); continue; }
    byId.set(res.value.id, res.value);
    checks.push(res.value);
  }
  return { checks, byId, errors };
}

/** Fail-closed helper for enforcement mains: located error lines, or null when the registry is clean. */
export function registryErrorLines(registry) {
  if (!registry.errors.length) return null;
  return registry.errors.map((e) => `  ✖ registry: ${e.file}: ${e.error}`);
}

function main() {
  const dirArg = process.argv.indexOf('--checks-dir');
  const checksDir = dirArg >= 0 ? process.argv[dirArg + 1] : undefined;
  if (!checksDir) { console.error('usage: load-registry.mjs --checks-dir <dir>'); process.exit(2); }
  const reg = loadRegistry({ checksDir });
  console.log(`loaded ${reg.checks.length} check(s), ${reg.errors.length} error(s)`);
  for (const e of reg.errors) console.error(`  ${e.file}: ${e.error}`);
  process.exit(reg.errors.length ? 1 : 0);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
