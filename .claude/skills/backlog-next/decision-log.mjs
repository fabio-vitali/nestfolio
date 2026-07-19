#!/usr/bin/env node
/**
 * Append-only decision log for backlog workstreams — the durable, committed replacement for the
 * epic run-state's ephemeral decisions[] (which lived in .git/ and died at the post-merge tail).
 *
 * Entries live in a `## Decision log` section of docs/backlog/<id>.md — the canonical workstream
 * record — so the trail survives /clear, crashes, AND the merge (it ships with the work). Used by:
 *   - /backlog-next standalone --auto  (its own item file)
 *   - /backlog-next epic-member mode   (the member's file)
 *   - /backlog-next-epic orchestrator  (the epic's file, for orchestrator-level decisions)
 *
 * APPEND-ONLY by construction (F-6): this helper only ever inserts a new entry at the end of the
 * section — there is no edit/remove path. A reversal is a NEW entry referencing the superseded one.
 *
 * Entry closed schema (F-12): { decision, options[], chosen, rationale, rejected? } — the file
 * identifies the workstream, so there is no `member` key.
 *
 * CLI:
 *   node decision-log.mjs append <id>            entry JSON on stdin
 *   node decision-log.mjs render <id> [<id>...]  aggregated markdown for PR bodies
 * Exit codes: 0 ok · 1 usage/validation · 2 backlog file missing.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SECTION_HEADING = '## Decision log';
export const ENTRY_KEYS = ['decision', 'options', 'chosen', 'rationale', 'rejected'];
const REQUIRED_KEYS = ['decision', 'options', 'chosen', 'rationale'];
const PREAMBLE = '<!-- append-only (F-6): entries are never edited or removed; a reversal is a NEW entry referencing the superseded one. Written by decision-log.mjs — do not hand-edit. -->';

export function validateEntry(entry) {
  if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('entry must be a JSON object');
  const allowed = new Set(ENTRY_KEYS);
  for (const k of Object.keys(entry)) {
    if (!allowed.has(k)) throw new Error(`unknown entry key "${k}" — closed schema is {${ENTRY_KEYS.join(', ')}}; the file identifies the workstream, so there is no member key`);
  }
  for (const k of REQUIRED_KEYS) {
    if (k === 'options') continue;
    if (typeof entry[k] !== 'string' || !entry[k].trim()) throw new Error(`entry.${k} must be a non-empty string`);
  }
  if (!Array.isArray(entry.options) || entry.options.length === 0 || !entry.options.every((o) => typeof o === 'string' && o.trim())) {
    throw new Error('entry.options must be a non-empty array of strings');
  }
  if ('rejected' in entry && (typeof entry.rejected !== 'string' || !entry.rejected.trim())) {
    throw new Error('entry.rejected, when present, must be a non-empty string');
  }
  return entry;
}

/** Local (not UTC) calendar date as YYYY-MM-DD — an evening-CET append must stamp today's local
 * date, not the UTC date, which is still yesterday until 00:00 UTC. */
export function localDateStamp(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatEntry(entry, n, isoDate) {
  const lines = [
    `### D${n} — ${isoDate}`,
    `- **Decision:** ${entry.decision}`,
    `- **Options:** ${entry.options.join(' | ')}`,
    `- **Chosen:** ${entry.chosen}`,
    `- **Rationale:** ${entry.rationale}`,
  ];
  if (entry.rejected) lines.push(`- **Rejected:** ${entry.rejected}`);
  return lines.join('\n') + '\n';
}

/** Locate the section [start, end) in md; end is the offset of the next `\n## ` or md.length. */
function sectionBounds(md) {
  const start = md.indexOf(`${SECTION_HEADING}\n`);
  if (start === -1) return null;
  const next = md.indexOf('\n## ', start + SECTION_HEADING.length);
  return { start, end: next === -1 ? md.length : next + 1 };
}

/** Append one validated entry; creates the section (at EOF) on first use. Returns the new md. */
export function appendEntry(md, entry, isoDate) {
  validateEntry(entry);
  let bounds = sectionBounds(md);
  if (!bounds) {
    md = md.replace(/\n*$/, '\n\n') + `${SECTION_HEADING}\n\n${PREAMBLE}\n\n`;
    bounds = { start: md.indexOf(`${SECTION_HEADING}\n`), end: md.length };
  }
  const section = md.slice(bounds.start, bounds.end);
  const n = (section.match(/^### D\d+ — /gm) ?? []).length + 1;
  const insertion = section.replace(/\n*$/, '\n\n') + formatEntry(entry, n, isoDate);
  return md.slice(0, bounds.start) + insertion + md.slice(bounds.end);
}

/** The section body (entries only, heading + preamble stripped), or null if absent. */
export function renderEntries(md) {
  const bounds = sectionBounds(md);
  if (!bounds) return null;
  return md.slice(bounds.start + SECTION_HEADING.length, bounds.end).replace(PREAMBLE, '').trim() || null;
}

// ---- CLI -------------------------------------------------------------------

function backlogPath(id) {
  const root = execSync('git rev-parse --show-toplevel').toString().trim();
  return `${root}/docs/backlog/${id}.md`;
}

function main() {
  const [cmd, ...ids] = process.argv.slice(2);
  if (!cmd || ids.length === 0) {
    console.error('Usage: decision-log.mjs <append <id> | render <id> [<id>...]>');
    process.exit(1);
  }
  if (cmd === 'append') {
    const path = backlogPath(ids[0]);
    if (!existsSync(path)) { console.error(`backlog file not found: ${path}`); process.exit(2); }
    let entry;
    try { entry = JSON.parse(readFileSync(0, 'utf8')); } catch (e) { console.error(`stdin is not valid JSON: ${e.message}`); process.exit(1); }
    try {
      writeFileSync(path, appendEntry(readFileSync(path, 'utf8'), entry, localDateStamp()));
    } catch (e) { console.error(e.message); process.exit(1); }
    console.log(`decision appended to ${path}`);
  } else if (cmd === 'render') {
    const out = [];
    for (const id of ids) {
      const path = backlogPath(id);
      const body = existsSync(path) ? renderEntries(readFileSync(path, 'utf8')) : null;
      out.push(`#### ${id}\n\n${body ?? '_no decisions auto-resolved_'}`);
    }
    console.log(out.join('\n\n'));
  } else {
    console.error(`unknown command: ${cmd}`); process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
