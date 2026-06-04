---
id: advisory-status-recompute-monotonic-version
status: shipped
rank: 11
type: refactor
out_of_scope:
  - "No change to dashboard-bff's advisory-status.ts P3 transform beyond confirming it stays correct under a monotonic counter __version (the carried version is consumed as-is; a counter is automatically monotonic)."
  - "No change to the inFlightCount recompute logic itself (countInFlightDecisions / the non-terminal DecisionReadModel count is correct)."
  - "No backfill/migration of existing AdvisoryStatus rows — the same-ms collision is benign and self-heals; the first new write seeds/continues the counter."
  - "No re-attempt of the stream SequenceNumber approach (known dead end, code comment explains why)."
  - "No application of any new reusable intent helper to other P3/derived aggregates in this workstream — generalisation beyond AdvisoryStatus is a separate promote-on-second-use-case item."
notes: "advisory-bff advisory-status-projector recompute versions the AdvisoryStatus P3 row with Date.now(). Two recomputes for the same tenant in the same millisecond produce equal versions and the `#__version < :version` guard drops the fresher count. Benign today (the next DecisionReadModel change re-triggers the recompute; 1ms-apart counts are near-identical). The C1 attempt to fix this with max stream SequenceNumber was WRONG and reverted (2026-06-03, dashboard-advisory-readmodel-fixes): DecisionReadModel rows are keyed Decision#<tenant>#<id> (per-decision pk) so a tenant's decisions span DIFFERENT stream shards whose SequenceNumbers are non-comparable — max() is non-monotonic and the recompute never wrote (caught by the advisory-bff integration recompute test). A correct strictly-monotonic version needs a different mechanism (e.g. an atomic self-increment ADD #__version :1 on the AdvisoryStatus row, which changes the write from projectVersioned-with-external-version to a command-owned-style self-increment, and must keep dashboard-bff's P3 projection keyed on the carried __version monotonic)."
references:
  - services/advisory/advisory-bff/src/handlers/advisory-status-projector.ts
topic_memory: [project_read_model_redesign.md]
spec: docs/superpowers/specs/2026-06-04-advisory-status-monotonic-version-design.md
plan: docs/superpowers/plans/2026-06-04-advisory-status-monotonic-version.md
validation_gate: |
  Reclassified advisory-bff AdvisoryStatus P3 -> CommandOwned; swapped
  projectVersioned(Date.now()) for update(..., { add: { __version: 1 } })
  atomic self-increment. dashboard-bff consumer-side P3 unchanged.
  Commits: 8dcb4245 (fix) + b80016ad (canonical doc §3/§4/§9) + 44d8da1b (service card).
  - advisory-bff:typecheck PASS (type-test trip-wire flipped: projectVersioned now rejected, update allowed).
  - advisory-bff:test PASS (34 tests; projector unit test rewritten to assert ADD #__version self-increment + no Date.now() version — regression lock).
  - dashboard-bff:typecheck + dashboard-bff:test PASS (consumer-side P3 unchanged under the monotonic counter).
  - event-processor:read-model-drift OK (0 drift; 44 registered, 25 excluded — R1–R6 all pass incl. R3 no fn.js writer).
  - nx affected -t test,lint --base=origin/main PASS (28 projects).
  - Deploy: dev-advisory-bff UPDATE_COMPLETE, AdvisoryStatusProjector Lambda updated (deploy.sh sandbox --prefix=dev --services=advisory-bff).
  - Integration vs deployed dev: advisory-bff:test-integration "recomputes inFlightCount = count of non-terminal DecisionReadModel rows" PASS (51s; inFlightCount 2 -> 1 on real dev) — exercises the new update+add write path end-to-end.
  - E2E: intentionally skipped (user-confirmed) — the same-ms collision is not e2e-reproducible and the integration test already validates the changed producer path on real dev.
---

# AdvisoryStatus recompute: strictly-monotonic version (correct C1 fix)

The `Date.now()` version on the AdvisoryStatus P3 recompute has a benign same-ms
collision footgun (see notes). The SequenceNumber approach is a known dead end —
do not re-attempt it (the projector carries a code comment explaining why).

A correct fix would make the per-tenant AdvisoryStatus version strictly monotonic
regardless of which DecisionReadModel shards triggered the batch — most likely an
atomic `ADD #__version :1` self-increment, reconciled with the read-model model
(AdvisoryStatus is advisory-bff's own aggregate; dashboard-bff projects it P3
keyed on the carried `__version`, which must stay monotonic).

In QUEUED as the lowest-urgency read-model residual: in-scope for the program's
"drain QUEUED = the model is fully correct" framing, but the live footgun is
benign (rare same-ms collision that self-heals on the next DecisionReadModel
change). Opens with a small design decision on the self-increment vs the carried
P3 `__version` contract.
