---
id: deposit-page-pattern-a-to-pattern-b
status: shipped
type: refactor
closed: "2026-05-08"
references:
  - apps/investor-mfe/src/app/deposit/deposit-page.component.ts
  - apps/advisory-mfe/src/app/decision/decision-detail.component.ts
  - services/investor/investor-bff/src/graphql/js-function/initiate-deposit.fn.js
  - services/investor/investor-bff/src/schema.graphql
  - services/investor/investor-bff/CLAUDE.md
  - apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts
out_of_scope:
  - "DepositEvent versioning — DETECTED/FAILED are terminal; no out-of-order frame guard needed."
  - "AppSync replay buffer — subscribe-readiness + getDeposit recovery covers the gap."
  - "Tenant-isolation rework — resolver pk uses caller's tenantId+userId; cross-tenant URL paste returns NotFoundError."
  - "Feature flag for the rollout — bugs are user-visible defects, no need to gate."
  - "Backwards-compat for old DepositInput shape — dev is disposable per feedback_no_deprecation."
  - "Auto-redirect from /deposit/:id to /deposit on invalid URL — render dedicated invalidUrl panel instead."
  - "Subscription drop retry — preserve existing console.error behaviour; 30s timeout still fires."
  - "Cross-tenant integration test fixtures — resolver unit asserting pk shape is structurally sufficient."
spec: docs/superpowers/specs/2026-05-08-deposit-page-pattern-b-design.md
plan: docs/superpowers/plans/2026-05-08-deposit-page-pattern-b.md
topic_memory: []
validation_gate: "investor-bff unit + integration green on deployed dev (19/19 + 7/7); investor-mfe unit green (93/93, includes REGRESSION 'subscribe before initiateDeposit' test); Playwright deposit-reload-mid-flight green; new-investor-happy-path remains green."
notes: "deposit-page is the lone Pattern A holdout; full fix = client-UUID + URL routing + getDeposit recovery."
---

# Refactor `deposit-page.component.ts` from subscribe-after-async (Pattern A) to subscribe-on-navigation (Pattern B)

`apps/investor-mfe/src/app/deposit/deposit-page.component.ts:180` attaches `subscribeToDepositEvent(intent.depositId, ...)` only after `initiateDeposit()` returns, with `depositId` in component-local state. Two consequences: (1) page reload mid-flight loses the subscription (depositId gone, form re-rendered empty even though backend is still processing); (2) ~200ms AppSync handshake races a hot-Lambda DETECTED frame on broker-sim cached path → frame delivered to not-yet-attached subscriber, lost.

**Approach (per spec 2026-05-08):** scope C — fix both bugs.
- Split into `DepositFormComponent` (`/deposit`) + `DepositPendingPageComponent` (`/deposit/:depositId`).
- Browser generates `depositId = crypto.randomUUID()`; passes amount + currency to pending route via Angular router `state`.
- Pending component on init: subscribe → await `start_ack` → `getDeposit(depositId)` → on `NotFoundError` mutate from `history.state`, otherwise hydrate from query result.
- Backend: `DepositInput` gains required `depositId: ID!`; new `getDeposit(depositId): Deposit` query; `Deposit` type replaces `DepositIntent`.

Mirror's Pattern B exemplar at `apps/advisory-mfe/src/app/decision/decision-detail.component.ts:377` (subscribe-before-query, recovery query catches missed frames). Three other MFE views already follow Pattern B (dashboard-container, notification-list, decision-detail) — deposit-page is the lone holdout.
