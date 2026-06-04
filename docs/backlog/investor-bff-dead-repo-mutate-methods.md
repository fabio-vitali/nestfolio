---
id: investor-bff-dead-repo-mutate-methods
status: shipped
rank: 9
type: refactor
notes: "5 InvestorProfileRepository mutate-methods have no live callers; one (upsertReadOnlyBalance) would violate CashBalance P1 ownership if revived."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_read_model_redesign.md]
validation_gate: |
  Shipped on main, commit 5da53065 (Simple lane, no worktree). Deleted all 5
  dead methods (setGoal/updateGoal/grantMandate/setOperatingMode/
  upsertReadOnlyBalance) + the orphaned validateGoalFields helper + the unused
  NotRetryableError/Goal/Mandate/OperatingMode/MandateLevel/RebalanceCadence
  imports + the corresponding unit-test blocks. 2 files, +1/-391.
  Zero-live-callers proof: repo-wide `grep -rn` for each method name — every
  match outside the deleted unit-test blocks is a GraphQL field-name string
  (set-goal/update-goal resolvers in facade.test.ts, updateGoal mutation in
  e2e/integration tests), NOT a `repo.<method>(` call. upsertReadOnlyBalance had
  zero refs anywhere. The 7 live methods (getProfile, revokeMandate,
  setExecutionMode, addNotification, getNotifications, markNotificationRead,
  getUnreadCount) are untouched.
  Validation: `pnpm nx affected -t test,lint --base=origin/main` GREEN — 28
  projects, investor-bff unit + lint included (ts-jest compile covers the
  import/method removal; lint covers unused-symbol cleanup). detect-doc-
  derivation=false. Deploy SKIPPED by user decision: behavior-preserving
  dead-code removal (no executed code path changes), so the path-based
  detect-deploy-needed=true is a known false positive and a deploy/integration
  run surfaces no new information beyond the green unit+lint.
---

# investor-bff dead repository mutate-methods

> ⚠ **Read-model refactoring item.** Any side-finding required to call this refactoring complete must be **folded into a QUEUED read-model item, never parked in LATER** — see `CLAUDE.md` § "Backlog Discipline" (refactoring-completeness exception).


Surfaced during w4 ([[bff-readmodel-w4-investor-bff]]) code review. In
`services/investor/investor-bff/src/repositories/investor-profile.repository.ts`
these mutate-methods have **zero live callers** (only unit-test references):

- `setGoal` (L59), `updateGoal` (L89), `grantMandate` (L134),
  `setOperatingMode` (L182) — superseded by the AppSync JS resolvers
  `update-goal.fn.js` / `update-operating-mode.fn.js`, which are the live
  GraphQL mutation path.
- `upsertReadOnlyBalance` (L258) — the live CashBalance write is the
  `balance-updated.ts` `projectVersioned` projection.

The only live repo writer of the composite row is `setExecutionMode`
(GO_LIVE_CONFIRMED handler).

Two hazards if any is revived without care:
1. **`upsertReadOnlyBalance` writes `CashBalance`**, which w4 made a ledger-owned
   **P1 projection** — a local write to it violates single-writer ownership.
2. **`setGoal`/`updateGoal`/`setOperatingMode`/`grantMandate` write the
   `InvestorProfile` row but do NOT bump `__version`** — a silent non-monotonic
   modify that dashboard-bff's InvestorSnapshot P1 version-guard would drop,
   going stale. Any revival MUST add `SET #v = if_not_exists(#v,:zero)+:one`
   (the w4 convention) or the method must be deleted.

Cheapest next step: delete all five (they are dead), or — if any is intended for
future wiring — add the version bump and an ownership-respecting path.

Promoted to QUEUED 2026-06-01 (w6 governance freeze): the dead
`upsertReadOnlyBalance` is a latent CashBalance-P1 single-writer-ownership
violation if revived, and the other four write `InvestorProfile` without the
`__version` bump — both are clean-up/consistency hazards that belong on the
explicit queue, not parking.
