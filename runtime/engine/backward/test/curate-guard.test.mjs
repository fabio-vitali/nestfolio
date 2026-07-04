import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { curateGuard } from '../lib/curate-guard.mjs';
import { inMemoryJournal } from '../lib/capabilities.mjs';
import { withTmpContent, writeDossier, validCheck } from './_fixtures.mjs';

const activeGuard = (o = {}) => validCheck({ id: 'no-ddb-scan', status: 'active',
  provenance: { minted_by: 'no-ddb-scan-guard', lesson: 'feedback_x.md', ratified: '2026-07-02' }, ...o });
const seed = (lessonsDir) => writeDossier(lessonsDir, 'feedback_x', { name: 'X', description: 'd', type: 'feedback',
  mints: [{ check: 'no-ddb-scan', ratified: '2026-07-02', status: 'active' }] });

test('CG1 keep is a NO-OP: no persist, no state change, never calls advanceLifecycle', () =>
  withTmpContent(async ({ checksDir, lessonsDir }) => {
    seed(lessonsDir);
    const r = await curateGuard({ guard: activeGuard(), trigger: 'ship-gate-blocking', transition: 'keep', rationale: '', checksDir, dossierRoot: lessonsDir });
    assert.equal(r.kept, true);
    assert.equal(r.check.status, 'active');
    assert.equal(existsSync(join(checksDir, 'no-ddb-scan.yaml')), false);
  }));

test('CG2 retire → status retired, retired_reason recorded, lesson mints entry flipped to retired', () =>
  withTmpContent(async ({ checksDir, lessonsDir }) => {
    seed(lessonsDir);
    const r = await curateGuard({ guard: activeGuard(), trigger: 'dangling-scope', transition: 'retire', floorApproval: true, rationale: 'code deleted', retiredReason: 'advisory-ctrl removed', checksDir, dossierRoot: lessonsDir });
    assert.equal(r.check.status, 'retired');
    assert.equal(r.check.provenance.retired_reason, 'advisory-ctrl removed');
    const mints = parse(/^---\n([\s\S]*?)\n---/.exec(readFileSync(join(lessonsDir, 'feedback_x.md'), 'utf8'))[1]).mints;
    assert.equal(mints[0].status, 'retired');
  }));

test('CG3 supersede → old superseded_by successor, successor active supersedes old, BOTH yamls persisted, mints re-aimed', () =>
  withTmpContent(async ({ checksDir, lessonsDir }) => {
    seed(lessonsDir);
    const successor = validCheck({ id: 'no-ddb-scan-v2', status: 'active', provenance: { minted_by: 'narrow-ddb-filter-allowance', lesson: 'feedback_x.md', ratified: '2026-09-11' } });
    const r = await curateGuard({ guard: activeGuard(), trigger: 'ship-gate-blocking', transition: 'supersede', successor, floorApproval: true, rationale: 'narrowed to GSI key attrs', checksDir, dossierRoot: lessonsDir });
    assert.equal(r.check.status, 'superseded');
    assert.equal(r.check.provenance.superseded_by, 'no-ddb-scan-v2');
    assert.equal(r.successor.provenance.supersedes, 'no-ddb-scan');
    assert.ok(existsSync(join(checksDir, 'no-ddb-scan.yaml')));
    assert.ok(existsSync(join(checksDir, 'no-ddb-scan-v2.yaml')));
    const mints = parse(/^---\n([\s\S]*?)\n---/.exec(readFileSync(join(lessonsDir, 'feedback_x.md'), 'utf8'))[1]).mints;
    assert.equal(mints.find((e) => e.check === 'no-ddb-scan').status, 'superseded');
    assert.equal(mints.find((e) => e.check === 'no-ddb-scan-v2').status, 'active');
  }));

test('CG4 floorless retire refuses — no persist', () =>
  withTmpContent(async ({ checksDir, lessonsDir }) => {
    seed(lessonsDir);
    const r = await curateGuard({ guard: activeGuard(), trigger: 'dangling-scope', transition: 'retire', floorApproval: false, rationale: 'x', checksDir, dossierRoot: lessonsDir });
    assert.equal(r.decision, null);
    assert.equal(existsSync(join(checksDir, 'no-ddb-scan.yaml')), false);
  }));

test('TORN-CURATE a throwing reconcile leaves the guard ACTIVE on disk and unrecorded — retry converges', () =>
  withTmpContent(async ({ checksDir, lessonsDir }) => {
    // NO dossier seeded → reconcileLesson throws ENOENT inside the step
    const journal = inMemoryJournal();
    const guard = activeGuard();
    await assert.rejects(() => curateGuard({ guard, trigger: 'dangling-scope', transition: 'retire',
      floorApproval: true, rationale: 'code deleted', retiredReason: 'gone', journal, checksDir, dossierRoot: lessonsDir }));
    assert.equal(existsSync(join(checksDir, 'no-ddb-scan.yaml')), false);   // guard NOT lowered on disk (the red-team hole)
    // retry after the operator fixes the dossier: same journal, same guard object — converges
    seed(lessonsDir);
    const r = await curateGuard({ guard, trigger: 'dangling-scope', transition: 'retire',
      floorApproval: true, rationale: 'code deleted', retiredReason: 'gone', journal, checksDir, dossierRoot: lessonsDir });
    assert.equal(r.check.status, 'retired');
    assert.ok(existsSync(join(checksDir, 'no-ddb-scan.yaml')));
  }));

test('EPOCH-C1 journal key carries the guard generation', () =>
  withTmpContent(async ({ checksDir, lessonsDir }) => {
    seed(lessonsDir);
    const journal = inMemoryJournal();
    const r = await curateGuard({ guard: activeGuard(), trigger: 'dangling-scope', transition: 'retire',
      floorApproval: true, rationale: 'x', retiredReason: 'x', journal, checksDir, dossierRoot: lessonsDir });
    assert.equal(r.decision.journal_key, 'curate:no-ddb-scan:g1:retire');
  }));
