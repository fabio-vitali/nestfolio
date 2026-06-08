# execution-adpt

Domain: execution | Bus: ExecutionBus
Stack: `services/execution/execution-adpt/src/service.stack.ts`

## State
None (stateless adapter — EB Rule forwarding only)

## Ingress (Cross-Domain Event Forwarding, Pull Model)
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
- ExecutionCrossDomainEventTypes: ORDER_STAGED, ORDER_REJECTED, ORDER_CANCELLED, ORDER_ESCALATED, BROKER_CIRCUIT_OPEN, BROKER_CIRCUIT_CLOSED, BROKER_HEAL_ESCALATED, ORDER_FILLED, ORDER_PARTIALLY_FILLED, DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, TRANSFER_FAILED, CORPORATE_ACTION_APPLIED, PORTFOLIO_SNAPSHOT_IMPORTED, ALPACA_ACCOUNT_SNAPSHOT
- ExecutionIngestEventTypes: DECISION_APPROVED, USER_CONFIRMED, DEPOSIT_INITIATED, WITHDRAWAL_REQUESTED, ACCOUNT_CLOSURE_REQUESTED, EXECUTION_MODE_CHANGED

## Payload Contracts (`src/domain/contracts.ts`, re-exported via `src/domain/index.ts`)
- FundingSnapshotSchema / FundingSnapshot (zod): producer-owned CDC subject shape for every broker-ctrl funding lifecycle transition (DEPOSIT_REQUESTED/DETECTED/SETTLED/FAILED, WITHDRAWAL_REQUESTED/SETTLED/FAILED). Owned here in the producer's cross-domain adapter (`@nestfolio/execution-adpt/domain`); forwarded to InvestorBus by investor-adpt and projected by investor-bff. Breaks the broker-ctrl ↔ investor-bff circular dependency.

## Tests
- `test/service.stack.test.ts` — CDK assertions (2 rules, DLQs, tags)

Domain adapters are pure EB rule forwarders (no handlers, no DDB). Per-adapter integration tests were removed 2026-05-13 — coverage is the CDK snapshot test + e2e flows that cross the forwarding hop via downstream consumers.

## Dependencies
- libs: cdk-constructs (core, observability, extensions), event-types
- npm: zod (payload contract schema)
