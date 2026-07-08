---
id: from-run-themes-intake-bare-capabilities-conformance-gap
type: bug
status: parking
done_when: "resolve: run-themes.mjs:66 and run-intake.mjs:82 compose bare
  makeClaudeCodeCapabilities({}) — harmless today (themes()/intake() never
  consume runProcedure/runGate; their parks are human asks), but it is the same
  construction divergence that caused the judge-binding gap in the four
  workstream-driver mains, and DC3 conformance deliberately covers only
  gate-running drivers. If a gate or skill:<name> judgment is ever added to the
  themes/intake drives, the fail-close ('unknown procedure') silently returns.
  Either wire makeDriverCapabilities() uniformly into ALL run-* mains and sweep
  DC3 over run-*.mjs instead of a hardcoded list, or record the bare-caps
  exemption explicitly. Surfaced during from-run-item-judge-binding-gap close
  (6.4b sweep, 2026-07-08)."
provenance:
  from_finding: run-themes-intake-bare-capabilities-conformance-gap
epic: runtime-operationalization
---

# from-run-themes-intake-bare-capabilities-conformance-gap

run-themes.mjs:66 and run-intake.mjs:82 compose bare makeClaudeCodeCapabilities({}) — harmless today (themes()/intake() never consume runProcedure/runGate; their parks are human asks), but it is the same construction divergence that caused the judge-binding gap in the four workstream-driver mains, and DC3 conformance deliberately covers only gate-running drivers. If a gate or skill:<name> judgment is ever added to the themes/intake drives, the fail-close ('unknown procedure') silently returns. Either wire makeDriverCapabilities() uniformly into ALL run-* mains and sweep DC3 over run-*.mjs instead of a hardcoded list, or record the bare-caps exemption explicitly. Surfaced during from-run-item-judge-binding-gap close (6.4b sweep, 2026-07-08).
