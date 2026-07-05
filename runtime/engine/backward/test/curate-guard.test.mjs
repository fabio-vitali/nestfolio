import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
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
    const r = await curateGuard({ guard: activeGuard(), trigger: 'ship-gate', transition: 'keep', rationale: '', checksDir, dossierRoot: lessonsDir });
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
  withTmpContent(async ({ checksDir, lessonsDir, scenariosDir }) => {
    seed(lessonsDir);
    const r = await curateGuard({ guard: activeGuard(), trigger: 'ship-gate', transition: 'supersede', successor: successorDraft(), floorApproval: true, rationale: 'narrowed to GSI key attrs', checksDir, dossierRoot: lessonsDir, scenariosDir });
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

const successorDraft = (o = {}) => ({
  entry: validCheck({ id: 'no-ddb-scan-v2', status: 'active',
    provenance: { minted_by: 'narrow-ddb', lesson: 'feedback_x.md', ratified: '2026-07-04' }, ...(o.entry ?? {}) }),
  eval_scenario: { path: 'runtime/eval/scenarios/no-ddb-scan-v2.scenario.mjs',
    fixtures: { good: ['fixtures/no-ddb-scan-v2/good/ok.ts'], bad: ['fixtures/no-ddb-scan-v2/bad/violation.ts'] },
    target_pass_rate: 1.0 },
  rationale: 'narrowed to GSI key attrs',
  ...o.rest,
});

test('SUCC1 invalid successor entry → REFUSED_INVALID_SUCCESSOR before the journal step (no record, no disk)', () =>
  withTmpContent(async ({ checksDir, lessonsDir, scenariosDir }) => {
    seed(lessonsDir);
    const journal = inMemoryJournal();
    const bad = successorDraft(); delete bad.entry.property;                       // breaks CheckEntrySchema
    const r = await curateGuard({ guard: activeGuard(), trigger: 'ship-gate', transition: 'supersede',
      successor: bad, floorApproval: true, rationale: 'narrow', journal, checksDir, dossierRoot: lessonsDir, scenariosDir });
    assert.equal(r.event, 'REFUSED_INVALID_SUCCESSOR');
    assert.equal(r.decision, null);
    assert.equal(existsSync(join(checksDir, 'no-ddb-scan.yaml')), false);          // guard untouched
    assert.equal(existsSync(join(checksDir, 'no-ddb-scan-v2.yaml')), false);
    journal.begin('backward', { runId: 'backward', auto: false });
    assert.equal([...journal.read('backward').steps.keys()].length, 0);            // no journal record
  }));

test('SUCC2 valid successor → both YAMLs + landed scenario + chained provenance + mints re-aimed', () =>
  withTmpContent(async ({ checksDir, lessonsDir, scenariosDir }) => {
    seed(lessonsDir);
    const r = await curateGuard({ guard: activeGuard(), trigger: 'ship-gate', transition: 'supersede',
      successor: successorDraft(), floorApproval: true, rationale: 'narrow', checksDir, dossierRoot: lessonsDir, scenariosDir });
    assert.equal(r.check.provenance.superseded_by, 'no-ddb-scan-v2');
    assert.equal(r.successor.provenance.supersedes, 'no-ddb-scan');
    assert.ok(existsSync(join(checksDir, 'no-ddb-scan-v2.yaml')));
    assert.ok(existsSync(join(scenariosDir, 'no-ddb-scan-v2.scenario.mjs')));      // §2.2: full mint guarantees
    assert.equal(r.landing.check, 'no-ddb-scan-v2');
  }));

test('SUCC3 missing eval_scenario → refused (a successor without a scenario is a naked guard)', () =>
  withTmpContent(async ({ checksDir, lessonsDir, scenariosDir }) => {
    seed(lessonsDir);
    const noScenario = successorDraft(); delete noScenario.eval_scenario;
    const r = await curateGuard({ guard: activeGuard(), trigger: 'ship-gate', transition: 'supersede',
      successor: noScenario, floorApproval: true, rationale: 'narrow', checksDir, dossierRoot: lessonsDir, scenariosDir });
    assert.equal(r.event, 'REFUSED_INVALID_SUCCESSOR');
  }));

// Item-10 fault-injection teeth (redteam 2026-07-04): the floor-decided write ORDER (successor first,
// guard LAST as commit point) had zero coverage — swapping the two writes passed every test.
test('F-order: the guard YAML is the LAST write (commit point) — successor lands first', () =>
  withTmpContent(async ({ checksDir, lessonsDir, scenariosDir }) => {
    seed(lessonsDir);
    const seq = [];
    const persist = { mkdir: () => {}, write: (path) => seq.push(path) };
    await curateGuard({ guard: activeGuard(), trigger: 'ship-gate', transition: 'supersede',
      successor: successorDraft(), floorApproval: true, rationale: 'narrow',
      checksDir, dossierRoot: lessonsDir, scenariosDir, persist });
    assert.equal(seq.length, 2);
    assert.match(seq[0], /no-ddb-scan-v2\.yaml$/);      // successor FIRST
    assert.match(seq[1], /(?<!-v2)no-ddb-scan\.yaml$/); // guard write LAST — swapping the lines fails here
  }));

test('F-torn: a crash on the guard write leaves the guard ACTIVE on disk; the retry converges', () =>
  withTmpContent(async ({ checksDir, lessonsDir, scenariosDir }) => {
    seed(lessonsDir);
    writeFileSync(join(checksDir, 'no-ddb-scan.yaml'), stringify(activeGuard()), 'utf8');   // pre-existing ACTIVE guard
    const journal = inMemoryJournal();
    const guard = activeGuard();
    let calls = 0;
    const torn = { mkdir: mkdirSync, write: (p, body) => {
      if (++calls === 2) throw new Error('disk full');   // successor landed, guard write crashes
      writeFileSync(p, body);
    } };
    await assert.rejects(() => curateGuard({ guard, trigger: 'ship-gate', transition: 'supersede',
      successor: successorDraft(), floorApproval: true, rationale: 'narrow',
      journal, checksDir, dossierRoot: lessonsDir, scenariosDir, persist: torn }));
    const onDisk = parse(readFileSync(join(checksDir, 'no-ddb-scan.yaml'), 'utf8'));
    assert.equal(onDisk.status, 'active');                                   // guard NOT superseded on disk
    assert.equal(journal.read('backward'), null);                            // nothing journaled (step fn threw)
    const r = await curateGuard({ guard, trigger: 'ship-gate', transition: 'supersede',   // retry, default persist
      successor: successorDraft(), floorApproval: true, rationale: 'narrow',
      journal, checksDir, dossierRoot: lessonsDir, scenariosDir });
    assert.equal(r.decision.transition, 'supersede');
    assert.equal(parse(readFileSync(join(checksDir, 'no-ddb-scan.yaml'), 'utf8')).status, 'superseded');
  }));
