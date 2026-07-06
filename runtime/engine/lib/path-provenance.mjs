// runtime/engine/lib/path-provenance.mjs — ring-1: the RUNTIME_ENGINE strangler flag + path-provenance
// vocabulary (spec §4). The single source of truth for which path drove a workstream. Writers = the
// adapter drivers (run-item / run-intake / …); readers = scripts/parity-oracle/soak-observer.mjs +
// runtime-grade.mjs. Pure: the journal and env are injected. Mirrors shouldSkip(env) at
// runtime/adapters/git/pre-commit-gate.mjs:19 and the dedicated 'gate-skips' ledger pattern.

export const RUNTIME_PATH_KEY = 'path:runtime';        // step key in the workstream's OWN ledger
export const FALLBACK_RUN_ID = 'path-fallback';        // dedicated ledger (mirrors 'gate-skips')
export const PATH_RUNTIME = 'runtime';
export const PATH_LEGACY_FALLBACK = 'legacy-fallback';

/** Hard cutover — one flag, no per-skill variants. Mirrors shouldSkip(env). */
export function usesRuntimeEngine(env) { return Boolean(env.RUNTIME_ENGINE); }

/** The dedicated-ledger key for a workstream's fallback (one per workstream — presence = "not ready"). */
export const fallbackKey = (workstream) => `fallback:${workstream}`;

/** Journal a runtime-path provenance record in the workstream's own ledger (soak counts these). */
export function recordRuntimePath(journal, { runId, workstream, sha }) {
  journal.record(runId, RUNTIME_PATH_KEY, { path: PATH_RUNTIME, workstream, sha });
}

/** Journal a DELIBERATE legacy fallback to the dedicated ledger — loud and countable (§4). */
export function recordLegacyFallback(journal, { workstream, reason, sha }) {
  journal.begin(FALLBACK_RUN_ID, { runId: FALLBACK_RUN_ID, auto: false });
  journal.record(FALLBACK_RUN_ID, fallbackKey(workstream), { path: PATH_LEGACY_FALLBACK, workstream, reason, sha });
}

/** True iff a StepRecord (from journal.read().steps) is a completed runtime-path provenance record. */
export function isRuntimePathRecord(step) {
  return step?.status === 'complete' && step?.value?.path === PATH_RUNTIME;
}
