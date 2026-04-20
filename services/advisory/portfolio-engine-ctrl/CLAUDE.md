# portfolio-engine-ctrl

Domain: advisory | Bus: advisoryBus
Stack: services/advisory/portfolio-engine-ctrl/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## KnowledgeBase
- FundKB: ETF prospectuses, risk factors, instrument data, allocation history
  Storage: S3 Vector Bucket (CfnVectorBucket + CfnIndex, float32/1024d/cosine)
  Embedding: amazon.titan-embed-text-v2:0
  Data source: S3 bucket (versioned)

## Ingress
- advisoryBus -> portfolio-engine-ctrl-ingress (SQS -> Lambda)
  Subscriptions: CONSTRUCT_PORTFOLIO, SEC_PROSPECTUS_UPDATED, SEC_10K_UPDATED
  Grants: AgentCore Memory API

## Egress
- CDC: DynamoDB Streams -> portfolio-engine-ctrl-egress (Lambda)
  Emits:
  - AgentInvocation -> PORTFOLIO_CONSTRUCTION_PROPOSED (insert only)
  - ReasoningOutput -> REBALANCE_PLAN_PRODUCED (insert only)

## AgentRuntime
Agent folder: agents/portfolio-engine/
- portfolio_engine_agents: portfolio-construction (Opus) + rebalance-planner (Sonnet) parallel orchestration
  Models: Opus, Sonnet (SSM from advisory-hub)
  Tools: none wired to AgentRuntime (Gateway)
  Context augmentation: portfolio-lookup (in-process, deterministic pre-fetch via agents/portfolio-engine/graph.ts)
  TraceEmitter: EventBridgeTraceEmitter (source `agent-orchestrator@portfolio-engine-ctrl`, detailType PORTFOLIO_ENGINE_AGENT_INVOCATION_TRACED)
  PutEvents grant: eventBus.grantPutEventsTo(agentRuntime.runtime.grantPrincipal)
  SSM runtime URL override param: `/nestfolio/${prefix}-portfolio-engine-ctrl/agent/runtimeUrl`

## Standalone Lambdas
- KBIngestion: Ingests SEC prospectus/10-K data into FundKB (triggered by SEC_PROSPECTUS_UPDATED, SEC_10K_UPDATED)

## Handlers
- event-listener.ts -- Ingress event handler (CONSTRUCT_PORTFOLIO)
- event-publisher.ts -- Egress CDC publisher
- kb-ingestion-handler.ts -- KB ingestion for SEC filing data
- agents/tools/portfolio-lookup.ts -- Portfolio positions factory (in-process, called from agents/portfolio-engine/graph.ts)
- agents/tools/format-context.ts -- Helper to serialize tool output as labelled prompt sections

## Event Types (domain/events.ts)
- PortfolioEngineEventTypes: PORTFOLIO_COMPLETED, PORTFOLIO_CONSTRUCTION_PROPOSED, REBALANCE_PLAN_PRODUCED, PORTFOLIO_ENGINE_AGENT_INVOCATION_TRACED
- HANDLED_EVENT_TYPES: CONSTRUCT_PORTFOLIO, SEC_PROSPECTUS_UPDATED, SEC_10K_UPDATED
- KB_INGESTION_EVENT_TYPES: SEC_PROSPECTUS_UPDATED, SEC_10K_UPDATED

## Tests
- agent-service.test.ts
- event-listener.test.ts
- graph.test.ts
- kb-ingestion-handler.test.ts
- portfolio-lookup.test.ts (factory, imports from src/agents/tools/)
- agents/format-context.test.ts
- service.stack.test.ts

## Dependencies
- libs: cdk-constructs (core, extensions, utils), event-processor
- SSM: advisory-hub (models/opus, models/sonnet), decision-workflow-ctrl (memory/id)
- AgentCore Memory API (CreateEvent, RetrieveMemoryRecords, GetMemoryRecord, ListMemoryRecords, ListEvents, ListActors, ListSessions)
