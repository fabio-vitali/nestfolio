#!/usr/bin/env node
// runtime/adapters/claude-code/run-view.mjs — the §14 Option B operator surface (view + executor).
// `view` renders the ring-1 deriveSurface over the REAL stores (item store, registry, git-native
// journal) plus two adapter enrichments: run-audit artifacts merged into open findings, and per-runId
// RESUME HINTS (the runId prefix → owning-driver mapping is adapter knowledge — ring-1 stays generic).
// `exec` dispatches a mutation through executeOp over judged capabilities (makeDriverCapabilities —
// bare caps would fail-close skill: procedures). READ-ONLY otherwise: this driver takes NO --fulfil;
// a park is resumed via the owning driver printed in the hint, so there is no second write path.
import { fileURLToPath } from 'node:url';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveSurface, renderSurface, executeOp } from '../../engine/lib/operational-surface.mjs';
import { makeJournal, listRunIds, gitCommonDir } from '../../engine/lib/journal.mjs';
import { loadRegistry } from '../../engine/lib/load-registry.mjs';
import { readItems } from '../../engine/lib/scope-gate.mjs';
import { activeEpics } from '../../content/lib/epic-members.mjs';
import { makeDriverCapabilities } from './driver-capabilities.mjs';

const USAGE = 'usage: run-view.mjs [view] [--json] | run-view.mjs exec (--procedure <name> [--args <json>] | --task <json>)';
const DRIVERS = 'runtime/adapters/claude-code';

/** runId prefix → the owning driver's resume command (fulfil by the printed pending KEY). */
export function resumeHints(runIds) {
  const hints = {};
  for (const runId of runIds) {
    if (runId.startsWith('item-')) hints[runId] = `node ${DRIVERS}/run-next.mjs ${runId.slice(5)} --fulfil '<key>' --value '<json>'`;
    else if (runId.startsWith('epic-')) hints[runId] = `node ${DRIVERS}/run-epic.mjs ${runId.slice(5)} --fulfil '<key>' --value '<json>'`;
    else if (runId.startsWith('intake-')) hints[runId] = `node ${DRIVERS}/run-intake.mjs --finding <finding.json> --fulfil '<key>' --value '<json>'`;
  }
  return hints;
}

/** Merge run-audit artifacts (runtime/.audit-findings/<runId>.json) into open-findings rows. */
export function loadAuditFindings(dir = 'runtime/.audit-findings') {
  if (!existsSync(dir)) return [];
  const rows = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    let artifact;
    try { artifact = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { continue; }   // torn artifact → skip
    if (Array.isArray(artifact?.findings) && artifact.findings.length) {
      rows.push({ runId: artifact.runId ?? f.replace(/\.json$/, ''), key: `audit:${artifact.trigger ?? 'manual'}`, findings: artifact.findings });
    }
  }
  return rows;
}

export function driveView({ backlogDir, checksDir, journalRoot = gitCommonDir(), auditDir = 'runtime/.audit-findings' }) {
  const backlog = readItems(backlogDir);
  const registry = loadRegistry({ checksDir });
  const journal = makeJournal({ root: journalRoot });                  // reads are lease-free (§5)
  const runIds = listRunIds(journalRoot);
  const surface = deriveSurface({ backlog, registry, journal, runIds, env: { activeEpics: activeEpics(backlog) } });
  surface.findings.push(...loadAuditFindings(auditDir));
  return { surface, hints: resumeHints(surface.pending.map((p) => p.runId)) };
}

async function main() {
  const argv = process.argv.slice(2);
  // read-only surface: NO --fulfil/--value here — a park is resumed via the owning driver (see hints).
  if (argv.includes('--fulfil') || argv.includes('--value')) { console.error(USAGE); process.exit(2); }
  const positionals = argv.filter((a) => !a.startsWith('--'));
  const cmd = positionals[0] ?? 'view';
  if (cmd === 'view' && positionals.length <= 1) {
    const cfg = JSON.parse(readFileSync('runtime/runtime.config.json', 'utf8'));
    const { surface, hints } = driveView({ backlogDir: cfg.backlogDir ?? 'docs/backlog', checksDir: cfg.checksDir });
    if (argv.includes('--json')) console.log(JSON.stringify({ surface, hints }, null, 2));
    else process.stdout.write(renderSurface(surface, { hints }));
    return process.exit(0);
  }
  if (cmd === 'exec') {
    const pi = argv.indexOf('--procedure'); const ti = argv.indexOf('--task'); const ai = argv.indexOf('--args');
    const bad = (i) => i >= 0 && (argv[i + 1] === undefined || argv[i + 1].startsWith('--'));
    if ((pi >= 0) === (ti >= 0) || bad(pi) || bad(ti) || bad(ai)) { console.error(USAGE); process.exit(2); }
    let op;
    try {
      op = pi >= 0 ? { kind: 'procedure', name: argv[pi + 1], args: ai >= 0 ? JSON.parse(argv[ai + 1]) : undefined }
                   : { kind: 'task', task: JSON.parse(argv[ti + 1]) };
    } catch { console.error(USAGE); process.exit(2); }
    const result = await executeOp({ capabilities: makeDriverCapabilities(), op });
    console.log(JSON.stringify(result, null, 2));
    return process.exit(result.status === 'done' ? 0 : result.status === 'paused' ? 3 : 1);
  }
  console.error(USAGE); process.exit(2);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
