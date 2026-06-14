#!/usr/bin/env node
// check-service-card-drift.mjs — deterministic CLAUDE.md service-card-drift gate.
//
// Renders the machine-derivable card sections from each service's
// service.stack.ts + domain/events.ts (via the typescript compiler AST) and
// enforces that the committed card matches. `--fix` rewrites the blocks.
// Prose/intent sections are LLM-owned and never touched (the tool only ever
// reads/writes between its own `card-drift:*` markers).
//
// Mirrors tools/check-read-model-drift.mjs: exported pure functions, an
// exclusion registry, node:test tmpdir tests, an nx target + pre-commit hook.
//
// Usage: node tools/check-service-card-drift.mjs [--root <dir>] [--fix]

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const SECTION_IDS = ['event-types', 'ingress', 'egress', 'handlers', 'ddb-entities'];

const EXCLUSIONS_FILE = 'tools/service-card-exclusions.json';
const EXCLUDE_DIR_FRAGMENTS = ['node_modules', 'dist', 'cdk.out', '.nx', '.worktrees', 'coverage', 'test'];

function parseArgs(argv) {
  let root = process.cwd();
  let fix = false;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--root') root = argv[++i];
    else if (argv[i] === '--fix') fix = true;
  }
  return { root, fix };
}

// Parse the exclusion registry → Set of "service::section" (or "service::*").
// Absent file → empty. Malformed entries throw.
export function parseExclusions(root) {
  let raw;
  try { raw = readFileSync(join(root, EXCLUSIONS_FILE), 'utf8'); }
  catch { return { exclusions: new Set(), entries: [] }; }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { throw new Error(`${EXCLUSIONS_FILE}: invalid JSON — ${e.message}`); }
  const entries = Array.isArray(parsed) ? parsed : (parsed.exclusions ?? []);
  const exclusions = new Set();
  for (const e of entries) {
    const ok = e && typeof e.service === 'string' && e.service &&
      typeof e.reason === 'string' && e.reason.trim() &&
      (e.section === undefined || (typeof e.section === 'string' && SECTION_IDS.includes(e.section)));
    if (!ok) throw new Error(`${EXCLUSIONS_FILE}: each entry needs {service, reason} with optional section ∈ ${SECTION_IDS.join('|')} — bad entry: ${JSON.stringify(e)}`);
    exclusions.add(`${e.service}::${e.section ?? '*'}`);
  }
  return { exclusions, entries };
}

export function isExcluded(exclusions, service, section) {
  return exclusions.has(`${service}::*`) || exclusions.has(`${service}::${section}`);
}
