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
  Profile: agentProfile({ p90=35_000ms, burst=40, ux=AGENT_BUDGETS.ADVISORY_NARRATIVE_UX_SEC=120s }) → 1024 MB / 58s timeout / batchSize 1 / concurrency 12 / visibility 232s. P90 raised from observed 29.7s to 35s so the Lambda timeout covers p99=53.7s.
  Grants: KB bucket read/write, Bedrock KB sync, AgentCore Memory API, InvokeAgentRuntime, AgentRuntimeUrl SSM read
  Pattern: materializeToTable. GENERATE_NARRATIVE runs the agent and emits AgentCompletion (success) / AgentFailure (caught error) rows. DECISION_FEEDBACK is routed through feedback-correlator to annotate decisions + sync the KB corpus.
  MemoryClient: createMemoryClient({ namespacePrefix: 'shared-rationale' }) — writes to DWC's RationaleArchivist namespace (/shared-rationale/{actorId}/rationale).
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
- event-publisher.ts -- Egress CDC publisher (changeDataCapture pipeline, typed-subject mode)
- publisher-schemas.ts — typed-subject registry: maps each emitted __typename → its producer zod contract (subjectSchemas) + exemptTypenames; the publisher emits schema.parse(row) (the DRY subject) for covered types, the fat row for exempt. Exempt: none (every emitted __typename now has a row-level contract — ReasoningOutput → ExplanationGeneratedSchema, AgentCompletion → NarrativeAgentCompletionSchema, AgentFailure → NarrativeAgentFailureSchema).
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

## Event Payload Contracts (domain/contracts.ts → @nestfolio/advisory-narrative-ctrl/contracts)
Producer-owned zod CDC subject contracts, exported via `@nestfolio/advisory-narrative-ctrl/contracts` (NOT re-exported through the `/domain` barrel). DRY domain subjects — identity travels in the event context (RequestContext), not on the subject.
- NarrativeAgentOutputSchema / NarrativeAgentOutput — the COMPOSITE runPipeline return stored as AgentCompletion.agentOutput, CDC-emitted on NARRATIVE_COMPLETED. Extends ExplainabilitySchema (summary, rationale, keyFactors: string[], tone, wordCount: number, confidence: number [0–1]) with: decisionId, metadata ({ durationMs: number, modelTier?: string } .passthrough()).
- NarrativeAgentCompletionSchema / NarrativeAgentCompletion — the AgentCompletion row DRY subject, CDC-emitted as NARRATIVE_COMPLETED. Composed via `AgentCompletionRowSchema('advisory-narrative', NarrativeAgentOutputSchema)` from `@nestfolio/agent-orchestrator`.
- NarrativeAgentFailureSchema / NarrativeAgentFailure — the AgentFailure row DRY subject, CDC-emitted as NARRATIVE_FAILED. Composed via `AgentFailureRowSchema('advisory-narrative')` from `@nestfolio/agent-orchestrator`.
- ExplanationGeneratedSchema / ExplanationGenerated — the ReasoningOutput row DRY subject, CDC-emitted as EXPLANATION_GENERATED. `ExplainabilitySchema.extend({ invocationId: z.string(), decisionId: z.string() })`. Identity (tenantId) travels in RequestContext.

### Shared AgentCompletionRow (from @nestfolio/agent-orchestrator)
The inline `AgentCompletionRow`/`AgentFailureRow` interfaces + the `AgentCompletion#`/`AgentFailure#` PK/SK helpers that used to live in this service were MOVED to `@nestfolio/agent-orchestrator` in the typed-subject-contracts slice. This service now uses the shared generics via typed aliases in `domain/models.ts`:
- `NarrativeAgentCompletionRow = AgentCompletionRow<'advisory-narrative', NarrativeAgentOutput>`
- `NarrativeAgentFailureRow = AgentFailureRow<'advisory-narrative'>`

The key helpers are imported from `@nestfolio/agent-orchestrator` and re-exported under their legacy SCREAMING_SNAKE aliases for call-site stability:
- `agentCompletionPk as AGENT_COMPLETION_PK`, `agentCompletionSk as AGENT_COMPLETION_SK`
- `agentFailurePk as AGENT_FAILURE_PK`, `agentFailureSk as AGENT_FAILURE_SK`

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
