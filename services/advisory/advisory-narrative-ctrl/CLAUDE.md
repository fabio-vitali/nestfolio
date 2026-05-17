# advisory-narrative-ctrl

Domain: advisory | Bus: advisoryBus
Stack: services/advisory/advisory-narrative-ctrl/src/service.stack.ts

## State
- DynamoDB table (streams enabled). Holds ReasoningOutput + AgentCompletion + AgentFailure rows.

## KnowledgeBase
- ExplainabilityKB: Financial literacy content, communication templates, feedback-driven corpus
  Storage: S3 Vector Bucket (CfnVectorBucket + CfnIndex, float32/1024d/cosine)
  Embedding: amazon.titan-embed-text-v2:0
  Data source: S3 bucket (versioned)

## Ingress
- advisoryBus -> advisory-narrative-ctrl-ingress (SQS -> Lambda)
  Subscriptions: GENERATE_NARRATIVE, DECISION_FEEDBACK
  Profile: agentProps (1024 MB / 5min timeout — Sonnet invocations are 50–130s p95; the default 30s timeout would leave the SF task token unreturned)
  Grants: KB bucket read/write, Bedrock KB sync, AgentCore Memory API, InvokeAgentRuntime, AgentRuntimeUrl SSM read
  Pattern: materializeToTable. GENERATE_NARRATIVE runs the agent and emits AgentCompletion (success) / AgentFailure (caught error) rows. DECISION_FEEDBACK is routed through feedback-correlator to annotate decisions + sync the KB corpus.
  errorEventType: ADVISORY_NARRATIVE_CTRL_FAILED

## Egress
- CDC: DynamoDB Streams -> advisory-narrative-ctrl-egress (Lambda)
  Emits:
  - ReasoningOutput -> EXPLANATION_GENERATED (insert only)
  - AgentCompletion -> NARRATIVE_COMPLETED (insert only)
  - AgentFailure -> NARRATIVE_FAILED (insert only)

  Flow: handler writes AgentCompletion/AgentFailure via materializeToTable -> DDB Stream -> CDC publisher -> EB -> DWC CallbackIngress -> states:SendTaskSuccess / states:SendTaskFailure. (No states:* IAM owned by this service.)

## AgentRuntime
Agent folder: agents/advisory-narrative/
- advisory_narrative_agents: explainability (Haiku 4.5, 8192 tokens) agent with feedback loop KB
  Models: Haiku (SSM from advisory-hub)
  Tools: none (all context arrives in event payload)
  Graph: single-node StateGraph wrapping agentNode (withFallback(withRetry(withValidation(createAgentNode)))), invoked via invokeOrchestrator
  TraceEmitter: EventBridgeTraceEmitter (source `agent-orchestrator@advisory-narrative-ctrl`, detailType ADVISORY_NARRATIVE_AGENT_INVOCATION_TRACED)
  PutEvents grant: eventBus.grantPutEventsTo(agentRuntime.runtime.grantPrincipal)
  SSM runtime URL param: `/nestfolio/${prefix}-advisory-narrative-ctrl/agent/runtimeUrl`

## Handlers
- event-listener.ts -- Ingress: dispatches GENERATE_NARRATIVE through the agent (wraps the orchestrator output via `wrapAgentOutput`) and records AgentCompletion / AgentFailure rows. DECISION_FEEDBACK is routed through feedback-correlator.
- event-publisher.ts -- Egress CDC publisher (changeDataCapture pipeline)
- feedback-correlator.ts -- Processes DECISION_FEEDBACK events, annotates decisions, writes to KB S3 bucket, triggers KB ingestion

## Event Types (domain/events.ts)
- NarrativeEventTypes (outbound): NARRATIVE_COMPLETED, NARRATIVE_FAILED, EXPLANATION_GENERATED, ADVISORY_NARRATIVE_AGENT_INVOCATION_TRACED
- HANDLED_EVENT_TYPES (inbound): GENERATE_NARRATIVE, DECISION_FEEDBACK
- FEEDBACK_EVENT_TYPES (routed): DECISION_FEEDBACK

## IAM trace
- Memory API: CreateEvent, RetrieveMemoryRecords, GetMemoryRecord, ListEvents, ListActors, ListSessions (resources: *)
- InvokeAgentRuntime on runtime ARN + endpoint sub-resource
- KB bucket read/write + bedrock-knowledge-base StartIngestionJob (ingress handler — feedback-correlator runs inline)
- **NO `states:SendTask*` grants.** Post-precomputation Task 7, the handler emits AgentCompletion/AgentFailure CDC rows; DWC's CallbackIngress owns the states:SendTask* grants and performs the SF resume. Lockdown asserted workspace-wide by Task 12's CDK invariant test.

## Tests
- test/unit/agent-service.test.ts
- test/unit/event-listener.test.ts
- test/unit/feedback-correlator.test.ts
- test/unit/graph.test.ts
- test/unit/service.stack.test.ts
- test/unit/agents/* (fallbacks, golden-fixtures, schemas, validation)
- test/integration/advisory-narrative-ctrl.integration.test.ts
- test/integration/advisory-narrative-ctrl.resilience.integration.test.ts

## Dependencies
- libs: cdk-constructs (core, extensions, utils), event-processor, agent-orchestrator, event-types, test-support, integration-testing
- Cross-service event-type imports: decision-workflow-ctrl (GENERATE_NARRATIVE, DECISION_FEEDBACK)
- SSM: advisory-hub (models/haiku), decision-workflow-ctrl (memory/id), advisory-narrative-ctrl (agent/runtimeUrl)
- AgentCore Memory API (CreateEvent, RetrieveMemoryRecords, GetMemoryRecord, ListEvents, ListActors, ListSessions)
- AgentCore Runtime (InvokeAgentRuntime)
