#!/usr/bin/env node
// fs-walk.mjs — house-convention file discovery (no glob lib). Lists *.yaml under a dir (one level;
// the check library is flat per §11). Absent dir → []. Pure, no side effects on import.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export function listYamlFiles({ dir }) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return []; }                 // absent dir tolerated (tmpdir-friendly)
  return entries
    .filter((e) => e.isFile() && (e.name.endsWith('.yaml') || e.name.endsWith('.yml')))
    .map((e) => join(dir, e.name))
    .sort();                           // stable order for deterministic tests
}
