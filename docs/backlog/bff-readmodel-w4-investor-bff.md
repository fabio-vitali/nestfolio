---
id: bff-readmodel-w4-investor-bff
status: shipped
type: refactor
notes: "Workstream 4 of bff-read-model-materialization-redesign: confirm investor-bff command-owned rows (InvestorProfile/Mandate/Notification/UserConfirmation) follow field-level update + condition + seed-by-event rules; CashBalance → P1 projection; register CommandOwned vs Projection typenames."
references:
  - "docs/superpowers/specs/2026-05-29-bff-read-model-materialization-redesign-design.md"
spec: docs/superpowers/specs/2026-05-29-bff-read-model-materialization-redesign-design.md
plan: docs/superpowers/plans/2026-05-31-bff-readmodel-w4-investor-bff.md
topic_memory: [project_read_model_redesign.md]
validation_gate: |
  Shipped on worktree branch worktree-bff-readmodel-w4-investor-bff.
  Commits: f2cea3dd (CashBalance versioned P1 + ownership registry + investor-bff typecheck gate),
  9c00f222 (monotonic __version on InvestorProfile across all 4 live write paths),
  370aa62a (dashboard-bff InvestorSnapshot versioned P1 + ownership registration — w2 carry-over),
  d8157563 (investor-bff integration __version assertions),
  d8641243 (service-card regen), 5e40d2bd (dashboard integration fixture alignment to versioned contract).
  Ownership trip-wires: `pnpm nx run investor-bff:typecheck` + `dashboard-bff:typecheck` GREEN
  (each via an isolated tsconfig.type-test.json @ts-expect-error proof; negative-checked).
  `pnpm nx affected -t test,lint --base=origin/main` → 11 projects GREEN.
  Deploy: bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-bff,dashboard-bff
  → ✅ dev-investor-bff + ✅ dev-dashboard-bff (UPDATE_COMPLETE).
  Integration (NESTFOLIO_INTEG_PREFIX=dev): investor-bff 18/18 (CashBalance __version=7 from
  snapshot.lastEventSequence; InvestorProfile seed __version=1; post-updateGoal __version>1) +
  dashboard-bff 21/21 (InvestorSnapshot P1 materialization on versioned INVESTOR_PROFILE_*).
  Scoped e2e (deployed dev): apps/e2e-feature-tests withdraw-cash + update-goal + update-operating-mode 3/3.
  3 side-findings filed parking: investor-bff-dead-repo-mutate-methods,
  event-processor-single-fn-handler-undefined-throws, bff-readmodel-typecheck-targets-not-in-ci.
out_of_scope:
  - "Deposit/Withdrawal/Order externally-settled entities — that is w5; CashBalance is the only external-authority row migrated here."
  - "dashboard-live-push-* transport rebuild — deferred, rebuilt on the clean read model later."
  - "Governance/freeze skill + audit-check edits — that is w6; only the incremental ReadModelOwnership registration for investor-bff (and dashboard InvestorSnapshot) typenames lands here."
  - "Event sourcing on the write side — system stays state-stored-aggregate + CDC-outbox."
  - "Re-migrating ledger-bff (w1), the rest of dashboard-bff (w2), or advisory (w3) read models — only the w2 InvestorSnapshot carry-over is in scope, gated on investor-bff stamping __version on INVESTOR_PROFILE_*."
---

# Workstream 4 — investor-bff

investor-bff is mostly command-owned rows; this workstream confirms they obey
the command-side rules and migrates the one external-authority row (CashBalance)
to a projection.

## Scope / deliverables
- Confirm command-owned rows — `InvestorProfile`, `Mandate`, `Notification`,
  `UserConfirmation`/`Rejection`/`Interaction` — use field-level `update()`
  (never full-row Put), condition-expression invariants, and seed-by-one-
  idempotent-event creation (`record()` once, then command-owned).
- `CashBalance` → P1 projection (`projectVersioned`) — ledger is its external
  authority.
- Register investor-bff typenames in `ReadModelOwnership` as `CommandOwned` or
  `Projection<...>` accordingly; the registration makes any mis-write fail
  typecheck.

## Done
investor-bff rows are correctly classified and enforced (command-owned vs P1);
CashBalance is a versioned projection; `event-processor:typecheck` + integration
green; deploy + scoped investor e2e green.

## Carry-over from w2
dashboard-bff's `InvestorSnapshot` stays on `project()` and is unregistered in
`ReadModelOwnership` until investor-bff stamps a `__version` on `INVESTOR_PROFILE_*`
with a stable `onboardedAt` in the payload (a full-row P1 write would otherwise
wipe `onboardedAt` on `INVESTOR_PROFILE_UPDATED`). This workstream adds that
producer-side `__version`, then migrates dashboard-bff's `InvestorSnapshot` to
`projectVersioned` P1 and registers it.

## Rollout context
Rank 4 (see spec §"Decomposition"). See [[project_read_model_redesign]].
