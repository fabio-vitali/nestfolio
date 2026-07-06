#!/usr/bin/env node
// runtime/adapters/claude-code/run-intake.mjs — the session-driven INTAKE driver (ring-2), the exact
// sibling of run-item.mjs for the forward edge's finding→items router. Park/fulfil binding: selectRoute's
// judgment task parks via the adapter execute; the session answers with a complete TaskResult whose
// summary is the route JSON; replay short-circuits and the driver writes the shaped item files
// deterministically (the frontmatter write is the project binding — it stays out of ring-1).
// Exit: 0 done / 3 parked / 1 failed / 2 usage.
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'yaml';
import { intake } from '../../engine/lib/intake.mjs';
import { loadRegistry } from '../../engine/lib/load-registry.mjs';
import { readItems } from '../../engine/lib/scope-gate.mjs';
import { pendingDecisions } from '../../engine/lib/journal.mjs';
import { makeClaudeCodeCapabilities } from './index.mjs';

class IntakeParked extends Error {}

/** Render an abstract intake Item to a docs/backlog frontmatter file. Returns the written path. */
export function writeItemFile({ backlogDir, item, body = '' }) {
  const { id, ...fm } = item;
  mkdirSync(backlogDir, { recursive: true });
  const path = join(backlogDir, `${id}.md`);
  writeFileSync(path, `---\n${yaml.stringify({ id, ...fm }).trimEnd()}\n---\n\n# ${id}\n${body ? `\n${body}\n` : ''}`);
  return path;
}

export async function driveIntake({ finding, backlogDir, checksDir, fulfil, capabilities }) {
  const runId = `intake-${finding.id}`;
  const { journal } = capabilities;
  journal.begin(runId, { runId, auto: false });
  if (fulfil) journal.fulfil(runId, fulfil.key, fulfil.value);
  const registry = loadRegistry({ checksDir });
  let parked = null;
  const stepExecute = async (task) => {
    const r = await journal.step(runId, `execute:${task.id}`, () => capabilities.execute(task));
    if (r?.status === 'paused') { parked = r; throw new IntakeParked(); }
    return r;
  };
  let result;
  try {
    result = await intake({ finding, registry, backlog: readItems(backlogDir),
      capabilities: { ...capabilities, execute: stepExecute } });
  } catch (e) {
    if (e instanceof IntakeParked) return { exit: 3, out: { result: { status: 'paused', summary: parked.summary }, pending: pendingDecisions(journal.read(runId)) } };
    return { exit: 1, out: { error: e.message } };
  }
  const written = result.items.map((item) => writeItemFile({ backlogDir, item, body: finding.detail }));
  journal.record(runId, `intake:${finding.id}:filed`, { route: result.route, files: written });
  return { exit: 0, out: { route: result.route, rationale: result.rationale, written } };
}

async function main() {
  const fi = process.argv.indexOf('--finding');
  const ff = process.argv.indexOf('--fulfil'); const vi = process.argv.indexOf('--value');
  const findingPath = fi >= 0 ? process.argv[fi + 1] : undefined;
  const fv = ff >= 0 ? process.argv[ff + 1] : undefined; const vv = vi >= 0 ? process.argv[vi + 1] : undefined;
  const badPair = ff >= 0 && (fv === undefined || fv.startsWith('--') || vv === undefined || vv.startsWith('--'));
  if (!findingPath || (ff >= 0) !== (vi >= 0) || badPair) {
    console.error('usage: run-intake.mjs --finding <finding.json> [--fulfil <key> --value <json>]'); process.exit(2);
  }
  const finding = JSON.parse(readFileSync(findingPath, 'utf8'));
  const cfg = JSON.parse(readFileSync('runtime/runtime.config.json', 'utf8'));
  const capabilities = makeClaudeCodeCapabilities({});
  const { exit, out } = await driveIntake({ finding, backlogDir: cfg.backlogDir ?? 'docs/backlog',
    checksDir: cfg.checksDir, fulfil: ff >= 0 ? { key: fv, value: JSON.parse(vv) } : undefined, capabilities });
  console.log(JSON.stringify(out, null, 2));
  process.exit(exit);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
