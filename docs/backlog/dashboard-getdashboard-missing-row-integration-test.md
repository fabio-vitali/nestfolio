---
id: dashboard-getdashboard-missing-row-integration-test
status: parking
type: tooling
notes: "Fast integration regression test for the getDashboard investorSnapshot missing-row .sk guard (today only covered by the WS-4 e2e scenario)."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: integration-coverage-backfill
epic_role: core
---

# Integration regression test for getDashboard missing-InvestorSnapshot guard

WS-4 (`dashboard-generating-failed-reflection`) fixed a pre-existing latent bug in
`services/investor/dashboard-bff/src/graphql/js-function/get-dashboard.fn.js` (commit
`bea504fe`): a `TransactGetItems` miss returns a keyless object (not null), so the
unguarded `investorSnapshot: items[2] || null` returned `{}`, and the non-nullable
`InvestorSnapshot.updatedAt: String!` resolved to null → the WHOLE `getDashboard`
query errored for any tenant with no InvestorSnapshot row. The fix guards on `.sk`
exactly like the existing `portfolioSummary` path.

Today the only regression coverage is the WS-4 Playwright scenario
(`dashboard reflects generating, failed, then ready-to-review` in
`apps/nestfolio-e2e/src/scenarios/advisory-generating-state.spec.ts`), which loads
`/dashboard` for an `onboardedPage` tenant that has no InvestorSnapshot — the exact
repro. That is deploy-gated and slow.

Add a faster `dashboard-bff` integration test: a fresh authed tenant with NO
INVESTOR_PROFILE event projected → `getDashboard` returns `investorSnapshot: null`
(and does NOT error). The existing integration suite binds its `appsync` client to a
single fully-seeded tenant, so this needs a second tenant/Cognito context — that
fixture work is why it was deferred from WS-4.

**Also consider** applying the same `.sk` guard to the `advisoryStatus` branch (line
~30): a missing AdvisoryStatus row currently yields synthetic zeros + a defaulted
`updatedAt` rather than null. It does NOT error (defaults), so it is benign, but it is
inconsistent with the `portfolioSummary`/`investorSnapshot` guards.
