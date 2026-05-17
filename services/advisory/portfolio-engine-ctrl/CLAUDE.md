# portfolio-engine-ctrl

Domain: advisory | Bus: advisoryBus
Stack: services/advisory/portfolio-engine-ctrl/src/service.stack.ts

## State
- DynamoDB table (streams enabled). Holds AgentInvocation + ReasoningOutput + AgentCompletion + AgentFailure rows.

## KnowledgeBase
- FundKB: ETF prospectuses, risk factors, instrument data, allocation history
  Storage: S3 Vector Bucket (CfnVectorBucket + CfnIndex, float32/1024d/cosine)
  Embedding: amazon.titan-embed-text-v2:0
  Data source: S3 bucket (versioned)

## Ingress
- advisoryBus -> portfolio-engine-ctrl-ingress (SQS -> Lambda)
  Subscriptions: CONSTRUCT_PORTFOLIO, SEC_PROSPECTUS_UPDATED, SEC_10K_UPDATED
  Profile: agentProps (1024 MB / 5min timeout / batchSize 1 / concurrency 5)
  Grants: AgentCore Memory API, InvokeAgentRuntime, AgentRuntimeUrl SSM read
  Pattern: materializeToTable. The handler runs the agent and emits either an AgentCompletion row (success) or an AgentFailure row (caught error) — it does NOT call states:SendTask*. The SF callback is performed by DWC's CallbackIngress consuming the resulting PORTFOLIO_COMPLETED / PORTFOLIO_FAILED events.
  errorEventType: PORTFOLIO_ENGINE_CTRL_FAILED

## Egress
- CDC: DynamoDB Streams -> portfolio-engine-ctrl-egress (Lambda)
  Emits:
  - AgentInvocation -> PORTFOLIO_CONSTRUCTION_PROPOSED (insert only)
  - ReasoningOutput -> REBALANCE_PLAN_PRODUCED (insert only)
  - AgentCompletion -> PORTFOLIO_COMPLETED (insert only)
  - AgentFailure -> PORTFOLIO_FAILED (insert only)

  Flow: handler writes AgentCompletion/AgentFailure via materializeToTable -> DDB Stream -> CDC publisher -> EB -> DWC CallbackIngress -> states:SendTaskSuccess / states:SendTaskFailure. (No states:* IAM owned by this service.)

## AgentRuntime
Agent folder: agents/portfolio-engine/
- portfolio_engine_agents: portfolio-construction (Opus) + rebalance-planner (Sonnet) parallel orchestration
  Models: Opus, Sonnet (SSM from advisory-hub)
  Tools: none wired to AgentRuntime (Gateway)
  Context augmentation: portfolio-lookup (in-process, deterministic pre-fetch via agents/portfolio-engine/graph.ts)
  TraceEmitter: EventBridgeTraceEmitter (source `agent-orchestrator@portfolio-engine-ctrl`, detailType PORTFOLIO_ENGINE_AGENT_INVOCATION_TRACED)
  PutEvents grant: eventBus.grantPutEventsTo(agentRuntime.runtime.grantPrincipal)
  SSM runtime URL param: `/nestfolio/${prefix}-portfolio-engine-ctrl/agent/runtimeUrl`

## Standalone Lambdas
- KBIngestion: Ingests SEC prospectus/10-K data into FundKB (triggered by SEC_PROSPECTUS_UPDATED, SEC_10K_UPDATED)

## Handlers
- event-listener.ts -- Ingress: dispatches CONSTRUCT_PORTFOLIO through the agent and records AgentCompletion (success) or AgentFailure (caught error) rows. SEC ingestion events are routed through to kb-ingestion-handler.
- event-publisher.ts -- Egress CDC publisher (changeDataCapture pipeline)
- kb-ingestion-handler.ts -- KB ingestion for SEC filing data
- agents/tools/portfolio-lookup.ts -- Portfolio positions factory (in-process, called from agents/portfolio-engine/graph.ts)
- agents/tools/format-context.ts -- Helper to serialize tool output as labelled prompt sections

## Event Types (domain/events.ts)
- PortfolioEngineEventTypes (outbound): PORTFOLIO_COMPLETED, PORTFOLIO_FAILED, PORTFOLIO_CONSTRUCTION_PROPOSED, REBALANCE_PLAN_PRODUCED, PORTFOLIO_ENGINE_AGENT_INVOCATION_TRACED
- HANDLED_EVENT_TYPES (inbound): CONSTRUCT_PORTFOLIO, SEC_PROSPECTUS_UPDATED, SEC_10K_UPDATED
- KB_INGESTION_EVENT_TYPES (KB-routed): SEC_PROSPECTUS_UPDATED, SEC_10K_UPDATED

## IAM trace
- Memory API: CreateEvent, RetrieveMemoryRecords, GetMemoryRecord, ListEvents, ListActors, ListSessions (resources: *)
- InvokeAgentRuntime on runtime ARN + endpoint sub-resource
- KB bucket write + bedrock-knowledge-base StartIngestionJob (KBIngestion only)
- **NO `states:SendTask*` grants.** Post-precomputation Task 6, the handler emits AgentCompletion/AgentFailure CDC rows; DWC's CallbackIngress owns the states:SendTask* grants and performs the SF resume. Lockdown asserted workspace-wide by Task 12's CDK invariant test.

## Tests
- test/unit/agent-service.test.ts
- test/unit/event-listener.test.ts
- test/unit/graph.test.ts
- test/unit/kb-ingestion-handler.test.ts
- test/unit/portfolio-lookup.test.ts (factory, imports from src/agents/tools/)
- test/unit/prompts.test.ts
- test/unit/service.stack.test.ts
- test/unit/agents/* (format-context, etc.)
- test/integration/portfolio-engine-ctrl.integration.test.ts
- test/integration/portfolio-engine-ctrl.resilience.integration.test.ts

## Dependencies
- libs: cdk-constructs (core, extensions, utils), event-processor, agent-orchestrator, event-types
- Cross-service event-type imports: decision-workflow-ctrl (CONSTRUCT_PORTFOLIO), sec-edgar-adpt (SEC_PROSPECTUS_UPDATED, SEC_10K_UPDATED)
- SSM: advisory-hub (models/opus, models/sonnet), decision-workflow-ctrl (memory/id)
- AgentCore Memory API (CreateEvent, RetrieveMemoryRecords, GetMemoryRecord, ListEvents, ListActors, ListSessions)
- AgentCore Runtime (InvokeAgentRuntime)
