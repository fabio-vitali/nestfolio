---
id: from-run-item-judge-binding-gap
type: bug
status: parking
done_when: "resolve: run-item.mjs:35 builds capabilities via bare
  makeClaudeCodeCapabilities({}) — the exact judge-binding gap fixed in
  run-next/run-epic/run-audit by from-run-next-pre-ship-judge-binding-gap:
  worker.mjs:21 derives the judge from runProcedure and uses it at the
  start-gate AND ship-gate, so any skill:<name> judgment check selected during a
  run-item drive fail-closes ('unknown procedure'). Deliberately not fixed there
  (out_of_scope, separate closure verdict): run-item is the generic SPEC-3 CLI —
  either wire makeDriverCapabilities() (one line; the seam now exists in
  runtime/adapters/claude-code/driver-capabilities.mjs) or retire run-item at P6
  runtime-legacy-retirement."
provenance:
  from_finding: run-item-judge-binding-gap
epic: runtime-operationalization
---

# from-run-item-judge-binding-gap

run-item.mjs:35 builds capabilities via bare makeClaudeCodeCapabilities({}) — the exact judge-binding gap fixed in run-next/run-epic/run-audit by from-run-next-pre-ship-judge-binding-gap: worker.mjs:21 derives the judge from runProcedure and uses it at the start-gate AND ship-gate, so any skill:<name> judgment check selected during a run-item drive fail-closes ('unknown procedure'). Deliberately not fixed there (out_of_scope, separate closure verdict): run-item is the generic SPEC-3 CLI — either wire makeDriverCapabilities() (one line; the seam now exists in runtime/adapters/claude-code/driver-capabilities.mjs) or retire run-item at P6 runtime-legacy-retirement.
