# market-intelligence-ctrl

Domain: advisory | Bus: advisoryBus
Stack: services/advisory/market-intelligence-ctrl/src/service.stack.ts

## State
- DynamoDB table (streams enabled). Holds AgentInvocation rows plus the continuously-projected MarketSnapshot row (one per region, keyed pk=`MarketSnapshot#{region}`, sk='MarketSnapshot').

## KnowledgeBase
- MarketKB: Market news, sentiment, macro indicators from 5 feed sources
  Storage: S3 Vector Bucket (CfnVectorBucket + CfnIndex, float32/1024d/cosine)
  Embedding: amazon.titan-embed-text-v2:0
  Data source: S3 bucket (versioned)

## Ingress
- advisoryBus -> market-intelligence-ctrl-ingress (SQS -> Lambda)
  Subscriptions (fast tier): YAHOO_FINANCE_UPDATED, MARKETWATCH_UPDATED, SEC_8K_FILED, FRED_INDICATORS_UPDATED, ALPHA_VANTAGE_NEWS_UPDATED
  Subscriptions (slow tier): MARKET_SNAPSHOT_REFRESH_TICK
  Profile: agentProps (1024 MB / 5min timeout / batchSize 1 / concurrency 5)
  Grants: AgentCore Memory API, InvokeAgentRuntime, AgentRuntimeUrl SSM read
  Pattern: materializeToTable (continuous projection — snapshot writer)
  errorEventType: MARKET_INTELLIGENCE_CTRL_FAILED

## Schedule
- MarketSnapshotRefreshTick (EventBridge Rule): rate(15 minutes) -> ScheduledEmitter Lambda -> PutEvents(MARKET_SNAPSHOT_REFRESH_TICK) on advisoryBus. The Lambda emitter builds a structured event-processor envelope (the native EB->EventBus target cannot construct envelopes inline).
- Fault-tolerance contract: a fresh deploy can leave the MarketSnapshot row absent for up to 15 minutes (and a scheduler-disabled / Bedrock-outage / row-eviction scenario can produce the same state at any time). DWC's SF tolerates this — `LookupMarketSnapshot` Catches the missing-Item failure and routes to `HandleMissingMarketSnapshot` (empty agentOutput default). PE+AN read `subject.marketAnalysis ?? {}` so absent market context degrades the decision rather than aborting the cycle.

## Egress
- CDC: DynamoDB Streams -> market-intelligence-ctrl-egress (Lambda)
  Emits:
  - AgentInvocation -> MARKET_SIGNAL_DETECTED (insert only)
  - MarketSnapshot -> MARKET_SNAPSHOT_UPDATED (insert AND modify — every fast-tier write or slow-tier rebuild emits one notification)

## AgentRuntime
Agent folder: agents/market-intelligence/
- market_intelligence_agents: market-research (Sonnet) single agent
  Models: Sonnet (SSM from advisory-hub)
  Tools: none wired to AgentRuntime (Gateway)
  Context augmentation: market-data + instrument-universe (in-process, deterministic pre-fetch via agents/market-intelligence/graph.ts)
  Graph: single-node StateGraph wrapping agentNode (withFallback(withRetry(withValidation(createAgentNode)))), invoked via invokeOrchestrator
  TraceEmitter: EventBridgeTraceEmitter (source `agent-orchestrator@market-intelligence-ctrl`, detailType MARKET_INTELLIGENCE_AGENT_INVOCATION_TRACED)
  PutEvents grant: eventBus.grantPutEventsTo(agentRuntime.runtime.grantPrincipal)
  SSM runtime URL param: `/nestfolio/${prefix}-market-intelligence-ctrl/agent/runtimeUrl`

## Standalone Lambdas
- KBIngestion: Ingests feed data into MarketKB (triggered by 5 feed ingestion events)
- ScheduledEmitter: 15-minute tick emitter Lambda (above)

## Handlers
- event-listener.ts -- Ingress snapshot writer (materializeToTable). Each feed event or tick runs the agent and records both an AgentInvocation row and the MarketSnapshot row keyed by region.
- event-publisher.ts -- Egress CDC publisher (changeDataCapture pipeline, typed-subject mode)
- publisher-schemas.ts — typed-subject registry: maps each emitted __typename → its producer zod contract (subjectSchemas) + exemptTypenames; the publisher emits schema.parse(row) (the DRY subject) for covered types, the fat row for exempt. Exempt: AgentInvocation (no row-level contract — see backlog advisory-agent-event-contract-coverage).
- kb-ingestion-handler.ts -- KB ingestion for 5 market feed sources
- scheduled-emitter.ts -- EventBridge schedule target: PutEvents a MARKET_SNAPSHOT_REFRESH_TICK envelope
- agents/tools/market-data.ts -- Market data factory (in-process, called from agents/market-intelligence/graph.ts)
- agents/tools/instrument-universe.ts -- Instrument universe factory (in-process)
- agents/tools/format-context.ts -- Helper to serialize tool output as labelled prompt sections

## Read model
- ReadModelOwnership registered in src/read-model-ownership.ts
  - CommandOwned (own-aggregate, one row per region, upserted via update() + atomic `__version` ADD, WS-B): MarketSnapshot — `__version` carried on MARKET_SNAPSHOT_UPDATED for downstream P1 projection
  - (DWC mirror of MarketSnapshot is registered Projection<'P1'> in WS-C, not here.)
- Enforced by `nx run market-intelligence-ctrl:typecheck` (test/types/read-model-ownership.type-test.ts)

## Event Payload Contracts (domain/contracts.ts → @nestfolio/market-intelligence-ctrl/contracts)
Producer-owned zod payload contracts, exported via `@nestfolio/market-intelligence-ctrl/contracts` (path alias in tsconfig.base.json). DRY domain subjects — identity travels in the event context (RegionContext), not on the subject.
- MarketSnapshotSchema / MarketSnapshot — subject carried on MARKET_SNAPSHOT_UPDATED. Fields: agentOutput (MarketAnalysisOutputSchema from src/agents/schemas.ts), __version?. The snapshot is region-scoped: `region` was REMOVED from the subject (2026-06-10 typed-subject-contracts-advisory) — it now travels in RegionContext (the event context). The persisted row still physically carries `region` (intersected from RegionContext onto the row); the CDC publisher derives `context.region` from the row's `region` attribute. Verified against MarketSnapshotRow (domain/models.ts) + the update() intent (handlers/event-listener.ts).
- Consumed intra-domain by decision-workflow-ctrl snapshot-projector via `parseSubject(payload, MarketSnapshotSchema)` (home rule: intra-domain → direct `<svc>/contracts`). Payload changes break the consumer build. DWC consumer co-change: `snapshot-projector.ts projectMarketSnapshot` now reads `region` from `ctx` (RegionContext) rather than `subject.region`.
Note (row type, 2026-06-10): `MarketSnapshotRow` (domain/models.ts) is now `TableEntry<MarketSnapshot, RegionContext> & { __typename: 'MarketSnapshot'; sk: 'MarketSnapshot'; fastComponentsAt: string; slowComponentsAt?: string; sourceEventIds: ReadonlyArray<string> }`. Identity (region) comes from RegionContext; the dry subject (agentOutput/__version) comes from the producer contract type. Row-only operational fields (fastComponentsAt, slowComponentsAt, sourceEventIds) are projection metadata and are NOT part of the emitted CDC subject.

## Event Types (domain/events.ts)
- MarketIntelligenceEventTypes (outbound): MARKET_SIGNAL_DETECTED, MARKET_INTELLIGENCE_AGENT_INVOCATION_TRACED, MARKET_SNAPSHOT_UPDATED, MARKET_SNAPSHOT_REFRESH_TICK
- HANDLED_EVENT_TYPES (inbound): YAHOO_FINANCE_UPDATED, MARKETWATCH_UPDATED, SEC_8K_FILED, FRED_INDICATORS_UPDATED, ALPHA_VANTAGE_NEWS_UPDATED, MARKET_SNAPSHOT_REFRESH_TICK
- FEED_INGESTION_EVENT_TYPES (KB-routed): YAHOO_FINANCE_UPDATED, MARKETWATCH_UPDATED, SEC_8K_FILED, FRED_INDICATORS_UPDATED, ALPHA_VANTAGE_NEWS_UPDATED

## IAM trace
- Memory API: CreateEvent, RetrieveMemoryRecords, GetMemoryRecord, ListEvents, ListActors, ListSessions (resources: *)
- InvokeAgentRuntime on runtime ARN + endpoint sub-resource
- PutEvents to advisoryBus (ScheduledEmitter + AgentRuntime principal)
- **NO `states:SendTask*` grants.** Post-precomputation, this service no longer resumes per-cycle SF callbacks — it materializes a snapshot row and DWC's SnapshotProjectorIngress + SF read it via DDB GetItem. Lockdown asserted workspace-wide by Task 12's CDK invariant test.

## Tests
- test/unit/agent-service.test.ts
- test/unit/event-listener.test.ts
- test/unit/graph.test.ts
- test/unit/kb-ingestion-handler.test.ts
- test/unit/service.stack.test.ts
- test/unit/domain/contracts.test.ts
- test/unit/agents/* (fallbacks, format-context, golden-fixtures, prompts, schemas, validation)
- test/unit/tools/* (instrument-universe, market-data)
- test/integration/market-intelligence-ctrl.integration.test.ts
- test/integration/market-intelligence-ctrl.resilience.integration.test.ts

## Dependencies
- libs: cdk-constructs (core, extensions, utils), event-processor, agent-orchestrator, event-types, test-support, integration-testing
- Cross-service event-type imports: yahoo-finance-adpt, marketwatch-adpt, sec-edgar-adpt, fred-adpt, alpha-vantage-adpt (5 feed sources)
- Produces contracts surface `@nestfolio/market-intelligence-ctrl/contracts` (consumed by decision-workflow-ctrl)
- SSM: advisory-hub (models/sonnet), decision-workflow-ctrl (memory/id), market-intelligence-ctrl (agent/runtimeUrl)
- AgentCore Memory API (CreateEvent, RetrieveMemoryRecords, GetMemoryRecord, ListEvents, ListActors, ListSessions)
- AgentCore Runtime (InvokeAgentRuntime)
