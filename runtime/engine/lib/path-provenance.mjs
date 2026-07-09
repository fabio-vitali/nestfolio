// runtime/engine/lib/path-provenance.mjs — ring-1: path-provenance vocabulary (spec §4). Journals
// which engine drove a workstream, kept as plain observability after the legacy work-driver retired
// (runtime-legacy-retirement, 2026-07-09): the strangler flag (`RUNTIME_ENGINE`/`usesRuntimeEngine`)
// and the legacy-fallback ledger (`FALLBACK_RUN_ID`/`PATH_LEGACY_FALLBACK`/`recordLegacyFallback`)
// were removed with the legacy path; `path:runtime` journaling stays so the ledger is self-describing
// and any future engine-path migration gets its soak instrument back for free. Writers = the adapter
// drivers (run-item / run-intake / …). Pure: the journal is injected.

export const RUNTIME_PATH_KEY = 'path:runtime';        // step key in the workstream's OWN ledger
export const PATH_RUNTIME = 'runtime';

/** Journal a runtime-path provenance record in the workstream's own ledger. */
export function recordRuntimePath(journal, { runId, workstream, sha }) {
  journal.record(runId, RUNTIME_PATH_KEY, { path: PATH_RUNTIME, workstream, sha });
}

/** True iff a StepRecord (from journal.read().steps) is a completed runtime-path provenance record. */
export function isRuntimePathRecord(step) {
  return step?.status === 'complete' && step?.value?.path === PATH_RUNTIME;
}
