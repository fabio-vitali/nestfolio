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
  Emits:
  - DecisionPacket insert → DECISION_PACKET_CREATED, modify → DECISION_PACKET_UPDATED
  - AgentInvocation insert → AGENT_INVOCATION_CREATED, modify → AGENT_INVOCATION_UPDATED
  - WorkflowState insert → WORKFLOW_STATE_CREATED, modify → WORKFLOW_STATE_UPDATED

## AgentRuntime
Agent folder: agents/decision-lifecycle/
- advisory_ctrl_decision_lifecycle: Multi-agent decision lifecycle orchestrated via LangGraph.js
  Models: Opus, Sonnet, Haiku (SSM from advisory-hub)
  Tools: portfolio-lookup, market-data, instrument-universe, event-publisher

## Standalone Lambdas
- PortfolioLookup: Retrieve current portfolio positions and cash balance (reads State table)
- MarketData: Retrieve current market indices, volatility, and recent events
- InstrumentUniverse: Retrieve the approved instrument universe
- ToolEventPublisher: Publish events to the advisory EventBridge bus (grants events:PutEvents)

## Handlers
- event-listener.ts — Ingress event handler (materializeToTable pipeline)
- event-publisher.ts — Egress CDC publisher (changeDataCapture pipeline)
- tools/portfolio-lookup.ts — Portfolio positions tool (raw Lambda)
- tools/market-data.ts — Market data tool (raw Lambda)
- tools/instrument-universe.ts — Instrument universe tool (raw Lambda)
- tools/event-publisher.ts — EventBridge publish tool (raw Lambda)

## Event Types (domain/events.ts)
- AdvisoryCtrlEventTypes: AGENT_INVOCATION_STARTED, AGENT_INVOCATION_COMPLETED, AGENT_EXECUTION_FAILED, GOAL_INTERPRETATION_PRODUCED, RISK_EVALUATION_PRODUCED, MARKET_SIGNAL_DETECTED, PORTFOLIO_CONSTRUCTION_PROPOSED, REBALANCE_PLAN_PRODUCED, RECOMMENDATION_PROPOSED, EXPLANATION_GENERATED, DECISION_PACKET_CREATED, DECISION_PACKET_UPDATED, USER_CONFIRMATION_REQUESTED, INCIDENT_DETECTED, INCIDENT_CONTAINED, INCIDENT_ESCALATED, INCIDENT_RESOLVED, HEALTH_CHECK_COMPLETED, MODEL_REGISTERED, SHADOW_RUN_STARTED, SHADOW_RUN_COMPLETED, MODEL_PROMOTION_REQUESTED, MODEL_PROMOTION_APPROVED, MODEL_PROMOTED, MODEL_ROLLBACK_TRIGGERED, TENANT_BUDGET_APPROACHING, TENANT_BUDGET_EXCEEDED, REASONING_TIER_CHANGED, OPERATOR_ACTION_PERFORMED, EVENT_DELIVERY_FAILED, EVENT_REPLAYED, AGENT_INVOCATION_CREATED, AGENT_INVOCATION_UPDATED, WORKFLOW_STATE_CREATED, WORKFLOW_STATE_UPDATED

## Tests
- event-listener.test.ts
- decision-lifecycle.service.test.ts
- decision.repository.test.ts
- graph.test.ts
- agents/config.test.ts
- agents/fallbacks.test.ts
- agents/golden-fixtures.test.ts
- agents/orchestrator-graph.test.ts
- agents/schemas.test.ts
- agents/validation.test.ts
- tools-event-publisher.test.ts
- tools-instrument-universe.test.ts
- tools-market-data.test.ts
- tools-portfolio-lookup.test.ts
- integration/advisory-ctrl.integration.test.ts

## Dependencies
- libs: cdk-constructs (core, extensions, utils), event-processor, event-types
- cross-domain imports: advisory-adpt/domain, advisory-bff/events, compliance-ctrl/events, execution-adpt/domain, investor-adpt/domain, ledger-adpt/domain
- SSM: advisory-hub (models/opus, models/sonnet, models/haiku)
