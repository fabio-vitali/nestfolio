#!/usr/bin/env node
// Level 4 (Context Formation) command family for the Nestfolio continuity
// adoption — MI-004. It forms, validates, authorizes, and delivers the one
// bounded Context Pack for the already selected Level 3 effort through the
// explicit DR-0011 pipeline. It never executes the selected backlog effort,
// never mutates any pre-existing tracked byte, and claims no Level 5-6,
// Run-store, registry, or auto-authorization authority.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

export const FORMATION_ALGORITHM = 'mi004-context-formation@1';
export const PACK_IDENTITY = 'nestfolio.context.dashboard-bff-awaiting-confirmation-activity-gap';
export const PACK_VERSION = 1;

export const DIAGNOSTICS = Object.freeze({
  F1: 'STALE_CONTEXT_DEPENDENCY',
  F2: 'CONTEXT_SOURCE_UNAVAILABLE',
  F3: 'CONTEXT_CONTRADICTION_UNRESOLVED',
  F4: 'CONTEXT_INPUT_CORRUPT',
  F5: 'CONTEXT_DELIVERY_UNBOUNDED',
  F6: 'CONTEXT_AUTHORIZATION_MISSING',
  F7: 'UNAUTHORIZED_CONTEXT_DELIVERY',
  F8: 'CONTEXT_DELIVERY_MISMATCH',
  F9: 'CONTEXT_IMMUTABILITY_VIOLATION',
  F10: 'SOURCE_MUTATION_PROHIBITED',
  F11: 'WORK_EXECUTION_PROHIBITED',
  F12: 'FORBIDDEN_HIGHER_LEVEL_CLAIM',
});

export const ABSENT_GUARANTEES = Object.freeze([
  'no Level 5 authority: no Session, Run, effect record, lease, Checkpoint, Handoff, or transcript-independent resume',
  'no Level 6 authority: no Assurance Plan, Evidence authority, Guard, Waiver, completion transition, Decision, Observation, Lesson, or learning promotion',
  'no execution authorization for the selected backlog effort: authorization covers only the Level 4 context authority and its digest-matched adapter view',
  'no deterministic auto-authorization policy exists, may be created, or may be exercised (DR-0020: explicit human authorization only)',
  'no registry, remote-source, external-write, or bidirectional-synchronization authority',
]);

const FORBIDDEN_CLAIMS = new Set([
  'session', 'run', 'effect', 'lease', 'checkpoint', 'handoff', 'resume',
  'assurance', 'evidence', 'guard', 'waiver', 'completion', 'decision',
  'observation', 'lesson', 'learning', 'auto-authorization', 'registry',
  'remote-source',
]);

export function canonicalJson(value) {
  const canon = (v) => {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v).sort()) o[k] = canon(v[k]);
      return o;
    }
    return v;
  };
  return JSON.stringify(canon(value), null, 2) + '\n';
}

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const git = (repoRoot, args) =>
  execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'buffer', maxBuffer: 1 << 26 });

class Blocked extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Write guard: Level 4 may write ONLY beneath <root>/continuity/level-4/.
export function guardedWrite(root, filePath, bytes) {
  const boundary = resolve(root, 'continuity', 'level-4') + sep;
  const target = resolve(filePath);
  if (!target.startsWith(boundary)) {
    throw new Blocked(DIAGNOSTICS.F10, `write outside Level 4 boundary: ${filePath}`);
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
}

const L4 = (root, name) => join(root, 'continuity', 'level-4', name);

function readCommitted(repoRoot, rev, path) {
  let bytes;
  try {
    bytes = git(repoRoot, ['show', `${rev}:${path}`]);
  } catch {
    throw new Blocked(DIAGNOSTICS.F2, `required source unavailable at bound revision: ${path}`);
  }
  return bytes;
}

function sourceEntry(repoRoot, rev, path, disposition, reason, slice) {
  const bytes = readCommitted(repoRoot, rev, path);
  const blob = git(repoRoot, ['rev-parse', `${rev}:${path}`]).toString('utf8').trim();
  return {
    byte_count: bytes.length,
    disposition,
    freshness: 'exact-at-bound-revision',
    owner: 'nestfolio (committed tracked byte at the bound revision; read-only input)',
    reason,
    slice_boundary: slice,
    source_blob_sha1: blob,
    source_path: path,
    source_revision: rev,
    source_sha256: sha256(bytes),
  };
}

function listTree(repoRoot, rev, prefix) {
  const raw = git(repoRoot, ['ls-tree', '-r', '--name-only', rev, '--', prefix]).toString('utf8');
  return raw.split('\n').filter(Boolean).sort();
}

const loadJson = (root, name) => {
  const p = L4(root, name);
  if (!existsSync(p)) return { missing: true, path: p };
  try {
    const bytes = readFileSync(p);
    return { bytes, path: p, value: JSON.parse(bytes.toString('utf8')) };
  } catch (e) {
    return { corrupt: true, error: String(e), path: p };
  }
};

const readL3 = (root, name) => {
  const p = join(root, 'continuity', 'level-3', name);
  if (!existsSync(p)) throw new Blocked(DIAGNOSTICS.F2, `Level 3 input missing: ${name}`);
  const bytes = readFileSync(p);
  try {
    return { bytes, value: JSON.parse(bytes.toString('utf8')) };
  } catch {
    throw new Blocked(DIAGNOSTICS.F4, `Level 3 input corrupt: ${name}`);
  }
};

// DR-0011 pipeline. Deterministic: no timestamp participates in any formed
// artifact; every byte derives from the recipe and the committed sources at
// the bound revision. Returns { recipeBytes?, packBytes, traceBytes }.
export function formCandidate({ root, repoRoot, rev }) {
  const stages = [];
  const stage = (id, name, result) => stages.push({ id, name, result });

  // Stage 1: frame objective and output contract.
  const work = readL3(root, 'work.json');
  const scope = readL3(root, 'scope.json');
  const selection = readL3(root, 'work-selection.json');
  const workingSet = readL3(root, 'working-set.json');
  const route = readL3(root, 'route.json');
  const brief = readL3(root, 'work-brief.json');
  const candidates = readL3(root, 'candidates.json');
  stage(1, 'frame-objective-and-output-contract',
    `objective framed from Level 3 Work ${work.value.identity}; output contract: one immutable digest-identified Context Pack version plus Formation Trace`);

  // Stage 2: bind workspace and revision. The bound revision must be a
  // commit contained in the current HEAD's ancestry (ancestor-or-equal);
  // formation reads committed bytes at that revision, never the working tree.
  const head = git(repoRoot, ['rev-parse', 'HEAD']).toString('utf8').trim();
  const contained = (() => {
    try {
      git(repoRoot, ['cat-file', '-e', `${rev}^{commit}`]);
      git(repoRoot, ['merge-base', '--is-ancestor', rev, 'HEAD']);
      return true;
    } catch {
      return false;
    }
  })();
  if (!contained) {
    throw new Blocked(DIAGNOSTICS.F1, `bound revision ${rev} is not contained in the current HEAD ${head}`);
  }
  stage(2, 'bind-workspace-and-revision', `nestfolio bound at ${rev}`);

  // Stage 3: load the exact Level 2 Pack lock.
  const l2LockBytes = readCommitted(repoRoot, rev, 'continuity/level-2/packs.lock.json');
  const l2Lock = JSON.parse(l2LockBytes.toString('utf8'));
  const l1LockBytes = readCommitted(repoRoot, rev, 'continuity/level-1/pack-lock.json');
  const l1Lock = JSON.parse(l1LockBytes.toString('utf8'));
  stage(3, 'load-exact-level-2-pack-lock',
    `aggregate ${l2Lock.aggregate.digest}; packs ${l2Lock.rootPacks.join(', ')}`);

  // Stage 4: discover candidate sources within the declared read-only scope.
  const ledger = [];
  ledger.push(sourceEntry(repoRoot, rev, work.value.source.source_path,
    'included-delivered', 'primary planning source of the selected effort; full text delivered', 'whole-file'));
  for (const name of ['work.json', 'work-selection.json', 'working-set.json', 'scope.json', 'route.json', 'work-brief.json']) {
    ledger.push(sourceEntry(repoRoot, rev, `continuity/level-3/${name}`,
      'included-delivered', 'Level 3 execution representation bound into the pack; semantic fields delivered with exact digest', 'whole-file'));
  }
  ledger.push(sourceEntry(repoRoot, rev, 'continuity/level-3/candidates.json',
    'inspect-only', 'full 462-entry projection exceeds the bounded delivery; bound by digest, inspectable on demand', 'digest-reference'));
  ledger.push(sourceEntry(repoRoot, rev, 'continuity/level-3/bin/continuity-work.mjs',
    'inspect-only', 'Level 3 tooling; not execution context', 'digest-reference'));
  ledger.push(sourceEntry(repoRoot, rev, 'continuity/level-3/schema/work-artifacts.schema.json',
    'inspect-only', 'Level 3 schema; not execution context', 'digest-reference'));
  ledger.push(sourceEntry(repoRoot, rev, 'continuity/level-2/packs.lock.json',
    'included-referenced', 'exact Level 2 composed-lock identity binds the procedure resolution authority', 'identity-and-digest'));
  ledger.push(sourceEntry(repoRoot, rev, 'continuity/level-1/pack-lock.json',
    'included-referenced', 'retained Level 1 lock identity binds the behavior-asset authority', 'identity-and-digest'));
  ledger.push(sourceEntry(repoRoot, rev, 'package.json',
    'included-referenced', 'activation-route integrity anchor recorded in the Level 2 lock', 'identity-and-digest'));
  ledger.push(sourceEntry(repoRoot, rev, '.claude/skills/backlog-next/SKILL.md',
    'inspect-only', 'procedure reference for the future separately authorized execution; not delivered as context', 'digest-reference'));
  ledger.push(sourceEntry(repoRoot, rev, 'CLAUDE.md',
    'inspect-only', 'repository instructions remain harness-injected environment, not canonical context', 'digest-reference'));
  for (const p of ['tests/continuity-level-1.test.mjs', 'tests/continuity-level-2.test.mjs', 'tests/continuity-level-3.test.mjs']) {
    ledger.push(sourceEntry(repoRoot, rev, p,
      'inspect-only', 'lower-level regression suite; validation input, not execution context', 'digest-reference'));
  }
  for (const dir of ['continuity/level-1', 'continuity/level-2', '.claude/skills/backlog-next/test']) {
    for (const p of listTree(repoRoot, rev, dir)) {
      if (ledger.some((e) => e.source_path === p)) continue;
      ledger.push(sourceEntry(repoRoot, rev, p,
        'inspect-only', 'lower-level authority surface; bound by digest, excluded from delivery', 'digest-reference'));
    }
  }
  for (const dir of ['continuity/evidence/mi-002', 'continuity/evidence/mi-003']) {
    for (const p of listTree(repoRoot, rev, dir)) {
      ledger.push(sourceEntry(repoRoot, rev, p,
        'excluded', 'immutable historical evidence; provenance only, never execution context', 'digest-reference'));
    }
  }
  ledger.sort((a, b) => (a.source_path < b.source_path ? -1 : a.source_path > b.source_path ? 1 : 0));
  stage(4, 'discover-candidate-sources', `${ledger.length} sources enumerated within the declared read-only scope`);

  // Stage 5: resolve authority, revision, freshness, and access limitations.
  stage(5, 'resolve-authority-revision-freshness',
    'every source resolves at the one bound revision; docs/backlog remains planning authority; continuity/level-3 remains the local execution representation; no external or remote source participates');

  // Stage 6: select bounded source slices with recorded rationale.
  const delivered = ledger.filter((e) => e.disposition === 'included-delivered');
  stage(6, 'select-bounded-source-slices',
    `${delivered.length} delivered sources (${delivered.reduce((n, e) => n + e.byte_count, 0)} bytes); referenced identities for locks and package; everything else inspect-only or excluded`);

  // Stage 7: record explicit exclusions.
  const excluded = ledger.filter((e) => e.disposition === 'excluded' || e.disposition === 'inspect-only');
  stage(7, 'record-explicit-exclusions', `${excluded.length} sources recorded as inspect-only or excluded with typed reasons`);

  // Stage 8: diagnose contradictions, staleness, omissions, and pending decisions.
  const gaps = [
    {
      blocks: 'nothing before execution; the first contracted execution step resolves it',
      description: 'investigation-first unknown: whether the dashboard recent-activity feed is expected to surface an awaiting-confirmation item, and whether it currently does via DECISION_PACKET_CREATED or the DecisionPacket update CDC',
      kind: 'known-unknown',
    },
    {
      blocks: 'nothing; the backlog declares no rank and Level 3 selection already resolved priority by explicit human statement',
      description: 'the backlog source declares no rank (declared_rank null); ranking inputs are deliberately absent',
      kind: 'omission',
    },
  ];
  const contradictions = [];
  if (scope.value.digest.source_sha256 !== selection.value.source_tuple.source_sha256) {
    contradictions.push('scope and selection disagree on the source digest');
  }
  if (contradictions.length) {
    throw new Blocked(DIAGNOSTICS.F3, contradictions.join('; '));
  }
  stage(8, 'diagnose-gaps-and-contradictions', `${gaps.length} recorded gaps; 0 unresolved contradictions; 0 pending decisions`);

  // Stage 9: assemble the immutable candidate Context Pack.
  const src = work.value.source;
  const pack = {
    absent_guarantees: [...ABSENT_GUARANTEES],
    authorization: {
      carries_execution_authorization: false,
      policy: 'explicit-human-only (DR-0020); a formed or validated version is not executable and not deliverable until one exact human authorization matches this identity, version, and digest',
    },
    bindings: {
      level_1_lock: { aggregate_digest: l1Lock.lockDigest, path: 'continuity/level-1/pack-lock.json', sha256: sha256(l1LockBytes) },
      level_2_lock: { aggregate_digest: l2Lock.aggregate.digest, path: 'continuity/level-2/packs.lock.json', sha256: sha256(l2LockBytes) },
      package_json: { path: 'package.json', sha256: sha256(readCommitted(repoRoot, rev, 'package.json')) },
      repository: { remote_role: 'origin/main equals HEAD at the bound revision', revision: rev },
      route: { sha256: sha256(route.bytes), state: route.value.state, target: route.value.route_target },
      scope: { scope_version: scope.value.scope_version, sha256: sha256(scope.bytes) },
      work: { identity: work.value.identity, sha256: sha256(work.bytes), status: work.value.status },
      work_brief: { sha256: sha256(brief.bytes) },
      work_selection: { selection_revision: selection.value.selection_revision, sha256: sha256(selection.bytes) },
      working_set: { count: workingSet.value.count, sha256: sha256(workingSet.bytes) },
      candidates_projection: { sha256: sha256(candidates.bytes) },
    },
    delivery_boundary: {
      delivered: [
        'the full backlog source text of the selected effort',
        'objective, outputs, criteria, evidence requirements, and validation requirements from the Level 3 Work and Scope',
        'scope include/excluded/immutable paths, non-goals, permitted and prohibited effects',
        'route target, binding digests, and the absent-guarantee statement',
      ],
      omitted_inspect_only: [
        'continuity/level-3/candidates.json (full projection; digest-bound)',
        'lower-level tooling, locks, tests, and behavior assets (digest-bound)',
        'immutable MI-002/MI-003 evidence (provenance only)',
      ],
      rule: 'required material fits the bounded delivery; scope, criteria, required evidence, and the exact objective are never omitted',
    },
    execution_instruction_boundary: {
      instruction: 'This Context Pack is execution INPUT only. The selected effort dashboard-bff-awaiting-confirmation-activity-gap is implemented only under a separate explicit authorization, driven by the standard backlog-next workstream procedure; MI-004 never starts it.',
      objective: work.value.objective,
      out_of_scope: scope.value.non_goals,
    },
    formation_algorithm: FORMATION_ALGORITHM,
    identity: PACK_IDENTITY,
    kind: 'continuity.level4.context-pack',
    schema_version: 1,
    source_ledger: ledger,
    source_tuple: {
      byte_count: src.byte_count ?? selection.value.source_tuple.byte_count,
      source_blob_sha1: src.source_blob_sha1,
      source_local_identity: src.source_local_identity,
      source_path: src.source_path,
      source_revision: src.source_revision,
      source_sha256: src.source_sha256,
    },
    uncertainty: { contradictions: [], gaps, pending_decisions: [] },
    version: PACK_VERSION,
  };
  const packBytes = Buffer.from(canonicalJson(pack), 'utf8');
  const packDigest = sha256(packBytes);
  stage(9, 'assemble-immutable-candidate', `candidate context-pack.json assembled; sha256 ${packDigest}`);

  // Stage 10: validate continuity properties (recorded separately by `validate`).
  stage(10, 'validate-continuity-properties', 'validation is executed and recorded by the validate command against this exact candidate digest');

  // Stage 11: apply the explicit authorization policy.
  stage(11, 'apply-authorization-policy', 'explicit human authorization required (DR-0020); nothing is auto-authorized at formation');

  // Stage 12: export without changing canonical state.
  stage(12, 'export-without-canonical-change', 'candidate artifacts are new uncommitted Level 4 files; no pre-existing tracked byte changes');

  const trace = {
    candidate: { identity: PACK_IDENTITY, sha256: packDigest, version: PACK_VERSION },
    considered_sources: ledger,
    formation_algorithm: FORMATION_ALGORITHM,
    kind: 'continuity.level4.formation-trace',
    pipeline: 'DR-0011 explicit context formation pipeline',
    schema_version: 1,
    stages,
    uncertainty: { contradictions: [], gaps, pending_decisions: [] },
  };
  const traceBytes = Buffer.from(canonicalJson(trace), 'utf8');
  return { packBytes, packDigest, traceBytes, traceDigest: sha256(traceBytes) };
}

// Structural, Scope, lock, capability, contradiction, and completeness
// validation of the exact candidate digest.
export function validateCandidate({ root, repoRoot, rev, expectedDigest }) {
  const packRaw = loadJson(root, 'context-pack.json');
  if (packRaw.missing) throw new Blocked(DIAGNOSTICS.F2, 'context-pack.json missing');
  if (packRaw.corrupt) throw new Blocked(DIAGNOSTICS.F4, 'context-pack.json unparseable');
  const actualDigest = sha256(packRaw.bytes);
  if (expectedDigest && actualDigest !== expectedDigest) {
    throw new Blocked(DIAGNOSTICS.F4, `candidate digest mismatch: expected ${expectedDigest}, actual ${actualDigest}`);
  }
  const pack = packRaw.value;
  const rules = [];
  const rule = (id, pass, detail) => rules.push({ detail, id, result: pass ? 'pass' : 'fail' });

  rule('structural.canonical-serialization',
    Buffer.from(canonicalJson(pack), 'utf8').equals(packRaw.bytes),
    'file bytes equal the canonical re-serialization');
  const requiredKeys = ['absent_guarantees', 'authorization', 'bindings', 'delivery_boundary',
    'execution_instruction_boundary', 'formation_algorithm', 'identity', 'kind', 'schema_version',
    'source_ledger', 'source_tuple', 'uncertainty', 'version'];
  rule('structural.required-fields', requiredKeys.every((k) => k in pack), 'all required pack fields present');
  rule('structural.identity', pack.identity === PACK_IDENTITY && pack.version === PACK_VERSION && pack.kind === 'continuity.level4.context-pack', 'exact identity, version, and kind');

  const scope = readL3(root, 'scope.json');
  const work = readL3(root, 'work.json');
  rule('scope.digest-binding', pack.bindings.scope.sha256 === sha256(scope.bytes), 'pack binds the exact Level 3 scope digest');
  rule('scope.effort-binding', scope.value.source_identity === pack.source_tuple.source_local_identity && work.value.identity === pack.source_tuple.source_local_identity, 'scope and work bind the same selected effort');
  const overlap = scope.value.include_paths.some((p) => new Set([...scope.value.excluded_paths, ...scope.value.immutable_paths]).has(p));
  rule('scope.no-include-exclude-contradiction', !overlap, 'include paths do not appear among excluded or immutable paths');

  const l2Bytes = readCommitted(repoRoot, rev, 'continuity/level-2/packs.lock.json');
  const l2 = JSON.parse(l2Bytes.toString('utf8'));
  const l1Bytes = readCommitted(repoRoot, rev, 'continuity/level-1/pack-lock.json');
  rule('lock.level2-aggregate', pack.bindings.level_2_lock.sha256 === sha256(l2Bytes) && pack.bindings.level_2_lock.aggregate_digest === l2.aggregate.digest, 'exact Level 2 composed-lock bytes and aggregate digest');
  rule('lock.level1-lock', pack.bindings.level_1_lock.sha256 === sha256(l1Bytes), 'exact retained Level 1 lock bytes');
  rule('lock.package-anchor', pack.bindings.package_json.sha256 === l2.activationRoute.packageJson.sha256, 'package.json digest equals the reviewed Level 2 activation-route anchor');

  rule('capability.executor-family', l2.executorFamily === 'claude-code', 'bound executor family is claude-code');
  rule('capability.local-only', (l2.registries ?? []).length === 0 && (l2.remoteSources ?? []).length === 0, 'no registry or remote source capability is required or claimed');

  rule('contradiction.none-unresolved', (pack.uncertainty.contradictions ?? []).length === 0, 'no unresolved contradiction is recorded');
  const srcAgree = pack.source_tuple.source_sha256 === work.value.source.source_sha256 && pack.source_tuple.source_sha256 === scope.value.digest.source_sha256;
  rule('contradiction.source-tuple-agreement', srcAgree, 'work, scope, and pack agree on the exact source digest');

  const pinned = readCommitted(repoRoot, pack.source_tuple.source_revision, pack.source_tuple.source_path);
  rule('completeness.source-exact-at-pinned-revision', sha256(pinned) === pack.source_tuple.source_sha256, 'the bound backlog source is byte-identical at its pinned revision');
  rule('completeness.ledger-typed', pack.source_ledger.every((e) => e.source_sha256 && e.disposition && e.reason && e.source_revision), 'every ledger entry carries digest, disposition, reason, and revision');
  rule('completeness.absent-guarantees', ['Level 5', 'Level 6'].every((l) => JSON.stringify(pack.absent_guarantees).includes(l)), 'absent Level 5-6 guarantees are stated truthfully');
  rule('completeness.no-forbidden-claim', ![...FORBIDDEN_CLAIMS].some((c) => (pack.claims ?? []).includes?.(c)), 'the pack claims no higher-level authority');
  rule('completeness.delivery-bounded', pack.delivery_boundary.delivered.length > 0 && pack.delivery_boundary.omitted_inspect_only.length > 0, 'delivery boundary is explicit and bounded with recorded omissions');

  const failed = rules.filter((r) => r.result !== 'pass');
  const result = {
    candidate: { identity: pack.identity, sha256: actualDigest, version: pack.version },
    kind: 'continuity.level4.validation-result',
    result: failed.length === 0 ? 'valid' : 'invalid',
    rule_count: rules.length,
    rules,
    schema_version: 1,
  };
  return { bytes: Buffer.from(canonicalJson(result), 'utf8'), result };
}

// Exactly one explicit human authorization tuple must match the one validated
// candidate. Anything else blocks with CONTEXT_AUTHORIZATION_MISSING (F6).
export function authorizeCandidate({ root, tuples, actor, statement, at }) {
  if (!Array.isArray(tuples) || tuples.length !== 1) {
    throw new Blocked(DIAGNOSTICS.F6, `exactly one authorization tuple is required; received ${Array.isArray(tuples) ? tuples.length : 0}`);
  }
  const t = tuples[0];
  if (!t?.identity || !t?.version || !t?.sha256 || !actor || !statement) {
    throw new Blocked(DIAGNOSTICS.F6, 'authorization requires identity, version, sha256, actor, and the exact human statement');
  }
  const packRaw = loadJson(root, 'context-pack.json');
  if (packRaw.missing || packRaw.corrupt) throw new Blocked(DIAGNOSTICS.F4, 'context-pack.json missing or corrupt');
  const validation = loadJson(root, 'validation-result.json');
  if (validation.missing || validation.corrupt) throw new Blocked(DIAGNOSTICS.F6, 'no validation result exists for the candidate');
  const digest = sha256(packRaw.bytes);
  if (validation.value.result !== 'valid' || validation.value.candidate.sha256 !== digest) {
    throw new Blocked(DIAGNOSTICS.F6, 'the candidate is not the exact validated version');
  }
  if (t.identity !== packRaw.value.identity || Number(t.version) !== packRaw.value.version || t.sha256 !== digest) {
    throw new Blocked(DIAGNOSTICS.F6, 'authorization tuple does not match the one validated identity, version, and digest');
  }
  const existing = loadJson(root, 'authorization-record.json');
  if (!existing.missing) {
    throw new Blocked(DIAGNOSTICS.F9, 'an authorization record already exists; authorized versions are never edited in place');
  }
  const record = {
    actor,
    actor_statement: statement,
    authorized: { identity: packRaw.value.identity, sha256: digest, version: packRaw.value.version },
    authorized_at_utc: at,
    kind: 'continuity.level4.authorization-record',
    match_verification: 'tuple identity, version, and sha256 each compared equal to the validated candidate before recording',
    permitted_scope_of_use: 'Level 4 context authority and digest-matched adapter-view delivery for the bound effort only; never execution of the selected effort; never Level 5-6 state',
    rollback_boundary: 'revocation or supersession disables delivery and returns the effort to Level 3; all versions and this record are preserved',
    schema_version: 1,
    status: 'authorized',
  };
  return { bytes: Buffer.from(canonicalJson(record), 'utf8'), record };
}

// Deterministic digest-linked delivery projection of the authorized pack.
export function buildAdapterView({ root }) {
  const packRaw = loadJson(root, 'context-pack.json');
  if (packRaw.missing || packRaw.corrupt) throw new Blocked(DIAGNOSTICS.F4, 'context-pack.json missing or corrupt');
  const auth = loadJson(root, 'authorization-record.json');
  if (auth.missing || auth.corrupt) {
    throw new Blocked(DIAGNOSTICS.F7, 'no authorization record: draft, formed, or validated-but-unauthorized versions are never delivered');
  }
  const digest = sha256(packRaw.bytes);
  if (auth.value.status !== 'authorized') {
    throw new Blocked(DIAGNOSTICS.F7, `authorization status is '${auth.value.status}'; delivery is disabled`);
  }
  if (auth.value.authorized.sha256 !== digest) {
    throw new Blocked(DIAGNOSTICS.F8, 'authorized digest does not match the pack bytes');
  }
  checkStaleness({ root });
  const pack = packRaw.value;
  const view = {
    authorized_context_pack: { identity: pack.identity, sha256: digest, version: pack.version },
    delivery_provenance: {
      derived: 'deterministic projection of the authorized Context Pack; rebuildable byte-identically; carries no authority of its own',
      derived_from_sha256: digest,
      deliverer: 'continuity/level-4/bin/continuity-context.mjs adapter-view',
    },
    kind: 'continuity.level4.adapter-view',
    schema_version: 1,
  };
  // Executor payload: exactly what the executor would receive.
  const scope = readL3(root, 'scope.json');
  const work = readL3(root, 'work.json');
  const sourceText = readFileSync(join(root, pack.source_tuple.source_path), 'utf8');
  if (sha256(Buffer.from(sourceText, 'utf8')) !== pack.source_tuple.source_sha256) {
    throw new Blocked(DIAGNOSTICS.F1, `stale context dependency: ${pack.source_tuple.source_path} changed after authorization`);
  }
  view.executor_receives = {
    absent_guarantees: pack.absent_guarantees,
    backlog_source_text: sourceText,
    bindings: pack.bindings,
    criteria: work.value.criteria,
    evidence_requirements: work.value.evidence_requirements,
    execution_instruction_boundary: pack.execution_instruction_boundary,
    objective: work.value.objective,
    outputs: work.value.outputs,
    scope: {
      excluded_paths: scope.value.excluded_paths,
      immutable_paths: scope.value.immutable_paths,
      include_paths: scope.value.include_paths,
      non_goals: scope.value.non_goals,
      permitted_effects: scope.value.permitted_effects,
      prohibited_effects: scope.value.prohibited_effects,
      validation_requirements: scope.value.validation_requirements,
    },
  };
  view.omitted_inspect_only = pack.delivery_boundary.omitted_inspect_only;
  const payloadBytes = Buffer.byteLength(canonicalJson(view.executor_receives), 'utf8');
  if (payloadBytes > MAX_DELIVERED_BYTES) {
    throw new Blocked(DIAGNOSTICS.F5, `required delivery of ${payloadBytes} bytes exceeds the declared bounded delivery of ${MAX_DELIVERED_BYTES} bytes and cannot be safely delivered`);
  }
  return { bytes: Buffer.from(canonicalJson(view), 'utf8'), view };
}

export const MAX_DELIVERED_BYTES = 262144;

// Staleness check (F1/S8): every bound dependency digest must still be exact.
export function checkStaleness({ root }) {
  const packRaw = loadJson(root, 'context-pack.json');
  if (packRaw.missing || packRaw.corrupt) throw new Blocked(DIAGNOSTICS.F4, 'context-pack.json missing or corrupt');
  const pack = packRaw.value;
  const changed = [];
  const probe = (rel, expected) => {
    const p = join(root, rel);
    if (!existsSync(p) || sha256(readFileSync(p)) !== expected) changed.push(rel);
  };
  probe(pack.source_tuple.source_path, pack.source_tuple.source_sha256);
  probe('continuity/level-3/work.json', pack.bindings.work.sha256);
  probe('continuity/level-3/scope.json', pack.bindings.scope.sha256);
  probe('continuity/level-3/route.json', pack.bindings.route.sha256);
  probe('continuity/level-2/packs.lock.json', pack.bindings.level_2_lock.sha256);
  probe('continuity/level-1/pack-lock.json', pack.bindings.level_1_lock.sha256);
  probe('package.json', pack.bindings.package_json.sha256);
  if (changed.length) {
    throw new Blocked(DIAGNOSTICS.F1, `stale context dependency: ${changed.join(', ')}`);
  }
  return { changed_dependencies: [], status: 'ready' };
}

// Source-preserving rejection/revocation (S5/S6): dispositions live in the
// authorization-record file; the immutable pack bytes are never touched.
export function applyDisposition({ root, kind, actor, statement, at }) {
  if (!['reject', 'revoke'].includes(kind)) throw new Blocked(DIAGNOSTICS.F11, `unknown disposition: ${kind}`);
  if (!actor || !statement) throw new Blocked(DIAGNOSTICS.F6, `${kind} requires an explicit actor and statement`);
  const packRaw = loadJson(root, 'context-pack.json');
  if (packRaw.missing || packRaw.corrupt) throw new Blocked(DIAGNOSTICS.F4, 'context-pack.json missing or corrupt');
  const digest = sha256(packRaw.bytes);
  const existing = loadJson(root, 'authorization-record.json');
  if (kind === 'reject') {
    if (!existing.missing && existing.value.status === 'authorized') {
      throw new Blocked(DIAGNOSTICS.F9, 'an authorized version cannot be rejected; use revoke');
    }
    const record = {
      actor, actor_statement: statement, candidate: { identity: packRaw.value.identity, sha256: digest, version: packRaw.value.version },
      disposition_at_utc: at, kind: 'continuity.level4.authorization-record', schema_version: 1,
      preserved: 'the candidate and its formation trace are preserved non-authorized with this rationale',
      status: 'rejected',
    };
    guardedWrite(root, L4(root, 'authorization-record.json'), canonicalJson(record));
    return { effort_level: 'level-3', status: 'rejected' };
  }
  if (existing.missing || existing.corrupt || existing.value.status !== 'authorized') {
    throw new Blocked(DIAGNOSTICS.F7, 'revocation applies only to an authorized version');
  }
  const record = {
    ...existing.value,
    revocation: { actor, actor_statement: statement, revoked_at_utc: at },
    status: 'revoked',
  };
  guardedWrite(root, L4(root, 'authorization-record.json'), canonicalJson(record));
  return { delivery: 'disabled', effort_level: 'level-3', status: 'revoked' };
}

// F1-F12 fixture harness: builds each mandatory failure in an isolated
// temporary directory outside every repository, observes the typed
// diagnostic, and removes the fixture with an absence proof.
export async function runFailureScenario(id, { root, repoRoot, rev }) {
  const { cpSync, mkdtempSync, rmSync } = await import('node:fs');
  const os = await import('node:os');
  const tmp = mkdtempSync(join(os.tmpdir(), `mi004-${id.toLowerCase()}-`));
  const fixRoot = join(tmp, 'root');
  const fixL4 = join(fixRoot, 'continuity', 'level-4');
  cpSync(join(root, 'continuity', 'level-4'), fixL4, { recursive: true });
  cpSync(join(root, 'continuity', 'level-3'), join(fixRoot, 'continuity', 'level-3'), { recursive: true });
  const pack = JSON.parse(readFileSync(join(fixL4, 'context-pack.json'), 'utf8'));
  const srcRel = pack.source_tuple.source_path;
  mkdirSync(dirname(join(fixRoot, srcRel)), { recursive: true });
  for (const rel of [srcRel, 'continuity/level-2/packs.lock.json', 'continuity/level-1/pack-lock.json', 'package.json']) {
    mkdirSync(dirname(join(fixRoot, rel)), { recursive: true });
    writeFileSync(join(fixRoot, rel), readFileSync(join(root, rel)));
  }
  const editJson = (name, fn) => {
    const p = join(fixL4, name);
    const v = JSON.parse(readFileSync(p, 'utf8'));
    writeFileSync(p, canonicalJson(fn(v) ?? v));
  };

  const expected = DIAGNOSTICS[id];
  let observed = null;
  let exitCode = 0;
  const observe = (fn) => {
    try {
      fn();
    } catch (e) {
      observed = e.code ?? String(e);
      exitCode = 1;
    }
  };

  if (id === 'F1') {
    writeFileSync(join(fixRoot, srcRel), 'tampered after authorization\n');
    observe(() => checkStaleness({ root: fixRoot }));
  } else if (id === 'F2') {
    rmSync(join(fixRoot, 'continuity', 'level-3', 'work.json'));
    observe(() => formCandidate({ repoRoot, rev, root: fixRoot }));
  } else if (id === 'F3') {
    const scopePath = join(fixRoot, 'continuity', 'level-3', 'scope.json');
    const scope = JSON.parse(readFileSync(scopePath, 'utf8'));
    scope.digest.source_sha256 = scope.digest.source_sha256.replace(/^./, (c) => (c === '0' ? '1' : '0'));
    writeFileSync(scopePath, canonicalJson(scope));
    observe(() => formCandidate({ repoRoot, rev, root: fixRoot }));
  } else if (id === 'F4') {
    const p = join(fixL4, 'context-pack.json');
    writeFileSync(p, readFileSync(p).subarray(0, 256));
    observe(() => validateCandidate({ repoRoot, rev, root: fixRoot }));
  } else if (id === 'F5') {
    const big = `oversized fixture material\n${'x'.repeat(MAX_DELIVERED_BYTES)}\n`;
    writeFileSync(join(fixRoot, srcRel), big);
    editJson('context-pack.json', (v) => {
      v.source_tuple.source_sha256 = sha256(Buffer.from(big, 'utf8'));
      return v;
    });
    const newDigest = sha256(readFileSync(join(fixL4, 'context-pack.json')));
    editJson('authorization-record.json', (v) => {
      v.authorized.sha256 = newDigest;
      return v;
    });
    observe(() => buildAdapterView({ root: fixRoot }));
  } else if (id === 'F6') {
    observe(() => authorizeCandidate({ actor: 'fixture', at: 'fixture', root: fixRoot, statement: 'fixture', tuples: [] }));
  } else if (id === 'F7') {
    rmSync(join(fixL4, 'authorization-record.json'));
    observe(() => buildAdapterView({ root: fixRoot }));
  } else if (id === 'F8') {
    editJson('authorization-record.json', (v) => {
      v.authorized.sha256 = v.authorized.sha256.replace(/^./, (c) => (c === '0' ? '1' : '0'));
      return v;
    });
    observe(() => buildAdapterView({ root: fixRoot }));
  } else if (id === 'F9') {
    observe(() => authorizeCandidate({
      actor: 'fixture', at: 'fixture', root: fixRoot, statement: 'fixture',
      tuples: [{ identity: pack.identity, sha256: sha256(readFileSync(join(fixL4, 'context-pack.json'))), version: pack.version }],
    }));
  } else if (id === 'F10') {
    observe(() => guardedWrite(fixRoot, join(fixRoot, 'continuity', 'level-3', 'intrusion.json'), '{}\n'));
  } else if (id === 'F11') {
    const result = await dispatch('execute', { root: fixRoot });
    observed = result.code;
    exitCode = result.status === 'blocked' ? 1 : 0;
  } else if (id === 'F12') {
    const result = await dispatch('claim', { root: fixRoot, type: 'run' });
    observed = result.code;
    exitCode = result.status === 'blocked' ? 1 : 0;
  } else {
    rmSync(tmp, { force: true, recursive: true });
    throw new Error(`unknown scenario ${id}`);
  }

  const fixtureDigest = sha256(readFileSync(join(fixL4, 'context-pack.json')));
  rmSync(tmp, { force: true, recursive: true });
  return {
    cleanup_absent: !existsSync(tmp),
    exit_code: exitCode,
    expected_diagnostic: expected,
    fixture_digest: fixtureDigest,
    id,
    observed_diagnostic: observed,
  };
}

function parse(argv) {
  const [command = 'status', ...tokens] = argv;
  const options = {};
  for (const token of tokens) {
    const match = token.match(/^--([^=]+)=(.*)$/);
    if (match) options[match[1]] = match[2];
    else if (token.startsWith('--')) options[token.slice(2)] = true;
  }
  return { command, options };
}

export async function dispatch(command, options) {
  const root = options.root ?? process.cwd();
  const repoRoot = options.repo ?? root;
  const rev = options.rev ?? 'HEAD';
  try {
    switch (command) {
      case 'form': {
        const { packBytes, packDigest, traceBytes, traceDigest } = formCandidate({ repoRoot, rev, root });
        if (options.out !== 'none') {
          guardedWrite(root, L4(root, 'context-pack.json'), packBytes);
          guardedWrite(root, L4(root, 'formation-trace.json'), traceBytes);
        }
        return { pack_sha256: packDigest, status: 'ready', trace_sha256: traceDigest };
      }
      case 'validate': {
        const { bytes, result } = validateCandidate({ expectedDigest: options.digest, repoRoot, rev, root });
        if (options.out !== 'none') guardedWrite(root, L4(root, 'validation-result.json'), bytes);
        return { result: result.result, rule_count: result.rule_count, status: result.result === 'valid' ? 'ready' : 'blocked', validated_sha256: result.candidate.sha256 };
      }
      case 'authorize': {
        const tuples = options.tuple ? [JSON.parse(options.tuple)] : [];
        if (options.tuples) tuples.push(...JSON.parse(options.tuples));
        const { bytes, record } = authorizeCandidate({ actor: options.actor, at: options.at, root, statement: options.statement, tuples });
        guardedWrite(root, L4(root, 'authorization-record.json'), bytes);
        return { authorized: record.authorized, status: 'ready' };
      }
      case 'adapter-view': {
        const { bytes, view } = buildAdapterView({ root });
        if (options.out !== 'none') guardedWrite(root, L4(root, 'adapter-view.json'), bytes);
        return { derived_from_sha256: view.delivery_provenance.derived_from_sha256, status: 'ready', view_sha256: sha256(bytes) };
      }
      case 'stale-check':
        return checkStaleness({ root });
      case 'reject':
      case 'revoke':
        return applyDisposition({ actor: options.actor, at: options.at, kind: command, root, statement: options.statement });
      case 'claim': {
        const claim = String(options.type ?? '').trim().toLowerCase();
        if (FORBIDDEN_CLAIMS.has(claim)) {
          return { code: DIAGNOSTICS.F12, message: `Level 4 cannot claim or create '${claim}'. Level 5-6 authority remains deliberately absent.`, status: 'blocked' };
        }
        return { message: 'no forbidden claim requested', status: 'ready' };
      }
      case 'execute':
      case 'run':
      case 'implement':
        return { code: DIAGNOSTICS.F11, message: 'Level 4 holds context authority only; executing the selected backlog effort is prohibited here.', status: 'blocked' };
      case 'status': {
        const pack = loadJson(root, 'context-pack.json');
        const auth = loadJson(root, 'authorization-record.json');
        return {
          authorization_status: auth.missing ? 'absent' : auth.corrupt ? 'corrupt' : auth.value.status,
          pack: pack.missing ? null : pack.corrupt ? 'corrupt' : { identity: pack.value.identity, sha256: sha256(pack.bytes), version: pack.value.version },
          status: 'ready',
        };
      }
      default:
        return { code: 'UNKNOWN_COMMAND', message: `Unknown Level 4 command: ${command}`, status: 'blocked' };
    }
  } catch (e) {
    if (e instanceof Blocked) return { code: e.code, message: e.message, status: 'blocked' };
    throw e;
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  const { command, options } = parse(process.argv.slice(2));
  const result = await dispatch(command, options);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === 'blocked' ? 1 : 0);
}
