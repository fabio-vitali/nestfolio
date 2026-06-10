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
  Profile: agentProfile({ p90=29_000ms, burst=40, ux=AGENT_BUDGETS.PORTFOLIO_ENGINE_UX_SEC=120s }) → 1024 MB / 49s timeout / batchSize 1 / concurrency 10 / visibility 196s
  Grants: AgentCore Memory API, InvokeAgentRuntime, AgentRuntimeUrl SSM read
  Pattern: materializeToTable. The handler runs the agent and emits either an AgentCompletion row (success) or an AgentFailure row (caught error) — it does NOT call states:SendTask*. The SF callback is performed by DWC's CallbackIngress consuming the resulting PORTFOLIO_COMPLETED / PORTFOLIO_FAILED events.
  MemoryClient: createMemoryClient({ namespacePrefix: 'shared-rationale' }) — writes to DWC's RationaleArchivist namespace (/shared-rationale/{actorId}/rationale).
  errorEventType: 'PORTFOLIO_ENGINE_CTRL_FAILED' (literal string in event-listener.ts materializeToTable call; not exported from domain/events.ts)

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
- portfolio_engine_agents: portfolio-construction + rebalance-planner parallel orchestration
  Models: SSM-resolved at deploy time from advisory-hub (models/opus, models/sonnet); the SSM values are passed to the runtime container, but the canonical per-agent modelIds live in src/agents/*.config.ts
  Tools: none wired to AgentRuntime (Gateway)
  Context augmentation: portfolio-lookup (in-process, deterministic pre-fetch via agents/portfolio-engine/graph.ts)
  TraceEmitter: EventBridgeTraceEmitter (source `agent-orchestrator@portfolio-engine-ctrl`, detailType PORTFOLIO_ENGINE_AGENT_INVOCATION_TRACED)
  PutEvents grant: eventBus.grantPutEventsTo(agentRuntime.runtime.grantPrincipal)
  SSM runtime URL param: `/nestfolio/${prefix}-portfolio-engine-ctrl/agent/runtimeUrl`
  Agents:
  - portfolio-construction (model: us.anthropic.claude-sonnet-4-6)
  - rebalance-planner (model: amazon.nova-pro-v1:0)

## Standalone Lambdas
- KBIngestion: Ingests SEC prospectus/10-K data into FundKB (triggered by SEC_PROSPECTUS_UPDATED, SEC_10K_UPDATED). Grants: kb.bucket write, kb.triggerSyncPolicy() (StartIngestionJob).

## Handlers
- event-listener.ts -- Ingress: dispatches CONSTRUCT_PORTFOLIO through the agent and records AgentCompletion (success) or AgentFailure (caught error) rows. SEC ingestion events are routed through to kb-ingestion-handler.
- event-publisher.ts -- Egress CDC publisher (changeDataCapture pipeline)
- kb-ingestion-handler.ts -- KB ingestion for SEC filing data

## Event Types (domain/events.ts)
- PortfolioEngineEventTypes (outbound): PORTFOLIO_COMPLETED, PORTFOLIO_FAILED, PORTFOLIO_CONSTRUCTION_PROPOSED, REBALANCE_PLAN_PRODUCED, PORTFOLIO_ENGINE_AGENT_INVOCATION_TRACED
- HANDLED_EVENT_TYPES (inbound): CONSTRUCT_PORTFOLIO, SEC_PROSPECTUS_UPDATED, SEC_10K_UPDATED
- KB_INGESTION_EVENT_TYPES (KB-routed): SEC_PROSPECTUS_UPDATED, SEC_10K_UPDATED

## IAM trace
- Memory API on Ingress handler: CreateEvent, RetrieveMemoryRecords, GetMemoryRecord, ListEvents, ListActors, ListSessions (resources: *)
- Memory API on AgentRuntime grantPrincipal: same six actions (resources: *) — for long-term-memory search inside the runtime
- InvokeAgentRuntime granted to Ingress handler via agentRuntime.grantInvoke (covers runtime ARN + endpoint sub-resource)
- AgentRuntime grantPrincipal granted advisoryBus PutEvents (trace envelopes)
- KBIngestion: kb.bucket write + kb.triggerSyncPolicy() (StartIngestionJob)
- **NO `states:SendTask*` grants.** Post-precomputation Task 6, the handler emits AgentCompletion/AgentFailure CDC rows; DWC's CallbackIngress owns the states:SendTask* grants and performs the SF resume. Lockdown asserted workspace-wide by Task 12's CDK invariant test.
- BedrockUsageAlarms: per-service cost alarms wired to imported cost alert topic (`/nestfolio/${prefix}-investor/cost-controls/alertTopicArn`)

## Event Payload Contracts (domain/contracts.ts → @nestfolio/portfolio-engine-ctrl/contracts)
Producer-owned zod CDC subject contracts, exported via `@nestfolio/portfolio-engine-ctrl/contracts` (NOT re-exported through the `/domain` barrel). DRY domain subjects — identity travels in the event context (RequestContext), not on the subject.
- PortfolioAgentOutputSchema / PortfolioAgentOutput — the COMPOSITE runPipeline return stored as AgentCompletion.agentOutput, CDC-emitted on PORTFOLIO_COMPLETED. Fields: decisionId, allocations (PortfolioConstructionSchema), trades (RebalancePlanSchema.optional()), metadata ({ durationMs: number, modelTiers?: string[], modeUsed?: string } .passthrough()).

### Shared AgentCompletionRow (from @nestfolio/agent-orchestrator)
The inline `AgentCompletionRow`/`AgentFailureRow` interfaces + the `AgentCompletion#`/`AgentFailure#` PK/SK helpers that used to live in this service were MOVED to `@nestfolio/agent-orchestrator` in the typed-subject-contracts slice. This service now uses the shared generics via typed aliases in `domain/models.ts`:
- `PortfolioAgentCompletionRow = AgentCompletionRow<'portfolio-engine', PortfolioAgentOutput>`
- `PortfolioAgentFailureRow = AgentFailureRow<'portfolio-engine'>`

The key helpers are imported from `@nestfolio/agent-orchestrator` and re-exported under their legacy SCREAMING_SNAKE aliases for call-site stability:
- `agentCompletionPk as AGENT_COMPLETION_PK`, `agentCompletionSk as AGENT_COMPLETION_SK`
- `agentFailurePk as AGENT_FAILURE_PK`, `agentFailureSk as AGENT_FAILURE_SK`

## Tests
- test/unit/agent-service.test.ts
- test/unit/event-listener.test.ts
- test/unit/graph.test.ts
- test/unit/kb-ingestion-handler.test.ts
- test/unit/portfolio-lookup.test.ts
- test/unit/prompts.test.ts
- test/unit/service.stack.test.ts
- test/unit/agents/fallbacks.test.ts
- test/unit/agents/format-context.test.ts
- test/unit/agents/golden-fixtures.test.ts
- test/unit/agents/prompts.test.ts
- test/unit/agents/schemas.test.ts
- test/unit/agents/validation.test.ts
- test/integration/portfolio-engine-ctrl.integration.test.ts
- test/integration/portfolio-engine-ctrl.resilience.integration.test.ts

## Dependencies
- libs: cdk-constructs (core, extensions, utils), event-processor, agent-orchestrator, event-types
- Cross-service event-type imports: decision-workflow-ctrl (CONSTRUCT_PORTFOLIO, AGENT_BUDGETS), sec-edgar-adpt (SEC_PROSPECTUS_UPDATED, SEC_10K_UPDATED)
- SSM: advisory-hub (models/opus, models/sonnet), decision-workflow-ctrl (memory/id)
- AgentCore Memory API (CreateEvent, RetrieveMemoryRecords, GetMemoryRecord, ListEvents, ListActors, ListSessions)
- AgentCore Runtime (InvokeAgentRuntime)
