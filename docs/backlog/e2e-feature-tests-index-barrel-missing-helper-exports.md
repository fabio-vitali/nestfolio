---
id: e2e-feature-tests-index-barrel-missing-helper-exports
status: parking
type: tooling
notes: "apps/e2e-feature-tests/src/index.ts barrel omits 3 helpers that exist in src/helpers/ (contract-assert, event-subject-trap, graphql-types); consumers reach them via ad-hoc relative paths instead."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# e2e-feature-tests src/index.ts barrel is missing 3 helper re-exports

## Evidence (audit-e2e-test judgment check, surfaced 2026-07-19 by the pre-ship deploy-gate on backlog item e2e-fixtures-test-stale-detail-envelope-assertion — unrelated to that item's own fix)

Config check #5 (warning): `src/index.ts` barrel does not export three helpers that exist in `src/helpers/` (`contract-assert.ts`, `event-subject-trap.ts`, `graphql-types.ts`); consumers reach them via ad-hoc relative paths instead of the barrel, inconsistent with the other helpers which are all re-exported.

`src/index.ts` exports `fresh-tenant`/`wait-for-graphql`/`poll`/`bff-client`/`fixtures`/`alpaca-paper-reset`/`agent-trace-trap` only; `src/helpers/` also contains `contract-assert.ts`, `event-subject-trap.ts`, `graphql-types.ts` (imported via `'../helpers/event-subject-trap'` etc.).

## Cheapest next step

Add the three missing re-exports to `src/index.ts` and sweep existing ad-hoc relative imports to use the barrel.
