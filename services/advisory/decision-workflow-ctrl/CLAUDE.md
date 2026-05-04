# decision-workflow-ctrl

Domain: advisory | Bus: advisoryBus
Stack: services/advisory/decision-workflow-ctrl/src/service.stack.ts

## State
- DynamoDB table (streams enabled). Holds DecisionPacket + AgentOutput rows. WorkflowTrigger DDB row REMOVED post-collapse — direct EB → SF eliminated the trigger-aggregator hop.

## Ingress (single — TriggerIngress removed)
- CallbackIngress: advisoryBus → decision-workflow-ctrl-callback-ingress (SQS → Lambda: sfn-callback.ts)
  Subscriptions: INVESTOR_PROFILE_COMPLETED, MARKET_ANALYSIS_COMPLETED, PORTFOLIO_COMPLETED, NARRATIVE_COMPLETED, DECISION_APPROVED, DECISION_BLOCKED, USER_CONFIRMED, USER_REJECTED

## Egress
- CDC: DynamoDB Streams → decision-workflow-ctrl-egress (Lambda)
  Emits:
  - DecisionPacket → DECISION_PACKET_CREATED (insert), DECISION_PACKET_UPDATED (modify)
  - AgentOutput → AGENT_OUTPUT_CREATED (insert), AGENT_OUTPUT_UPDATED (modify)

## Orchestration (Direct EB → SF)
- DecisionStateMachine: Step Functions state machine (72h timeout)
  Started directly by EB Rule on the 7 trigger events (Orchestration.triggers — declarative). No TriggerIngress, no WorkflowTrigger DDB row, no WORKFLOW_TRIGGER_CREATED hop.
  Entry state UnpackTriggerEnvelope flattens {subject.decisionId, subject.tenantId, context.userId, context.region} to top-level SF state so every putEvents task state can emit the event-processor envelope ({id, type, timestamp, subject, context}).
  AssembleDecisionPacket uses ResultPath=DISCARD to preserve userId/region through compliance + user-confirm phases.
  Callback access granted to CallbackIngress handler.
  Invokes assemblePacketFn, publishes to advisoryBus.
- Auto-named executions (no executionName field — AWS doesn't expose per-target Name for the native EB→SF integration). At-least-once redelivery risk is theoretical and unobserved post-collapse (the multi-event-per-action duplication that previously motivated dedup is gone).

## Standalone Lambdas
- AssemblePacket: Reads all 4 agent outputs from AgentCore Memory at assembly time; persists DecisionPacket row with explanation + proposedTrades

## Handlers
- sfn-callback.ts — CallbackIngress handler (resumes Step Functions via SendTaskSuccess); writes AgentOutput records on agent completions; updates DecisionPacket status on compliance + user response events
- assemble-packet.ts — Assembles decision packet (invoked by SF, reads AgentCore Memory)
- event-publisher.ts — Egress CDC publisher

## Event Types (domain/events.ts)
- DecisionWorkflowEventTypes: DECISION_PACKET_CREATED, DECISION_PACKET_UPDATED, ANALYZE_INVESTOR_PROFILE, ANALYZE_MARKET, CONSTRUCT_PORTFOLIO, GENERATE_NARRATIVE, RECOMMENDATION_PROPOSED, USER_CONFIRMATION_REQUESTED, DECISION_FEEDBACK, DECISION_WORKFLOW_FAILED, AGENT_OUTPUT_CREATED, AGENT_OUTPUT_UPDATED
- TRIGGER_EVENT_TYPES (7): INVESTOR_PROFILE_CREATED, INVESTOR_PROFILE_UPDATED, PORTFOLIO_DRIFT_DETECTED, ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED
- AGENT_COMPLETION_EVENT_TYPES: INVESTOR_PROFILE_COMPLETED, MARKET_ANALYSIS_COMPLETED, PORTFOLIO_COMPLETED, NARRATIVE_COMPLETED
- COMPLIANCE_EVENT_TYPES: DECISION_APPROVED, DECISION_BLOCKED
- USER_RESPONSE_EVENT_TYPES: USER_CONFIRMED, USER_REJECTED

## Tests
- assemble-packet.test.ts
- decision-packet.repository.test.ts
- service.stack.test.ts
- sfn-callback.test.ts

## Dependencies
- libs: cdk-constructs (core, utils), event-processor
- SSM: advisory-hub (models/sonnet)
- CDK: @aws-cdk/aws-bedrock-agentcore-alpha, @aws-cdk/aws-bedrock-alpha
