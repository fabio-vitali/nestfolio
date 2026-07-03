---
id: no-agent-result-fallback-check-overbroad
status: parking
type: refactor
notes: "The no-agent-result-fallback content-ring check flags EVERY ?? {} / ?? [] in advisory src (38), not only AgentCore/orchestrator-result fallbacks — over-broad vs its own stated property."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
epic: runtime-operationalization
epic_role: captured
---

# `no-agent-result-fallback` check is over-broad

The content-ring check `no-agent-result-fallback` (`runtime/content/checks/no-agent-result-fallback.yaml` →
`tools/check-no-agent-result-fallback.mjs`) declares the property *"No `?? {}` / `?? []` fallback on an
AgentCore/orchestrator invocation result in advisory agent services."* But the implementation is a bare
regex for `?? {}` / `?? []` anywhere under `services/advisory/**/src`, so it flags **38** matches — most of
them legitimate nullish-coalescing on DB reads (e.g. `result.Items ?? []` in `advisory-bff` repositories),
not agent-result fallbacks. It fires on `advisory.repository.ts:62,99,143,191`, `advisory-narrative-ctrl/
agent-service.ts:62`, and 33 more.

Distinct root cause from `[[gate-surfaced-source-debt]]`: there the **code** violates a valid rule; here the
**check** is wrong (too broad vs its own property). Diff-scoping (`runtime-make-it-fire`) de-risks it — it now
only bites when you stage an advisory-src file with such a fallback — but the check should be narrowed to
actually target invocation results (e.g. match `?? {}`/`?? []` only when the LHS is an `invoke`/orchestrator/
agent call, per `feedback_no_silent_fallback_in_agent_results`), or its scope/property reconsidered.

**Cheapest next step:** tighten `tools/check-no-agent-result-fallback.mjs` to the invocation-result pattern
and re-run its golden-gate test; confirm the 38 → true-positives only.
