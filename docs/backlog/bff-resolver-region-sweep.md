---
id: bff-resolver-region-sweep
status: shipped
type: bug
references: []
out_of_scope:
  - "ledger-bff — read-only BFF, zero mutation resolvers, nothing to fix."
  - "investor-bff update-feature-flag.fn.js PutItem (no region) — separate BFF outside this workstream's stated scope; file separately if it CDC-publishes cross-domain."
  - "UpdateItem-only resolvers (publish-deposit-event, revoke-mandate, update-goal, update-operating-mode, mark-notification-read) — modify existing rows whose region was set at original PutItem."
  - "Ingress transform region persistence — separate from mutation-resolver writes."
spec: null
plan: null
topic_memory: []
validation_gate: "Fix commit 6d3b5123. advisory-bff unit suite 40/40 green (3 new resolver region tests). nx affected test,lint green (8 projects). Deployed dev-advisory-bff — confirmDecisionFn2 / rejectDecisionFn2 / recordExplanationViewFn1 FunctionConfigurations UPDATE_COMPLETE. nx affected test-integration green (6 projects; advisory-bff.integration.test.ts 322s PASS). E2E vs deployed dev: accept-decision + reject-decision + view-decision-explanation 3/3 PASS, no flakes."
notes: "advisory-bff + ledger-bff mutation resolvers likely missing region field."
---

# BFF resolver region sweep

advisory-bff + ledger-bff mutation resolvers likely missing `region` field.

## Confirmed scope

BFF mutation resolvers that `PutItem` a new row must write `region`
(`ctx.stash.region`, set by `check-auth.fn.js`). The CDC publisher
(`changeDataCapture()`, no fallback — `change-data-capture.ts:131`
`region: record.region`) reads it from the stream image into
`context.region`; consumer SQS pipelines reject events missing
`context.region` (`parse-sqs-record.ts:47`). Same gap fixed for
investor-bff in commit `8b8076f1`.

- **advisory-bff** — three mutation resolvers `PutItem` rows with
  `tenantId`+`userId` but no `region`:
  - `confirm-decision.fn.js` → `UserConfirmation` row → CDC `USER_CONFIRMED`
    (consumed by decision-workflow-ctrl `sfn-callback`, execution-ctrl)
  - `reject-decision.fn.js` → `UserRejection` row → CDC `USER_REJECTED`
  - `record-explanation-view.fn.js` → `UserInteraction` row → CDC
    `USER_INTERACTION_CREATED`
- **ledger-bff** — read-only BFF, no mutation resolvers. Nothing to fix.
