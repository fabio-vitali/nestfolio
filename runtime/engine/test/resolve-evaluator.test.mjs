import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEvaluator, scopedStagedFiles } from '../lib/resolve-evaluator.mjs';
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

// SF1 — cmd: check receives RUNTIME_STAGED_PATHS from stagedFiles; undefined → env unset; [] → ''
// (in-scope paths: since redteam item 8a the env carries staged∩scope — the narrowing test below pins that)
test('a cmd: check receives RUNTIME_STAGED_PATHS from stagedFiles', () => withTmpDir((root) => {
  const script = join(root, 's.mjs');
  writeFileSync(script, 'process.stdout.write(process.env.RUNTIME_STAGED_PATHS ?? "<unset>"); process.exit(1);', 'utf8');
  const check = validCheck({ evaluator: { type: 'deterministic', run: `cmd:node ${script}` } });
  const scoped = resolveEvaluator({ check, stagedFiles: ['services/a/x.ts', 'services/a/y.ts'] }).invoke();
  assert.equal(scoped[0].evidence, 'services/a/x.ts\nservices/a/y.ts');
  const audit = resolveEvaluator({ check }).invoke();
  assert.equal(audit[0].evidence, '<unset>');
  const empty = resolveEvaluator({ check, stagedFiles: [] }).invoke();
  assert.equal(empty[0].evidence, '');   // set-but-empty → '' (nothing staged), NOT <unset>
}));

// SF2 — scopedStagedFiles: undefined → whole scope; list → staged∩scope; empty intersection → []
test('scopedStagedFiles narrows staged files to the check scope', () => {
  const check = validCheck({ scope: { paths: ['libs/**/src/**/*.ts'] }, evaluator: { type: 'deterministic', run: 'eslint:@nx/enforce-module-boundaries' } });
  assert.deepEqual(scopedStagedFiles(check, undefined), ['libs/**/src/**/*.ts']);
  assert.deepEqual(scopedStagedFiles(check, ['libs/a/src/x.ts', 'services/b/src/y.ts']), ['libs/a/src/x.ts']);
  assert.deepEqual(scopedStagedFiles(check, []), []);
});

test('cmd: RUNTIME_STAGED_PATHS and attribution are staged ∩ scope, not the raw staged set', async () => {
  const check = {
    id: 'c1', property: 'p', kind: 'drift', cost_tier: 'cheap', contexts: ['gate'], status: 'active',
    scope: { paths: ['services/**/*.ts'] },
    evaluator: { type: 'deterministic',
      run: 'cmd:node -e "console.error(process.env.RUNTIME_STAGED_PATHS); process.exit(1)"' },
    provenance: { minted_by: 't', ratified: '2026-01-01' },
  };
  const { invoke } = resolveEvaluator({ check, stagedFiles: ['services/x/a.ts', 'docs/unrelated.md'] });
  const [f] = await invoke();
  assert.deepEqual(f.scope, ['services/x/a.ts']);            // attribution = intersection
  assert.match(f.evidence, /services\/x\/a\.ts/);            // env carried the narrowed list
  assert.ok(!f.evidence.includes('docs/unrelated.md'));      // out-of-scope path NOT passed
});
