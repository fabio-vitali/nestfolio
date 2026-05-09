---
id: delete-deprecated-inject-advisory-update-fixture
status: parking
type: refactor
notes: "Delete @deprecated injectAdvisoryUpdate backdoor and migrate happy-path WSS sentinel test to a real-EB path."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Delete `@deprecated` `injectAdvisoryUpdate` fixture and migrate the WSS sentinel caller

`apps/nestfolio-e2e/src/fixtures/inject-advisory-update.ts` retains a `@deprecated` export `injectAdvisoryUpdate` (a dashboard-bff GraphQL backdoor that mutates `AdvisoryStatus.lastRecommendationAt` directly without firing any event). Its sole caller is `apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts:150`, where it serves as a WSS-broadcast sentinel — the test asserts the AppSync subscription delivers the mutated value.

Per `memory/feedback_no_deprecation.md`: dev is disposable and breaking changes are free, so deprecations should be replaced with deletion + caller migration rather than left in place.

**Why it's parking, not active:** the migration is non-trivial. The sentinel test currently exploits the backdoor's instant state mutation. A clean migration needs a real-EB path that doesn't require waiting the 30–75s agent pipeline — e.g.:

- Emit a `DECISION_PACKET_CREATED` directly on advisoryBus, skipping decision-workflow-ctrl SF; or
- Use a different sentinel signal (e.g., a small directly-emittable state mutation that still goes through real CDC) so the test still verifies WSS broadcast end-to-end without paying the agent-pipeline cost.

Either approach is a small workstream of its own and was not in scope for the in-flight projection design.

**Cheapest next step:** read `apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts:150` in context, decide between the two migration options above, then delete the legacy export + its file-level deprecation comment.

Surfaced 2026-05-09 during code-review of `advisory-in-flight-projection` (commit `ad32d03c`).
