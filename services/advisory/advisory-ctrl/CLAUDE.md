# advisory-ctrl

Domain: advisory | Bus: advisoryBus
Stack: services/advisory/advisory-ctrl/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress
- advisoryBus → advisory-ctrl-ingress (SQS → Lambda)
  Subscriptions: MANDATE_CREATED, GOAL_CREATED, GOAL_UPDATED, RISK_PROFILE_CREATED, RISK_PROFILE_UPDATED, OPERATING_MODE_CHANGED, PORTFOLIO_DRIFT_DETECTED, ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED, DECISION_APPROVED, DECISION_BLOCKED, USER_CONFIRMED, USER_REJECTED

## Egress
- CDC: DynamoDB Streams → advisory-ctrl-egress (Lambda)
  Emits: DECISION_PACKET (DecisionPacket), AGENT_INVOCATION (AgentInvocation), WORKFLOW_STATE (WorkflowState)

## AgentRuntime
- advisory_ctrl_decision_lifecycle: Multi-agent decision lifecycle orchestrated via LangGraph.js
  Models: Opus, Sonnet, Haiku (SSM from advisory-hub)
  Tools: portfolio-lookup, market-data, instrument-universe, event-publisher

## Standalone Lambdas
- PortfolioLookup: Retrieve current portfolio positions and cash balance (tool Lambda, reads State table)
- MarketData: Retrieve current market indices, volatility, and recent events (tool Lambda)
- InstrumentUniverse: Retrieve the approved instrument universe (tool Lambda)
- ToolEventPublisher: Publish events to the advisory EventBridge bus (tool Lambda, grants events:PutEvents)

## Handlers
- event-listener.ts — Ingress event handler
- event-publisher.ts — Egress CDC publisher
- tools/portfolio-lookup.ts — Portfolio positions tool
- tools/market-data.ts — Market data tool
- tools/instrument-universe.ts — Instrument universe tool
- tools/event-publisher.ts — EventBridge publish tool

## Event Types (domain/events.ts)
- AdvisoryCtrlEventTypes: AGENT_INVOCATION_STARTED, AGENT_INVOCATION_COMPLETED, AGENT_EXECUTION_FAILED, GOAL_INTERPRETATION_PRODUCED, RISK_EVALUATION_PRODUCED, MARKET_SIGNAL_DETECTED, PORTFOLIO_CONSTRUCTION_PROPOSED, REBALANCE_PLAN_PRODUCED, RECOMMENDATION_PROPOSED, EXPLANATION_GENERATED, DECISION_PACKET_CREATED, DECISION_PACKET_ENRICHED, USER_CONFIRMATION_REQUESTED, INCIDENT_DETECTED, INCIDENT_CONTAINED, INCIDENT_ESCALATED, INCIDENT_RESOLVED, CIRCUIT_BREAKER_TRIGGERED, CIRCUIT_BREAKER_RESET, HEALTH_CHECK_COMPLETED, MODEL_REGISTERED, SHADOW_RUN_STARTED, SHADOW_RUN_COMPLETED, MODEL_PROMOTION_REQUESTED, MODEL_PROMOTION_APPROVED, MODEL_PROMOTED, MODEL_ROLLBACK_TRIGGERED, TENANT_BUDGET_APPROACHING, TENANT_BUDGET_EXCEEDED, REASONING_TIER_CHANGED, OPERATOR_ACTION_PERFORMED, EVENT_DELIVERY_FAILED, EVENT_REPLAYED

## Tests
- decision-lifecycle.service.test.ts
- decision.repository.test.ts
- event-listener.test.ts
- tools-event-publisher.test.ts
- tools-instrument-universe.test.ts
- tools-market-data.test.ts
- tools-portfolio-lookup.test.ts
- agents/ (agent test directory)

## Dependencies
- libs: cdk-constructs (core, extensions, utils), event-processor
- SSM: advisory-hub (models/opus, models/sonnet, models/haiku)
