import { existsSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createStore } from './store.mjs';
import { loadBacklogItem, updateBacklogItem } from './backlog-binding.mjs';
import { formContext, loadBinding } from './context.mjs';
import { resolvePacks, verifyPackLock } from './pack-resolver.mjs';
import {
  assertInsideRoot,
  digestJson,
  fileDigest,
  isoNow,
  newId,
  readJson,
  repositoryFingerprint,
  sha256,
  writeTextAtomic,
} from './utils.mjs';
import { fail } from './errors.mjs';

const WORK_KIND = 'work-items';
const SET_KIND = 'working-sets';
const SCOPE_KIND = 'scopes';

function getRun(store, runId) {
  return store.readArtifact('runs', runId);
}

function getHead(store, runId) {
  return store.readOperational(runId, 'head');
}

function writeHead(store, runId, head) {
  return store.writeOperational(runId, 'head', head);
}

function audit(store, command, { runId = null, sessionId = null, target = null, expectedRevision = null, before = null, after = null, result = 'ok', details = {} } = {}) {
  store.appendAudit({
    command,
    operation_id: newId('op'),
    actor: 'developer-via-claude-code-adapter',
    authority_policy: 'vs-001-configured-policy',
    run_id: runId,
    session_id: sessionId,
    adapter: 'claude-code',
    target,
    expected_prior_revision: expectedRevision,
    before,
    after,
    result,
    details,
  });
}

function acquireLease(store, runId, sessionId, { readOnly = false } = {}) {
  const lease = store.readOperational(runId, 'lease', { required: false });
  if (readOnly) return { read_only: true, holder: lease?.session_id ?? null };
  if (lease?.active && lease.session_id !== sessionId) {
    fail('LEASE_CONFLICT', `Run ${runId} is already owned by Session ${lease.session_id}`, {
      run_id: runId,
      holder_session_id: lease.session_id,
      requested_session_id: sessionId,
    });
  }
  return store.writeOperational(runId, 'lease', {
    active: true,
    run_id: runId,
    session_id: sessionId,
    acquired_at: lease?.session_id === sessionId ? lease.acquired_at : isoNow(),
  });
}

function releaseLease(store, runId, sessionId) {
  const lease = store.readOperational(runId, 'lease', { required: false });
  if (lease?.active && lease.session_id !== sessionId) {
    fail('LEASE_CONFLICT', `Session ${sessionId} cannot release lease owned by ${lease.session_id}`, {
      run_id: runId,
      holder_session_id: lease.session_id,
      requested_session_id: sessionId,
    });
  }
  return store.writeOperational(runId, 'lease', {
    active: false,
    run_id: runId,
    session_id: sessionId,
    released_at: isoNow(),
  });
}

function ensureRunSession(store, runId, sessionId, { mutable = true } = {}) {
  const run = getRun(store, runId);
  const session = store.readArtifact('sessions', sessionId);
  if (session.run_id !== runId) fail('SESSION_RUN_MISMATCH', `Session ${sessionId} does not belong to Run ${runId}`);
  if (mutable) acquireLease(store, runId, sessionId);
  return { run, session };
}

function createExecutionView(root, run, session, contextPack, checkpoint = null) {
  const lines = [
    '# Continuity Claude Code Execution View',
    '',
    `- Run: \`${run.id}\``,
    `- Session: \`${session.id}\``,
    `- Working Set: \`${run.working_set_ref.id}\``,
    `- Scope: \`${run.scope_ref.id}@${run.scope_ref.revision}\``,
    `- Context Pack: \`${contextPack.id}@${contextPack.revision}\``,
    `- Pack lock digest: \`${contextPack.pack_lock_digest}\``,
    `- Transcript dependency: **none**`,
    '',
    '## Objective',
    run.objective,
    '',
    '## Completion criteria',
    ...run.completion_criteria.map((criterion) => `- [${criterion.status === 'passed' ? 'x' : ' '}] \`${criterion.id}\` — ${criterion.description}`),
    '',
    '## Scope exclusions',
    ...run.exclusions.map((item) => `- ${item}`),
    '',
    '## Resolved procedures',
    ...contextPack.procedures.map((procedure) => `- \`${procedure.id}\` from \`${procedure.pack_id}@${procedure.pack_version}\` via \`${procedure.executor_asset}\``),
    '',
    '## Applicable Guards',
    ...(contextPack.guards.length ? contextPack.guards.map((guard) => `- \`${guard.id}@${guard.version}\``) : ['- Explicitly none']),
    '',
    '## Accepted Decisions',
    ...contextPack.decisions.map((decision) => `- \`${decision.id}@${decision.version}\``),
    '',
    '## Exact next action',
    checkpoint?.next_action ?? run.initial_next_action,
    '',
    'Use only canonical artifacts and this adapter-produced view. Do not reconstruct state from an earlier chat.',
    '',
  ];
  const relativePath = `.continuity/derived/execution-views/${run.id}-${session.id}.md`;
  writeTextAtomic(join(root, relativePath), `${lines.join('\n')}\n`);
  return { path: relativePath, sha256: fileDigest(root, relativePath).sha256 };
}

function loadRunDependencies(store, run) {
  return {
    workItem: store.readArtifact(WORK_KIND, run.work_item_ref.id),
    workingSet: store.readArtifact(SET_KIND, run.working_set_ref.id),
    scope: store.readArtifact(SCOPE_KIND, run.scope_ref.id),
    contextPack: store.readArtifact('context-packs', run.context_pack_ref.id),
    packLock: store.readArtifact('pack-locks', run.pack_lock_ref.id),
  };
}

function verifyFreshness(root, store, run, checkpoint) {
  const { workItem, workingSet, scope, contextPack, packLock } = loadRunDependencies(store, run);
  const failures = [];
  const compare = (label, expected, actual) => {
    if (expected !== actual) failures.push({ label, expected, actual });
  };
  compare('work_item_revision', checkpoint.work_item_ref.revision, workItem.revision);
  compare('working_set_revision', checkpoint.working_set_ref.revision, workingSet.revision);
  compare('scope_revision', checkpoint.scope_ref.revision, scope.revision);
  compare('context_pack_digest', checkpoint.context_pack_digest, contextPack.digest);
  compare('pack_lock_digest', checkpoint.pack_lock_digest, packLock.lock_digest);
  verifyPackLock(root, packLock.lock);
  const repo = repositoryFingerprint(root, scope.fingerprint_paths);
  compare('repository_fingerprint', checkpoint.repository_fingerprint.digest, repo.digest);
  if (failures.length) {
    fail('STALE_RUN', `Run ${run.id} is stale and cannot resume automatically`, { failures });
  }
  if (!checkpoint.next_action) fail('INVALID_HANDOFF', 'Checkpoint has no exact next action');
  return { workItem, workingSet, scope, contextPack, packLock, repo };
}

export function selectWork(root, { workId, workingSetId = `ws-${workId}` } = {}) {
  const store = createStore(root);
  const backlog = loadBacklogItem(root, workId);
  if (!['active', 'queued', 'parking'].includes(backlog.frontmatter.status)) {
    fail('WORK_NOT_READY', `Backlog item ${workId} is not selectable`, { status: backlog.frontmatter.status });
  }
  const binding = loadBinding(root, workId);
  const work = store.writeArtifact(WORK_KIND, workId, {
    schema_version: 1,
    status: 'selected',
    source: {
      type: 'nestfolio-backlog',
      path: backlog.relative_path,
      sha256: backlog.sha256,
      source_status: backlog.frontmatter.status,
    },
    objective: binding.objective,
    type: backlog.frontmatter.type ?? 'implementation',
    project_binding: 'nestfolio',
    dependencies: binding.dependencies ?? [],
    blockers: [],
    scope_ref: { id: binding.scope.id, revision: 1 },
    exclusions: binding.scope.exclusions,
    constraints: binding.constraints ?? [],
    expected_outputs: binding.expected_outputs,
    completion_criteria: binding.completion_criteria.map((criterion) => ({ ...criterion, status: 'pending' })),
    required_evidence: binding.required_evidence,
    required_capabilities: binding.required_capabilities,
    guards: binding.guards,
    decisions: binding.decisions,
    active_run_refs: [],
    completed_run_refs: [],
    evidence_refs: [],
    history: [{ action: 'selected', at: isoNow(), source_sha256: backlog.sha256 }],
  }, { expectedRevision: 0 });
  const scope = store.writeArtifact(SCOPE_KIND, binding.scope.id, {
    schema_version: 1,
    status: 'active',
    allowed_read_paths: binding.scope.allowed_read_paths,
    allowed_write_paths: binding.scope.allowed_write_paths,
    fingerprint_paths: binding.scope.fingerprint_paths,
    exclusions: binding.scope.exclusions,
    effect_classes: binding.scope.effect_classes,
    expansion_policy: 'explicit-revision-and-authorization',
    owner: 'VS-001',
    repository_identity: binding.scope.repository_identity,
  }, { expectedRevision: 0 });
  const workingSet = store.writeArtifact(SET_KIND, workingSetId, {
    schema_version: 1,
    status: 'ready',
    objective: binding.objective,
    work_item_refs: [{ id: work.id, revision: work.revision, digest: work.digest }],
    scope_ref: { id: scope.id, revision: scope.revision, digest: scope.digest },
    shared_completion_boundary: binding.shared_completion_boundary,
    exclusions: binding.scope.exclusions,
    dependency_rationale: 'Single bounded VS-001 implementation/dogfood item; no unrelated Nestfolio work.',
    active_run_refs: [],
    completed_run_refs: [],
    evidence_refs: [],
    history: [{ action: 'created', at: isoNow() }],
  }, { expectedRevision: 0 });
  audit(store, 'continuity select', {
    target: `${WORK_KIND}/${workId}`,
    after: { work_revision: work.revision, working_set_revision: workingSet.revision, scope_revision: scope.revision },
  });
  store.rebuildIndex();
  return { work_item: work, working_set: workingSet, scope };
}

export function startRun(root, { workingSetId, sessionId = newId('session'), runId = newId('run') } = {}) {
  const store = createStore(root);
  const workingSet = store.readArtifact(SET_KIND, workingSetId);
  if (workingSet.status !== 'ready') fail('WORKING_SET_NOT_READY', `Working Set ${workingSetId} is not ready`, { status: workingSet.status });
  const workRef = workingSet.work_item_refs[0];
  const workItem = store.readArtifact(WORK_KIND, workRef.id);
  const scope = store.readArtifact(SCOPE_KIND, workingSet.scope_ref.id);
  const packLockRaw = resolvePacks(root, workItem.required_capabilities);
  const packLock = store.writeImmutableArtifact('pack-locks', runId, {
    schema_version: 1,
    run_id: runId,
    status: 'locked',
    lock_digest: packLockRaw.digest,
    lock: packLockRaw,
  });
  const guards = workItem.guards.map((guard) => ({ ...guard, definition_sha256: fileDigest(root, guard.path).sha256 }));
  const decisions = workItem.decisions.map((decision) => ({ ...decision, definition_sha256: fileDigest(root, decision.path).sha256 }));
  const formed = formContext({ root, runId, workItem, workingSet, scope, packLock: packLockRaw, decisions, guards });
  const trace = store.writeImmutableArtifact('formation-traces', runId, {
    ...formed.trace,
    trace_digest: formed.traceDigest,
  });
  const contextPack = store.writeImmutableArtifact('context-packs', runId, {
    ...formed.contextPack,
    formation_trace_ref: { id: trace.id, revision: trace.revision, digest: trace.digest },
    context_pack_digest: formed.contextPackDigest,
  });
  const validationPlan = store.writeImmutableArtifact('validation-plans', runId, {
    schema_version: 1,
    run_id: runId,
    status: 'ready',
    criteria: workItem.completion_criteria.map((criterion) => ({
      id: criterion.id,
      description: criterion.description,
      validator: criterion.validator,
      required_evidence_type: criterion.required_evidence_type,
      required: true,
    })),
    guards,
    completion_policy: 'all-required-criteria-pass-with-evidence',
  });
  const run = store.writeArtifact('runs', runId, {
    schema_version: 1,
    status: 'running',
    objective: workItem.objective,
    work_item_ref: { id: workItem.id, revision: workItem.revision, digest: workItem.digest },
    working_set_ref: { id: workingSet.id, revision: workingSet.revision, digest: workingSet.digest },
    scope_ref: { id: scope.id, revision: scope.revision, digest: scope.digest },
    context_pack_ref: { id: contextPack.id, revision: contextPack.revision, digest: contextPack.digest },
    pack_lock_ref: { id: packLock.id, revision: packLock.revision, digest: packLock.digest },
    validation_plan_ref: { id: validationPlan.id, revision: validationPlan.revision, digest: validationPlan.digest },
    repository_fingerprint_at_start: formed.contextPack.repository_fingerprint,
    adapter: 'claude-code',
    executor_asset_provenance: packLockRaw.procedures.map((procedure) => ({
      procedure_id: procedure.id,
      executor_asset: procedure.executor_asset,
      sha256: procedure.executor_asset_sha256,
    })),
    completion_criteria: workItem.completion_criteria,
    exclusions: workItem.exclusions,
    initial_next_action: 'Execute the authorized keyed dogfood effect, then checkpoint.',
    session_refs: [],
    effect_keys: [],
    checkpoint_refs: [],
    validation_result_refs: [],
    evidence_refs: [],
    observation_refs: [],
    lesson_refs: [],
    history: [{ action: 'started', at: isoNow() }],
  }, { expectedRevision: 0 });
  const session = store.writeArtifact('sessions', sessionId, {
    schema_version: 1,
    run_id: runId,
    status: 'active',
    adapter: 'claude-code',
    executor: 'Claude Code',
    opened_at: isoNow(),
    transcript_dependency: false,
    prior_session_ref: null,
  }, { expectedRevision: 0 });
  acquireLease(store, runId, sessionId);
  const executionView = createExecutionView(root, run, session, contextPack);
  const updatedRun = store.writeArtifact('runs', runId, {
    ...run,
    session_refs: [{ id: session.id, revision: session.revision, digest: session.digest }],
    execution_view_refs: [{ session_id: session.id, ...executionView }],
    history: [...run.history, { action: 'adapter-view-delivered', at: isoNow(), session_id: session.id, execution_view: executionView }],
  }, { expectedRevision: run.revision });
  writeHead(store, runId, {
    schema_version: 1,
    run_id: runId,
    status: 'running',
    run_revision: updatedRun.revision,
    active_session_id: sessionId,
    latest_checkpoint_id: null,
  });
  const workUpdated = store.writeArtifact(WORK_KIND, workItem.id, {
    ...workItem,
    status: 'in_progress',
    active_run_refs: [{ id: runId, revision: updatedRun.revision }],
    history: [...workItem.history, { action: 'run-started', at: isoNow(), run_id: runId }],
  }, { expectedRevision: workItem.revision });
  const setUpdated = store.writeArtifact(SET_KIND, workingSet.id, {
    ...workingSet,
    status: 'in_progress',
    active_run_refs: [{ id: runId, revision: updatedRun.revision }],
    work_item_refs: [{ id: workUpdated.id, revision: workUpdated.revision, digest: workUpdated.digest }],
    history: [...workingSet.history, { action: 'run-started', at: isoNow(), run_id: runId }],
  }, { expectedRevision: workingSet.revision });
  audit(store, 'continuity start', {
    runId,
    sessionId,
    target: `runs/${runId}`,
    after: { run_revision: updatedRun.revision, context_pack_digest: contextPack.digest, pack_lock_digest: packLockRaw.digest, execution_view: executionView },
  });
  store.rebuildIndex();
  return { run: updatedRun, session, context_pack: contextPack, formation_trace: trace, pack_lock: packLock, validation_plan: validationPlan, execution_view: executionView };
}

export function recordFileEffect(root, { runId, sessionId, key, path, content }) {
  const store = createStore(root);
  const { run } = ensureRunSession(store, runId, sessionId);
  const scope = store.readArtifact(SCOPE_KIND, run.scope_ref.id);
  const normalized = path.replaceAll('\\', '/').replace(/^\.?\//, '');
  const allowed = scope.allowed_write_paths.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix.replace(/\/$/, '')}/`));
  if (!allowed) fail('OUT_OF_SCOPE_EFFECT', `Effect path is outside declared Scope: ${normalized}`, { path: normalized });
  const effects = store.readOperational(runId, 'effects', { required: false }) ?? { schema_version: 1, run_id: runId, effects: [] };
  const existing = effects.effects.find((effect) => effect.key === key);
  if (existing?.status === 'completed') {
    const currentDigest = existsSync(join(root, normalized)) ? sha256(readFileSync(join(root, normalized))) : null;
    if (currentDigest !== existing.after_sha256) {
      fail('COMPLETED_EFFECT_DIVERGED', `Completed effect ${key} is no longer observable`, {
        key,
        expected_sha256: existing.after_sha256,
        actual_sha256: currentDigest,
      });
    }
    audit(store, 'continuity effect', { runId, sessionId, target: `effect/${key}`, result: 'deduplicated', details: { path: normalized } });
    return { effect: existing, deduplicated: true };
  }
  if (existing && ['started', 'unknown'].includes(existing.status)) {
    fail('UNKNOWN_EFFECT_REQUIRES_RECONCILIATION', `Effect ${key} cannot be retried automatically`, { effect: existing });
  }
  const abs = assertInsideRoot(root, join(root, normalized));
  const before = existsSync(abs) ? sha256(readFileSync(abs)) : null;
  writeTextAtomic(abs, content);
  const after = sha256(readFileSync(abs));
  const effect = {
    key,
    status: 'completed',
    effect_class: 'repository-file-write',
    path: normalized,
    before_sha256: before,
    after_sha256: after,
    completed_at: isoNow(),
    session_id: sessionId,
  };
  store.writeOperational(runId, 'effects', {
    schema_version: 1,
    run_id: runId,
    effects: [...effects.effects, effect],
  });
  const runUpdated = store.writeArtifact('runs', runId, {
    ...run,
    effect_keys: [...new Set([...run.effect_keys, key])],
    history: [...run.history, { action: 'effect-completed', at: isoNow(), session_id: sessionId, effect_key: key, path: normalized }],
  }, { expectedRevision: run.revision });
  writeHead(store, runId, { ...getHead(store, runId), run_revision: runUpdated.revision });
  audit(store, 'continuity effect', { runId, sessionId, target: `effect/${key}`, before: { sha256: before }, after: { sha256: after, path: normalized } });
  return { effect, deduplicated: false };
}

export function checkpointRun(root, { runId, sessionId, nextAction, final = false }) {
  const store = createStore(root);
  const { run } = ensureRunSession(store, runId, sessionId);
  const { workItem, workingSet, scope, contextPack, packLock } = loadRunDependencies(store, run);
  verifyPackLock(root, packLock.lock);
  const effects = store.readOperational(runId, 'effects', { required: false }) ?? { effects: [] };
  const repo = repositoryFingerprint(root, scope.fingerprint_paths);
  const checkpointId = `${runId}-${final ? 'final' : 'cp'}-${run.checkpoint_refs.length + 1}`;
  const checkpointPayload = {
    schema_version: 1,
    run_id: runId,
    session_id: sessionId,
    status: 'verified',
    final,
    captured_at: isoNow(),
    work_item_ref: { id: workItem.id, revision: workItem.revision, digest: workItem.digest },
    working_set_ref: { id: workingSet.id, revision: workingSet.revision, digest: workingSet.digest },
    scope_ref: { id: scope.id, revision: scope.revision, digest: scope.digest },
    context_pack_digest: contextPack.digest,
    pack_lock_digest: packLock.lock_digest,
    repository_fingerprint: repo,
    completed_effects: effects.effects.filter((effect) => effect.status === 'completed').map((effect) => ({
      key: effect.key,
      path: effect.path,
      after_sha256: effect.after_sha256,
    })),
    next_action: nextAction,
    active_scope: scope.allowed_write_paths,
    completion_criteria: run.completion_criteria,
    adapter_session_provenance: { adapter: 'claude-code', session_id: sessionId },
  };
  const checkpoint = store.writeImmutableArtifact('checkpoints', checkpointId, {
    ...checkpointPayload,
    verification_digest: digestJson(checkpointPayload),
  });
  const updatedRun = store.writeArtifact('runs', runId, {
    ...run,
    checkpoint_refs: [...run.checkpoint_refs, { id: checkpoint.id, revision: checkpoint.revision, digest: checkpoint.digest, final }],
    history: [...run.history, { action: 'checkpoint-verified', at: isoNow(), checkpoint_id: checkpoint.id, final }],
  }, { expectedRevision: run.revision });
  writeHead(store, runId, {
    ...getHead(store, runId),
    status: final ? 'validating' : 'paused',
    run_revision: updatedRun.revision,
    latest_checkpoint_id: checkpoint.id,
  });
  audit(store, 'continuity checkpoint', {
    runId,
    sessionId,
    target: `checkpoints/${checkpoint.id}`,
    after: { digest: checkpoint.digest, verification_digest: checkpoint.verification_digest, next_action: nextAction },
  });
  return { checkpoint, run: updatedRun };
}

export function interruptSession(root, { runId, sessionId, reason = 'simulated-unexpected-termination' }) {
  const store = createStore(root);
  const run = getRun(store, runId);
  const session = store.readArtifact('sessions', sessionId);
  const head = getHead(store, runId);
  if (!head.latest_checkpoint_id) fail('CHECKPOINT_REQUIRED', 'A verified Checkpoint is required before publishing a resumable Handoff');
  const checkpoint = store.readArtifact('checkpoints', head.latest_checkpoint_id);
  const updatedSession = store.writeArtifact('sessions', sessionId, {
    ...session,
    status: 'interrupted',
    closed_at: isoNow(),
    close_reason: reason,
  }, { expectedRevision: session.revision });
  const handoff = store.writeImmutableArtifact('handoffs', `${runId}-${sessionId}`, {
    schema_version: 1,
    run_id: runId,
    from_session_id: sessionId,
    status: 'published',
    checkpoint_ref: { id: checkpoint.id, revision: checkpoint.revision, digest: checkpoint.digest },
    exact_next_action: checkpoint.next_action,
    completed_effects: checkpoint.completed_effects,
    context_pack_digest: checkpoint.context_pack_digest,
    pack_lock_digest: checkpoint.pack_lock_digest,
    repository_fingerprint: checkpoint.repository_fingerprint,
    transcript_dependency: false,
    reason,
  });
  releaseLease(store, runId, sessionId);
  const updatedRun = store.writeArtifact('runs', runId, {
    ...run,
    status: 'interrupted',
    handoff_refs: [...(run.handoff_refs ?? []), { id: handoff.id, revision: handoff.revision, digest: handoff.digest }],
    history: [...run.history, { action: 'session-interrupted', at: isoNow(), session_id: sessionId, handoff_id: handoff.id }],
  }, { expectedRevision: run.revision });
  writeHead(store, runId, {
    ...head,
    status: 'interrupted',
    run_revision: updatedRun.revision,
    active_session_id: null,
  });
  audit(store, 'continuity interrupt', { runId, sessionId, target: `sessions/${sessionId}`, after: { status: 'interrupted', handoff_id: handoff.id } });
  return { session: updatedSession, handoff, run: updatedRun };
}

export function resumeRun(root, { runId, sessionId = newId('session'), readOnly = false }) {
  const store = createStore(root);
  const run = getRun(store, runId);
  const head = getHead(store, runId);
  if (!['paused', 'interrupted', 'validation_failed', 'blocked'].includes(head.status) && !['interrupted', 'paused', 'validation_failed', 'blocked'].includes(run.status)) {
    fail('RUN_NOT_RESUMABLE', `Run ${runId} is not resumable`, { run_status: run.status, head_status: head.status });
  }
  const checkpoint = store.readArtifact('checkpoints', head.latest_checkpoint_id);
  const fresh = verifyFreshness(root, store, run, checkpoint);
  const leaseResult = acquireLease(store, runId, sessionId, { readOnly });
  const priorSessionId = run.session_refs.at(-1)?.id ?? null;
  const session = store.writeArtifact('sessions', sessionId, {
    schema_version: 1,
    run_id: runId,
    status: readOnly ? 'read_only' : 'active',
    adapter: 'claude-code',
    executor: 'Claude Code',
    opened_at: isoNow(),
    transcript_dependency: false,
    prior_session_ref: priorSessionId,
    resumed_from_checkpoint_ref: { id: checkpoint.id, revision: checkpoint.revision, digest: checkpoint.digest },
    lease: leaseResult,
  }, { expectedRevision: 0 });
  const executionView = createExecutionView(root, run, session, fresh.contextPack, checkpoint);
  const updatedRun = store.writeArtifact('runs', runId, {
    ...run,
    status: readOnly ? run.status : 'running',
    session_refs: [...run.session_refs, { id: session.id, revision: session.revision, digest: session.digest }],
    execution_view_refs: [...(run.execution_view_refs ?? []), { session_id: session.id, ...executionView }],
    history: [...run.history, { action: 'resumed', at: isoNow(), session_id: session.id, checkpoint_id: checkpoint.id, read_only: readOnly }],
  }, { expectedRevision: run.revision });
  writeHead(store, runId, {
    ...head,
    status: readOnly ? head.status : 'running',
    run_revision: updatedRun.revision,
    active_session_id: readOnly ? head.active_session_id : session.id,
    last_resume_validation: {
      repository_fingerprint: fresh.repo.digest,
      context_pack_digest: fresh.contextPack.digest,
      pack_lock_digest: fresh.packLock.lock_digest,
      checkpoint_digest: checkpoint.digest,
      passed: true,
    },
  });
  audit(store, 'continuity resume', {
    runId,
    sessionId,
    target: `runs/${runId}`,
    after: { checkpoint_id: checkpoint.id, execution_view: executionView, read_only: readOnly },
  });
  return { run: updatedRun, session, checkpoint, execution_view: executionView, exact_next_action: checkpoint.next_action };
}

function runValidator(root, validator) {
  if (validator.type === 'file') {
    const path = join(root, validator.path);
    if (!existsSync(path)) return { passed: false, exit_code: null, stdout: '', stderr: `Missing file: ${validator.path}` };
    const bytes = readFileSync(path);
    if (validator.expected_sha256 && sha256(bytes) !== validator.expected_sha256) {
      return { passed: false, exit_code: null, stdout: '', stderr: `SHA mismatch for ${validator.path}` };
    }
    if (validator.contains && !bytes.toString('utf8').includes(validator.contains)) {
      return { passed: false, exit_code: null, stdout: '', stderr: `Expected content missing from ${validator.path}` };
    }
    return { passed: true, exit_code: 0, stdout: `Verified ${validator.path}`, stderr: '' };
  }
  if (validator.type === 'command') {
    const result = spawnSync(validator.command[0], validator.command.slice(1), {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, CONTINUITY_VALIDATION: '1' },
    });
    return {
      passed: result.status === 0,
      exit_code: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  }
  fail('UNKNOWN_VALIDATOR', `Unknown validator type: ${validator.type}`);
}

export function validateRun(root, { runId, sessionId }) {
  const store = createStore(root);
  const { run } = ensureRunSession(store, runId, sessionId);
  const plan = store.readArtifact('validation-plans', run.validation_plan_ref.id);
  const results = [];
  const evidenceRefs = [];
  for (const criterion of plan.criteria) {
    const result = runValidator(root, criterion.validator);
    const resultId = `${runId}-${criterion.id}-${run.validation_result_refs.length + results.length + 1}`;
    const validationResult = store.writeImmutableArtifact('validation-results', resultId, {
      schema_version: 1,
      run_id: runId,
      criterion_id: criterion.id,
      mode: criterion.validator.type === 'command' ? 'deterministic-command' : 'deterministic-file',
      status: result.passed ? 'passed' : 'failed',
      validator: criterion.validator,
      exit_code: result.exit_code,
      stdout_sha256: sha256(result.stdout),
      stderr_sha256: sha256(result.stderr),
      stdout_excerpt: result.stdout.slice(0, 2000),
      stderr_excerpt: result.stderr.slice(0, 2000),
    });
    results.push(validationResult);
    if (result.passed) {
      const evidenceId = `${runId}-${criterion.id}`;
      const evidence = store.writeImmutableArtifact('evidence', evidenceId, {
        schema_version: 1,
        run_id: runId,
        criterion_id: criterion.id,
        evidence_type: criterion.required_evidence_type,
        authority: 'deterministic',
        validation_result_ref: { id: validationResult.id, revision: validationResult.revision, digest: validationResult.digest },
        provenance: {
          adapter: 'claude-code',
          session_id: sessionId,
          validator: criterion.validator,
          repository_fingerprint: repositoryFingerprint(root, store.readArtifact(SCOPE_KIND, run.scope_ref.id).fingerprint_paths).digest,
        },
        status: 'accepted',
      });
      evidenceRefs.push({ id: evidence.id, revision: evidence.revision, digest: evidence.digest, criterion_id: criterion.id });
    }
  }
  const allPassed = results.every((result) => result.status === 'passed');
  const updatedRun = store.writeArtifact('runs', runId, {
    ...run,
    status: allPassed ? 'validating' : 'validation_failed',
    validation_result_refs: [...run.validation_result_refs, ...results.map((result) => ({ id: result.id, revision: result.revision, digest: result.digest, criterion_id: result.criterion_id }))],
    evidence_refs: [...run.evidence_refs, ...evidenceRefs],
    completion_criteria: run.completion_criteria.map((criterion) => ({
      ...criterion,
      status: results.find((result) => result.criterion_id === criterion.id)?.status ?? criterion.status,
    })),
    history: [...run.history, { action: 'validated', at: isoNow(), session_id: sessionId, all_passed: allPassed }],
  }, { expectedRevision: run.revision });
  writeHead(store, runId, { ...getHead(store, runId), status: updatedRun.status, run_revision: updatedRun.revision });
  audit(store, 'continuity validate', {
    runId,
    sessionId,
    target: `runs/${runId}`,
    result: allPassed ? 'passed' : 'failed',
    after: { criteria: results.map((result) => ({ id: result.criterion_id, status: result.status })) },
  });
  return { run: updatedRun, validation_results: results, evidence_refs: evidenceRefs, all_passed: allPassed };
}

export function recordLesson(root, {
  runId,
  sessionId,
  observation,
  lesson,
  unsafe = false,
}) {
  const store = createStore(root);
  const run = getRun(store, runId);
  const observationId = newId('observation');
  const observationArtifact = store.writeImmutableArtifact('observations', observationId, {
    schema_version: 1,
    run_id: runId,
    session_id: sessionId,
    status: 'triaged',
    statement: observation,
    evidence_refs: run.evidence_refs,
  });
  const lessonId = newId('lesson');
  const lessonArtifact = store.writeImmutableArtifact('lessons', lessonId, {
    schema_version: 1,
    run_id: runId,
    observation_ref: { id: observationArtifact.id, revision: observationArtifact.revision, digest: observationArtifact.digest },
    status: unsafe ? 'rejected' : 'candidate',
    statement: lesson,
    safety_review: unsafe ? {
      status: 'unsafe',
      rationale: 'A single Run may not automatically create or modify canonical Guards, Skills, or Procedures.',
    } : {
      status: 'pending-human-review',
    },
    promotion: {
      status: 'not_promoted',
      target_changes: [],
      automatic: false,
    },
    evidence_refs: run.evidence_refs,
  });
  const updatedRun = store.writeArtifact('runs', runId, {
    ...run,
    observation_refs: [...run.observation_refs, { id: observationArtifact.id, revision: observationArtifact.revision, digest: observationArtifact.digest }],
    lesson_refs: [...run.lesson_refs, { id: lessonArtifact.id, revision: lessonArtifact.revision, digest: lessonArtifact.digest }],
    history: [...run.history, { action: 'lesson-recorded', at: isoNow(), session_id: sessionId, lesson_id: lessonArtifact.id, unsafe }],
  }, { expectedRevision: run.revision });
  writeHead(store, runId, { ...getHead(store, runId), run_revision: updatedRun.revision });
  audit(store, 'continuity lesson', {
    runId,
    sessionId,
    target: `lessons/${lessonArtifact.id}`,
    result: unsafe ? 'rejected-unsafe' : 'candidate-unpromoted',
  });
  return { observation: observationArtifact, lesson: lessonArtifact, run: updatedRun };
}

export function completeRun(root, { runId, sessionId }) {
  const store = createStore(root);
  const { run } = ensureRunSession(store, runId, sessionId);
  const failedCriteria = run.completion_criteria.filter((criterion) => criterion.status !== 'passed');
  const evidenceByCriterion = new Map(run.evidence_refs.map((ref) => [ref.criterion_id, ref]));
  const missingEvidence = run.completion_criteria
    .filter((criterion) => criterion.status === 'passed' && !evidenceByCriterion.has(criterion.id))
    .map((criterion) => criterion.id);
  if (failedCriteria.length || missingEvidence.length) {
    fail('COMPLETION_GATE_BLOCKED', `Run ${runId} cannot complete`, {
      failed_criteria: failedCriteria.map((criterion) => ({ id: criterion.id, status: criterion.status })),
      missing_evidence: missingEvidence,
    });
  }
  const lease = store.readOperational(runId, 'lease', { required: false });
  if (!lease?.active || lease.session_id !== sessionId) {
    fail('LEASE_REQUIRED', 'Completion requires the active mutating lease');
  }
  const checkpointResult = checkpointRun(root, {
    runId,
    sessionId,
    nextAction: 'No execution action remains. Review the candidate Lesson and authorize the next iteration from VS-001 evidence.',
    final: true,
  });
  const currentRun = checkpointResult.run;
  const workItem = store.readArtifact(WORK_KIND, currentRun.work_item_ref.id);
  const workingSet = store.readArtifact(SET_KIND, currentRun.working_set_ref.id);
  const updatedRun = store.writeArtifact('runs', runId, {
    ...currentRun,
    status: 'completed',
    completed_at: isoNow(),
    history: [...currentRun.history, { action: 'completed', at: isoNow(), session_id: sessionId }],
  }, { expectedRevision: currentRun.revision });
  const workUpdated = store.writeArtifact(WORK_KIND, workItem.id, {
    ...workItem,
    status: 'completed',
    active_run_refs: [],
    completed_run_refs: [{ id: updatedRun.id, revision: updatedRun.revision, digest: updatedRun.digest }],
    evidence_refs: updatedRun.evidence_refs,
    completion_criteria: updatedRun.completion_criteria,
    history: [...workItem.history, { action: 'completed', at: isoNow(), run_id: updatedRun.id, evidence_refs: updatedRun.evidence_refs.map((ref) => ref.id) }],
  }, { expectedRevision: workItem.revision });
  const setUpdated = store.writeArtifact(SET_KIND, workingSet.id, {
    ...workingSet,
    status: 'completed',
    active_run_refs: [],
    completed_run_refs: [{ id: updatedRun.id, revision: updatedRun.revision, digest: updatedRun.digest }],
    evidence_refs: updatedRun.evidence_refs,
    work_item_refs: [{ id: workUpdated.id, revision: workUpdated.revision, digest: workUpdated.digest }],
    history: [...workingSet.history, { action: 'completed', at: isoNow(), run_id: updatedRun.id }],
  }, { expectedRevision: workingSet.revision });
  const source = workItem.source;
  const backlogUpdated = updateBacklogItem(root, workItem.id, {
    expected_sha256: source.sha256,
    status: 'shipped',
    closed: isoNow().slice(0, 10),
    validation_gate: `Continuity VS-001 Run ${runId}: all required criteria passed with criterion-linked Evidence; final Checkpoint ${checkpointResult.checkpoint.id}.`,
  });
  releaseLease(store, runId, sessionId);
  const session = store.readArtifact('sessions', sessionId);
  const sessionUpdated = store.writeArtifact('sessions', sessionId, {
    ...session,
    status: 'closed',
    closed_at: isoNow(),
    close_reason: 'run-completed',
  }, { expectedRevision: session.revision });
  writeHead(store, runId, {
    ...getHead(store, runId),
    status: 'completed',
    run_revision: updatedRun.revision,
    active_session_id: null,
    latest_checkpoint_id: checkpointResult.checkpoint.id,
  });
  audit(store, 'continuity complete', {
    runId,
    sessionId,
    target: `runs/${runId}`,
    after: {
      run_revision: updatedRun.revision,
      work_revision: workUpdated.revision,
      working_set_revision: setUpdated.revision,
      final_checkpoint_id: checkpointResult.checkpoint.id,
      backlog_sha256: backlogUpdated.sha256,
    },
  });
  store.rebuildIndex();
  return {
    run: updatedRun,
    work_item: workUpdated,
    working_set: setUpdated,
    session: sessionUpdated,
    final_checkpoint: checkpointResult.checkpoint,
    backlog: { path: backlogUpdated.relative_path, sha256: backlogUpdated.sha256, status: backlogUpdated.frontmatter.status },
  };
}

export function rebuildDerivedIndex(root) {
  const store = createStore(root);
  const index = store.rebuildIndex();
  audit(store, 'continuity rebuild-index', { target: '.continuity/derived/index.json', after: { digest: index.digest } });
  return index;
}

export function inspectRun(root, { runId }) {
  const store = createStore(root);
  const run = getRun(store, runId);
  return {
    run,
    head: getHead(store, runId),
    lease: store.readOperational(runId, 'lease', { required: false }),
    effects: store.readOperational(runId, 'effects', { required: false }),
    checkpoints: run.checkpoint_refs.map((ref) => store.readArtifact('checkpoints', ref.id)),
    sessions: run.session_refs.map((ref) => store.readArtifact('sessions', ref.id)),
    handoffs: (run.handoff_refs ?? []).map((ref) => store.readArtifact('handoffs', ref.id)),
    evidence: run.evidence_refs.map((ref) => store.readArtifact('evidence', ref.id)),
    observations: run.observation_refs.map((ref) => store.readArtifact('observations', ref.id)),
    lessons: run.lesson_refs.map((ref) => store.readArtifact('lessons', ref.id)),
  };
}
