import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { landEvalScenario } from '../lib/land-eval-scenario.mjs';
import { validateEvalScenarioLanding } from '../schema/eval-landing.ts';
import { validDraft, withTmpContent } from './_fixtures.mjs';

test('LE1 landing a deterministic draft writes the scenario file + returns a valid landing (no flake_contract)', () => {
  withTmpContent(({ scenariosDir }) => {
    const landing = landEvalScenario({ draft: validDraft(), scenariosDir });
    assert.equal(validateEvalScenarioLanding(landing).ok, true);
    assert.equal(landing.evaluator_kind, 'deterministic');
    assert.equal(landing.flake_contract, undefined);
    assert.equal(landing.registered_via, 'harness:landScenario');
    assert.ok(existsSync(join(scenariosDir, 'sample-mint.scenario.mjs')));
    assert.match(readFileSync(join(scenariosDir, 'sample-mint.scenario.mjs'), 'utf8'), /export const scenario/);
  });
});

test('LE2 landing is idempotent — a second call does not rewrite (same content)', () => {
  withTmpContent(({ scenariosDir }) => {
    const first = landEvalScenario({ draft: validDraft(), scenariosDir });
    const body1 = readFileSync(first.scenario_path, 'utf8');
    const second = landEvalScenario({ draft: validDraft(), scenariosDir });
    assert.equal(second.scenario_path, first.scenario_path);
    assert.equal(readFileSync(second.scenario_path, 'utf8'), body1);
  });
});

test('LE3 a gen-2 re-mint REWRITES a stale gen-1 scenario file with the new content (epoch-aware)', () => {
  withTmpContent(({ scenariosDir }) => {
    const stalePath = join(scenariosDir, 'sample-mint.scenario.mjs');
    writeFileSync(stalePath, 'STALE CONTENT — pre-epoch-aware fixtures\n', 'utf8');
    const draft = validDraft({
      entry: { provenance: { minted_by: 'sample-item', lesson: 'feedback_sample.md', generation: 2 } },
      eval_scenario: { path: 'runtime/eval/scenarios/sample-mint.scenario.mjs',
        fixtures: { good: ['fixtures/sample-mint/good/new.ts'], bad: ['fixtures/sample-mint/bad/new.ts'] },
        target_pass_rate: 1.0 },
    });
    const landing = landEvalScenario({ draft, scenariosDir });
    const content = readFileSync(landing.scenario_path, 'utf8');
    assert.doesNotMatch(content, /STALE CONTENT/);
    assert.match(content, /fixtures\/sample-mint\/good\/new\.ts/);
  });
});

test('LE4 gen-1 (absent generation) does NOT overwrite an existing file — absent-only write still holds', () => {
  withTmpContent(({ scenariosDir }) => {
    const p = join(scenariosDir, 'sample-mint.scenario.mjs');
    writeFileSync(p, 'PRE-EXISTING CONTENT\n', 'utf8');
    const landing = landEvalScenario({ draft: validDraft(), scenariosDir });
    assert.equal(readFileSync(landing.scenario_path, 'utf8'), 'PRE-EXISTING CONTENT\n');
  });
});
