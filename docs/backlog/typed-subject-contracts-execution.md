---
id: typed-subject-contracts-execution
status: shipped
rank: 4
type: refactor
notes: "Execution domain slice (slice 3) of the typed-subject-producer-contracts umbrella (design: docs/superpowers/specs/2026-06-09-typed-subject-producer-contracts-design.md § 'Execution (slice 3)'). LIVE-MONEY path — validate every contract against the REAL broker emissions, NOT fixtures ([[event-subject-contracts]]). broker-ctrl: order-lifecycle contracts (funding already covered via execution-adpt/domain). broker-sim-adpt: complete coverage (only SimDepositCompleted today). broker-alpaca-adpt: Alpaca order/transfer contracts. execution-ctrl: ORDER_CREATED / STAGED_ORDER_CREATED producer contracts; continues importing ProposedTrade cross-domain from advisory-adpt/domain (authored/converted to zod in the Advisory slice) — no change needed here beyond execution's own producer contracts. Home rule: cross-domain consumers import producer-domain adapter /domain re-exports. Depends on phase-0 (typed-subject-platform-context-taxonomy); the ProposedTrade zod conversion lands in the Advisory slice (advisory produces it). Validation: producer unit tests + tsc green + scoped e2e against the REAL broker path (incl. the funding/order-execution scenarios). Complex lane (worktree + deploy + e2e)."
references:
  - docs/superpowers/specs/2026-06-09-typed-subject-producer-contracts-design.md
  - docs/superpowers/specs/2026-06-09-typed-subject-program-strategy.md
out_of_scope:
  - "ProposedTrade -> zod conversion: lands in the Advisory slice (slice 4); execution imports it cross-domain from advisory-adpt/domain UNCHANGED (still a plain interface today)."
  - "WS-2 (cdc-publisher-typed-subjects) and WS-3 (consumer-parse-subject): separate program workstreams. This slice only AUTHORS/extends Execution producer contracts + converts Execution inline rows to TableEntry<Subject>; it does not retype publishers or consumer parseSubject seams."
  - "Funding-completed lifecycle: order-lifecycle is the scope here. Funding contracts are already covered via execution-adpt/domain. The funding-completed field-name normalization drift (broker-funding-completed-normalization-drift, rank 6) and broker-ctrl-alpaca-funding-carrier-pk-divergence (LATER) are their own items — NOT in this slice."
  - "Enforcement capstone (typing-convention-enforcement-skills-docs): skills/docs/lint enforcement is a separate queued item."
  - "Other domains' producer contracts: ledger + investor already shipped; advisory is slice 4."
  - "Runtime changes to emitted CONTEXT payloads beyond what typing requires (subject = business aggregate only; metainfo stays in context)."
spec: docs/superpowers/specs/2026-06-09-typed-subject-producer-contracts-design.md
plan: docs/superpowers/plans/2026-06-10-typed-subject-contracts-execution.md
topic_memory: []
validation_gate: "SHIPPED 2026-06-10 (branch worktree-typed-subject-contracts-execution, 15 commits). Producer zod contracts for all 4 execution services (broker-ctrl NormalizedOrderEvent/BrokerOrder/ExecutionMode; broker-sim VirtualTrade/SimWithdrawalCompleted + 3 internal rows; broker-alpaca AlpacaOrderResult/AlpacaTransferResult/AlpacaAccountSnapshot/BrokerCircuitEvent/CircuitBreaker; execution-ctrl Order/StagedOrder); 7 unused zod row schemas replaced; rows typed `satisfies TableEntry<Subject>`. Build-time typing caught 3 contract-vs-reality drifts the old co-wrong schemas hid (AlpacaAccountSnapshot equity/buyingPower are raw-API STRING-not-number; AlpacaOrderResult/AlpacaTransferResult timestamp + alpacaOrderId optional across writers) → contracts corrected to reality. Unit: per-service contracts suites green; scoped `nx test,lint` on the 4 svcs + e2e lint green. Deployed 4 svcs to dev (deploy.sh, exit 0). E2E apps/e2e-feature-tests execution-contract-emission against deployed dev: SIM 3/3 PASS (execution-ctrl Order via DECISION_APPROVED; broker-sim VirtualTrade + DepositDetected + WithdrawalCompleted via direct adapter triggers — real producer rows) + REAL Alpaca paper 3/3 PASS (AlpacaOrderResult/AlpacaTransferResult/AlpacaAccountSnapshot via direct ALPACA_* to broker-alpaca — confirms the equity-string correction against the REAL Alpaca emission). Both blocks green first-try (no flake). Boundaries unit-validated + documented (NOT e2e-driven): broker-ctrl NormalizedOrderEvent (latent OrderStateMachine input-shape gap — SF reads top-level $.detail; backlog broker-ctrl-order-sf-input-contract-gap), BrokerOrder/ExecutionMode internal, BrokerCircuitEvent/CircuitBreaker (circuit-breaker-lifecycle.e2e), broker-sim Virtual* internal, StagedOrder (market-closed). ProposedTrade imported unchanged (Advisory slice converts to zod). 5 side-findings filed to parking."
---

# Typed-subject contracts — Execution (slice 3)

Third per-domain slice of the `typed-subject-producer-contracts` umbrella. **Live-money path** —
validate against the **real** broker emissions, never fixtures ([[event-subject-contracts]]). See the
design spec (`§ Execution (slice 3)`).

## Goal

Every Execution-domain producer aggregate has a producer-owned zod contract typing both the row
(`TableEntry<Subject>`) and the event (`BusEvent<Subject>`), validated against the real emitted shape.

## Scope

- **broker-ctrl** — order-lifecycle contracts (funding already covered via `execution-adpt/domain`).
- **broker-sim-adpt** — complete coverage (only `SimDepositCompleted` today).
- **broker-alpaca-adpt** — Alpaca order/transfer contracts.
- **execution-ctrl** — `ORDER_CREATED` / `STAGED_ORDER_CREATED` producer contracts. Continues to
  import `ProposedTrade` cross-domain from `advisory-adpt/domain` (authored/converted to zod in the
  Advisory slice) — no change here beyond execution's own producer contracts.
- Home rule: cross-domain consumers import the producer-domain adapter `/domain` re-export.

## Done

Every Execution event a publisher/consumer touches has a producer contract; rows are
`TableEntry<Subject>`; producers' unit tests + `tsc` green.

## Validation (THE #1 risk)

Scoped e2e against deployed dev validates each contract against the **REAL** broker path (funding /
order-execution scenarios), **not fixtures** ([[event-subject-contracts]]). Producer unit tests +
`tsc` green.

## Deps

Phase-0 (`typed-subject-platform-context-taxonomy`). The `ProposedTrade` → zod conversion lands in
the Advisory slice (advisory produces it); execution imports it cross-domain unchanged.
