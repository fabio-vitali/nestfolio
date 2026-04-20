# decision-workflow-ctrl

Domain: advisory | Bus: advisoryBus
Stack: services/advisory/decision-workflow-ctrl/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress (dual)
- TriggerIngress: advisoryBus → decision-workflow-ctrl-trigger-ingress (SQS → Lambda: event-listener.ts)
  Subscriptions: MANDATE_CREATED, GOAL_CREATED, GOAL_UPDATED, RISK_PROFILE_CREATED, RISK_PROFILE_UPDATED, OPERATING_MODE_CHANGED, PORTFOLIO_DRIFT_DETECTED, ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED

- CallbackIngress: advisoryBus → decision-workflow-ctrl-callback-ingress (SQS → Lambda: sfn-callback.ts)
  Subscriptions: INVESTOR_PROFILE_COMPLETED, MARKET_ANALYSIS_COMPLETED, PORTFOLIO_COMPLETED, NARRATIVE_COMPLETED, DECISION_APPROVED, DECISION_BLOCKED, USER_CONFIRMED, USER_REJECTED

## Egress
- CDC: DynamoDB Streams → decision-workflow-ctrl-egress (Lambda)
  Emits:
  - WorkflowTrigger → WORKFLOW_TRIGGER
  - DecisionPacket → DECISION_PACKET
  - AgentOutput → AGENT_OUTPUT

## Orchestration
- DecisionStateMachine: Step Functions state machine (72h timeout)
  Started by EB Rule on WORKFLOW_TRIGGER_CREATED (Orchestration.triggers).
  Entry state UnpackTriggerEnvelope flattens {subject.decisionId,
  subject.tenantId, context.userId, context.region} to top-level SF state
  so every putEvents task state can emit the event-processor envelope
  ({id, type, timestamp, subject, context}).
  AssembleDecisionPacket uses ResultPath=DISCARD to preserve userId/region
  through compliance + user-confirm phases.
  Callback access granted to CallbackIngress handler.
  Invokes assemblePacketFn, publishes to advisoryBus.

## Standalone Lambdas
- AssemblePacket: Assembles decision packet data (invoked by Step Functions)

## Handlers
- event-listener.ts — TriggerIngress event handler (materializes trigger events to DDB)
- sfn-callback.ts — CallbackIngress handler (resumes Step Functions via SendTaskSuccess)
- assemble-packet.ts — Assembles decision packet (invoked by SF)
- event-publisher.ts — Egress CDC publisher

## Event Types (domain/events.ts)
- DecisionWorkflowEventTypes: DECISION_PACKET_CREATED, DECISION_PACKET_UPDATED, ANALYZE_INVESTOR_PROFILE, ANALYZE_MARKET, CONSTRUCT_PORTFOLIO, GENERATE_NARRATIVE, RECOMMENDATION_PROPOSED, USER_CONFIRMATION_REQUESTED, DECISION_FEEDBACK, DECISION_WORKFLOW_FAILED
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
- SSM: advisory-hub (models/sonnet)
- CDK: @aws-cdk/aws-bedrock-agentcore-alpha, @aws-cdk/aws-bedrock-alpha
