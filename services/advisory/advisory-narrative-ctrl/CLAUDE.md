# advisory-narrative-ctrl

Domain: advisory | Bus: advisoryBus
Stack: services/advisory/advisory-narrative-ctrl/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## KnowledgeBase
- ExplainabilityKB: Financial literacy content, communication templates, feedback-driven corpus
  Storage: S3 Vector Bucket (CfnVectorBucket + CfnIndex, float32/1024d/cosine)
  Embedding: amazon.titan-embed-text-v2:0
  Data source: S3 bucket (versioned)

## Ingress
- advisoryBus -> advisory-narrative-ctrl-ingress (SQS -> Lambda)
  Subscriptions: GENERATE_NARRATIVE, DECISION_FEEDBACK
  Grants: KB bucket read/write, Bedrock KB sync, AgentCore Memory API, InvokeAgentRuntime, AgentRuntimeUrl SSM read
  errorEventType: ADVISORY_NARRATIVE_CTRL_FAILED

## Egress
- CDC: DynamoDB Streams -> advisory-narrative-ctrl-egress (Lambda)
  Emits:
  - ReasoningOutput -> EXPLANATION_GENERATED (insert only)

## AgentRuntime
Agent folder: agents/advisory-narrative/
- advisory_narrative_agents: explainability (Sonnet, 8192 tokens) agent with feedback loop KB
  Models: Sonnet (SSM from advisory-hub)
  Tools: none (all context arrives in event payload)
  Graph: single-node StateGraph wrapping agentNode (withFallback(withRetry(withValidation(createAgentNode)))), invoked via invokeOrchestrator
  TraceEmitter: EventBridgeTraceEmitter (source `agent-orchestrator@advisory-narrative-ctrl`, detailType ADVISORY_NARRATIVE_AGENT_INVOCATION_TRACED)
  PutEvents grant: eventBus.grantPutEventsTo(agentRuntime.runtime.grantPrincipal)
  SSM runtime URL override param: `/nestfolio/${prefix}-advisory-narrative-ctrl/agent/runtimeUrl`

## Handlers
- event-listener.ts -- Ingress event handler (GENERATE_NARRATIVE, DECISION_FEEDBACK) via resumeStateMachine pipeline
- event-publisher.ts -- Egress CDC publisher (changeDataCapture pipeline)
- feedback-correlator.ts -- Processes DECISION_FEEDBACK events, annotates decisions, writes to KB S3 bucket, triggers KB ingestion

## Event Types (domain/events.ts)
- NarrativeEventTypes (outbound): NARRATIVE_COMPLETED, EXPLANATION_GENERATED, ADVISORY_NARRATIVE_AGENT_INVOCATION_TRACED
- HANDLED_EVENT_TYPES (inbound): GENERATE_NARRATIVE, DECISION_FEEDBACK
- FEEDBACK_EVENT_TYPES (routed): DECISION_FEEDBACK

## Tests
- test/unit/agent-service.test.ts
- test/unit/event-listener.test.ts
- test/unit/feedback-correlator.test.ts
- test/unit/graph.test.ts
- test/unit/service.stack.test.ts
- test/unit/agents/fallbacks.test.ts
- test/unit/agents/golden-fixtures.test.ts
- test/unit/agents/schemas.test.ts
- test/unit/agents/validation.test.ts
- test/integration/advisory-narrative-ctrl.integration.test.ts

## Dependencies
- libs: cdk-constructs (core, extensions, utils), event-processor, agent-orchestrator, event-types, test-support, integration-testing
- SSM: advisory-hub (models/sonnet), decision-workflow-ctrl (memory/id), advisory-narrative-ctrl (agent/runtimeUrl)
- AgentCore Memory API (CreateEvent, RetrieveMemoryRecords, GetMemoryRecord, ListMemoryRecords, ListEvents, ListActors, ListSessions)
- AgentCore Runtime (InvokeAgentRuntime)
