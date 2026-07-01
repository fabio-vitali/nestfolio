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
