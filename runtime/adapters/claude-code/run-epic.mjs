#!/usr/bin/env node
// runtime/adapters/claude-code/run-epic.mjs — the orchestrator-drive adapter for backlog-next-epic (WS-4).
// Thin: it wraps the ALREADY-LIVE spine runOrchestrator, adding only (a) member-selection + the rule-11
// single-active-epic guard (Nestfolio content, computed HERE in the adapter ring — the engine stays
// project-agnostic, SPEC-1 hard constraint) and (b) git provenance / headSha threading (e2e-freshness).
// DEFERRED per spec §8/§10: the gh-PR-state probe and worktree-ops binding stay host-side (epics drain as
// standalone member PRs). The backlog-next-epic SKILL drive calls this unconditionally (the legacy prose
// body + RUNTIME_ENGINE flag were retired 2026-07-09). Exit: 0 done / 3 paused / 1 failed / 2 usage.
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { runOrchestrator } from '../../engine/loop/orchestrator.mjs';
import { loadRegistry } from '../../engine/lib/load-registry.mjs';
import { readItems } from '../../engine/lib/scope-gate.mjs';
import { pendingDecisions, gitHeadSha } from '../../engine/lib/journal.mjs';
import { recordRuntimePath } from '../../engine/lib/path-provenance.mjs';
import { selectEpicMembers, activeEpics } from '../../content/lib/epic-members.mjs';
import { resolveFulfilKey } from './fulfil-key.mjs';
import { makeDriverCapabilities } from './driver-capabilities.mjs';

export async function driveEpic({ epicId, backlogDir, checksDir, fulfil, capabilities, headSha, auto = false, locus = {} }) {
  const items = readItems(backlogDir);
  const epic = items.find((i) => i.id === epicId);
  if (!epic) return { exit: 2, out: { error: `unknown epic: ${epicId}` } };
  if (epic.type !== 'epic') return { exit: 2, out: { error: `${epicId} is type '${epic.type}', not 'epic' — use run-next.mjs for non-epic items` } };
  // rule-11 / single-active-epic guard (the E1 pre-drive surface): refuse if ANY epic OTHER than this one is active.
  const foreignActive = activeEpics(items).filter((id) => id !== epicId);
  if (foreignActive.length) return { exit: 2, out: { error: `rule-11 (single active epic) blocked: other active epic(s): ${foreignActive.join(', ')}` } };

  const runId = `epic-${epicId}`;
  if (fulfil) capabilities.journal.fulfil(runId, resolveFulfilKey(capabilities.journal.read(runId), fulfil.key), fulfil.value);
  const registry = loadRegistry({ checksDir });
  const members = selectEpicMembers(items, epicId);
  const result = await runOrchestrator({ epic, members, capabilities, registry, headSha, auto, locus });
  recordRuntimePath(capabilities.journal, { runId, workstream: epicId, sha: headSha ?? gitHeadSha() });
  const pending = pendingDecisions(capabilities.journal.read(runId));
  const exit = result.status === 'done' ? 0 : result.status === 'paused' ? 3 : 1;
  return { exit, out: { result, pending, members: members.map((m) => m.id) } };
}

async function main() {
  const [epicId] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const fi = process.argv.indexOf('--fulfil'); const vi = process.argv.indexOf('--value');
  const fv = fi >= 0 ? process.argv[fi + 1] : undefined; const vv = vi >= 0 ? process.argv[vi + 1] : undefined;
  const badPair = fi >= 0 && (fv === undefined || fv.startsWith('--') || vv === undefined || vv.startsWith('--'));
  if (!epicId || (fi >= 0) !== (vi >= 0) || badPair) { console.error('usage: run-epic.mjs <epic-id> [--fulfil <key> --value <json>] [--auto]'); process.exit(2); }
  const cfg = JSON.parse(readFileSync('runtime/runtime.config.json', 'utf8'));
  const capabilities = makeDriverCapabilities();   // judged: skill:<name> checks resolve instead of fail-closing
  const { exit, out } = await driveEpic({ epicId, backlogDir: cfg.backlogDir ?? 'docs/backlog', checksDir: cfg.checksDir,
    fulfil: fi >= 0 ? { key: fv, value: JSON.parse(vv) } : undefined, capabilities,
    headSha: gitHeadSha(), auto: process.argv.includes('--auto') });
  console.log(JSON.stringify(out, null, 2));
  process.exit(exit);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
