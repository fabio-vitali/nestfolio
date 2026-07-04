import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { registerRatified } from '../lib/register-ratified.mjs';
import { inMemoryJournal } from '../lib/capabilities.mjs';
import { validateCheck } from '../../schema/check.schema.ts';
import { validDraft, withTmpContent, writeDossier } from './_fixtures.mjs';

const seedLesson = (lessonsDir) => writeDossier(lessonsDir, 'feedback_sample', { name: 'S', description: 'd', type: 'feedback' });

test('RR1 ratify performs ALL THREE side-effects (yaml persisted + active + ratified stamped, scenario landed, mints reconciled)', () =>
  withTmpContent(async ({ checksDir, lessonsDir, scenariosDir }) => {
    seedLesson(lessonsDir);
    const res = await registerRatified({ draft: validDraft(), floorApproval: true, journal: inMemoryJournal(), checksDir, dossierRoot: lessonsDir, scenariosDir });
    const yamlPath = join(checksDir, 'sample-mint.yaml');
    assert.ok(existsSync(yamlPath));
    const persisted = parse(readFileSync(yamlPath, 'utf8'));
    assert.equal(validateCheck(persisted).ok, true);
    assert.equal(persisted.status, 'active');
    assert.ok(persisted.provenance.ratified);
    assert.ok(existsSync(join(scenariosDir, 'sample-mint.scenario.mjs')));
    assert.equal(res.mints[0].check, 'sample-mint');
    assert.equal(res.decision.act, 'mint');
    assert.equal(res.decision.decided_by, 'human');
  }));

test('RR2 floorless ratify writes NO yaml, no decision (advanceLifecycle refuses)', () =>
  withTmpContent(async ({ checksDir, lessonsDir, scenariosDir }) => {
    seedLesson(lessonsDir);
    const res = await registerRatified({ draft: validDraft(), floorApproval: false, journal: inMemoryJournal(), checksDir, dossierRoot: lessonsDir, scenariosDir });
    assert.equal(res.decision, null);
    assert.equal(res.event, 'REFUSED_NO_FLOOR');
    assert.equal(existsSync(join(checksDir, 'sample-mint.yaml')), false);
  }));

test('RR3 replay (same journal_key) is a no-op returning the first result — no double-mint', () =>
  withTmpContent(async ({ checksDir, lessonsDir, scenariosDir }) => {
    seedLesson(lessonsDir);
    const journal = inMemoryJournal();
    const first = await registerRatified({ draft: validDraft(), floorApproval: true, journal, checksDir, dossierRoot: lessonsDir, scenariosDir });
    const second = await registerRatified({ draft: validDraft(), floorApproval: true, journal, checksDir, dossierRoot: lessonsDir, scenariosDir });
    assert.equal(second, first);
    const raw = readFileSync(join(lessonsDir, 'feedback_sample.md'), 'utf8');
    assert.equal(parse(/^---\n([\s\S]*?)\n---/.exec(raw)[1]).mints.length, 1);
  }));

test('EPOCH-M1 gen-2 ratify executes fresh under its own key; gen-1 record untouched', () =>
  withTmpContent(async ({ checksDir, lessonsDir, scenariosDir }) => {
    writeDossier(lessonsDir, 'feedback_sample', { name: 'S', description: 'd', type: 'feedback',
      mints: [{ check: 'sample-mint', ratified: '2026-07-01', status: 'retired' }] });
    const journal = inMemoryJournal();
    journal.begin('backward', { runId: 'backward', auto: false });   // meta needed for journal.read below
    // seed a COMPLETE gen-1 record — a naive epoch-less key would replay this and write nothing
    journal.record('backward', 'mint:sample-mint:g1:ratify', { stale: true });
    const draft = validDraft({ entry: { provenance: { minted_by: 'sample-item', lesson: 'feedback_sample.md', generation: 2 } } });
    const r = await registerRatified({ draft, floorApproval: true, journal, checksDir, dossierRoot: lessonsDir, scenariosDir });
    assert.equal(r.event, 'RATIFIED');
    assert.ok(existsSync(join(checksDir, 'sample-mint.yaml')));                       // gen-2 actually wrote
    assert.deepEqual(journal.read('backward').steps.get('mint:sample-mint:g1:ratify').value, { stale: true });  // gen-1 untouched
    const mints = parse(/^---\n([\s\S]*?)\n---/.exec(readFileSync(join(lessonsDir, 'feedback_sample.md'), 'utf8'))[1]).mints;
    assert.equal(mints.length, 2);
    assert.equal(mints[1].generation, 2);
  }));
