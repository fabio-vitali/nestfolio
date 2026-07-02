import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEvaluator } from '../lib/resolve-evaluator.mjs';
import { EvaluatorUnresolved, JudgmentContractMissing } from '../lib/errors.mjs';
import { validCheck, withTmpDir } from './_fixtures.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// F1 — a resolving cmd: check → {kind:'deterministic', invoke:thunk}
test('a cmd: check resolves to deterministic with a callable invoke thunk', () => {
  const { kind, invoke } = resolveEvaluator({ check: validCheck({ evaluator: { type: 'deterministic', run: 'cmd:true' } }) });
  assert.equal(kind, 'deterministic');
  assert.equal(typeof invoke, 'function');
});

// F2 — unknown scheme / bare / non-existent module target → EvaluatorUnresolved
test('an unknown scheme throws EvaluatorUnresolved', () => {
  assert.throws(() => resolveEvaluator({ check: validCheck({ evaluator: { type: 'deterministic', run: 'bogus:x' } }) }), EvaluatorUnresolved);
});
test('a bare (scheme-less) run throws EvaluatorUnresolved', () => {
  assert.throws(() => resolveEvaluator({ check: validCheck({ evaluator: { type: 'deterministic', run: 'node tools/x.mjs' } }) }), EvaluatorUnresolved);
});
test('a module: pointing at an absent file throws EvaluatorUnresolved', () => {
  assert.throws(() => resolveEvaluator({ check: validCheck({ evaluator: { type: 'deterministic', run: 'module:./nope-absent.mjs#fn' } }) }), EvaluatorUnresolved);
});

// F3 — judgment without flake_contract → JudgmentContractMissing
test('a skill: judgment check with no flake_contract throws JudgmentContractMissing', () => {
  const c = validCheck({ evaluator: { type: 'judgment', run: 'skill:audit-service' } });
  delete c.flake_contract;
  assert.throws(() => resolveEvaluator({ check: c }), JudgmentContractMissing);
});

// F4 — one check per scheme resolves via its branch; kinds correct
test('each scheme resolves via its dispatch branch with the right kind', () => withTmpDir((root) => {
  const mod = join(root, 'm.mjs'); writeFileSync(mod, 'export const fn = () => [];', 'utf8');
  const cmd = resolveEvaluator({ check: validCheck({ evaluator: { type: 'deterministic', run: 'cmd:true' } }) });
  const module_ = resolveEvaluator({ check: validCheck({ evaluator: { type: 'deterministic', run: `module:${mod}#fn` } }) });
  const eslint = resolveEvaluator({ check: validCheck({ evaluator: { type: 'deterministic', run: 'eslint:@nx/enforce-module-boundaries' } }) });
  const skill = resolveEvaluator({ check: validCheck({
    kind: 'gap', cost_tier: 'expensive', contexts: ['audit'],
    evaluator: { type: 'judgment', run: 'skill:audit-service' },
    flake_contract: { eval_scenario: 's', allowed_flake_rate: 0.05, calibration: 'n=20' },
  }) });
  assert.equal(cmd.kind, 'deterministic');
  assert.equal(module_.kind, 'deterministic');
  assert.equal(eslint.kind, 'deterministic');
  assert.equal(skill.kind, 'judgment');
}));

// E0 (SPEC 3 §15 delta) — an injected judge realizes the deferred skill: invocation
test('a skill: check with an injected judge invokes it instead of throwing', async () => {
  const check = { id: 'j', property: 'p', kind: 'inconsistency', cost_tier: 'expensive', contexts: ['audit'],
    status: 'active', scope: { paths: ['**/*'] }, evaluator: { type: 'judgment', run: 'skill:audit-x' },
    flake_contract: { eval_scenario: 'runtime/eval/scenarios/j.scenario.mjs', allowed_flake_rate: 0.1, calibration: 'x' },
    provenance: { minted_by: 'x' } };
  const judge = async () => [{ detail: 'judged violation', scope: ['a'] }];
  const { kind, invoke } = resolveEvaluator({ check, judge });
  assert.equal(kind, 'judgment');
  const findings = await invoke();
  assert.equal(findings[0].detail, 'judged violation');
});
