#!/usr/bin/env node
// runtime/adapters/claude-code/run-themes.mjs — the cold-path THEMES driver (ring-2), the all-vs-all
// sibling of run-intake.mjs. Gathers the backlog, runs the clustering judgment through a journaled
// execute step (park/fulfil binding), then applies the abstract mutations: mint new theme-epic files +
// repoint absorbed items' frontmatter. Exit: 0 done / 3 parked / 1 failed / 2 usage.
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'yaml';
import { themes } from '../../engine/lib/themes.mjs';
import { readItems } from '../../engine/lib/scope-gate.mjs';
import { pendingDecisions, gitHeadSha } from '../../engine/lib/journal.mjs';
import { recordRuntimePath } from '../../engine/lib/path-provenance.mjs';
import { writeItemFile } from './run-intake.mjs';
import { makeClaudeCodeCapabilities } from './index.mjs';

const FM_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
class ThemesParked extends Error {}

/** Apply abstract theme mutations to docs/backlog: mint epic files + repoint absorbed items. Returns paths. */
export function applyThemeMutations({ backlogDir, mints, repoints }) {
  const written = [];
  for (const epic of mints) written.push(writeItemFile({ backlogDir, item: epic, body: '' }));
  for (const rp of repoints) {
    const path = join(backlogDir, `${rp.id}.md`);
    const m = FM_RE.exec(readFileSync(path, 'utf8'));
    if (!m) throw new Error(`repoint target has no frontmatter: ${path}`);
    const front = yaml.parse(m[1]) ?? {};
    front.epic = rp.epic; front.epic_role = rp.epic_role;
    writeFileSync(path, `---\n${yaml.stringify(front).trimEnd()}\n---\n${m[2]}`);
    written.push(path);
  }
  return written;
}

export async function driveThemes({ backlogDir, checksDir, fulfil, capabilities }) {
  const runId = 'themes';
  const { journal } = capabilities;
  journal.begin(runId, { runId, auto: false });
  recordRuntimePath(journal, { runId, workstream: 'themes', sha: gitHeadSha() });
  if (fulfil) journal.fulfil(runId, fulfil.key, fulfil.value);
  let parked = null;
  const stepExecute = async (task) => {
    const r = await journal.step(runId, `execute:${task.id}`, () => capabilities.execute(task));
    if (r?.status === 'paused') { parked = r; throw new ThemesParked(); }
    return r;
  };
  let result;
  try {
    result = await themes({ backlog: readItems(backlogDir), capabilities: { ...capabilities, execute: stepExecute } });
  } catch (e) {
    if (e instanceof ThemesParked) return { exit: 3, out: { result: { status: 'paused', summary: parked.summary }, pending: pendingDecisions(journal.read(runId)) } };
    return { exit: 1, out: { error: e.message } };
  }
  const written = applyThemeMutations({ backlogDir, mints: result.mints, repoints: result.repoints });
  journal.record(runId, 'themes:applied', { mints: result.mints.map((m) => m.id), repoints: result.repoints.map((r) => r.id), files: written });
  return { exit: 0, out: { clusters: result.clusters, rationale: result.rationale, written } };
}

async function main() {
  const ff = process.argv.indexOf('--fulfil'); const vi = process.argv.indexOf('--value');
  const fv = ff >= 0 ? process.argv[ff + 1] : undefined; const vv = vi >= 0 ? process.argv[vi + 1] : undefined;
  const badPair = ff >= 0 && (fv === undefined || fv.startsWith('--') || vv === undefined || vv.startsWith('--'));
  if ((ff >= 0) !== (vi >= 0) || badPair) { console.error('usage: run-themes.mjs [--fulfil <key> --value <json>]'); process.exit(2); }
  const cfg = JSON.parse(readFileSync('runtime/runtime.config.json', 'utf8'));
  const capabilities = makeClaudeCodeCapabilities({});
  const { exit, out } = await driveThemes({ backlogDir: cfg.backlogDir ?? 'docs/backlog', checksDir: cfg.checksDir,
    fulfil: ff >= 0 ? { key: fv, value: JSON.parse(vv) } : undefined, capabilities });
  console.log(JSON.stringify(out, null, 2));
  process.exit(exit);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
