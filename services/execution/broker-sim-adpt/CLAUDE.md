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
- event-listener.ts — SQS Ingress handler (event-processor pipeline)
- event-publisher.ts — CDC Egress handler (event-processor pipeline)

## Event Types (domain/events.ts)
- ExecutionAdptEventTypes: ORDER_ACCEPTED, ORDER_PARTIALLY_FILLED, ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, PORTFOLIO_SNAPSHOT_IMPORTED, BROKER_SESSION_ESTABLISHED, BROKER_SESSION_LOST, STREAM_CONNECTED, STREAM_DISCONNECTED, BROKER_AUTHORIZATION_REVOKED, DEPOSIT_DETECTED, WITHDRAWAL_SUBMITTED, WITHDRAWAL_COMPLETED, WITHDRAWAL_REJECTED
- BrokerSimEventTypes (inbound): SIM_ORDER_REQUESTED, SIM_DEPOSIT_INITIATED, SIM_WITHDRAWAL_REQUESTED
- BrokerSimEventTypes (outbound/CDC): SIM_ORDER_FILLED, SIM_ORDER_REJECTED, SIM_DEPOSIT_COMPLETED, SIM_WITHDRAWAL_COMPLETED

## Tests
- event-listener.test.ts
- market-data.service.test.ts
- simulation-engine.service.test.ts
- virtual-ledger.repository.test.ts

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/utils, event-processor
