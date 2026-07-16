#!/usr/bin/env node
// Level 3 (Work) command family for the Nestfolio continuity adoption.
// Bounded local execution representation only: it derives, verifies, and
// transitions the seven Level 3 artifacts. It never executes the selected
// backlog effort, never mutates any pre-existing tracked byte, and claims no
// Level 4-6, Run-store, registry, or Epic-orchestration authority.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

export const ALGORITHM_IDENTITY = 'mi003-r2-candidate-projection@1';
export const ALGORITHM_RULES = [
  'R1 missing/unparseable frontmatter id or status -> EXCLUDED_AMBIGUOUS_MAPPING (F5)',
  'R2 type==epic -> EXCLUDED_EPIC_ORCHESTRATION (working_set: no Epic orchestration)',
  'R3 status==shipped -> EXCLUDED_TERMINAL_SHIPPED',
  'R4 status==dropped -> EXCLUDED_TERMINAL_DROPPED',
  'R5 status==active -> EXCLUDED_ACTIVE_ROUTE_CONFLICT (F4)',
  'R6 status==blocked -> EXCLUDED_HARD_DEPENDENCY_BLOCKED (F2)',
  'R7 status==queued -> eligible INCLUDED_OPEN_QUEUED',
  'R8 status==parking -> eligible INCLUDED_OPEN_PARKING (explicit human selection supplies promotion authority; F2 re-checked at selection)',
  'R9 any other status -> EXCLUDED_AMBIGUOUS_MAPPING (F5)',
  'ORDER first matching rule wins; entries sorted bytewise by source_path; no timestamp participates in derivation or ordering',
];

export const DIAGNOSTICS = Object.freeze({
  F1: 'STALE_WORK_SOURCE',
  F2: 'HARD_DEPENDENCY_UNRESOLVED',
  F3: 'CANDIDATE_PROJECTION_INVALID',
  F4: 'DUAL_ROUTE_CONFLICT',
  F5: 'AMBIGUOUS_WORK_MAPPING',
  F6: 'SELECTION_AUTHORITY_MISSING',
  F7: 'INVALID_OR_UNBOUNDED_SCOPE',
  F8: 'INCOMPLETE_WORK_CONTRACT',
  F9: 'ROUTE_AUTHORITY_INVALID',
  F10: 'SOURCE_MUTATION_PROHIBITED',
  F11: 'WORK_EXECUTION_PROHIBITED',
  F12: 'FORBIDDEN_HIGHER_LEVEL_CLAIM',
});

const ARTIFACTS = Object.freeze({
  candidates: 'candidates.json',
  route: 'route.json',
  scope: 'scope.json',
  work: 'work.json',
  workBrief: 'work-brief.json',
  workSelection: 'work-selection.json',
  workingSet: 'working-set.json',
});

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

const git = (repoRoot, args, opts = {}) =>
  execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'buffer', maxBuffer: 1 << 26, ...opts });

class Blocked extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Write guard: Level 3 may write ONLY beneath <root>/continuity/level-3/.
export function guardedWrite(root, filePath, bytes) {
  const boundary = resolve(root, 'continuity', 'level-3') + sep;
  const target = resolve(filePath);
  if (!target.startsWith(boundary)) {
    throw new Blocked(DIAGNOSTICS.F10, `write outside Level 3 boundary: ${filePath}`);
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
}

const fmField = (fm, key) => {
  const m = fm.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'));
  if (!m) return null;
  let v = m[1].trim();
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = v.slice(1, -1);
  if (v === '' || v === 'null') return null;
  return v;
};

// Deterministic candidate projection over every in-scope docs/backlog source
// at one exact revision. Returns canonical JSON bytes (S1: byte-identical
// rebuild from canonical sources; no timestamp participates).
export function buildCandidates({ repoRoot, rev }) {
  const lsRaw = git(repoRoot, ['ls-tree', '-r', rev, 'docs/backlog']).toString('utf8');
  const rows = lsRaw
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [meta, path] = l.split('\t');
      const [, , blob] = meta.split(/\s+/);
      return { blob, path };
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const entries = [];
  let eligible = 0;
  for (const { path, blob } of rows) {
    const content = git(repoRoot, ['show', `${rev}:${path}`]);
    const digest = sha256(content);
    const text = content.toString('utf8');
    const fmm = text.match(/^---\n([\s\S]*?)\n---(\n|$)/);
    const fm = fmm ? fmm[1] : null;
    const id = fm ? fmField(fm, 'id') : null;
    const status = fm ? fmField(fm, 'status') : null;
    const type = fm ? fmField(fm, 'type') : null;
    const rank = fm ? fmField(fm, 'rank') : null;
    const epic = fm ? fmField(fm, 'epic') : null;
    const epicRole = fm ? fmField(fm, 'epic_role') : null;
    const base = path.replace(/^docs\/backlog\//, '').replace(/\.md$/, '');
    const idMatches = id === base;

    let elig = false;
    let rationale;
    if (!id || !status || !idMatches) rationale = 'EXCLUDED_AMBIGUOUS_MAPPING';
    else if (type === 'epic') rationale = 'EXCLUDED_EPIC_ORCHESTRATION';
    else if (status === 'shipped') rationale = 'EXCLUDED_TERMINAL_SHIPPED';
    else if (status === 'dropped') rationale = 'EXCLUDED_TERMINAL_DROPPED';
    else if (status === 'active') rationale = 'EXCLUDED_ACTIVE_ROUTE_CONFLICT';
    else if (status === 'blocked') rationale = 'EXCLUDED_HARD_DEPENDENCY_BLOCKED';
    else if (status === 'queued') { elig = true; rationale = 'INCLUDED_OPEN_QUEUED'; }
    else if (status === 'parking') { elig = true; rationale = 'INCLUDED_OPEN_PARKING'; }
    else rationale = 'EXCLUDED_AMBIGUOUS_MAPPING';
    if (elig) eligible++;

    entries.push({
      byte_count: content.length,
      declared_status: status,
      declared_type: type,
      dependency_disposition: { epic, epic_role: epicRole },
      eligibility: elig,
      id_matches_filename: idMatches,
      rank_inputs: { declared_rank: rank },
      rationale_type: rationale,
      source_blob_sha1: blob,
      source_local_identity: id,
      source_path: path,
      source_revision: rev,
      source_sha256: digest,
    });
  }

  return canonicalJson({
    algorithm_identity: ALGORITHM_IDENTITY,
    algorithm_rules: ALGORITHM_RULES,
    considered_count: entries.length,
    eligible_count: eligible,
    entries,
    source_revision: rev,
    source_root: 'docs/backlog',
  });
}

const loadJson = (root, name) => {
  const p = join(root, 'continuity', 'level-3', name);
  if (!existsSync(p)) return { missing: true, path: p };
  try {
    const bytes = readFileSync(p);
    return { bytes, path: p, value: JSON.parse(bytes.toString('utf8')) };
  } catch (e) {
    return { corrupt: true, error: String(e), path: p };
  }
};

const requiredFrom = (root) => {
  const schemaPath = join(root, 'continuity', 'level-3', 'schema', 'work-artifacts.schema.json');
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  return (def) => schema.$defs[def].required ?? [];
};

// Full referential/digest verification of the artifact set (S4) with the
// twelve typed fail-closed diagnostics (F1-F12).
export function verifyArtifacts({ root, repoRoot }) {
  // F10 first: no pre-existing tracked byte of the source repository may be
  // modified, deleted, renamed, or staged.
  const status = git(repoRoot, ['status', '--porcelain', '-uall']).toString('utf8');
  for (const line of status.split('\n')) {
    if (!line) continue;
    if (!line.startsWith('?? ')) {
      throw new Blocked(DIAGNOSTICS.F10, `tracked byte mutated: ${line.trim()}`);
    }
  }

  const req = requiredFrom(root);

  // F3: candidates projection must be present, parseable, and structurally exact.
  const cand = loadJson(root, ARTIFACTS.candidates);
  if (cand.missing || cand.corrupt) throw new Blocked(DIAGNOSTICS.F3, `candidates: ${cand.error ?? 'missing'}`);
  for (const k of req('candidates')) {
    if (!(k in cand.value)) throw new Blocked(DIAGNOSTICS.F3, `candidates missing ${k}`);
  }
  if (cand.value.algorithm_identity !== ALGORITHM_IDENTITY) {
    throw new Blocked(DIAGNOSTICS.F3, 'unknown derivation algorithm identity');
  }
  const entries = cand.value.entries;
  if (!Array.isArray(entries) || entries.length !== cand.value.considered_count) {
    throw new Blocked(DIAGNOSTICS.F3, 'entry count mismatch');
  }
  const eligibleCount = entries.filter((e) => e.eligibility === true).length;
  if (eligibleCount !== cand.value.eligible_count) {
    throw new Blocked(DIAGNOSTICS.F3, 'eligible count mismatch');
  }

  // F6: exactly one explicit human selection matching one eligible candidate.
  const sel = loadJson(root, ARTIFACTS.workSelection);
  if (sel.missing || sel.corrupt) throw new Blocked(DIAGNOSTICS.F6, 'work-selection missing or unreadable');
  for (const k of req('workSelection')) {
    if (!(k in sel.value)) throw new Blocked(DIAGNOSTICS.F6, `work-selection missing ${k}`);
  }
  const t = sel.value.source_tuple ?? {};
  const matches = entries.filter(
    (e) =>
      e.source_path === t.source_path &&
      e.source_local_identity === t.source_local_identity &&
      e.source_revision === t.source_revision &&
      e.source_sha256 === t.source_sha256,
  );
  if (matches.length !== 1 || matches[0].eligibility !== true) {
    throw new Blocked(
      DIAGNOSTICS.F6,
      `selection tuple matches ${matches.length} eligible candidate(s)`,
    );
  }
  const candidate = matches[0];

  // F5: work source mapping must be present and unambiguous.
  const work = loadJson(root, ARTIFACTS.work);
  if (work.missing || work.corrupt) throw new Blocked(DIAGNOSTICS.F8, 'work missing or unreadable');
  const ws = work.value.source ?? {};
  if (!ws.source_local_identity || !ws.declared_status || !ws.declared_type) {
    throw new Blocked(DIAGNOSTICS.F5, 'work source identity/status/type mapping missing');
  }
  if (ws.source_local_identity !== t.source_local_identity || work.value.identity !== t.source_local_identity) {
    throw new Blocked(DIAGNOSTICS.F5, 'work identity does not map to the selected source');
  }
  if (!('declared_rank' in (ws.rank_inputs ?? {}))) {
    throw new Blocked(DIAGNOSTICS.F5, 'work source rank input missing');
  }

  // F1: the pinned source revision/digest must still be exact.
  let pinned;
  try {
    pinned = git(repoRoot, ['show', `${ws.source_revision}:${ws.source_path}`]);
  } catch {
    throw new Blocked(DIAGNOSTICS.F1, 'pinned source revision unreadable');
  }
  if (sha256(pinned) !== ws.source_sha256) {
    throw new Blocked(DIAGNOSTICS.F1, 'source digest mismatch at pinned revision');
  }

  // F2: no unresolved hard dependency.
  const hard = work.value.dependency?.hard_dependencies ?? null;
  if (!Array.isArray(hard)) throw new Blocked(DIAGNOSTICS.F8, 'dependency facts missing');
  if (hard.some((d) => d && d.unresolved === true)) {
    throw new Blocked(DIAGNOSTICS.F2, 'unresolved hard dependency declared');
  }

  // F8: the Work contract must be complete.
  for (const k of req('work')) {
    if (!(k in work.value)) throw new Blocked(DIAGNOSTICS.F8, `work missing ${k}`);
  }
  for (const k of ['criteria', 'evidence_requirements', 'outputs']) {
    if (!Array.isArray(work.value[k]) || work.value[k].length === 0) {
      throw new Blocked(DIAGNOSTICS.F8, `work ${k} empty`);
    }
  }
  const wsSet = loadJson(root, ARTIFACTS.workingSet);
  if (wsSet.missing || wsSet.corrupt) throw new Blocked(DIAGNOSTICS.F8, 'working-set missing or unreadable');
  for (const k of req('workingSet')) {
    if (!(k in wsSet.value)) throw new Blocked(DIAGNOSTICS.F8, `working-set missing ${k}`);
  }
  if (wsSet.value.count !== 1 || wsSet.value.epic_orchestration !== false) {
    throw new Blocked(DIAGNOSTICS.F12, 'working set must hold exactly one Work with no Epic orchestration');
  }
  if (wsSet.value.work?.identity !== work.value.identity) {
    throw new Blocked(DIAGNOSTICS.F5, 'working-set does not reference the selected Work');
  }

  // F7: Scope must be non-empty, internally consistent, and bounded to the effort.
  const scope = loadJson(root, ARTIFACTS.scope);
  if (scope.missing || scope.corrupt) throw new Blocked(DIAGNOSTICS.F8, 'scope missing or unreadable');
  for (const k of req('scope')) {
    if (!(k in scope.value)) throw new Blocked(DIAGNOSTICS.F8, `scope missing ${k}`);
  }
  const inc = scope.value.include_paths;
  if (!Array.isArray(inc) || inc.length === 0) {
    throw new Blocked(DIAGNOSTICS.F7, 'scope include paths empty');
  }
  const excluded = new Set([...(scope.value.excluded_paths ?? []), ...(scope.value.immutable_paths ?? [])]);
  if (inc.some((p) => excluded.has(p))) {
    throw new Blocked(DIAGNOSTICS.F7, 'scope include/exclude contradiction');
  }
  if (scope.value.source_identity !== work.value.identity) {
    throw new Blocked(DIAGNOSTICS.F7, 'scope expands beyond the selected effort');
  }

  // F9: route authority must be explicit; never inferred from file presence.
  const route = loadJson(root, ARTIFACTS.route);
  if (route.missing || route.corrupt) throw new Blocked(DIAGNOSTICS.F9, 'route missing or unreadable');
  for (const k of req('route')) {
    if (!(k in route.value)) throw new Blocked(DIAGNOSTICS.F9, `route missing ${k}`);
  }
  if (route.value.authority_declared !== true || typeof route.value.active !== 'boolean') {
    throw new Blocked(DIAGNOSTICS.F9, 'route authority not explicitly declared');
  }
  if (route.value.route_target?.work_identity !== work.value.identity) {
    throw new Blocked(DIAGNOSTICS.F9, 'route does not target the selected Work');
  }

  // F4: no dual-route, lease, or ownership conflict.
  const nc = route.value.no_conflict ?? {};
  if (
    route.value.active === true &&
    (nc.current_route_active === true ||
      nc.target_route_preexisting === true ||
      (Array.isArray(nc.lease_conflicts) && nc.lease_conflicts.length > 0) ||
      nc.result !== 'no-conflict')
  ) {
    throw new Blocked(DIAGNOSTICS.F4, 'active route with a declared conflict');
  }

  // F11: the representation must never claim execution of the selected effort.
  if (!['represented', 'returned', 'cancelled'].includes(work.value.status)) {
    throw new Blocked(DIAGNOSTICS.F11, `work status claims execution: ${work.value.status}`);
  }

  // F12: no Level 4-6, Run-store, registry, or universal-ranking claim.
  if (route.value.authority_level !== 'level-3' || route.value.run_store !== null) {
    throw new Blocked(DIAGNOSTICS.F12, 'route claims authority beyond Level 3');
  }
  const absent = work.value.absent_guarantees ?? [];
  const absentText = JSON.stringify(absent);
  for (const lvl of ['Level 4', 'Level 5', 'Level 6']) {
    if (!absentText.includes(lvl)) {
      throw new Blocked(DIAGNOSTICS.F12, `absent-guarantee statement missing for ${lvl}`);
    }
  }

  return {
    candidate,
    eligible_count: eligibleCount,
    route_state: route.value.state,
    selection_revision: sel.value.selection_revision,
    status: 'ready',
    work_identity: work.value.identity,
  };
}

// Deterministic read-only Work Brief projection (S7: byte-identical rebuild).
export function rebuildBrief({ root }) {
  const read = (name) => {
    const p = join(root, 'continuity', 'level-3', name);
    return { bytes: readFileSync(p), value: JSON.parse(readFileSync(p, 'utf8')) };
  };
  const cand = read(ARTIFACTS.candidates);
  const sel = read(ARTIFACTS.workSelection);
  const work = read(ARTIFACTS.work);
  const wsSet = read(ARTIFACTS.workingSet);
  const scope = read(ARTIFACTS.scope);
  const route = read(ARTIFACTS.route);

  return canonicalJson({
    absent_guarantees: work.value.absent_guarantees,
    artifact_digests: {
      'candidates.json': sha256(cand.bytes),
      'route.json': sha256(route.bytes),
      'scope.json': sha256(scope.bytes),
      'work-selection.json': sha256(sel.bytes),
      'work.json': sha256(work.bytes),
      'working-set.json': sha256(wsSet.bytes),
    },
    criteria: work.value.criteria,
    disclaimer:
      'Deterministic read-only projection. Not a Context Pack. Carries no execution authorization for the selected backlog effort and no Level 4-6 guarantee.',
    procedure_references: work.value.procedure_references,
    route: {
      active: route.value.active,
      authority_level: route.value.authority_level,
      owning_command_family: route.value.owning_command_family,
      route_target: route.value.route_target,
      state: route.value.state,
      transition_time: route.value.transition_time,
    },
    source_authorities: {
      local_execution_representation: 'continuity/level-3 (Level 3 Work artifacts)',
      planning: `docs/backlog @ ${work.value.source.source_revision} (current backlog remains planning authority)`,
    },
    work: {
      identity: work.value.identity,
      objective: work.value.objective,
      outputs: work.value.outputs,
      status: work.value.status,
    },
    working_set: wsSet.value,
  });
}

// Source-preserving return/cancel transitions (S8): disable the target route,
// preserve source tuple and history, require a new explicit selection revision.
export function applyTransition({ root, kind, statement, at }) {
  if (!['return', 'cancel'].includes(kind)) {
    throw new Blocked(DIAGNOSTICS.F11, `unknown transition: ${kind}`);
  }
  if (!statement) throw new Blocked(DIAGNOSTICS.F9, 'transition requires an explicit actor statement');
  const routePath = join(root, 'continuity', 'level-3', ARTIFACTS.route);
  if (!existsSync(routePath)) throw new Blocked(DIAGNOSTICS.F9, 'no route to transition');
  const route = JSON.parse(readFileSync(routePath, 'utf8'));
  const state = kind === 'return' ? 'returned' : 'cancelled';
  const next = {
    ...route,
    active: false,
    reactivation_requires: 'new-explicit-selection-revision',
    state,
    transition_time: at,
    transitions: [
      ...(route.transitions ?? []),
      { actor_statement: statement, at, from_state: route.state, kind },
    ],
  };
  guardedWrite(root, routePath, canonicalJson(next));
  return { route_target: next.route_target, state, status: 'ready' };
}

// F1-F12 fixture harness: builds each mandatory failure in an isolated
// temporary directory outside every repository, observes the typed
// diagnostic, and removes the fixture with an absence proof.
export async function runFailureScenario(id, { root, repoRoot }) {
  const { cpSync, mkdtempSync, rmSync } = await import('node:fs');
  const os = await import('node:os');
  const tmp = mkdtempSync(join(os.tmpdir(), `mi003-${id.toLowerCase()}-`));
  const fixRoot = join(tmp, 'root');
  cpSync(join(root, 'continuity', 'level-3'), join(fixRoot, 'continuity', 'level-3'), {
    recursive: true,
  });
  const editJson = (name, fn) => {
    const p = join(fixRoot, 'continuity', 'level-3', name);
    const v = JSON.parse(readFileSync(p, 'utf8'));
    writeFileSync(p, canonicalJson(fn(v) ?? v));
  };
  const tmpGitRepo = (files, { dirty } = {}) => {
    const r = join(tmp, 'repo');
    mkdirSync(r, { recursive: true });
    const g2 = (...a) => execFileSync('git', ['-C', r, ...a], { encoding: 'utf8' });
    g2('init', '-q');
    g2('config', 'user.email', 'fixture@local');
    g2('config', 'user.name', 'fixture');
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(dirname(join(r, rel)), { recursive: true });
      writeFileSync(join(r, rel), content);
    }
    g2('add', '-A');
    g2('commit', '-q', '-m', 'fixture');
    if (dirty) writeFileSync(join(r, Object.keys(files)[0]), 'tampered after commit\n');
    return { head: g2('rev-parse', 'HEAD').trim(), repo: r };
  };

  let verifyRepo = repoRoot;
  const expected = DIAGNOSTICS[id];
  if (id === 'F1') {
    const work = JSON.parse(
      readFileSync(join(fixRoot, 'continuity', 'level-3', ARTIFACTS.work), 'utf8'),
    );
    const fx = tmpGitRepo({ [work.source.source_path]: 'divergent content\n' });
    verifyRepo = fx.repo;
    editJson(ARTIFACTS.work, (w) => {
      w.source.source_revision = fx.head;
      return w;
    });
  } else if (id === 'F2') {
    editJson(ARTIFACTS.work, (w) => {
      w.dependency.hard_dependencies = [{ id: 'fixture-dependency', unresolved: true }];
      return w;
    });
  } else if (id === 'F3') {
    const p = join(fixRoot, 'continuity', 'level-3', ARTIFACTS.candidates);
    writeFileSync(p, readFileSync(p).subarray(0, 512));
  } else if (id === 'F4') {
    editJson(ARTIFACTS.route, (r) => {
      r.no_conflict.current_route_active = true;
      r.no_conflict.result = 'conflict';
      return r;
    });
  } else if (id === 'F5') {
    editJson(ARTIFACTS.work, (w) => {
      w.source.declared_status = null;
      return w;
    });
  } else if (id === 'F6') {
    editJson(ARTIFACTS.workSelection, (s) => {
      s.source_tuple.source_sha256 = s.source_tuple.source_sha256.replace(/^./, (c) =>
        c === '0' ? '1' : '0',
      );
      return s;
    });
  } else if (id === 'F7') {
    editJson(ARTIFACTS.scope, (s) => {
      s.include_paths = [];
      return s;
    });
  } else if (id === 'F8') {
    editJson(ARTIFACTS.work, (w) => {
      delete w.criteria;
      return w;
    });
  } else if (id === 'F9') {
    editJson(ARTIFACTS.route, (r) => {
      delete r.authority_declared;
      delete r.no_conflict;
      return r;
    });
  } else if (id === 'F10') {
    const fx = tmpGitRepo({ 'tracked.txt': 'original\n' }, { dirty: true });
    verifyRepo = fx.repo;
  } else if (id === 'F11') {
    editJson(ARTIFACTS.work, (w) => {
      w.status = 'executing';
      return w;
    });
  } else if (id === 'F12') {
    editJson(ARTIFACTS.route, (r) => {
      r.authority_level = 'level-4';
      return r;
    });
  } else {
    rmSync(tmp, { recursive: true, force: true });
    throw new Error(`unknown scenario ${id}`);
  }

  let observed = null;
  let exitCode = 0;
  try {
    verifyArtifacts({ repoRoot: verifyRepo, root: fixRoot });
  } catch (e) {
    observed = e.code ?? String(e);
    exitCode = 1;
  }
  const fixtureDigest = sha256(
    readFileSync(join(fixRoot, 'continuity', 'level-3', ARTIFACTS.work)),
  );
  rmSync(tmp, { recursive: true, force: true });
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
  const args = [];
  for (const token of tokens) {
    const match = token.match(/^--([^=]+)=(.*)$/);
    if (match) options[match[1]] = match[2];
    else if (token.startsWith('--')) options[token.slice(2)] = true;
    else args.push(token);
  }
  return { args, command, options };
}

export async function dispatch(command, options) {
  const root = options.root ?? process.cwd();
  const repoRoot = options.repo ?? root;
  try {
    switch (command) {
      case 'status': {
        const route = loadJson(root, ARTIFACTS.route);
        if (route.missing) return { route: null, status: 'ready' };
        if (route.corrupt) return { code: DIAGNOSTICS.F9, status: 'blocked' };
        return {
          route: {
            active: route.value.active,
            authority_level: route.value.authority_level,
            route_target: route.value.route_target,
            state: route.value.state,
          },
          status: 'ready',
        };
      }
      case 'rebuild-candidates': {
        const bytes = buildCandidates({ repoRoot, rev: options.rev });
        if (options.out) guardedWrite(root, options.out, bytes);
        return { digest: sha256(bytes), status: 'ready', written: options.out ?? null };
      }
      case 'rebuild-brief': {
        const bytes = rebuildBrief({ root });
        if (options.out) guardedWrite(root, options.out, bytes);
        return { digest: sha256(bytes), status: 'ready', written: options.out ?? null };
      }
      case 'verify':
        return verifyArtifacts({ repoRoot, root });
      case 'return':
      case 'cancel':
        return applyTransition({
          at: options.at ?? new Date().toISOString(),
          kind: command,
          root,
          statement: options.statement,
        });
      case 'execute':
      case 'run':
      case 'implement':
        return {
          code: DIAGNOSTICS.F11,
          message:
            'Level 3 holds a bounded local representation only; executing the selected backlog effort is prohibited here.',
          status: 'blocked',
        };
      default:
        return { code: 'UNKNOWN_COMMAND', message: `Unknown Level 3 command: ${command}`, status: 'blocked' };
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
