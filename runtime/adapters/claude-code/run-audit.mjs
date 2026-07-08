#!/usr/bin/env node
// runtime/adapters/claude-code/run-audit.mjs — Seam B (ring-2). The expensive-check cadence dispatcher:
// derive the judge from the audit procedures, run the watch engine for an [audit]/expensive trigger,
// emit findings (stdout + a gitignored artifact for CI upload / later intake). exit 0 clean / 1 findings / 2 usage.
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadRegistry, registryErrorLines } from '../../engine/lib/load-registry.mjs';
import { loadTriggers, runWatch } from '../../engine/lib/run-watch.mjs';
import { deriveJudge } from '../../engine/lib/derive-judge.mjs';
import { makeDriverCapabilities } from './driver-capabilities.mjs';

export async function runAudit({ registry, trigger, judge, changedScope = ['**/*'], only }) {
  const scoped = only ? { ...registry, checks: registry.checks.filter((c) => c.id === only) } : registry;
  return await runWatch({ registry: scoped, trigger, changedScope, judge });
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
  const on = args.on ?? 'schedule';
  const cfg = JSON.parse(readFileSync('runtime/runtime.config.json', 'utf8'));
  const registry = loadRegistry({ checksDir: cfg.checksDir });
  const errLines = registryErrorLines(registry);
  if (errLines) { console.error('run-audit: registry corrupt (fail-closed):'); for (const l of errLines) console.error(l); process.exit(2); }
  const trigger = loadTriggers(cfg.triggersFile).find((t) => t.on === on);
  if (!trigger) { console.error(`unknown trigger: ${on}`); process.exit(2); }
  const capabilities = makeDriverCapabilities();
  const judge = deriveJudge(capabilities.runProcedure);
  const findings = await runAudit({ registry, trigger, judge, only: args.only });
  const runId = `audit-${on}-${process.env.GITHUB_RUN_ID ?? 'local'}`;
  const dir = 'runtime/.audit-findings';
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${runId}.json`);
  writeFileSync(path, JSON.stringify({ runId, trigger: on, findings }, null, 2));
  console.log(JSON.stringify({ runId, count: findings.length, path, findings }, null, 2));
  process.exit(findings.length ? 1 : 0);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
