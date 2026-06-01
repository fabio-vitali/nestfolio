---
id: bff-readmodel-w5-externally-settled-entities
status: shipped
type: refactor
effort: xhigh
out_of_scope:
  - "w6 governance/freeze enforcement (layers 3+4) — tracked in bff-readmodel-w6-governance-freeze."
  - "Re-touching rows already migrated in w1–w4 (ledger/dashboard/advisory P1 projections, investor command-owned rows) except where w5 changes the deposit/withdrawal/cash path."
  - "Real-broker (Alpaca) funding rails — the funding lifecycle is modeled on the existing broker-sim deposit path; no real-money deposit/withdrawal integration."
  - "Creating any new service — broker-ctrl is the funding-lifecycle owner; no new service."
  - "Re-architecting Orders — already Execution-owned; w5 only aligns, it does not redesign order ownership."
  - "Weight-drift / rebalance detection and the deferred dashboard-live-push-* transport items — separate workstreams."
notes: "Workstream 5 (cross-domain, last) of bff-read-model-materialization-redesign: broker-ctrl (Execution) owns the Deposit/Withdrawal funding lifecycle + emits versioned lifecycle events; investor-bff deposit/withdrawal → P1 projections; initiateDeposit → intent event + optimistic UI; ledger-ctrl consumes settled for cash. Fixes deposit-settlement-never-persisted."
references:
  - "docs/superpowers/specs/2026-05-29-bff-read-model-materialization-redesign-design.md"
  - "docs/superpowers/plans/2026-05-31-w5-externally-settled-entities.md"
  - "docs/superpowers/specs/2026-06-01-deposit-withdrawal-live-push-transport-design.md"
  - "docs/superpowers/plans/2026-06-01-deposit-withdrawal-live-push-transport.md"
spec: docs/superpowers/specs/2026-05-29-bff-read-model-materialization-redesign-design.md
plan: docs/superpowers/plans/2026-05-31-w5-externally-settled-entities.md
topic_memory: [project_read_model_redesign.md]
validation_gate: "Backend P1–P6 green (broker-ctrl 64/64, ledger 101/101, investor-bff 86/86, dashboard-bff, investor-ctrl) + integration 5/5 services on deployed dev + scoped Jest e2e 2/2 (fund-account, withdraw-cash). Phase-6 transport: investor-bff 86/86 + investor-mfe 97/97 unit; pre-deploy `nx affected test,lint` 10 projects green; deployed to dev (AppSync schema + publishDeposit/WithdrawalUpdate resolvers + DepositPublisher Lambda + 2nd DDB stream EventSourceMapping created clean alongside Egress CDC); Playwright on deployed dev GREEN twice consecutively (new-investor-happy-path + deposit-reload-mid-flight, 2 passed each run) — confirms DETECTED live-push reaches the browser via onDepositUpdate and survives F5. Fixes deposit-settlement-never-persisted (by construction) + the transport regression w5 Task 4.6 introduced."
---

# Workstream 5 — externally-settled entities (cross-domain)

> ⚠️ **EFFORT: xhigh** (`effort: xhigh` in frontmatter). Set reasoning effort to
> xhigh before executing this workstream — do not run it at the default. Why:
> the only cross-domain workstream in the program. It designates broker-ctrl as a
> new funding-lifecycle aggregate owner, introduces intent events + optimistic
> UI, and re-routes ledger-ctrl to consume settlement — spanning Execution +
> investor + ledger. New ownership topology, not a projection swap; fixes the
> deposit-settlement-never-persisted latent bug by construction.

The only part of the program that reaches beyond the read-side BFFs. Deposits/
withdrawals are started by the user but finished by an outside system, so the
BFF is not their owner.

## Scope / deliverables
- Designate `broker-ctrl` (Execution) as the funding-lifecycle aggregate owner:
  maintain canonical requested→detected→settled/failed state and emit **versioned
  lifecycle events** (adjacent to `DEPOSIT_DETECTED`). No new service.
- investor-bff `Deposit`/`Withdrawal` rows → pure P1 projections fed by those
  events; register the typenames.
- `initiateDeposit` becomes an **intent event** (outbox / AppSync→EventBridge),
  not a local row write; UI shows "submitting…/pending" optimistically until the
  projection catches up.
- `ledger-ctrl` keeps consuming "settled" to adjust cash (records the effect; it
  does not own the funding rail). Align Orders (already Execution-owned).

## Out of scope
- w6 governance/freeze enforcement (layers 3+4) — tracked in `bff-readmodel-w6-governance-freeze`.
- Re-touching rows already migrated in w1–w4 (ledger/dashboard/advisory P1 projections, investor command-owned rows) except where w5 changes the deposit/withdrawal/cash path.
- Real-broker (Alpaca) funding rails — the funding lifecycle is modeled on the existing broker-sim deposit path; no real-money deposit/withdrawal integration.
- Creating any new service — `broker-ctrl` is the funding-lifecycle owner.
- Re-architecting Orders — already Execution-owned; w5 only aligns, it does not redesign order ownership.
- Weight-drift / rebalance detection and the deferred `dashboard-live-push-*` transport items — separate workstreams.

> The full § Out of scope is refined in the implementation plan (`superpowers:writing-plans`) and this frontmatter mirrors it.

## Done
funding lifecycle owned + versioned by broker-ctrl; deposit/withdrawal are P1
projections; settlement is persisted (latent bug #1 fixed by construction);
`initiateDeposit` is an intent event with optimistic UI; integration + scoped
e2e green across Execution + investor + ledger.

## Rollout context
Rank 5 — cross-domain, sequenced last (see spec §"Externally-settled entities").
Funding owner decision settled 2026-05-29 (broker-ctrl). See
[[project_read_model_redesign]].

## Ship narrative (2026-06-01)
Shipped on `worktree-feat+bff-readmodel-w5-externally-settled-entities`. The whole workstream
(backend Phases 1–5 + the Phase-6 deposit/withdrawal live-push transport) ships green in one PR.

**Backend Phases 1–5 = DONE + GREEN:**
- P1 event taxonomy + adapters · P2 broker-ctrl Funding carrier aggregate (64/64) · P3 ledger
  cash on `*_SETTLED` (101/101, fixes deposit/withdrawal-settlement-never-persisted) · P4
  investor-bff Deposit/WithdrawalRequest P1 projections + intent outbox (75/75; a real
  projection-identity bug was caught by integration + fixed in `5b28083c`) · P5 dashboard +
  investor-ctrl `WITHDRAWAL_COMPLETED→WITHDRAWAL_SETTLED` rename.
- Pre-deploy gate `nx affected test,lint` GREEN (21 projects, 0 errors). Deployed 8 stacks to dev.
- Validation against deployed dev: integration **5/5 services GREEN** (broker-ctrl R3 two-carrier,
  ledger cash-on-settlement, investor-bff 19/19, dashboard-bff, investor-ctrl); scoped Jest e2e
  **2/2 GREEN** (fund-account + withdraw-cash).

**Phase 6 — deposit/withdrawal live-push transport (the regression w5 Task 4.6 introduced):**
w5 had deleted the `onDepositEvent` subscription with no replacement, so the investor-mfe deposit
page couldn't receive DETECTED (backend row updated fine — transport-only gap). Fixed by mirroring
dashboard-bff's pattern (`broadcastFromStream`→none-datasource publish-mutation→`@aws_subscribe`),
keyed on `depositId`/`withdrawalId`, deposit+withdrawal symmetric:
- investor-bff: `none`-datasource `publishDepositUpdate`/`publishWithdrawalUpdate` resolvers
  (echo args incl. the filter-pivot id) + `deposit-publisher.ts` (`broadcastFromStream`, keyed on
  `__typename`, `whenChanged:['status']`, skips the `DepositIntent` outbox row) + schema
  `DepositUpdate`/`WithdrawalUpdate` types/mutations/subscriptions + a 2nd DDB-stream consumer
  Lambda (Egress CDC is the 1st; 2 readers/shard is within DynamoDB's limit — verified clean on deploy).
- investor-mfe: `onDepositEvent`→`onDepositUpdate` subscription; `deposit.service` maps the payload
  (`occurredAt = detectedAt ?? settledAt ?? failedAt`); pending page resolves DETECTED **and**
  SETTLED to the `deposit-panel-detected` UI (incl. the `hydrate()` F5-on-settled fix found in review).
- Plan: `docs/superpowers/plans/2026-06-01-deposit-withdrawal-live-push-transport.md` (subagent-driven,
  two-stage review per task). Deferred hardening filed: `bff-publisher-stream-dlq` (parking).

**Validation:** see `validation_gate`. Playwright on deployed dev passed twice consecutively.
