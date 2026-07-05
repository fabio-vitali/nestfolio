// errors.mjs — typed error classes surfaced by resolveEvaluator (meta-check assertion 2/3 surfaces).
export class EvaluatorUnresolved extends Error {
  constructor(run, reason) { super(`evaluator unresolved: ${run} (${reason})`); this.name = 'EvaluatorUnresolved'; this.run = run; }
}
export class JudgmentContractMissing extends Error {
  constructor(id) { super(`judgment check "${id}" has no flake_contract`); this.name = 'JudgmentContractMissing'; }
}
export class JudgeCapabilityUnavailable extends Error {
  constructor(run) { super(`skill judge capability is not wired in ring-1 (SPEC 3 seam #1): ${run}`); this.name = 'JudgeCapabilityUnavailable'; }
}
export class JournalWriterConflict extends Error {
  constructor(runId, holder) {
    super(`journal runId "${runId}" is held by a live writer (pid ${holder?.pid}@${holder?.host}) — single-writer rule (§5)`);
    this.name = 'JournalWriterConflict'; this.holder = holder;
  }
}
