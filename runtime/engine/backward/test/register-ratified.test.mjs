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

test('RR1 ratify performs ALL THREE side-effects (yaml persisted + active + ratified stamped, scenario landed, mints reconciled)', () => {
  withTmpContent(({ checksDir, lessonsDir, scenariosDir }) => {
    seedLesson(lessonsDir);
    const res = registerRatified({ draft: validDraft(), floorApproval: true, journal: inMemoryJournal(), checksDir, dossierRoot: lessonsDir, scenariosDir });
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
  });
});

test('RR2 floorless ratify writes NO yaml, no decision (advanceLifecycle refuses)', () => {
  withTmpContent(({ checksDir, lessonsDir, scenariosDir }) => {
    seedLesson(lessonsDir);
    const res = registerRatified({ draft: validDraft(), floorApproval: false, journal: inMemoryJournal(), checksDir, dossierRoot: lessonsDir, scenariosDir });
    assert.equal(res.decision, null);
    assert.equal(res.event, 'REFUSED_NO_FLOOR');
    assert.equal(existsSync(join(checksDir, 'sample-mint.yaml')), false);
  });
});

test('RR3 replay (same journal_key) is a no-op returning the first result — no double-mint', () => {
  withTmpContent(({ checksDir, lessonsDir, scenariosDir }) => {
    seedLesson(lessonsDir);
    const journal = inMemoryJournal();
    const first = registerRatified({ draft: validDraft(), floorApproval: true, journal, checksDir, dossierRoot: lessonsDir, scenariosDir });
    const second = registerRatified({ draft: validDraft(), floorApproval: true, journal, checksDir, dossierRoot: lessonsDir, scenariosDir });
    assert.equal(second, first);
    const raw = readFileSync(join(lessonsDir, 'feedback_sample.md'), 'utf8');
    assert.equal(parse(/^---\n([\s\S]*?)\n---/.exec(raw)[1]).mints.length, 1);
  });
});
