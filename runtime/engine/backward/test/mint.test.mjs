import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runMint } from '../lib/mint.mjs';
import { inMemoryJournal } from '../lib/capabilities.mjs';
import { withTmpContent, writeDossier } from './_fixtures.mjs';

const proposal = (over = {}) => ({
  id: 'no-ddb-scan', property: 'No ScanCommand', kind: 'drift',
  evaluator: { type: 'deterministic', run: 'cmd:node tools/check-no-ddb-scan.mjs' },
  cost_tier: 'cheap', contexts: ['invariant', 'gate'],
  scope: { paths: ['services/**/src/**/*.ts'], dossiers: ['feedback_no_scan_no_filter.md'] },
  eval_scenario: { path: 'runtime/eval/scenarios/no-ddb-scan.scenario.mjs', fixtures: { good: ['g'], bad: ['b'] }, target_pass_rate: 1.0 },
  rationale: 'meets all three gates', gates: { mechanizable: true, recurring: true, stillIntended: true }, ...over,
});
const seed = (lessonsDir) => writeDossier(lessonsDir, 'feedback_no_scan_no_filter', { name: 'S', description: 'd', type: 'feedback' });
const args = (dirs, over) => ({ item: { id: 'no-ddb-scan-guard' }, lesson: 'feedback_no_scan_no_filter.md', proposal: proposal(), journal: inMemoryJournal(), checksDir: dirs.checksDir, dossierRoot: dirs.lessonsDir, scenariosDir: dirs.scenariosDir, ...over });

test('MI1 §11.1-1/2 human ratify → kind minted, all three side-effects', () =>
  withTmpContent(async (dirs) => {
    seed(dirs.lessonsDir);
    const r = await runMint(args(dirs, { ask: async (d) => ({ decisionId: d.id, value: 'ratify' }) }));
    assert.equal(r.kind, 'minted');
    assert.ok(existsSync(join(dirs.checksDir, 'no-ddb-scan.yaml')));
    assert.equal(r.mints[0].check, 'no-ddb-scan');
  }));

test('MI2 §11.1-3 --auto/headless → kind paused, sentinel, NO yaml, NO mints', () =>
  withTmpContent(async (dirs) => {
    seed(dirs.lessonsDir);
    const r = await runMint(args(dirs));   // default headless ask
    assert.equal(r.kind, 'paused');
    assert.match(r.sentinel, /HARNESS-PAUSE: mint no-ddb-scan/);
    assert.equal(existsSync(join(dirs.checksDir, 'no-ddb-scan.yaml')), false);
  }));

test('MI3 §11.1-4 decline → kind declined, no yaml, no scenario, no mints', () =>
  withTmpContent(async (dirs) => {
    seed(dirs.lessonsDir);
    const r = await runMint(args(dirs, { ask: async (d) => ({ decisionId: d.id, value: 'decline' }) }));
    assert.equal(r.kind, 'declined');
    assert.equal(existsSync(join(dirs.checksDir, 'no-ddb-scan.yaml')), false);
    assert.equal(existsSync(join(dirs.scenariosDir, 'no-ddb-scan.scenario.mjs')), false);
  }));

test('MI4 §11.1-6 retrieval-only lesson (gate 1 fails) → kind rejected, nothing drafted', () =>
  withTmpContent(async (dirs) => {
    seed(dirs.lessonsDir);
    const r = await runMint(args(dirs, { proposal: proposal({ gates: { mechanizable: false, recurring: true, stillIntended: true } }), ask: async (d) => ({ decisionId: d.id, value: 'ratify' }) }));
    assert.equal(r.kind, 'rejected');
  }));
