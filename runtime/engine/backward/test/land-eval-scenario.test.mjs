import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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
