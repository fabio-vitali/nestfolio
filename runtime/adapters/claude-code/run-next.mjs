#!/usr/bin/env node
// runtime/adapters/claude-code/run-next.mjs — the worker-drive adapter for backlog-next (WS-3). Mirrors
// run-item.mjs but (a) computes the Nestfolio lane→trigger mapping HERE in the adapter ring — classifyLane
// (content) stays OUT of ring-1, keeping the engine project-agnostic (SPEC-1 hard constraint) — and injects
// the resulting preShipTrigger + branch-delta changedScope into runWorker; (b) threads git provenance.
// Behind RUNTIME_ENGINE the backlog-next SKILL entry/closing step calls this; flag off → the legacy skill
// body (byte-for-byte). Exit: 0 done / 3 paused / 1 failed / 2 usage. Git-workflow preconditions stay host.
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { runWorker } from '../../engine/loop/worker.mjs';
import { loadRegistry } from '../../engine/lib/load-registry.mjs';
import { readItems } from '../../engine/lib/scope-gate.mjs';
import { pendingDecisions, gitHeadSha } from '../../engine/lib/journal.mjs';
import { recordRuntimePath } from '../../engine/lib/path-provenance.mjs';
import { classifyLane, laneToTrigger } from '../../content/lib/classify-lane.mjs';
import { resolveFulfilKey } from './fulfil-key.mjs';
import { makeClaudeCodeCapabilities } from './index.mjs';

const diffOf = (base) => { try { return execSync(`git diff --name-only ${base}...HEAD`, { encoding: 'utf8' }).split('\n').filter(Boolean); } catch { return []; } };

export async function driveNext({ itemId, backlogDir, checksDir, fulfil, capabilities, diffPaths, headSha }) {
  const item = readItems(backlogDir).find((i) => i.id === itemId);
  if (!item) return { exit: 2, out: { error: `unknown item: ${itemId}` } };
  const runId = `item-${itemId}`;
  if (fulfil) capabilities.journal.fulfil(runId, resolveFulfilKey(capabilities.journal.read(runId), fulfil.key), fulfil.value);
  const registry = loadRegistry({ checksDir });
  // adapter-ring lane classification (Nestfolio content) → injected pre-ship trigger (null ⇒ doc-layer skips).
  const lane = classifyLane(item, diffPaths ?? []);
  const preShipTrigger = laneToTrigger(lane);
  const result = await runWorker({ item, capabilities, registry, headSha, preShipTrigger, changedScope: diffPaths });
  recordRuntimePath(capabilities.journal, { runId, workstream: itemId, sha: headSha ?? gitHeadSha() });
  const pending = pendingDecisions(capabilities.journal.read(runId));
  const exit = result.status === 'done' ? 0 : result.status === 'paused' ? 3 : 1;
  return { exit, out: { result, pending, lane } };
}

async function main() {
  const [itemId] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const fi = process.argv.indexOf('--fulfil'); const vi = process.argv.indexOf('--value');
  const fv = fi >= 0 ? process.argv[fi + 1] : undefined; const vv = vi >= 0 ? process.argv[vi + 1] : undefined;
  const badPair = fi >= 0 && (fv === undefined || fv.startsWith('--') || vv === undefined || vv.startsWith('--'));
  if (!itemId || (fi >= 0) !== (vi >= 0) || badPair) { console.error('usage: run-next.mjs <item-id> [--fulfil <key> --value <json>]'); process.exit(2); }
  const cfg = JSON.parse(readFileSync('runtime/runtime.config.json', 'utf8'));
  const capabilities = makeClaudeCodeCapabilities({});
  const { exit, out } = await driveNext({ itemId, backlogDir: cfg.backlogDir ?? 'docs/backlog', checksDir: cfg.checksDir,
    fulfil: fi >= 0 ? { key: fv, value: JSON.parse(vv) } : undefined, capabilities, diffPaths: diffOf('origin/main') });
  console.log(JSON.stringify(out, null, 2));
  process.exit(exit);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
