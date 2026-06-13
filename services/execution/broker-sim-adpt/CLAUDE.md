# broker-sim-adpt

Domain: execution | Bus: ExecutionBus
Stack: services/execution/broker-sim-adpt/src/service.stack.ts

## State
- Table (DynamoDB, streams enabled)

## Ingress
- ExecutionBus → broker-sim-adpt-ingress (SQS → Lambda)
  Subscriptions: SIM_ORDER_REQUESTED, SIM_DEPOSIT_INITIATED, SIM_WITHDRAWAL_REQUESTED

## Egress
- CDC: DynamoDB Streams → broker-sim-adpt-egress (Lambda)
  Emits:
  - VirtualTrade (insert): SIM_ORDER_FILLED (default), SIM_ORDER_REJECTED (status=REJECTED)
  - VirtualTrade (modify): SIM_ORDER_FILLED (default), SIM_ORDER_REJECTED (status=REJECTED)
  - DepositDetected (insert): SIM_DEPOSIT_COMPLETED
  - WithdrawalCompleted (insert): SIM_WITHDRAWAL_COMPLETED

## Handlers
- event-listener.ts — SQS Ingress handler (event-processor pipeline); SIM_DEPOSIT_INITIATED parses `DepositInitiatedSchema` (investor-adpt/domain) via `parseSubject` + threads `amountCents`; SIM_WITHDRAWAL_REQUESTED parses `WithdrawalInitiatedSchema` (investor-adpt/domain) via `parseSubject` + converts `amountCents` to dollars for the virtual ledger (mirrors the deposit handler)
- event-publisher.ts — CDC Egress handler (event-processor pipeline, typed-subject mode)
- publisher-schemas.ts — typed-subject registry: maps each emitted __typename → its producer zod contract (subjectSchemas) + exemptTypenames; the publisher emits schema.parse(row) (the DRY subject) for covered types, the fat row for exempt.

## Event Types (domain/events.ts)
- ExecutionAdptEventTypes: ORDER_ACCEPTED, ORDER_PARTIALLY_FILLED, ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, PORTFOLIO_SNAPSHOT_IMPORTED, BROKER_SESSION_ESTABLISHED, BROKER_SESSION_LOST, STREAM_CONNECTED, STREAM_DISCONNECTED, BROKER_AUTHORIZATION_REVOKED, DEPOSIT_DETECTED, WITHDRAWAL_SUBMITTED, WITHDRAWAL_COMPLETED, WITHDRAWAL_REJECTED
- BrokerSimEventTypes (inbound): SIM_ORDER_REQUESTED, SIM_DEPOSIT_INITIATED, SIM_WITHDRAWAL_REQUESTED
- BrokerSimEventTypes (outbound/CDC): SIM_ORDER_FILLED, SIM_ORDER_REJECTED, SIM_DEPOSIT_COMPLETED, SIM_WITHDRAWAL_COMPLETED

## Event Payload Contracts (domain/contracts.ts → @nestfolio/broker-sim-adpt/contracts)
Producer-owned zod CDC subject contracts, exported via `@nestfolio/broker-sim-adpt/contracts` (NOT re-exported through the `/domain` barrel). DRY domain subjects — identity travels in the event context (RequestContext), not on the subject.
- SimDepositCompletedSchema / SimDepositCompleted — SIM_DEPOSIT_COMPLETED subject (from the `DepositDetected` row written by event-listener.ts on SIM_DEPOSIT_INITIATED). Fields: depositId, amountCents, currency, sourceEventId, timestamp.
- SimWithdrawalCompletedSchema / SimWithdrawalCompleted — SIM_WITHDRAWAL_COMPLETED subject (from the `WithdrawalCompleted` row). Fields: withdrawalId, amount (dollars, NOT cents — deposit/withdrawal asymmetry tracked in backlog), sourceEventId, timestamp.
- VirtualTradeSchema / VirtualTrade — SIM_ORDER_FILLED / SIM_ORDER_REJECTED subject (from the `VirtualTrade` row written by the simulation engine). Fields: tradeId, orderId, symbol, side (BUY|SELL), quantity, fillPrice, totalValue, cashBefore, cashAfter, executedAt.
- VirtualCashBalanceSchema / VirtualCashBalance — internal virtual-ledger cash balance row, NOT CDC-emitted. Fields: currency, balance, version.
- VirtualPositionSchema / VirtualPosition — internal virtual-ledger position row, NOT CDC-emitted. Fields: symbol, quantity, averageCostBasis, marketValue.
- VirtualSnapshotSchema / VirtualSnapshot — internal virtual-ledger snapshot row, NOT CDC-emitted. Fields: date, cashBalance, positions (array), totalValue.
Inbound-event schemas live separately in domain/schemas.ts. SIM_* completions are intra-execution CDC carriers; broker-ctrl is the current consumer via `parseSubject`.

## Tests
- event-listener.test.ts
- market-data.service.test.ts
- simulation-engine.service.test.ts
- virtual-ledger.repository.test.ts

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/utils, event-processor, event-types
- @nestfolio/investor-adpt/domain — consumes `DepositInitiatedSchema`, `WithdrawalInitiatedSchema` (event-listener `parseSubject` seam for SIM_DEPOSIT_INITIATED / SIM_WITHDRAWAL_REQUESTED)
- npm: zod (payload contract schemas in domain/contracts.ts + domain/schemas.ts)
