# advisory-ctrl

Domain: advisory | Bus: AdvisoryBus
Stack: services/advisory/advisory-ctrl/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress
- AdvisoryBus -> advisory-ctrl-ingress (SQS -> Lambda)
  Subscriptions: MANDATE_GRANTED, GOAL_UPDATED, RISK_PROFILE_UPDATED, OPERATING_MODE_CHANGED, PORTFOLIO_DRIFT_DETECTED, ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED, DECISION_APPROVED, DECISION_BLOCKED, USER_CONFIRMED, USER_REJECTED

## Egress
- CDC: DynamoDB Streams -> advisory-ctrl-egress (Lambda)
  Emits: DecisionPacket, AgentInvocation, WorkflowState

## AgentRuntime
- advisory_ctrl_decision_lifecycle: Multi-agent decision lifecycle orchestrated via LangGraph.js
  Models: Opus, Sonnet, Haiku
  Tools: portfolio-lookup, market-data, instrument-universe, event-publisher

## Handlers
- event-listener.ts
- event-publisher.ts
- tools/portfolio-lookup.ts
- tools/market-data.ts
- tools/instrument-universe.ts
- tools/event-publisher.ts

## Tests
- agents/
- decision-lifecycle.service.test.ts
- decision.repository.test.ts
- event-listener.test.ts
- event-publisher-cdc.test.ts
- tools-event-publisher.test.ts
- tools-instrument-universe.test.ts
- tools-market-data.test.ts
- tools-portfolio-lookup.test.ts

## Dependencies
- libs: cdk-constructs (core, extensions, utils)
- SSM: advisory-hub (models/opus, models/sonnet, models/haiku)
