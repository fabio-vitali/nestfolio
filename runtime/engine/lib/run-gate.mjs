// runtime/engine/lib/run-gate.mjs — gates as registry checks in their `gate` context (§10). The prove
// step: nothing ships without the evidence its gates demand. exit 0 ≠ pass — the finding count decides.
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { loadRegistry } from './load-registry.mjs';
import { findByScope } from './find-by-scope.mjs';
import { runCheck } from './run-check.mjs';

const isoNow = () => new Date().toISOString();

export async function runGate({ registry, boundary, item, judge }) {
  const { checks, invariants } = findByScope({ registry, scope: item.scope ?? '' });
  const selected = new Map();
  for (const c of checks) if (c.contexts.includes('gate')) selected.set(c.id, c);
  for (const c of invariants) selected.set(c.id, c);                       // global invariants always ride (§6.2)
  const findings = []; let allRan = true;
  for (const check of selected.values()) {
    const context = check.contexts.includes('gate') ? 'gate' : 'invariant';
    let r;
    try { r = await runCheck({ check, context, judge }); }
    catch (e) {   // a throwing evaluator (skill: with no judge, module-not-found) FAILS CLOSED via a gap finding
      findings.push({ id: `${check.id}#err`, check: check.id, kind: 'gap', scope: check.scope.paths, detail: `evaluator error: ${e.message}`, raised_at: isoNow() });
      continue;
    }
    if (!r.ran) { allRan = false; continue; }
    r.findings.forEach((f, n) => findings.push({ id: `${check.id}#${n}`, check: check.id, kind: f.kind, scope: f.scope, detail: f.detail, raised_at: isoNow() }));
  }
  return { passed: findings.length === 0 && allRan, findings };
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
  if (!args.boundary || !args.item) { console.error('usage: run-gate.mjs --boundary=<start|ship> --item=<id> --item-scope=<glob>'); process.exit(2); }
  const cfg = JSON.parse(readFileSync('runtime/runtime.config.json', 'utf8'));
  const registry = loadRegistry({ checksDir: cfg.checksDir });
  const { passed, findings } = await runGate({ registry, boundary: args.boundary, item: { id: args.item, scope: args['item-scope'] ?? '' } });
  for (const f of findings) console.log(`${f.check}\t${f.detail}`);
  process.exit(passed ? 0 : 1);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
