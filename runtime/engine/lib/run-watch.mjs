// runtime/engine/lib/run-watch.mjs — the watch engine (§6). Net-new cadence over SPEC 1 checks.
// Selection: active checks whose contexts ∩ trigger.contexts ≠ ∅ AND cost_tier ≤ cost_ceiling, plus
// every global invariant (findByScope returns them unconditionally). Runs each once (in its first
// activated context), COMPLETES the partial runCheck findings (id/check/raised_at). exit 0/1/2.
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import yaml from 'yaml';
import { loadRegistry } from './load-registry.mjs';
import { findByScope } from './find-by-scope.mjs';
import { runCheck } from './run-check.mjs';

const COST_RANK = { cheap: 0, moderate: 1, expensive: 2 };
const isoNow = () => new Date().toISOString();

export function selectChecks({ registry, trigger, changedScope }) {
  const { checks, invariants } = findByScope({ registry, scope: changedScope ?? [] });
  const candidates = new Map();
  for (const c of [...checks, ...invariants]) candidates.set(c.id, c);        // dedup by id
  const activated = (c) => c.contexts.some((ctx) => trigger.contexts.includes(ctx));
  const affordable = (c) => COST_RANK[c.cost_tier] <= COST_RANK[trigger.cost_ceiling];
  return [...candidates.values()].filter((c) => activated(c) && affordable(c));
}

export async function runWatch({ registry, trigger, changedScope, stagedFiles, judge }) {
  const findings = [];
  for (const check of selectChecks({ registry, trigger, changedScope })) {
    const context = check.contexts.find((ctx) => trigger.contexts.includes(ctx));
    let result;
    try { result = await runCheck({ check, context, judge, stagedFiles }); }
    catch (e) {
      findings.push({ id: `${check.id}#err`, check: check.id, kind: 'gap',
        scope: check.scope.paths, detail: `evaluator error: ${e.message}`, raised_at: isoNow() });
      continue;
    }
    if (!result.ran) continue;
    result.findings.forEach((f, n) => findings.push({
      id: `${check.id}#${n}`, check: check.id, kind: f.kind, scope: f.scope,
      detail: f.detail, ...(f.evidence ? { evidence: f.evidence } : {}), raised_at: isoNow(),
    }));
  }
  return findings;
}

export function loadTriggers(triggersFile) { return yaml.parse(readFileSync(triggersFile, 'utf8')).triggers; }

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
  if (!args.on) { console.error('usage: run-watch.mjs --on=<trigger> [--changed=glob,glob]'); process.exit(2); }
  const cfg = JSON.parse(readFileSync('runtime/runtime.config.json', 'utf8'));
  const registry = loadRegistry({ checksDir: cfg.checksDir });
  const trigger = loadTriggers(cfg.triggersFile).find((t) => t.on === args.on);
  if (!trigger) { console.error(`unknown trigger: ${args.on}`); process.exit(2); }
  const findings = await runWatch({ registry, trigger, changedScope: args.changed ? args.changed.split(',') : ['**/*'] });
  for (const f of findings) console.log(`${f.check}\t${f.kind}\t${f.detail}`);
  process.exit(findings.length ? 1 : 0);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
