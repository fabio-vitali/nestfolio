#!/usr/bin/env node
// runtime/adapters/claude-code/run-item.mjs — the session-driven loop driver (ring-2: assembles the
// adapter, so it may NOT live in engine/). Park/fulfil IS the interactive binding: this process runs
// until the first unfulfilled park, prints it, and exits; the session performs the work / surfaces the
// real AskUserQuestion, re-invokes with --fulfil, and replay advances. Exit: 0 done / 3 paused / 1 failed / 2 usage.
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { runWorker } from '../../engine/loop/worker.mjs';
import { loadRegistry } from '../../engine/lib/load-registry.mjs';
import { readItems } from '../../engine/lib/scope-gate.mjs';
import { pendingDecisions } from '../../engine/lib/journal.mjs';
import { makeClaudeCodeCapabilities } from './index.mjs';

export async function driveItem({ itemId, backlogDir, checksDir, fulfil, capabilities }) {
  const item = readItems(backlogDir).find((i) => i.id === itemId);
  if (!item) return { exit: 2, out: { error: `unknown item: ${itemId}` } };
  const runId = `item-${itemId}`;
  if (fulfil) capabilities.journal.fulfil(runId, fulfil.key, fulfil.value);
  const registry = loadRegistry({ checksDir });
  const result = await runWorker({ item, capabilities, registry });
  const pending = pendingDecisions(capabilities.journal.read(runId));
  const exit = result.status === 'done' ? 0 : result.status === 'paused' ? 3 : 1;
  return { exit, out: { result, pending } };
}

async function main() {
  const [itemId] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const fi = process.argv.indexOf('--fulfil'); const vi = process.argv.indexOf('--value');
  const fv = fi >= 0 ? process.argv[fi + 1] : undefined; const vv = vi >= 0 ? process.argv[vi + 1] : undefined;
  const badPair = fi >= 0 && (fv === undefined || fv.startsWith('--') || vv === undefined || vv.startsWith('--'));
  if (!itemId || (fi >= 0) !== (vi >= 0) || badPair) { console.error('usage: run-item.mjs <item-id> [--fulfil <key> --value <json>]'); process.exit(2); }
  const cfg = JSON.parse(readFileSync('runtime/runtime.config.json', 'utf8'));
  const capabilities = makeClaudeCodeCapabilities({});
  const { exit, out } = await driveItem({ itemId, backlogDir: cfg.backlogDir ?? 'docs/backlog', checksDir: cfg.checksDir,
    fulfil: fi >= 0 ? { key: fv, value: JSON.parse(vv) } : undefined, capabilities });
  console.log(JSON.stringify(out, null, 2));
  process.exit(exit);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
