#!/usr/bin/env node
// meta-check.mjs — metaCheck(): the registry self-check (§8). Three integrity assertions + two
// rot-detectors + cheap-by-construction, over `registry` and an INJECTED `env` (pure, agnostic core).
// It only FILES findings; it NEVER advances a check's state. CLI: 0 clean, 1 any finding, 2 usage.
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveEvaluator } from './resolve-evaluator.mjs';
import { loadRegistry, registryErrorLines } from './load-registry.mjs';

let SEQ = 0;
const finding = (kind, detail, scope = []) =>
  ({ id: `registry-integrity-${++SEQ}`, check: 'registry-integrity', kind, scope, detail, raised_at: nowIso() });

export function metaCheck({ registry, env }) {
  SEQ = 0;
  const findings = [];
  const activeById = new Map(registry.checks.filter((c) => c.status === 'active').map((c) => [c.id, c]));

  // Assertion 1 — every enforced surface ↔ an active entry (matched by id or by identical run).
  for (const surface of env.enforcedSurfaces ?? []) {
    const matched = [...activeById.values()].some((c) => c.id === surface.id || c.evaluator.run === surface.run);
    if (!matched) findings.push(finding('inconsistency', `enforced surface "${surface.id}" (${surface.kind}) has no active registry entry`));
  }

  for (const check of registry.checks) {
    // Assertion 2 — evaluator resolves.
    try { resolveEvaluator({ check }); }
    catch (e) { findings.push(finding('gap', `check "${check.id}" evaluator does not resolve: ${e.message}`, check.scope.paths)); continue; }

    // Assertion 3 — judgment ⇒ eval_scenario exists on disk.
    if (check.evaluator.type === 'judgment') {
      const sc = check.flake_contract?.eval_scenario;
      const abs = sc && (isAbsolute(sc) ? sc : resolvePath(process.cwd(), sc));
      if (!sc || !existsSync(abs)) findings.push(finding('gap', `judgment check "${check.id}" eval_scenario missing: ${sc ?? '(none)'}`, check.scope.paths));
    }

    // Cheap-by-construction — invariant ⇒ cheap.
    if (check.contexts.includes('invariant') && check.cost_tier !== 'cheap') {
      findings.push(finding('inconsistency', `check "${check.id}" is contexts:[invariant] but cost_tier:${check.cost_tier} (must be cheap)`, check.scope.paths));
    }

    // Rot-detector i — dangling scope ⇒ staleness (retirement candidate); status is NOT changed.
    if (check.status === 'active') {
      const resolved = env.resolveGlobs ? env.resolveGlobs(check.scope.paths) : ['x'];
      if (resolved.length === 0) findings.push(finding('staleness', `active check "${check.id}" scope resolves to zero files (retirement-candidate)`, check.scope.paths));
    }
  }

  // Rot-detector ii — every stored knob must be the scope of an active check (law §13.2).
  for (const knob of env.storedKnobs ?? []) {
    const covered = knob.scopeRef && activeById.has(knob.scopeRef);
    if (!covered) findings.push(finding('gap', `stored knob "${knob.id}" has no validating active check (derive-don't-store)`));
  }

  return findings;
}

function nowIso() { return new Date().toISOString(); }

// The registry-integrity CLI (redteam item 5): both rings register `cmd:node …/meta-check.mjs`, so the
// self-check must actually run from cmd:. Exit 0 clean / 1 findings-or-registry-errors / 2 usage.
// enforcedSurfaces/storedKnobs stay [] (they need SPEC-3-level wiring); assertions 2/3 +
// cheap-by-construction + rot-i are the CLI's teeth.
function main() {
  const argv = process.argv.slice(2);
  const flag = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  let checksDir = flag('--checks-dir');
  if (!checksDir) {
    try { checksDir = JSON.parse(readFileSync('runtime/runtime.config.json', 'utf8')).checksDir; }
    catch { /* fall through to usage */ }
  }
  if (!checksDir) { console.error('usage: meta-check.mjs [--checks-dir <dir>] (default: runtime/runtime.config.json)'); process.exit(2); }
  const registry = loadRegistry({ checksDir });
  const errLines = registryErrorLines(registry);
  if (errLines) { for (const l of errLines) console.error(l); process.exit(1); }   // self-check is fail-closed too
  // :(glob) pathspec magic: git's default fnmatch resolves `a/**/b/**/*.ts` to ZERO files; wildmatch
  // matches the minimatch semantics the scope globs assume everywhere else (empirical, redteam item 5).
  const resolveGlobs = (globs) => {
    try {
      return execSync(`git ls-files -- ${globs.map((g) => `':(glob)${g}'`).join(' ')}`, { encoding: 'utf8' })
        .split('\n').filter(Boolean);
    } catch { return ['x']; }   // not a git repo → skip rot-detection rather than false-flag
  };
  const findings = metaCheck({ registry, env: { resolveGlobs, enforcedSurfaces: [], storedKnobs: [] } });
  for (const f of findings) console.log(`${f.check}\t${f.kind}\t${f.detail}`);
  process.exit(findings.length ? 1 : 0);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
