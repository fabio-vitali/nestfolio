# decision-workflow-ctrl

Domain: advisory | Bus: advisoryBus
Stack: services/advisory/decision-workflow-ctrl/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress
- advisoryBus → decision-workflow-ctrl-trigger-ingress (SQS → Lambda: event-listener.ts)
  Subscriptions: MANDATE_CREATED, GOAL_CREATED, GOAL_UPDATED, RISK_PROFILE_CREATED, RISK_PROFILE_UPDATED, OPERATING_MODE_CHANGED, PORTFOLIO_DRIFT_DETECTED, ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED

- advisoryBus → decision-workflow-ctrl-callback-ingress (SQS → Lambda: sfn-callback.ts)
  Subscriptions: INVESTOR_PROFILE_COMPLETED, MARKET_ANALYSIS_COMPLETED, PORTFOLIO_COMPLETED, NARRATIVE_COMPLETED, DECISION_APPROVED, DECISION_BLOCKED, USER_CONFIRMED, USER_REJECTED

## Egress
- CDC: DynamoDB Streams → decision-workflow-ctrl-egress (Lambda)
  Emits: WORKFLOW_TRIGGER (WorkflowTrigger), DECISION_PACKET (DecisionPacket), AGENT_OUTPUT (AgentOutput)

## Orchestration
- DecisionStateMachine: Decision lifecycle Step Functions state machine (timeout: 72 hours)
  Started via CDC chain (no direct EB trigger)
  grantCallbackAccess → callbackIngress handler (sfn-callback.ts)
  assemblePacketFn invoked by state machine, reads agent outputs from Memory

## AgentCore Memory
- Shared agent memory: nestfolio_{prefix}_agent_memory (90-day TTL)
  Strategies:
  - InvestorPreferenceLearner (UserPreference, /investor-profile/{actorId}/preferences)
  - MarketSignalExtractor (Semantic, /market-intelligence/{actorId}/signals)
  - AllocationRationaleExtractor (Semantic, /portfolio-engine/{actorId}/rationale)
  - NarrativePreferenceLearner (UserPreference, /advisory-narrative/{actorId}/preferences)
  - NarrativeSessionSummarizer (Summarization, /advisory-narrative/{actorId}/sessions)
- Memory ID exported via SSM: memory/id

## Standalone Lambdas
- AssemblePacket: Reads all 4 agent outputs from Memory, writes assembled packet to State table (invoked by StateMachine)

## Handlers
- event-listener.ts — Trigger ingress handler (materializes trigger events to State table)
- sfn-callback.ts — Callback ingress handler (sends SendTaskSuccess/Failure to Step Functions)
- assemble-packet.ts — Assembles decision packet from Memory agent outputs (invoked by SF)
- event-publisher.ts — Egress CDC publisher

## Event Types (domain/events.ts)
- DecisionWorkflowEventTypes: DECISION_PACKET_CREATED, DECISION_PACKET_ENRICHED, ANALYZE_INVESTOR_PROFILE, ANALYZE_MARKET, CONSTRUCT_PORTFOLIO, GENERATE_NARRATIVE, RECOMMENDATION_PROPOSED, USER_CONFIRMATION_REQUESTED, DECISION_FEEDBACK, DECISION_WORKFLOW_FAILED
- TRIGGER_EVENT_TYPES: MANDATE_CREATED, GOAL_CREATED, GOAL_UPDATED, RISK_PROFILE_CREATED, RISK_PROFILE_UPDATED, OPERATING_MODE_CHANGED, PORTFOLIO_DRIFT_DETECTED, ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED
- AGENT_COMPLETION_EVENT_TYPES: INVESTOR_PROFILE_COMPLETED, MARKET_ANALYSIS_COMPLETED, PORTFOLIO_COMPLETED, NARRATIVE_COMPLETED
- COMPLIANCE_EVENT_TYPES: DECISION_APPROVED, DECISION_BLOCKED
- USER_RESPONSE_EVENT_TYPES: USER_CONFIRMED, USER_REJECTED

## Tests
- assemble-packet.test.ts
- decision-packet.repository.test.ts
- event-listener.test.ts
- service.stack.test.ts
- sfn-callback.test.ts

## Dependencies
- libs: cdk-constructs (core, utils), event-processor
- npm: @aws-cdk/aws-bedrock-agentcore-alpha, @aws-cdk/aws-bedrock-alpha
- SSM: advisory-hub (models/sonnet)
