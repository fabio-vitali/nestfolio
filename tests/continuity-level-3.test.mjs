// MI-003 Level 3 (Work) — bounded success scenarios S1-S10 and mandatory
// failure scenarios F1-F12. Temporary fixtures live outside every repository
// (os.tmpdir) and are removed with an absence proof.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  applyTransition,
  buildCandidates,
  dispatch,
  rebuildBrief,
  runFailureScenario,
  verifyArtifacts,
} from '../continuity/level-3/bin/continuity-work.mjs';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const L3 = (n) => join(ROOT, 'continuity', 'level-3', n);
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const REV = 'fd5e58b35e665fa5fa0db3c2c31ea5561442f9b6';

const PERMITTED_ADDITIONS = new Set([
  'continuity/level-3/bin/continuity-work.mjs',
  'continuity/level-3/schema/work-artifacts.schema.json',
  'continuity/level-3/candidates.json',
  'continuity/level-3/work-selection.json',
  'continuity/level-3/work.json',
  'continuity/level-3/working-set.json',
  'continuity/level-3/scope.json',
  'continuity/level-3/route.json',
  'continuity/level-3/work-brief.json',
  'tests/continuity-level-3.test.mjs',
  'continuity/evidence/mi-003/00-repository-bindings.json',
  'continuity/evidence/mi-003/01-candidate-discovery.json',
  'continuity/evidence/mi-003/02-selection-scope-and-route.json',
  'continuity/evidence/mi-003/03-success-scenarios.json',
  'continuity/evidence/mi-003/04-mandatory-failures.json',
  'continuity/evidence/mi-003/05-preservation-and-rollback.json',
  'continuity/evidence/mi-003/06-criterion-matrix-and-verdict.json',
  'continuity/evidence/mi-003/commands/01-level3-tests.json',
  'continuity/evidence/mi-003/commands/02-level2-tests.json',
  'continuity/evidence/mi-003/commands/03-level1-tests.json',
  'continuity/evidence/mi-003/commands/04-backlog-next-tests.json',
  'continuity/evidence/mi-003/commands/05-final-changed-files.json',
]);

// Lower-level identities pinned at the MI-003-R2 start revision.
const PINNED = {
  '.claude/skills/backlog-next/SKILL.md':
    'e56fd21ae6bb53dfdd2d5d0d239a0200d49d69c82bb171f3336b837a91124cd1',
  'continuity/level-1/pack-lock.json':
    '701caacfce402077dd77659669768759a6c6d4613a94e6abb8e68248f44a8da9',
  'continuity/level-2/packs.lock.json':
    '0d0e6b52eb5aab3957d51abb432b5baa4c4911880151de8c96a9e4f7c90bb63c',
  'package.json': '07b935ab66c83752ebffdeea942a57abac598b18c568b39c027534c6edd2357c',
};

test('S1: candidate projection rebuilds byte-identically from canonical sources', () => {
  const committed = readFileSync(L3('candidates.json'));
  const first = buildCandidates({ repoRoot: ROOT, rev: REV });
  const second = buildCandidates({ repoRoot: ROOT, rev: REV });
  assert.equal(sha256(first), sha256(second), 'two rebuilds must be byte-identical');
  assert.equal(sha256(first), sha256(committed), 'rebuild must equal the committed candidates.json');
});

test('S2: every considered source entry carries typed rationale and exact identity', () => {
  const cand = readJson(L3('candidates.json'));
  const rationales = new Set([
    'EXCLUDED_ACTIVE_ROUTE_CONFLICT',
    'EXCLUDED_AMBIGUOUS_MAPPING',
    'EXCLUDED_EPIC_ORCHESTRATION',
    'EXCLUDED_HARD_DEPENDENCY_BLOCKED',
    'EXCLUDED_TERMINAL_DROPPED',
    'EXCLUDED_TERMINAL_SHIPPED',
    'INCLUDED_OPEN_PARKING',
    'INCLUDED_OPEN_QUEUED',
  ]);
  assert.equal(cand.entries.length, cand.considered_count);
  for (const e of cand.entries) {
    assert.ok(rationales.has(e.rationale_type), `typed rationale on ${e.source_path}`);
    assert.equal(typeof e.eligibility, 'boolean');
    assert.match(e.source_sha256, /^[0-9a-f]{64}$/);
    assert.match(e.source_blob_sha1, /^[0-9a-f]{40}$/);
    assert.equal(e.source_revision, REV);
    assert.ok(e.source_path.startsWith('docs/backlog/'));
  }
});

test('S3: exactly one eligible candidate matches the recorded human selection', () => {
  const cand = readJson(L3('candidates.json'));
  const sel = readJson(L3('work-selection.json'));
  const t = sel.source_tuple;
  const matches = cand.entries.filter(
    (e) =>
      e.source_path === t.source_path &&
      e.source_local_identity === t.source_local_identity &&
      e.source_revision === t.source_revision &&
      e.source_sha256 === t.source_sha256,
  );
  assert.equal(matches.length, 1);
  assert.equal(matches[0].eligibility, true);
  assert.equal(sel.selection_revision, 1);
  assert.ok(sel.actor_statement.length > 0, 'human actor statement recorded');
});

test('S4: WorkSelection, Work, Working Set, and Scope are referentially and digest consistent', () => {
  const result = verifyArtifacts({ repoRoot: ROOT, root: ROOT });
  assert.equal(result.status, 'ready');
  const sel = readJson(L3('work-selection.json'));
  const work = readJson(L3('work.json'));
  const wsSet = readJson(L3('working-set.json'));
  const scope = readJson(L3('scope.json'));
  assert.equal(work.identity, sel.source_tuple.source_local_identity);
  assert.equal(work.source.source_sha256, sel.source_tuple.source_sha256);
  assert.equal(wsSet.work.identity, work.identity);
  assert.equal(wsSet.work.selection_revision, sel.selection_revision);
  assert.equal(scope.source_identity, work.identity);
  assert.equal(scope.digest.source_sha256, work.source.source_sha256);
  assert.equal(scope.digest.candidates_projection_sha256, sel.candidates_projection_sha256);
});

test('S5: Scope states includes, exclusions, outputs, criteria, evidence, and prohibited effects', () => {
  const scope = readJson(L3('scope.json'));
  const work = readJson(L3('work.json'));
  for (const k of [
    'include_paths',
    'excluded_paths',
    'immutable_paths',
    'permitted_effects',
    'prohibited_effects',
    'non_goals',
    'outputs',
    'criteria',
    'validation_requirements',
  ]) {
    assert.ok(Array.isArray(scope[k]) && scope[k].length > 0, `scope.${k} non-empty`);
  }
  assert.ok(work.evidence_requirements.length > 0, 'evidence requirements explicit');
});

test('S6: route identifies one Level 3 target authority while backlog remains planning authority', () => {
  const route = readJson(L3('route.json'));
  assert.equal(route.authority_declared, true);
  assert.equal(route.authority_level, 'level-3');
  assert.equal(route.active, true);
  assert.equal(route.state, 'active');
  assert.equal(route.run_store, null);
  assert.equal(route.owning_command_family, 'continuity-work');
  assert.equal(route.no_conflict.result, 'no-conflict');
  assert.match(route.planning_authority, /docs\/backlog/);
  assert.equal(
    route.route_target.work_identity,
    'dashboard-bff-awaiting-confirmation-activity-gap',
  );
});

test('S7: Work Brief rebuild is byte-identical and states absent Level 4-6 guarantees', () => {
  const committed = readFileSync(L3('work-brief.json'));
  const first = rebuildBrief({ root: ROOT });
  const second = rebuildBrief({ root: ROOT });
  assert.equal(sha256(first), sha256(second));
  assert.equal(sha256(first), sha256(committed));
  const brief = JSON.parse(first.toString('utf8'));
  const text = JSON.stringify(brief.absent_guarantees);
  for (const lvl of ['Level 4', 'Level 5', 'Level 6']) assert.match(text, new RegExp(lvl));
  assert.match(brief.disclaimer, /no execution authorization/);
});

test('S8: isolated return and cancel preserve source and history and disable the target route', () => {
  for (const kind of ['return', 'cancel']) {
    const tmp = mkdtempSync(join(os.tmpdir(), `mi003-s8-${kind}-`));
    cpSync(L3(''), join(tmp, 'continuity', 'level-3'), { recursive: true });
    const before = {
      route: readJson(join(tmp, 'continuity', 'level-3', 'route.json')),
      selection: sha256(readFileSync(join(tmp, 'continuity', 'level-3', 'work-selection.json'))),
      work: sha256(readFileSync(join(tmp, 'continuity', 'level-3', 'work.json'))),
    };
    const result = applyTransition({
      at: '2026-07-16T00:00:00.000Z',
      kind,
      root: tmp,
      statement: `isolated ${kind} rollback proof`,
    });
    assert.equal(result.status, 'ready');
    const after = readJson(join(tmp, 'continuity', 'level-3', 'route.json'));
    assert.equal(after.active, false);
    assert.equal(after.state, kind === 'return' ? 'returned' : 'cancelled');
    assert.equal(after.reactivation_requires, 'new-explicit-selection-revision');
    assert.deepEqual(after.route_target, before.route.route_target, 'source tuple preserved');
    assert.equal(after.transitions.length, before.route.transitions.length + 1);
    assert.deepEqual(
      after.transitions.slice(0, -1),
      before.route.transitions,
      'history preserved',
    );
    assert.equal(
      sha256(readFileSync(join(tmp, 'continuity', 'level-3', 'work-selection.json'))),
      before.selection,
      'selection record untouched',
    );
    assert.equal(
      sha256(readFileSync(join(tmp, 'continuity', 'level-3', 'work.json'))),
      before.work,
      'work record untouched',
    );
    rmSync(tmp, { recursive: true, force: true });
    assert.equal(existsSync(tmp), false, 'fixture removed with absence proof');
  }
  // The real route remains active and untouched.
  const real = readJson(L3('route.json'));
  assert.equal(real.active, true);
  assert.equal(real.state, 'active');
});

test('S9: lower-level identities (Level 1, Level 2, backlog-next, package) remain exact', () => {
  for (const [rel, expected] of Object.entries(PINNED)) {
    assert.equal(sha256(readFileSync(join(ROOT, rel))), expected, rel);
  }
});

test('S10: no pre-existing tracked byte changed; additions confined to the permitted create set', () => {
  const out = execFileSync('git', ['-C', ROOT, 'status', '--porcelain', '-uall'], {
    encoding: 'utf8',
  });
  for (const line of out.split('\n')) {
    if (!line) continue;
    assert.ok(line.startsWith('?? '), `no tracked mutation: ${line}`);
    const path = line.slice(3).trim();
    assert.ok(PERMITTED_ADDITIONS.has(path), `addition within permitted set: ${path}`);
  }
});

for (const id of ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12']) {
  test(`${id}: blocks fail-closed with the exact typed diagnostic`, async () => {
    const record = await runFailureScenario(id, { repoRoot: ROOT, root: ROOT });
    assert.equal(record.observed_diagnostic, record.expected_diagnostic, id);
    assert.equal(record.exit_code, 1);
    assert.equal(record.cleanup_absent, true, 'fixture removed with absence proof');
  });
}

test('F11 command surface: execute/run/implement are refused as prohibited work execution', async () => {
  for (const command of ['execute', 'run', 'implement']) {
    const result = await dispatch(command, { root: ROOT });
    assert.equal(result.status, 'blocked');
    assert.equal(result.code, 'WORK_EXECUTION_PROHIBITED');
  }
});
