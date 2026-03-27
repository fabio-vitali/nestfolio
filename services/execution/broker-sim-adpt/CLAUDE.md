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
  Emits: VirtualTrade, DepositDetected, WithdrawalCompleted

## Handlers
- event-listener.ts
- event-publisher.ts

## Event Types (domain/events.ts)
- BrokerSimEventTypes (inbound): SIM_ORDER_REQUESTED, SIM_DEPOSIT_INITIATED, SIM_WITHDRAWAL_REQUESTED
- BrokerSimEventTypes (outbound/CDC): SIM_ORDER_FILLED, SIM_ORDER_REJECTED, SIM_DEPOSIT_COMPLETED, SIM_WITHDRAWAL_COMPLETED

## Tests
- event-listener.test.ts
- event-publisher.test.ts
- market-data.service.test.ts
- simulation-engine.service.test.ts
- virtual-ledger.repository.test.ts

## Dependencies
- libs: cdk-constructs/core
