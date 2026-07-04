import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { reconcileLesson } from '../lib/reconcile-lesson.mjs';
import { withTmpContent, writeDossier } from './_fixtures.mjs';

const front = () => ({ name: 'No scans', description: 'never scan', type: 'feedback' });
const readMints = (dir, name) => {
  const raw = readFileSync(join(dir, `${name}.md`), 'utf8');
  return parse(/^---\n([\s\S]*?)\n---/.exec(raw)[1]).mints;
};

test('RL1 ratify appends an active MintsEntry to a lesson with no mints yet', () => {
  withTmpContent(({ lessonsDir }) => {
    writeDossier(lessonsDir, 'feedback_x', front());
    const r = reconcileLesson({ lesson: 'feedback_x.md', check: 'no-ddb-scan', transition: 'ratify', ratified: '2026-07-02', dossierRoot: lessonsDir });
    assert.deepEqual(r.mints, [{ check: 'no-ddb-scan', ratified: '2026-07-02', status: 'active' }]);
    assert.deepEqual(readMints(lessonsDir, 'feedback_x'), r.mints);
  });
});

test('RL2 ratify is idempotent — re-ratifying the same check does not duplicate', () => {
  withTmpContent(({ lessonsDir }) => {
    writeDossier(lessonsDir, 'feedback_x', front());
    reconcileLesson({ lesson: 'feedback_x.md', check: 'no-ddb-scan', transition: 'ratify', ratified: '2026-07-02', dossierRoot: lessonsDir });
    const r = reconcileLesson({ lesson: 'feedback_x.md', check: 'no-ddb-scan', transition: 'ratify', ratified: '2026-07-02', dossierRoot: lessonsDir });
    assert.equal(r.mints.length, 1);
  });
});

test('RL3 retire flips the entry to retired (nothing removed)', () => {
  withTmpContent(({ lessonsDir }) => {
    writeDossier(lessonsDir, 'feedback_x', { ...front(), mints: [{ check: 'no-ddb-scan', ratified: '2026-07-02', status: 'active' }] });
    const r = reconcileLesson({ lesson: 'feedback_x.md', check: 'no-ddb-scan', transition: 'retire', dossierRoot: lessonsDir });
    assert.equal(r.mints[0].status, 'retired');
  });
});

test('RL4 supersede flips old→superseded+superseded_by AND appends successor active', () => {
  withTmpContent(({ lessonsDir }) => {
    writeDossier(lessonsDir, 'feedback_x', { ...front(), mints: [{ check: 'no-ddb-scan', ratified: '2026-07-02', status: 'active' }] });
    const r = reconcileLesson({ lesson: 'feedback_x.md', check: 'no-ddb-scan', transition: 'supersede', successor: 'no-ddb-scan-v2', ratified: '2026-09-11', dossierRoot: lessonsDir });
    const old = r.mints.find((e) => e.check === 'no-ddb-scan');
    const succ = r.mints.find((e) => e.check === 'no-ddb-scan-v2');
    assert.equal(old.status, 'superseded');
    assert.equal(old.superseded_by, 'no-ddb-scan-v2');
    assert.equal(succ.status, 'active');
  });
});

test('RL5 a lesson with no frontmatter throws (cannot reconcile)', () => {
  withTmpContent(({ lessonsDir }) => {
    const p = join(lessonsDir, 'bad.md');
    writeFileSync(p, 'no frontmatter here', 'utf8');
    assert.throws(() => reconcileLesson({ lesson: 'bad.md', check: 'x', transition: 'ratify', dossierRoot: lessonsDir }), /frontmatter/);
  });
});

test('EPOCH-R1 gen-2 ratify appends a second entry keyed (check, generation); gen-1 stays terminal', () =>
  withTmpContent(({ lessonsDir }) => {
    writeDossier(lessonsDir, 'feedback_g', { name: 'G', description: 'd', type: 'feedback',
      mints: [{ check: 'no-x', ratified: '2026-07-01', status: 'retired' }] });
    const { mints } = reconcileLesson({ lesson: 'feedback_g.md', check: 'no-x', transition: 'ratify',
      ratified: '2026-07-04', generation: 2, dossierRoot: lessonsDir });
    assert.equal(mints.length, 2);
    assert.equal(mints[0].status, 'retired');                       // gen-1 untouched
    assert.deepEqual(mints[1], { check: 'no-x', ratified: '2026-07-04', status: 'active', generation: 2 });
  }));

test('EPOCH-R2 retire targets only the matching generation', () =>
  withTmpContent(({ lessonsDir }) => {
    writeDossier(lessonsDir, 'feedback_g', { name: 'G', description: 'd', type: 'feedback',
      mints: [{ check: 'no-x', ratified: '2026-07-01', status: 'retired' },
              { check: 'no-x', ratified: '2026-07-04', status: 'active', generation: 2 }] });
    const { mints } = reconcileLesson({ lesson: 'feedback_g.md', check: 'no-x', transition: 'retire',
      generation: 2, dossierRoot: lessonsDir });
    assert.equal(mints[1].status, 'retired');
    assert.equal(mints[0].status, 'retired');                       // was already; untouched, not duplicated
  }));

test('EPOCH-R3 default generation=1 preserves existing behavior (idempotent ratify)', () =>
  withTmpContent(({ lessonsDir }) => {
    writeDossier(lessonsDir, 'feedback_g', { name: 'G', description: 'd', type: 'feedback',
      mints: [{ check: 'no-x', ratified: '2026-07-01', status: 'active' }] });
    const { mints } = reconcileLesson({ lesson: 'feedback_g.md', check: 'no-x', transition: 'ratify',
      ratified: '2026-07-04', dossierRoot: lessonsDir });
    assert.equal(mints.length, 1);                                  // no duplicate for (no-x, g1)
  }));
