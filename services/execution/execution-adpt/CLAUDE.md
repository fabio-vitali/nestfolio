# execution-adpt

Domain: execution | Bus: ExecutionBus
Stack: `services/execution/execution-adpt/src/service.stack.ts`

## State
None (stateless adapter — EB Rule forwarding only)

## Ingress (Cross-Domain Event Forwarding, Pull Model)
<!-- card-drift:ingress (generated — `nx run event-processor:card-drift -- --fix`) -->
- ExecutionIngress-FromAdvisory: DECISION_APPROVED, USER_CONFIRMED
- ExecutionIngress-FromInvestor: ACCOUNT_CLOSURE_REQUESTED, DEPOSIT_INITIATED, EXECUTION_MODE_CHANGED, WITHDRAWAL_INITIATED
<!-- /card-drift:ingress -->
- Advisory -> Execution:
  Rule on AdvisoryBus -> ExecutionBus (DLQ: FromAdvisoryDLQ, 14-day retention, KMS encrypted)
  Events: DECISION_APPROVED, USER_CONFIRMED

- Investor -> Execution:
  Rule on InvestorBus -> ExecutionBus (DLQ: FromInvestorDLQ, 14-day retention, KMS encrypted)
  Events: DEPOSIT_INITIATED, WITHDRAWAL_REQUESTED, ACCOUNT_CLOSURE_REQUESTED, EXECUTION_MODE_CHANGED

## Egress
None (no CDC, no direct EB emission)

## Orchestration
None

## Standalone Lambdas
None

## Facade
None

## Handlers
None (no Lambda handlers — pure EB Rule forwarding)

## Event Types (`src/domain/events.ts`)
<!-- card-drift:event-types (generated — `nx run event-processor:card-drift -- --fix`) -->
- ExecutionCrossDomainEventTypes: ALPACA_ACCOUNT_SNAPSHOT, BROKER_CIRCUIT_CLOSED, BROKER_CIRCUIT_OPEN, BROKER_HEAL_ESCALATED, CORPORATE_ACTION_APPLIED, DEPOSIT_DETECTED, DEPOSIT_SETTLED, ORDER_CANCELLED, ORDER_ESCALATED, ORDER_FILLED, ORDER_PARTIALLY_FILLED, ORDER_REJECTED, ORDER_STAGED, PORTFOLIO_SNAPSHOT_IMPORTED, WITHDRAWAL_SETTLED
- ExecutionIngestEventTypes: ACCOUNT_CLOSURE_REQUESTED, DECISION_APPROVED, DEPOSIT_INITIATED, EXECUTION_MODE_CHANGED, USER_CONFIRMED, WITHDRAWAL_INITIATED
<!-- /card-drift:event-types -->
- ExecutionCrossDomainEventTypes: ORDER_STAGED, ORDER_REJECTED, ORDER_CANCELLED, ORDER_ESCALATED, BROKER_CIRCUIT_OPEN, BROKER_CIRCUIT_CLOSED, BROKER_HEAL_ESCALATED, ORDER_FILLED, ORDER_PARTIALLY_FILLED, DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, TRANSFER_FAILED, CORPORATE_ACTION_APPLIED, PORTFOLIO_SNAPSHOT_IMPORTED, ALPACA_ACCOUNT_SNAPSHOT
- ExecutionIngestEventTypes: DECISION_APPROVED, USER_CONFIRMED, DEPOSIT_INITIATED, WITHDRAWAL_REQUESTED, ACCOUNT_CLOSURE_REQUESTED, EXECUTION_MODE_CHANGED

## Payload Contracts (`src/domain/contracts.ts`, re-exported via `src/domain/index.ts`)
DRY domain subjects — identity travels in the event context (RequestContext), not on the subject.
- FundingSnapshotSchema / FundingSnapshot (zod): producer-owned CDC subject shape for every broker-ctrl funding lifecycle transition (DEPOSIT_REQUESTED/DETECTED/SETTLED/FAILED, WITHDRAWAL_REQUESTED/SETTLED/FAILED). Owned here in the producer's cross-domain adapter (`@nestfolio/execution-adpt/domain`); forwarded to InvestorBus by investor-adpt and projected by investor-bff. Breaks the broker-ctrl ↔ investor-bff circular dependency.
- AlpacaTransferRequestSchema / AlpacaTransferRequest (zod): broker-ctrl → broker-alpaca-adpt funding boundary contract. Emitted by broker-ctrl's deposit-withdrawal-router (ALPACA_TRANSFER_REQUESTED subject) and parsed by broker-alpaca-adpt's event-listener. Fields: transferId (the nestfolioTransferId — depositId or withdrawalId), direction (INCOMING|OUTGOING), amountCents. Hosted here (not in broker-ctrl or broker-alpaca-adpt /contracts) to avoid the mutual intra-execution project cycle.
- AlpacaTransferResultSchema / AlpacaTransferResult (zod): broker-alpaca-adpt → broker-ctrl funding boundary contract. Emitted by broker-alpaca-adpt CDC (ALPACA_TRANSFER_* subjects) and parsed by broker-ctrl's deposit-withdrawal-normalizer. Fields: nestfolioTransferId, alpacaTransferId, direction (INCOMING|OUTGOING), amount, status (INITIATED/COMPLETED/FAILED), failureReason?, timestamp?. Moved here from broker-alpaca-adpt/contracts to avoid the mutual intra-execution project cycle.

## Tests
- `test/service.stack.test.ts` — CDK assertions (2 rules, DLQs, tags)

Domain adapters are pure EB rule forwarders (no handlers, no DDB). Per-adapter integration tests were removed 2026-05-13 — coverage is the CDK snapshot test + e2e flows that cross the forwarding hop via downstream consumers.

## Dependencies
- libs: cdk-constructs (core, observability, extensions), event-types
- npm: zod (payload contract schema)
