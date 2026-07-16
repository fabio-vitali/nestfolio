// MI-004 Level 4 (Context Formation) — bounded success scenarios S1-S10 and
// mandatory failure scenarios F1-F12. Temporary fixtures live outside every
// repository (os.tmpdir) and are removed with an absence proof.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  applyDisposition,
  buildAdapterView,
  checkStaleness,
  dispatch,
  formCandidate,
  runFailureScenario,
  validateCandidate,
} from '../continuity/level-4/bin/continuity-context.mjs';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const L4 = (n) => join(ROOT, 'continuity', 'level-4', n);
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const REV = 'b9d7264082322e09cfd233819b79f128ef912e31';

const PERMITTED_ADDITIONS = new Set([
  'continuity/level-4/bin/continuity-context.mjs',
  'continuity/level-4/schema/context-artifacts.schema.json',
  'continuity/level-4/context-recipe.json',
  'continuity/level-4/formation-trace.json',
  'continuity/level-4/context-pack.json',
  'continuity/level-4/validation-result.json',
  'continuity/level-4/authorization-record.json',
  'continuity/level-4/adapter-view.json',
  'tests/continuity-level-4.test.mjs',
  'continuity/evidence/mi-004/00-repository-bindings.json',
  'continuity/evidence/mi-004/01-formation-and-trace.json',
  'continuity/evidence/mi-004/02-validation-and-authorization.json',
  'continuity/evidence/mi-004/03-success-scenarios.json',
  'continuity/evidence/mi-004/04-mandatory-failures.json',
  'continuity/evidence/mi-004/05-preservation-and-rollback.json',
  'continuity/evidence/mi-004/06-criterion-matrix-and-verdict.json',
  'continuity/evidence/mi-004/commands/01-level4-tests.json',
  'continuity/evidence/mi-004/commands/02-level3-tests.json',
  'continuity/evidence/mi-004/commands/03-level2-tests.json',
  'continuity/evidence/mi-004/commands/04-level1-tests.json',
  'continuity/evidence/mi-004/commands/05-backlog-next-tests.json',
  'continuity/evidence/mi-004/commands/06-final-changed-files.json',
]);

// Lower-level identities pinned at the MI-004 start revision.
const PINNED = {
  '.claude/skills/backlog-next/SKILL.md':
    'e56fd21ae6bb53dfdd2d5d0d239a0200d49d69c82bb171f3336b837a91124cd1',
  'continuity/level-1/pack-lock.json':
    '701caacfce402077dd77659669768759a6c6d4613a94e6abb8e68248f44a8da9',
  'continuity/level-2/packs.lock.json':
    '0d0e6b52eb5aab3957d51abb432b5baa4c4911880151de8c96a9e4f7c90bb63c',
  'continuity/level-3/candidates.json':
    '1c292f2f21c9226e4074cab0645323f959374618916a660fc01117c0f08f5f12',
  'continuity/level-3/route.json':
    '0ed84d148428125c0700969921d03fefb914819333d4848d4b262193f1c13d11',
  'continuity/level-3/scope.json':
    'db7a45278e8f4a270552e3ae1db3695b70e07d1624b27bcdc28f6417883a5ad6',
  'continuity/level-3/work-brief.json':
    'dc50b59f42a72de0bee1b36c888596e8a19a347fb37559237a3a90272f9e60da',
  'continuity/level-3/work-selection.json':
    'b01555e1ec65b4f232d008c82d7d2a22e0b94ac5a0b0a43410397f8638a1848c',
  'continuity/level-3/work.json':
    'b23812bb0999f962856556516945bf82297642140f808d24cdd52e9341381936',
  'continuity/level-3/working-set.json':
    'e24fe112a6947d1959a2f4fa6d0083e34ea1a2614347487eaba747bcaab64b97',
  'docs/backlog/dashboard-bff-awaiting-confirmation-activity-gap.md':
    'b656733991c96c4275d11e9a9f2bff7f5ac72cdd298cbc68a4b94b6799dc742d',
  'package.json': '07b935ab66c83752ebffdeea942a57abac598b18c568b39c027534c6edd2357c',
  'tests/continuity-level-1.test.mjs':
    'e08f981817e5c6b18f25e51900200e99723a60b90a423ee600c90684041ad19d',
  'tests/continuity-level-2.test.mjs':
    '00ac0c226790763408fe1bbc9b186e8fd75e4ef37bdfd2f5a17dd192e68c6e1a',
  'tests/continuity-level-3.test.mjs':
    'b6fd45d09da9c2c27ff4cf80a51b05f3efecb8340e1441f5405211734c4be500',
};

test('S1: formation rebuilds context-pack and formation-trace byte-identically', () => {
  const committedPack = readFileSync(L4('context-pack.json'));
  const committedTrace = readFileSync(L4('formation-trace.json'));
  const first = formCandidate({ repoRoot: ROOT, rev: REV, root: ROOT });
  const second = formCandidate({ repoRoot: ROOT, rev: REV, root: ROOT });
  assert.equal(sha256(first.packBytes), sha256(second.packBytes), 'two rebuilds are byte-identical');
  assert.equal(sha256(first.traceBytes), sha256(second.traceBytes));
  assert.equal(sha256(first.packBytes), sha256(committedPack), 'rebuild equals the committed context-pack.json');
  assert.equal(sha256(first.traceBytes), sha256(committedTrace), 'rebuild equals the committed formation-trace.json');
});

test('S2: every considered source carries a typed disposition with owner, revision, and SHA-256', () => {
  const trace = readJson(L4('formation-trace.json'));
  const dispositions = new Set(['included-delivered', 'included-referenced', 'inspect-only', 'excluded']);
  assert.ok(trace.considered_sources.length >= 60, 'the declared read-only scope is enumerated');
  for (const e of trace.considered_sources) {
    assert.ok(dispositions.has(e.disposition), `typed disposition on ${e.source_path}`);
    assert.ok(e.reason.length > 0, 'explicit inclusion/exclusion reason');
    assert.ok(e.owner.length > 0, 'explicit owner');
    assert.equal(e.source_revision, REV);
    assert.match(e.source_sha256, /^[0-9a-f]{64}$/);
    assert.match(e.source_blob_sha1, /^[0-9a-f]{40}$/);
  }
  assert.equal(trace.stages.length, 12, 'all twelve DR-0011 stages recorded');
});

test('S3: validation covers structural, scope, lock, capability, contradiction, and completeness on the exact digest', () => {
  const committed = readFileSync(L4('validation-result.json'));
  const pack = readFileSync(L4('context-pack.json'));
  const { bytes, result } = validateCandidate({ expectedDigest: sha256(pack), repoRoot: ROOT, rev: REV, root: ROOT });
  assert.equal(sha256(bytes), sha256(committed), 'revalidation equals the committed validation-result.json');
  assert.equal(result.result, 'valid');
  assert.equal(result.candidate.sha256, sha256(pack), 'validation binds the exact candidate digest');
  for (const family of ['structural.', 'scope.', 'lock.', 'capability.', 'contradiction.', 'completeness.']) {
    assert.ok(result.rules.some((r) => r.id.startsWith(family)), `rule family ${family}`);
  }
  assert.ok(result.rules.every((r) => r.result === 'pass'));
});

test('S4: exactly one explicit human authorization matches the validated version and digest', () => {
  const record = readJson(L4('authorization-record.json'));
  const pack = readFileSync(L4('context-pack.json'));
  const packValue = JSON.parse(pack.toString('utf8'));
  assert.equal(record.status, 'authorized');
  assert.equal(record.authorized.identity, packValue.identity);
  assert.equal(record.authorized.version, packValue.version);
  assert.equal(record.authorized.sha256, sha256(pack), 'authorized digest equals the pack bytes');
  assert.ok(record.actor.includes('fabio.vitali'), 'named human actor');
  assert.ok(record.actor_statement.includes(record.authorized.sha256), 'the exact human statement names the digest');
  assert.match(record.permitted_scope_of_use, /never execution of the selected effort/);
});

test('S5: isolated rejection preserves the non-authorized candidate with rationale', () => {
  const tmp = mkdtempSync(join(os.tmpdir(), 'mi004-s5-'));
  cpSync(L4(''), join(tmp, 'continuity', 'level-4'), { recursive: true });
  rmSync(join(tmp, 'continuity', 'level-4', 'authorization-record.json'));
  const before = sha256(readFileSync(join(tmp, 'continuity', 'level-4', 'context-pack.json')));
  const result = applyDisposition({
    actor: 'fixture reviewer', at: '2026-07-16T00:00:00.000Z', kind: 'reject', root: tmp,
    statement: 'isolated rejection proof: candidate is preserved non-authorized',
  });
  assert.equal(result.status, 'rejected');
  const record = readJson(join(tmp, 'continuity', 'level-4', 'authorization-record.json'));
  assert.equal(record.status, 'rejected');
  assert.equal(record.candidate.sha256, before, 'rejection binds the exact candidate digest');
  assert.equal(sha256(readFileSync(join(tmp, 'continuity', 'level-4', 'context-pack.json'))), before, 'pack bytes preserved');
  const blocked = (() => { try { buildAdapterView({ root: tmp }); return null; } catch (e) { return e.code; } })();
  assert.equal(blocked, 'UNAUTHORIZED_CONTEXT_DELIVERY', 'a rejected version is never delivered');
  rmSync(tmp, { force: true, recursive: true });
  assert.equal(existsSync(tmp), false, 'fixture removed with absence proof');
});

test('S6: isolated revocation disables delivery and returns the effort to Level 3', () => {
  const tmp = mkdtempSync(join(os.tmpdir(), 'mi004-s6-'));
  cpSync(L4(''), join(tmp, 'continuity', 'level-4'), { recursive: true });
  const before = sha256(readFileSync(join(tmp, 'continuity', 'level-4', 'context-pack.json')));
  const result = applyDisposition({
    actor: 'fixture authority', at: '2026-07-16T00:00:00.000Z', kind: 'revoke', root: tmp,
    statement: 'isolated revocation proof: delivery disabled, effort returns to Level 3',
  });
  assert.equal(result.status, 'revoked');
  assert.equal(result.effort_level, 'level-3');
  assert.equal(result.delivery, 'disabled');
  const record = readJson(join(tmp, 'continuity', 'level-4', 'authorization-record.json'));
  assert.equal(record.status, 'revoked');
  assert.equal(record.authorized.sha256, before, 'the authorized version identity is preserved');
  const blocked = (() => { try { buildAdapterView({ root: tmp }); return null; } catch (e) { return e.code; } })();
  assert.equal(blocked, 'UNAUTHORIZED_CONTEXT_DELIVERY', 'a revoked version is never delivered');
  assert.equal(sha256(readFileSync(join(tmp, 'continuity', 'level-4', 'context-pack.json'))), before, 'pack bytes preserved');
  rmSync(tmp, { force: true, recursive: true });
  assert.equal(existsSync(tmp), false, 'fixture removed with absence proof');
  // The real repository authorization remains untouched and authorized.
  assert.equal(readJson(L4('authorization-record.json')).status, 'authorized');
  assert.equal(readJson(join(ROOT, 'continuity', 'level-3', 'route.json')).state, 'active');
});

test('S7: adapter view rebuilds byte-identically, digest-matches, and states absent Level 5-6 guarantees', () => {
  const committed = readFileSync(L4('adapter-view.json'));
  const first = buildAdapterView({ root: ROOT });
  const second = buildAdapterView({ root: ROOT });
  assert.equal(sha256(first.bytes), sha256(second.bytes));
  assert.equal(sha256(first.bytes), sha256(committed), 'rebuild equals the committed adapter-view.json');
  const pack = readFileSync(L4('context-pack.json'));
  assert.equal(first.view.authorized_context_pack.sha256, sha256(pack), 'view digest-matches the authorized pack');
  assert.equal(first.view.delivery_provenance.derived_from_sha256, sha256(pack));
  const text = JSON.stringify(first.view.executor_receives.absent_guarantees);
  for (const lvl of ['Level 5', 'Level 6']) assert.match(text, new RegExp(lvl));
  assert.ok(first.view.omitted_inspect_only.length > 0, 'omitted inspect-only material listed with reasons');
});

test('S8: a changed source digest marks the pack stale with the exact changed dependency', () => {
  const tmp = mkdtempSync(join(os.tmpdir(), 'mi004-s8-'));
  cpSync(L4(''), join(tmp, 'continuity', 'level-4'), { recursive: true });
  cpSync(join(ROOT, 'continuity', 'level-3'), join(tmp, 'continuity', 'level-3'), { recursive: true });
  for (const rel of ['docs/backlog/dashboard-bff-awaiting-confirmation-activity-gap.md',
    'continuity/level-2/packs.lock.json', 'continuity/level-1/pack-lock.json', 'package.json']) {
    cpSync(join(ROOT, rel), join(tmp, rel));
  }
  assert.equal(checkStaleness({ root: tmp }).status, 'ready', 'fresh fixture is not stale');
  cpSync(join(ROOT, 'continuity', 'level-3', 'work.json'), join(tmp, 'continuity', 'level-3', 'scope.json'));
  let code = null;
  let message = '';
  try {
    checkStaleness({ root: tmp });
  } catch (e) {
    code = e.code;
    message = e.message;
  }
  assert.equal(code, 'STALE_CONTEXT_DEPENDENCY');
  assert.match(message, /continuity\/level-3\/scope\.json/, 'the exact changed dependency is named');
  const blocked = (() => { try { buildAdapterView({ root: tmp }); return null; } catch (e) { return e.code; } })();
  assert.equal(blocked, 'STALE_CONTEXT_DEPENDENCY', 'delivery blocks while stale');
  rmSync(tmp, { force: true, recursive: true });
  assert.equal(existsSync(tmp), false, 'fixture removed with absence proof');
});

test('S9: lower-level identities (Levels 1-3, backlog-next, suites, package) remain exact', () => {
  for (const [rel, expected] of Object.entries(PINNED)) {
    assert.equal(sha256(readFileSync(join(ROOT, rel))), expected, rel);
  }
});

test('S10: no pre-existing tracked byte changed; additions confined to the permitted create set', () => {
  const out = execFileSync('git', ['-C', ROOT, 'status', '--porcelain', '-uall'], { encoding: 'utf8' });
  for (const line of out.split('\n')) {
    if (!line) continue;
    assert.ok(line.startsWith('?? '), `no tracked mutation: ${line}`);
    const path = line.slice(3).trim();
    assert.ok(PERMITTED_ADDITIONS.has(path), `addition within permitted set: ${path}`);
  }
});

for (const id of ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12']) {
  test(`${id}: blocks fail-closed with the exact typed diagnostic`, async () => {
    const record = await runFailureScenario(id, { repoRoot: ROOT, rev: REV, root: ROOT });
    assert.equal(record.observed_diagnostic, record.expected_diagnostic, id);
    assert.equal(record.exit_code, 1);
    assert.equal(record.cleanup_absent, true, 'fixture removed with absence proof');
  });
}

test('command surface: execute/run/implement and higher-level claims are refused', async () => {
  for (const command of ['execute', 'run', 'implement']) {
    const result = await dispatch(command, { root: ROOT });
    assert.equal(result.status, 'blocked');
    assert.equal(result.code, 'WORK_EXECUTION_PROHIBITED');
  }
  for (const claim of ['session', 'run', 'checkpoint', 'handoff', 'evidence', 'guard', 'decision', 'lesson', 'auto-authorization']) {
    const result = await dispatch('claim', { root: ROOT, type: claim });
    assert.equal(result.status, 'blocked');
    assert.equal(result.code, 'FORBIDDEN_HIGHER_LEVEL_CLAIM');
  }
});
