#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export class ParseError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

const SUMMARY_KEYS = ['kind', 'member', 'lane', 'status', 'validation_gate', 'commits', 'decisions', 'blocked_reason'];
const NEEDS_KEYS = ['kind', 'member', 'reason', 'question', 'deliberation', 'options', 'fork_key', 'blast_radius'];
const DECISION_KEYS = ['decision', 'options', 'chosen', 'rationale', 'rejected', 'fork_key', 'supersedes'];
const LANES = new Set(['doc-layer', 'simple', 'complex']);
const REASONS = new Set(['design-approval', 'bounded-effort-exceeded', 'catch-all']);
const isReason = (r) => REASONS.has(r) || /^floor:/.test(r);

function fencedKindBlocks(text) {
  const blocks = [];
  const re = /```json\s*([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let obj;
    try { obj = JSON.parse(m[1].trim()); } catch { obj = { __malformed: true }; }
    if (obj && obj.__malformed) blocks.push({ malformed: true });
    else if (obj && typeof obj === 'object' && 'kind' in obj) blocks.push({ obj });
  }
  return blocks;
}

function rejectUnknown(obj, allowed, where) {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) throw new ParseError('schema', `${where}: unknown key "${k}"`);
}

export function parseMemberOutput(text) {
  const blocks = fencedKindBlocks(text);
  if (blocks.length === 0) {
    // distinguish malformed-only from truly-none: was there a ```json fence at all?
    if (/```json/.test(text)) throw new ParseError('malformed', 'a ```json block was present but unparseable');
    throw new ParseError('none', 'no kind-bearing json payload found');
  }
  const malformed = blocks.filter((b) => b.malformed);
  const good = blocks.filter((b) => b.obj);
  if (good.length === 0) throw new ParseError('malformed', 'json payload present but unparseable');
  // Operative = the LAST kind-bearing block. Ambiguous only if the last two good blocks disagree on kind.
  if (good.length >= 2) {
    const last = good[good.length - 1].obj.kind;
    const prev = good[good.length - 2].obj.kind;
    if (last !== prev && [last, prev].every((k) => k === 'member-summary' || k === 'needs-decision'))
      throw new ParseError('ambiguous', `two different operative kinds: ${prev} vs ${last}`);
  }
  const obj = good[good.length - 1].obj;
  if (obj.kind === 'needs-decision') return validateNeeds(obj);
  if (obj.kind === 'member-summary') return validateSummary(obj);
  throw new ParseError('schema', `unknown kind "${obj.kind}"`);
}

function validateNeeds(o) {
  rejectUnknown(o, NEEDS_KEYS, 'needs-decision');
  if (typeof o.member !== 'string' || !o.member) throw new ParseError('schema', 'needs-decision.member required');
  if (!isReason(o.reason)) throw new ParseError('schema', `needs-decision.reason invalid: ${o.reason}`);
  if (typeof o.question !== 'string' || !o.question) throw new ParseError('schema', 'needs-decision.question required');
  if (!Array.isArray(o.options) || o.options.length === 0) throw new ParseError('schema', 'needs-decision.options required');
  if (typeof o.fork_key !== 'string' || !o.fork_key) throw new ParseError('schema', 'needs-decision.fork_key required');
  return o;
}

function validateSummary(o) {
  rejectUnknown(o, SUMMARY_KEYS, 'member-summary');
  if (typeof o.member !== 'string' || !o.member) throw new ParseError('schema', 'member-summary.member required');
  if (!LANES.has(o.lane)) throw new ParseError('schema', `member-summary.lane invalid: ${o.lane}`);
  if (o.status !== 'shipped' && o.status !== 'blocked') throw new ParseError('schema', `member-summary.status invalid: ${o.status}`);
  if (typeof o.validation_gate !== 'string') throw new ParseError('schema', 'member-summary.validation_gate required');
  if (!Array.isArray(o.commits)) throw new ParseError('schema', 'member-summary.commits required');
  if (!Array.isArray(o.decisions)) throw new ParseError('schema', 'member-summary.decisions required');
  for (const d of o.decisions) {
    rejectUnknown(d, DECISION_KEYS, 'decision');
    if (typeof d.fork_key !== 'string' || !d.fork_key) throw new ParseError('schema', 'decision.fork_key required');
  }
  if (o.status === 'blocked' && (typeof o.blocked_reason !== 'string' || !o.blocked_reason)) o.blocked_reason = 'unspecified';
  return o;
}

function main() {
  const [cmd, file] = process.argv.slice(2);
  if (cmd !== 'parse' || !file) { console.error('Usage: member-summary.mjs parse <file>'); process.exit(3); }
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) { console.error(`cannot read ${file}: ${e.message}`); process.exit(3); }
  let r;
  try { r = parseMemberOutput(text); }
  catch (e) { console.error(`parse-failure [${e.code ?? 'error'}]: ${e.message}`); process.exit(3); }
  console.log(JSON.stringify(r, null, 2));
  if (r.kind === 'needs-decision') process.exit(0);
  process.exit(r.status === 'blocked' ? 2 : 1);
}

if (import.meta.url === `file://${process.argv[1]}` || fileURLToPath(import.meta.url) === process.argv[1]) main();
