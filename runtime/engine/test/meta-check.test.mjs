import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metaCheck } from '../lib/meta-check.mjs';
import { validCheck, withTmpDir } from './_fixtures.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const reg = (checks) => ({ checks, byId: new Map(checks.map((c) => [c.id, c])), errors: [] });
const emptyEnv = { enforcedSurfaces: [], resolveGlobs: () => ['some/file.ts'], storedKnobs: [] };

// B1 — enforced nx target with no registry entry → one inconsistency finding naming it
test('B1 an enforced surface with no active entry → inconsistency', () => {
  const env = { ...emptyEnv, enforcedSurfaces: [{ id: 'orphan-target', kind: 'nx-target', run: 'cmd:node tools/orphan.mjs' }] };
  const findings = metaCheck({ registry: reg([]), env });
  const f = findings.find((x) => x.kind === 'inconsistency' && /orphan-target/.test(x.detail));
  assert.ok(f, 'expected an inconsistency naming the orphaned surface');
});

// B2 — unresolvable evaluator → gap; AND a resolvable one raises nothing (negative)
test('B2 an unresolvable evaluator → gap; a resolvable one → no gap', () => withTmpDir((root) => {
  const bad = validCheck({ id: 'bad', evaluator: { type: 'deterministic', run: 'module:./absent.mjs#fn' }, contexts: ['gate'] });
  const modPath = join(root, 'ok.mjs'); writeFileSync(modPath, 'export const fn = () => [];', 'utf8');
  const good = validCheck({ id: 'good', evaluator: { type: 'deterministic', run: `module:${modPath}#fn` }, contexts: ['gate'] });
  const findings = metaCheck({ registry: reg([bad, good]), env: emptyEnv });
  assert.ok(findings.some((x) => x.kind === 'gap' && /bad/.test(x.detail)));
  assert.ok(!findings.some((x) => x.kind === 'gap' && /good/.test(x.detail)));
}));

// B3 — judgment with a non-existent eval_scenario → gap
test('B3 judgment with an absent eval_scenario path → gap', () => {
  const j = validCheck({ id: 'j', kind: 'gap', cost_tier: 'expensive', contexts: ['audit'],
    evaluator: { type: 'judgment', run: 'skill:audit-service' },
    flake_contract: { eval_scenario: 'runtime/eval/scenarios/does-not-exist.scenario.mjs', allowed_flake_rate: 0.05, calibration: 'n=20' } });
  const findings = metaCheck({ registry: reg([j]), env: emptyEnv });
  assert.ok(findings.some((x) => x.kind === 'gap' && /eval_scenario|scenario/.test(x.detail)));
});

// B4 — dangling scope → staleness (retirement-candidate), status stays active
test('B4 an active check whose scope globs match zero files → staleness; status stays active', () => {
  const c = validCheck({ id: 'dangling', contexts: ['gate'], scope: { paths: ['gone/**'] } });
  const env = { ...emptyEnv, resolveGlobs: (paths) => paths.includes('gone/**') ? [] : ['x'] };
  const findings = metaCheck({ registry: reg([c]), env });
  const f = findings.find((x) => x.kind === 'staleness' && /dangling/.test(x.detail));
  assert.ok(f);
  assert.equal(c.status, 'active');   // meta-check NEVER advances state
});

// B5 — stored knob not scoped by any active check → gap (binds law §13.2)
test('B5 a stored knob with no validating active check → gap', () => {
  const env = { ...emptyEnv, storedKnobs: [{ id: 'blast-radius-threshold' }] };
  const findings = metaCheck({ registry: reg([]), env });
  assert.ok(findings.some((x) => x.kind === 'gap' && /blast-radius-threshold/.test(x.detail)));
});

// B6 — invariant + expensive → inconsistency (cheap-by-construction)
test('B6 contexts:[invariant] with cost_tier:expensive → inconsistency', () => {
  const c = validCheck({ id: 'e', contexts: ['invariant'], cost_tier: 'expensive', scope: { paths: ['x/**'] } });
  const env = { ...emptyEnv, resolveGlobs: () => ['x/a'] };
  const findings = metaCheck({ registry: reg([c]), env });
  assert.ok(findings.some((x) => x.kind === 'inconsistency' && /cheap|invariant/.test(x.detail)));
});
