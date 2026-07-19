---
id: e2e-ddb-justification-convention-gap
status: parking
type: epic
notes: "E2E convention check #5 requires a justification comment for direct DDB reads; enforcement is inconsistent, producing both missing and weak justifications across scenario files. Theme epic, 2 members."
done_when: "Every in-scope direct DDB read in apps/e2e-feature-tests/ carries a specific comment explaining why BFF GraphQL is insufficient for that read (or is replaced by the equivalent GraphQL query where one already exists); both members shipped or dropped."
scope: "apps/e2e-feature-tests/ scenario files that read DynamoDB directly to assert downstream state, where the required GraphQL-insufficiency justification comment is either absent or present but generic/weak rather than specifically justifying that read."
out_of_scope:
  - "Other E2E convention drift with a different root cause (hand-rolled polling, barrel omissions, timeout floors, project.json config) — each has its own distinct fix pattern, not a justification-comment gap"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# E2E direct-DDB-read justification convention gap

Root cause: E2E convention check #5 (hard fail) requires every direct DDB read/assertion in a scenario test body to carry a comment explaining why BFF GraphQL is insufficient for that read — but enforcement is manual and inconsistent, so the convention drifts in two ways on the same underlying rule. Missing entirely: `go-live-switch`, `operating-mode-authority`, `update-operating-mode`, `reconciliation-correction`, `circuit-breaker-lifecycle` scenario tests read DDB with no justification comment at all (one, `go-live-switch`, even reads a field — `executionMode` — that IS exposed through GraphQL via `confirmGoLive`'s return value, so the DDB read is not just undocumented but plausibly unnecessary). Present but inadequate: the four `*-contract-emission.e2e.test.ts` files (~40 DDB calls) carry comments, but they're generic/weak rather than specifically justifying why GraphQL can't serve that particular read. Fix pattern: for each read, either add a specific justification (when the DDB read is genuinely necessary — e.g. a cross-domain read model not exposed via any GraphQL query) or replace it with the equivalent GraphQL query where one already exists.

Members (derived from `epic:` pointers):
- `e2e-ddb-read-missing-graphql-justification-comment`
- `e2e-ddb-contract-emission-family-weak-justification`
