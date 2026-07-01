import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCurate } from '../lib/curate.mjs';
import { inMemoryJournal } from '../lib/capabilities.mjs';
import { withTmpContent, writeDossier, validCheck } from './_fixtures.mjs';

const guard = () => validCheck({ id: 'no-ddb-scan', status: 'active', provenance: { minted_by: 'g', lesson: 'feedback_x.md', ratified: '2026-07-02' } });
const finding = (kind = 'staleness') => ({ id: 'f1', check: 'no-ddb-scan', kind, scope: ['services/advisory/advisory-ctrl/**'], detail: 'zero files', raised_at: '2026-07-02T00:00:00Z' });
const seed = (d) => writeDossier(d, 'feedback_x', { name: 'X', description: 'd', type: 'feedback', mints: [{ check: 'no-ddb-scan', ratified: '2026-07-02', status: 'active' }] });

test('CU1 §11.3 dangling-scope + human retire → kind retired', () => {
  withTmpContent((dirs) => {
    seed(dirs.lessonsDir);
    const r = runCurate({ guard: guard(), trigger: 'dangling-scope', finding: finding(), rationale: 'advisory-ctrl removed', ask: () => ({ selected: 'retire' }), journal: inMemoryJournal(), checksDir: dirs.checksDir, dossierRoot: dirs.lessonsDir });
    assert.equal(r.kind, 'retired');
    assert.equal(r.check.status, 'retired');
  });
});

test('CU2 §11.2-3 sync guard-fail + human keep (default) → kind kept, no state change', () => {
  withTmpContent((dirs) => {
    seed(dirs.lessonsDir);
    const r = runCurate({ guard: guard(), trigger: 'ship-gate-blocking', finding: finding('drift'), ask: () => ({ selected: 'keep' }), journal: inMemoryJournal(), checksDir: dirs.checksDir, dossierRoot: dirs.lessonsDir });
    assert.equal(r.kind, 'kept');
    assert.equal(r.check.status, 'active');
  });
});

test('CU3 §11.2-4 --auto at a curate floor → kind paused (lowering a guard is a hard-floor act)', () => {
  withTmpContent((dirs) => {
    seed(dirs.lessonsDir);
    const r = runCurate({ guard: guard(), trigger: 'ship-gate-blocking', finding: finding('drift'), journal: inMemoryJournal(), checksDir: dirs.checksDir, dossierRoot: dirs.lessonsDir });
    assert.equal(r.kind, 'paused');
    assert.match(r.sentinel, /HARNESS-PAUSE: curate no-ddb-scan/);
  });
});

test('CU4 §11.2-2 sync + human supersede → kind superseded, successor active', () => {
  withTmpContent((dirs) => {
    seed(dirs.lessonsDir);
    const successor = validCheck({ id: 'no-ddb-scan-v2', status: 'active', provenance: { minted_by: 'narrow-ddb-filter-allowance', lesson: 'feedback_x.md', ratified: '2026-09-11' } });
    const r = runCurate({ guard: guard(), trigger: 'ship-gate-blocking', finding: finding('drift'), proposedSuccessor: successor, rationale: 'narrowed', ask: () => ({ selected: 'supersede' }), journal: inMemoryJournal(), checksDir: dirs.checksDir, dossierRoot: dirs.lessonsDir });
    assert.equal(r.kind, 'superseded');
    assert.equal(r.successor.provenance.supersedes, 'no-ddb-scan');
  });
});
