#!/usr/bin/env node
/**
 * Run-state helper for /backlog-next-epic — the epic's crash-recovery backbone.
 *
 * The run-state JSON at `<git-common-dir>/backlog-next-epic-<id>.json` is the ONLY
 * durable artifact a resume reads. It must never be hand-edited (a hand-written file
 * drifted its schema and emitted malformed JSON — F-11/F-12). Every read/write goes
 * through this helper: parse → mutate → JSON.stringify, validated against a CLOSED
 * schema, at a cwd-independent ABSOLUTE path.
 *
 * Closed schema (exactly these keys; anything else is rejected — F-12):
 *   epic       string   the epic id
 *   branch     string   feat/epic-<id>
 *   worktree   string   .claude/worktrees/epic-<id>
 *   auto       boolean  --auto run?
 *   decisions  array    append-only; ONE flat list, each entry tagged by `member`
 *   e2e        object|null  { commands, outcome, sha } — sha pins the validated HEAD (F-14)
 *   e8?        string   optional; only "PR_OPEN_AWAITING_MERGE" (the E8 hand-off marker)
 *
 * Member status is deliberately NOT stored — it is re-derived from member frontmatter
 * via epic-members.mjs (the single source of truth). Run-state only carries the run
 * marker, `auto`, the decision log, e2e evidence, and the e8 marker.
 *
 * CLI (read-modify-write is atomic per call; complex payloads come from stdin so the
 * caller never hand-crafts the raw FILE):
 *   node runstate.mjs path  <epic-id>                        → print absolute path
 *   node runstate.mjs get   <epic-id>                        → print state JSON (exit 0),
 *                                                              or "FRESH" (exit 3) if absent,
 *                                                              or a clean error (exit 2) if malformed
 *   node runstate.mjs init  <epic-id> --branch=B --worktree=W [--auto]
 *   node runstate.mjs append-decision <epic-id>  <stdin: decision object>
 *   node runstate.mjs set-e2e         <epic-id>  <stdin: e2e object or "null">
 *   node runstate.mjs set-e8          <epic-id> PR_OPEN_AWAITING_MERGE
 *   node runstate.mjs e2e-fresh       <epic-id>                        → exit 0 if e2e.sha === HEAD, else 1 (F-14)
 *
 * Exit codes: 0 ok · 1 usage/validation error / stale e2e · 2 malformed existing file · 3 absent (FRESH).
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const RUNSTATE_KEYS = ['epic', 'branch', 'worktree', 'auto', 'decisions', 'e2e'];
const OPTIONAL_KEYS = ['e8'];
export const E8_MARKER = 'PR_OPEN_AWAITING_MERGE';

/** Absolute, cwd-independent path to the run-state file (F-13). Uses the SAME
 * `--path-format=absolute --git-common-dir` form at every site, so a resume launched
 * from a worktree cwd resolves the identical path it was written to (never misclassifies
 * a RESUME as FRESH). The common-dir is shared across worktrees → one run-state per epic. */
export function runStatePath(epicId, exec = defaultExec) {
  const common = exec('git rev-parse --path-format=absolute --git-common-dir').trim();
  return `${common.replace(/\/$/, '')}/backlog-next-epic-${epicId}.json`;
}

function defaultExec(cmd) {
  return execSync(cmd).toString();
}

/** A fresh run-state object (E3). */
export function initRunState({ epic, branch, worktree, auto = false }) {
  return { epic, branch, worktree, auto: !!auto, decisions: [], e2e: null };
}

/** Validate against the closed schema. Returns the (same) object or throws a clear
 * Error naming the offending key — this is what blocks schema drift like the invented
 * `paused_at` / `ws3_decisions` (F-12). */
export function validateRunState(state) {
  if (state == null || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('run-state must be a JSON object');
  }
  const allowed = new Set([...RUNSTATE_KEYS, ...OPTIONAL_KEYS]);
  for (const k of Object.keys(state)) {
    if (!allowed.has(k)) {
      throw new Error(`unknown run-state key "${k}" — closed schema is {${RUNSTATE_KEYS.join(', ')}} (+ optional e8). Do NOT invent per-member arrays or paused_at; append decisions to the single decisions[] tagged by member.`);
    }
  }
  for (const k of RUNSTATE_KEYS) {
    if (!(k in state)) throw new Error(`missing required run-state key "${k}"`);
  }
  if (typeof state.epic !== 'string' || typeof state.branch !== 'string' || typeof state.worktree !== 'string') {
    throw new Error('epic/branch/worktree must be strings');
  }
  if (typeof state.auto !== 'boolean') throw new Error('auto must be a boolean');
  if (!Array.isArray(state.decisions)) throw new Error('decisions must be an array');
  if (state.e2e !== null && (typeof state.e2e !== 'object' || Array.isArray(state.e2e))) {
    throw new Error('e2e must be an object or null');
  }
  if ('e8' in state && state.e8 !== E8_MARKER) {
    throw new Error(`e8, when present, must be "${E8_MARKER}"`);
  }
  return state;
}

/** Parse run-state with a clean self-heal: never throw a raw SyntaxError stack at a
 * resume. Returns {ok:true, state} | {ok:false, error}. (F-11) */
export function parseRunState(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `malformed JSON: ${e.message}` };
  }
  try {
    validateRunState(parsed);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  return { ok: true, state: parsed };
}

/** Append ONE decision to the single decisions[] (append-only — never edit/remove a prior
 * entry; a reversal is a NEW entry referencing the superseded index). Each entry is tagged
 * by `member`. (F-12) */
export function appendDecision(state, decision) {
  if (decision == null || typeof decision !== 'object' || Array.isArray(decision)) {
    throw new Error('decision must be an object');
  }
  if (typeof decision.member !== 'string' || !decision.member) {
    throw new Error('decision.member (string) is required so the entry is attributable');
  }
  return { ...state, decisions: [...state.decisions, decision] };
}

/** Pin e2e evidence to the validated HEAD sha (F-14). */
export function setE2e(state, e2e) {
  return validateRunState({ ...state, e2e: e2e ?? null });
}

/** Whether recorded e2e evidence is still valid for `headSha` — a re-opened member moves
 * HEAD, so a stale e2e.sha must force a return to E6 before ship (F-14). */
export function e2eIsFresh(state, headSha) {
  return !!state.e2e && typeof state.e2e.sha === 'string' && state.e2e.sha === headSha;
}

/** Serialize canonically (pretty, trailing newline) — the ONLY way the file is written. */
export function serializeRunState(state) {
  return JSON.stringify(validateRunState(state), null, 2) + '\n';
}

// ---- CLI -------------------------------------------------------------------

function flag(args, name) {
  const pre = `--${name}=`;
  const hit = args.find((a) => a.startsWith(pre));
  return hit ? hit.slice(pre.length) : undefined;
}

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

function main() {
  const [cmd, epicId, ...rest] = process.argv.slice(2);
  if (!cmd || !epicId) {
    console.error('Usage: runstate.mjs <path|get|init|append-decision|set-e2e|set-e8> <epic-id> [...]');
    process.exit(1);
  }
  const path = runStatePath(epicId);

  const loadOrExit = () => {
    if (!existsSync(path)) { console.error(`run-state absent: ${path}`); process.exit(3); }
    const res = parseRunState(readFileSync(path, 'utf8'));
    if (!res.ok) { console.error(`run-state ${path} is unusable — ${res.error}\nFix or re-init; do NOT hand-edit.`); process.exit(2); }
    return res.state;
  };
  const save = (state) => writeFileSync(path, serializeRunState(state));

  switch (cmd) {
    case 'path':
      console.log(path); break;
    case 'get': {
      if (!existsSync(path)) { console.log('FRESH'); process.exit(3); }
      const res = parseRunState(readFileSync(path, 'utf8'));
      if (!res.ok) { console.error(`malformed run-state: ${res.error}`); process.exit(2); }
      console.log(JSON.stringify(res.state, null, 2)); break;
    }
    case 'init': {
      const state = initRunState({
        epic: epicId, branch: flag(rest, 'branch'), worktree: flag(rest, 'worktree'),
        auto: rest.includes('--auto'),
      });
      save(state);
      console.log(`initialized ${path}`); break;
    }
    case 'append-decision': {
      const decision = JSON.parse(readStdin());
      save(appendDecision(loadOrExit(), decision));
      console.log('decision appended'); break;
    }
    case 'set-e2e': {
      const raw = readStdin().trim();
      save(setE2e(loadOrExit(), raw === 'null' || raw === '' ? null : JSON.parse(raw)));
      console.log('e2e set'); break;
    }
    case 'set-e8': {
      const marker = rest[0];
      if (marker !== E8_MARKER) { console.error(`set-e8 expects "${E8_MARKER}"`); process.exit(1); }
      save(validateRunState({ ...loadOrExit(), e8: marker }));
      console.log('e8 marker set'); break;
    }
    case 'e2e-fresh': {
      const state = loadOrExit();
      const head = defaultExec('git rev-parse HEAD').trim();
      if (e2eIsFresh(state, head)) { console.log('e2e FRESH'); break; }
      console.error(`e2e STALE — recorded sha ${state.e2e?.sha ?? '(none)'} != HEAD ${head}; re-run E6`);
      process.exit(1);
    }
    default:
      console.error(`unknown command: ${cmd}`); process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
