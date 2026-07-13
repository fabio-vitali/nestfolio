import { join } from 'node:path';
import { digestJson, fileDigest, isoNow, readJson, repositoryFingerprint } from './utils.mjs';

export function formContext({
  root,
  runId,
  workItem,
  workingSet,
  scope,
  packLock,
  decisions = [],
  guards = [],
}) {
  const sources = [
    { type: 'work_item', id: workItem.id, revision: workItem.revision, digest: workItem.digest, required: true, rationale: 'Selected work authority' },
    { type: 'working_set', id: workingSet.id, revision: workingSet.revision, digest: workingSet.digest, required: true, rationale: 'Bounded execution selection' },
    { type: 'scope', id: scope.id, revision: scope.revision, digest: scope.digest, required: true, rationale: 'Read/write boundary and exclusions' },
    ...packLock.procedures.map((procedure) => ({
      type: 'procedure',
      id: procedure.id,
      revision: `${procedure.pack_id}@${procedure.pack_version}`,
      digest: procedure.procedure_sha256,
      required: true,
      rationale: 'Resolved executable procedure',
    })),
    ...guards.map((guard) => ({
      type: 'guard',
      id: guard.id,
      revision: guard.version,
      digest: fileDigest(root, guard.path).sha256,
      required: true,
      rationale: 'Applicable project Guard',
    })),
    ...decisions.map((decision) => ({
      type: 'decision',
      id: decision.id,
      revision: decision.version,
      digest: fileDigest(root, decision.path).sha256,
      required: true,
      rationale: 'Accepted architectural/project Decision',
    })),
  ];
  const repo = repositoryFingerprint(root, scope.fingerprint_paths);
  const trace = {
    schema_version: 1,
    run_id: runId,
    formed_at: isoNow(),
    stages: [
      'bind-work',
      'bind-execution-boundary',
      'resolve-packs',
      'resolve-procedures',
      'resolve-decisions',
      'resolve-guards-and-criteria',
      'inspect-repository-evidence',
      'apply-inclusions-and-exclusions',
      'detect-stale-missing-contradictory-state',
      'assemble-context-pack',
      'validate-and-authorize',
      'deliver-adapter-view',
    ],
    sources,
    omissions: [],
    diagnostics: [],
  };
  const traceDigest = digestJson(trace);
  const contextPack = {
    schema_version: 1,
    run_id: runId,
    status: 'authorized',
    authorized_by: 'configured-deterministic-policy',
    work_item_ref: { id: workItem.id, revision: workItem.revision, digest: workItem.digest },
    working_set_ref: { id: workingSet.id, revision: workingSet.revision, digest: workingSet.digest },
    scope_ref: { id: scope.id, revision: scope.revision, digest: scope.digest },
    pack_lock_digest: packLock.digest,
    procedures: packLock.procedures,
    guards,
    decisions,
    completion_criteria: workItem.completion_criteria,
    required_evidence: workItem.required_evidence,
    repository_fingerprint: repo,
    formation_trace_digest: traceDigest,
    transcript_dependency: false,
  };
  return { trace, traceDigest, contextPack, contextPackDigest: digestJson(contextPack) };
}

export function loadBinding(root, workId) {
  return readJson(join(root, 'continuity', 'bindings', 'nestfolio', 'work-items', `${workId}.json`));
}
