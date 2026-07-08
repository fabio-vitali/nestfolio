// runtime/engine/lib/journal.mjs — the git-native, append-only, keyed NDJSON journal (§5).
// Ring-1: git is universal infrastructure, NOT a harness primitive. Two backings share one contract:
// makeJournal({root}) (persistent) + inMemoryJournal() (tests/headless). Resume = replay: a 'complete'
// step short-circuits (fn NOT re-invoked); a torn tail line is dropped (crash-safe, generalizes F-11).
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, appendFileSync, writeFileSync, renameSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { validateStepRecord, validateRunMeta } from '../schema/journal.schema.ts';
import { JournalWriterConflict } from './errors.mjs';

const isoNow = () => new Date().toISOString();

export const PAUSE = '<<HARNESS-PAUSE>>';

/** Re-freeze 2026-07-03: a paused TaskResult (status 'paused' + a Decision) — step() parks it. */
export function isPaused(v) { return v?.status === 'paused' && typeof v?.decision?.id === 'string'; }

/** Resolve the git-common-dir (cwd-independent, shared across worktrees) — the runstate.mjs form. */
export function gitCommonDir(exec = (c) => execSync(c, { encoding: 'utf8' })) {
  return exec('git rev-parse --path-format=absolute --git-common-dir').trim().replace(/\/$/, '');
}

/** Parse an NDJSON step-ledger line-by-line; a torn/invalid line is DROPPED (tail-heal, §5). */
function parseSteps(text) {
  const steps = new Map();
  for (const line of text.split('\n')) {
    if (!line.length) continue;
    let parsed;
    try { parsed = JSON.parse(line); } catch { continue; }   // torn line → drop
    const v = validateStepRecord(parsed);
    if (!v.ok) continue;                                       // malformed record → drop
    steps.set(v.value.key, v.value);                           // last-write-wins per key
  }
  return steps;
}

/** The one contract, over an injected storage backing. */
function makeBacking({ readMeta, writeMeta, readSteps, appendStep }) {
  return {
    begin(runId, meta) {
      const v = validateRunMeta(meta);
      if (!v.ok) throw new Error(`journal.begin: invalid RunMeta: ${v.error}`);
      if (readMeta(runId) == null) writeMeta(runId, v.value);   // idempotent: existing run → NOOP
    },
    async step(runId, key, fn, strategy = 'keyed-effect') {
      if (strategy === 'pure-rederive') return await fn();       // never ledgered — replay is free
      const existing = readSteps(runId).get(key);
      if (existing?.status === 'complete') return existing.value; // REPLAY — fn NOT invoked (incl. a fulfilled park)
      const value = await fn();                                   // execute (an awaiting record does NOT short-circuit)
      if (isPaused(value)) {                                      // PARK-not-complete: replay re-invokes until fulfilled
        appendStep(runId, { key, status: 'awaiting', decision: value.decision, ts: isoNow() });
        return value;
      }
      appendStep(runId, { key, status: 'complete', value, ts: isoNow() });
      return value;
    },
    record(runId, key, value) { appendStep(runId, { key, status: 'complete', value, ts: isoNow() }); },
    read(runId) {
      const meta = readMeta(runId);
      if (meta == null) return null;                             // FRESH
      return { meta, steps: readSteps(runId) };
    },
    awaiting(runId, key, decision) { appendStep(runId, { key, status: 'awaiting', decision, ts: isoNow() }); },
    fulfil(runId, key, choice) { appendStep(runId, { key, status: 'complete', value: choice, ts: isoNow() }); },
  };
}

/** Git-native persistent journal. root defaults to <git-common-dir>; tests pass a temp root. */
export function makeJournal({ root = gitCommonDir(), lease } = {}) {
  const me = { pid: process.pid, host: hostname(),
    alive: (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } }, ...lease };
  const runDir = (runId) => join(root, 'journal', runId);
  const metaPath = (runId) => join(runDir(runId), 'meta.json');
  const stepsPath = (runId) => join(runDir(runId), 'steps.ndjson');
  const leasePath = (runId) => join(runDir(runId), 'writer.json');
  // §5 single-writer per runId: the root is shared across worktrees, so every MUTATION asserts the
  // lease. Dead same-host holders are taken over (short-lived CLI writers chain); a live foreign pid
  // or any foreign host (liveness unverifiable) throws. Reads are lease-free.
  const acquireLease = (runId) => {
    mkdirSync(runDir(runId), { recursive: true });
    if (existsSync(leasePath(runId))) {
      let holder = null;
      try { holder = JSON.parse(readFileSync(leasePath(runId), 'utf8')); } catch { holder = null; } // torn → reclaim
      if (holder && holder.pid === me.pid && holder.host === me.host) return;
      if (holder && (holder.host !== me.host || me.alive(holder.pid))) throw new JournalWriterConflict(runId, holder);
    }
    writeFileSync(leasePath(runId), JSON.stringify({ pid: me.pid, host: me.host, acquired_at: isoNow() }, null, 2) + '\n');
  };
  return makeBacking({
    readMeta: (runId) => {
      if (!existsSync(metaPath(runId))) return null;
      try { return JSON.parse(readFileSync(metaPath(runId), 'utf8')); }
      catch { return null; }   // torn meta heals like the steps tail: treated as absent, begin() rewrites
    },
    writeMeta: (runId, meta) => {
      acquireLease(runId);
      writeFileSync(metaPath(runId) + '.tmp', JSON.stringify(meta, null, 2) + '\n');
      renameSync(metaPath(runId) + '.tmp', metaPath(runId));   // atomic on POSIX
    },
    readSteps: (runId) => (existsSync(stepsPath(runId)) ? parseSteps(readFileSync(stepsPath(runId), 'utf8')) : new Map()),
    appendStep: (runId, rec) => { acquireLease(runId); appendFileSync(stepsPath(runId), JSON.stringify(rec) + '\n'); },
  });
}

/** In-memory Journal (same contract) — tests + the headless backward-edge default. */
export function inMemoryJournal() {
  const metas = new Map();
  const lines = new Map();   // runId → StepRecord[]
  return makeBacking({
    readMeta: (runId) => metas.get(runId) ?? null,
    writeMeta: (runId, meta) => metas.set(runId, meta),
    readSteps: (runId) => { const m = new Map(); for (const r of lines.get(runId) ?? []) m.set(r.key, r); return m; },
    appendStep: (runId, rec) => { const a = lines.get(runId) ?? []; a.push(rec); lines.set(runId, a); },
  });
}

/** Every runId with a ledger under <root>/journal — the journal owns its own layout (§5).
 *  Read-only + lease-free; the operational surface (§14) derives floor-pending across these. */
export function listRunIds(root = gitCommonDir()) {
  const dir = join(root, 'journal');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
}

/** Awaiting records with no later completion (parseSteps is last-write-wins per key). */
export function pendingDecisions(ledger) {
  return ledger ? [...ledger.steps.values()].filter((r) => r.status === 'awaiting') : [];
}

/** Choice-shaped step completions — the spine threads these into Task.choices (pure-data resume). */
export function fulfilledChoices(ledger) {
  return ledger ? [...ledger.steps.values()]
    .filter((r) => r.status === 'complete' && typeof r.value?.decisionId === 'string' && 'value' in (r.value ?? {}))
    .map((r) => r.value) : [];
}

/** The journaled floor ask (§4.3): replay a fulfilled Choice; park a PAUSE; record only terminal answers.
 *  recordWhen(choice) false ⇒ the answer is a deferral (e.g. 'hold') — parked as awaiting, re-asked next wake. */
export async function askStep({ journal, runId, decision, ask, recordWhen = () => true }) {
  const existing = journal.read(runId)?.steps.get(decision.id);
  if (existing?.status === 'complete') return existing.value;   // fulfilled — never re-ask
  const choice = await ask(decision);
  if (choice.value === PAUSE) { journal.awaiting(runId, decision.id, decision); return null; }
  if (recordWhen(choice)) journal.fulfil(runId, decision.id, choice);
  else journal.awaiting(runId, decision.id, decision);
  return choice;
}

/** e2e-freshness helper (F-14). NOTE: journal.step is sha-AGNOSTIC — it short-circuits on ANY 'complete'
 *  record for a key, regardless of HEAD. e2e freshness is therefore a SEPARATE mechanism: F2 records the
 *  result via journal.record('e2e', {sha, green}) and gates re-runs with e2eIsFresh(ledger, HEAD) BEFORE
 *  deciding to re-run — a moved HEAD ⇒ stale ⇒ return to E6. Do NOT model e2e freshness as a step() replay. */
export function e2eIsFresh(ledger, headSha) {
  const rec = ledger?.steps?.get('e2e');
  return !!rec && rec.value?.sha === headSha;
}

/** HEAD sha (cwd-independent) — the freshness key for the epic-pre-done e2e batch (F-14, §5). */
export function gitHeadSha(exec = (c) => execSync(c, { encoding: 'utf8' })) {
  return exec('git rev-parse HEAD').trim();
}
