#!/usr/bin/env node
// runtime/adapters/claude-code/run-backward.mjs — the backward-edge floor driver (ring-2, §3.1).
// run-item.mjs's park/fulfil pattern verbatim: this process runs until the first unfulfilled floor park,
// prints the pending Decision (FULL §2.3 payload) and exits 3; the session surfaces the real
// AskUserQuestion and re-invokes with --fulfil <decision-id> --value '<choice-json>'; replay advances.
// Exit: 0 done / 3 parked / 1 refused-or-failed / 2 usage. runId 'backward' (one shared floor ledger).
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parse } from 'yaml';
import { runMint } from '../../engine/backward/lib/mint.mjs';
import { runCurate } from '../../engine/backward/lib/curate.mjs';
import { toDecision } from '../../engine/backward/lib/present-floor.mjs';
import { headlessAsk } from '../../engine/backward/lib/capabilities.mjs';
import { validateCheck } from '../../engine/schema/check.schema.ts';
import { makeJournal, askStep, PAUSE, pendingDecisions, gitHeadSha } from '../../engine/lib/journal.mjs';

export const RUN_ID = 'backward';

export function parseFlags(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) continue;
    const k = args[i].slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith('--')) out[k] = true;
    else { out[k] = next; i++; }
  }
  return out;
}

/** ask bound through askStep (§3.1): a fulfilled Choice replays; a PAUSE parks as awaiting. */
export function makeJournaledAsk({ journal, runId = RUN_ID, ask = headlessAsk }) {
  return async (decision) =>
    (await askStep({ journal, runId, decision, ask })) ?? { decisionId: decision.id, value: PAUSE };
}

/** §2.4: a mint targeting an id whose on-disk YAML is terminal gets generation = prior + 1.
 *  A LIVE (active/candidate) on-disk id is a category error — curate, don't re-mint — UNLESS this
 *  exact generation's ratify already completed in `journal` (§6 "re-invoking after success reprints
 *  the recorded result"): then it's a replay, not a re-mint, and keeps the same generation so the
 *  journal-keyed steps downstream (askStep, registerRatified) short-circuit instead of erroring. */
export function deriveGeneration({ checksDir, id, journal }) {
  const p = join(checksDir, `${id}.yaml`);
  if (!existsSync(p)) return { generation: 1 };
  const prior = parse(readFileSync(p, 'utf8'));
  if (prior?.status === 'retired' || prior?.status === 'superseded')
    return { generation: (prior.provenance?.generation ?? 1) + 1 };
  const priorGen = prior?.provenance?.generation ?? 1;
  if (journal?.read(RUN_ID)?.steps.get(`mint:${id}:g${priorGen}:ratify`)?.status === 'complete')
    return { generation: priorGen };
  return { error: `check "${id}" is ${prior?.status} on disk — curate (retire/supersede) it instead of re-minting` };
}

/** Mirror an external lesson into lessonsDir if absent (frontmatter intact) — the mirror IS the
 *  reconcile target (dogfood D1 convention). Returns the dossier name relative to lessonsDir. */
export function mirrorLesson({ lessonFile, lessonsDir }) {
  const rel = basename(lessonFile);
  const dest = join(lessonsDir, rel);
  if (!existsSync(dest)) { mkdirSync(lessonsDir, { recursive: true }); copyFileSync(lessonFile, dest); }
  return rel;
}

const paused = (journal, result) => ({ exit: 3, out: { result, pending: pendingDecisions(journal.read(RUN_ID)) } });

export async function mintCommand({ itemId, lessonFile, proposal, journal, ask = headlessAsk, cfg }) {
  journal.begin(RUN_ID, { runId: RUN_ID, auto: false });
  const gen = deriveGeneration({ checksDir: cfg.checksDir, id: proposal.id, journal });
  if (gen.error) return { exit: 1, out: { error: gen.error } };
  const p = gen.generation > 1 ? { ...proposal, generation: gen.generation } : proposal;
  const lessonRel = mirrorLesson({ lessonFile, lessonsDir: cfg.lessonsDir });
  const r = await runMint({ item: { id: itemId }, lesson: lessonRel, proposal: p,
    ask: makeJournaledAsk({ journal, ask }), journal,
    checksDir: cfg.checksDir, dossierRoot: cfg.lessonsDir, scenariosDir: cfg.scenariosDir });
  if (r.kind === 'paused') return paused(journal, r);
  if (r.kind === 'rejected') return { exit: 1, out: { result: r } };
  if (r.kind === 'edit') {
    // Re-open the floor (last-write-wins): the revised proposal must ask fresh, not replay 'edit'.
    const choice = { act: 'mint', candidate: r.draft.entry, lesson: r.draft.entry.provenance.lesson,
      rationale: r.draft.rationale, recommended: 'ratify', options: ['ratify', 'edit', 'decline'] };
    journal.awaiting(RUN_ID, toDecision(choice).id, toDecision(choice));
    return { exit: 0, out: { result: r } };
  }
  if (r.kind === 'minted') return { exit: r.decision ? 0 : 1, out: { result: r } };
  return { exit: 0, out: { result: r } };                          // declined
}

export async function curateCommand({ checkId, trigger, successorDraft, reason = '', journal, ask = headlessAsk, cfg }) {
  journal.begin(RUN_ID, { runId: RUN_ID, auto: false });
  const guardPath = join(cfg.checksDir, `${checkId}.yaml`);
  if (!existsSync(guardPath)) return { exit: 1, out: { error: `no such check on disk: ${guardPath}` } };
  const v = validateCheck(parse(readFileSync(guardPath, 'utf8')));
  if (!v.ok) return { exit: 1, out: { error: `invalid guard YAML for "${checkId}": ${v.error}` } };
  const r = await runCurate({ guard: v.value, trigger, proposedSuccessor: successorDraft, rationale: reason,
    ask: makeJournaledAsk({ journal, ask }), journal,
    checksDir: cfg.checksDir, dossierRoot: cfg.lessonsDir, scenariosDir: cfg.scenariosDir });
  if (r.kind === 'paused') return paused(journal, r);
  return { exit: r.decision ? 0 : 1, out: { result: r } };         // refusals carry decision: null
}

export function considerCommand({ itemId, minted, none, reason, journal, sha, ts }) {
  if (!itemId || !reason || (!minted && !none) || (minted && none)) {
    return { exit: 2, out: { error: "usage: consider --item <id> (--minted <check-id> | --none) --reason '…'" } };
  }
  journal.begin(RUN_ID, { runId: RUN_ID, auto: false });
  const value = { outcome: minted ?? 'none', reason, sha, ts };
  journal.record(RUN_ID, `consider:${itemId}`, value);
  return { exit: 0, out: { recorded: { key: `consider:${itemId}`, ...value } } };
}

function usage() {
  console.error(`usage: run-backward.mjs <mint|curate|consider> …
  mint     --item <id> --lesson <file> --proposal <proposal.json> [--fulfil <decision-id> --value '<choice-json>']
  curate   --check <id> --trigger <ship-gate|dangling-scope> [--successor <draft.json>] [--reason '…'] [--fulfil <decision-id> --value '<choice-json>']
  consider --item <id> (--minted <check-id> | --none) --reason '…'`);
  process.exit(2);
}

async function main() {
  const cmd = process.argv[2];
  const f = parseFlags(process.argv.slice(3));
  if ((f.fulfil !== undefined) !== (f.value !== undefined) || f.fulfil === true || f.value === true) usage();
  const cfg = JSON.parse(readFileSync('runtime/runtime.config.json', 'utf8'));
  const journal = makeJournal({});                                 // root = git-common-dir (shared across worktrees)
  journal.begin(RUN_ID, { runId: RUN_ID, auto: false });
  if (f.fulfil) journal.fulfil(RUN_ID, f.fulfil, JSON.parse(f.value));
  let r;
  if (cmd === 'mint') {
    if (typeof f.item !== 'string' || typeof f.lesson !== 'string' || typeof f.proposal !== 'string') usage();
    r = await mintCommand({ itemId: f.item, lessonFile: f.lesson, proposal: JSON.parse(readFileSync(f.proposal, 'utf8')), journal, cfg });
  } else if (cmd === 'curate') {
    if (typeof f.check !== 'string' || typeof f.trigger !== 'string') usage();
    const successorDraft = typeof f.successor === 'string' ? JSON.parse(readFileSync(f.successor, 'utf8')) : undefined;
    r = await curateCommand({ checkId: f.check, trigger: f.trigger, successorDraft, reason: typeof f.reason === 'string' ? f.reason : '', journal, cfg });
  } else if (cmd === 'consider') {
    r = considerCommand({ itemId: f.item, minted: typeof f.minted === 'string' ? f.minted : undefined,
      none: f.none === true, reason: typeof f.reason === 'string' ? f.reason : undefined,
      journal, sha: gitHeadSha(), ts: new Date().toISOString() });
  } else usage();
  console.log(JSON.stringify(r.out, null, 2));
  process.exit(r.exit);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
