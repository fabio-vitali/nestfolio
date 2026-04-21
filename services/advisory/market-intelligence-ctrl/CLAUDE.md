# market-intelligence-ctrl

Domain: advisory | Bus: advisoryBus
Stack: services/advisory/market-intelligence-ctrl/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## KnowledgeBase
- MarketKB: Market news, sentiment, macro indicators from 5 feed sources
  Storage: S3 Vector Bucket (CfnVectorBucket + CfnIndex, float32/1024d/cosine)
  Embedding: amazon.titan-embed-text-v2:0
  Data source: S3 bucket (versioned)

## Ingress
- advisoryBus -> market-intelligence-ctrl-ingress (SQS -> Lambda)
  Subscriptions: ANALYZE_MARKET, YAHOO_FINANCE_UPDATED, MARKETWATCH_UPDATED, SEC_8K_FILED, FRED_INDICATORS_UPDATED, ALPHA_VANTAGE_NEWS_UPDATED
  Grants: AgentCore Memory API

## Egress
- CDC: DynamoDB Streams -> market-intelligence-ctrl-egress (Lambda)
  Emits:
  - AgentInvocation -> MARKET_SIGNAL_DETECTED (insert only)

## AgentRuntime
Agent folder: agents/market-intelligence/
- market_intelligence_agents: market-research (Sonnet) single agent
  Models: Sonnet (SSM from advisory-hub)
  Tools: none wired to AgentRuntime (Gateway)
  Context augmentation: market-data + instrument-universe (in-process, deterministic pre-fetch via agents/market-intelligence/graph.ts)
  Graph: single-node StateGraph wrapping agentNode (withFallback(withRetry(withValidation(createAgentNode)))), invoked via invokeOrchestrator
  TraceEmitter: EventBridgeTraceEmitter (source `agent-orchestrator@market-intelligence-ctrl`, detailType MARKET_INTELLIGENCE_AGENT_INVOCATION_TRACED)
  PutEvents grant: eventBus.grantPutEventsTo(agentRuntime.runtime.grantPrincipal)
  SSM runtime URL override param: `/nestfolio/${prefix}-market-intelligence-ctrl/agent/runtimeUrl`

## Standalone Lambdas
- KBIngestion: Ingests feed data into MarketKB (triggered by 5 feed ingestion events)

## Handlers
- event-listener.ts -- Ingress event handler (ANALYZE_MARKET)
- event-publisher.ts -- Egress CDC publisher
- kb-ingestion-handler.ts -- KB ingestion for 5 market feed sources
- agents/tools/market-data.ts -- Market data factory (in-process, called from agents/market-intelligence/graph.ts)
- agents/tools/instrument-universe.ts -- Instrument universe factory (in-process)
- agents/tools/format-context.ts -- Helper to serialize tool output as labelled prompt sections

## Event Types (domain/events.ts)
- MarketIntelligenceEventTypes (outbound): MARKET_ANALYSIS_COMPLETED, MARKET_SIGNAL_DETECTED, MARKET_INTELLIGENCE_AGENT_INVOCATION_TRACED
- HANDLED_EVENT_TYPES (inbound): ANALYZE_MARKET
- FEED_INGESTION_EVENT_TYPES (inbound): YAHOO_FINANCE_UPDATED, MARKETWATCH_UPDATED, SEC_8K_FILED, FRED_INDICATORS_UPDATED, ALPHA_VANTAGE_NEWS_UPDATED

## Tests
- test/unit/agent-service.test.ts
- test/unit/event-listener.test.ts
- test/unit/graph.test.ts
- test/unit/kb-ingestion-handler.test.ts
- test/unit/service.stack.test.ts
- test/unit/agents/fallbacks.test.ts
- test/unit/agents/format-context.test.ts
- test/unit/agents/golden-fixtures.test.ts
- test/unit/agents/schemas.test.ts
- test/unit/agents/validation.test.ts
- test/unit/tools/instrument-universe.test.ts
- test/unit/tools/market-data.test.ts
- test/integration/market-intelligence-ctrl.integration.test.ts

## Dependencies
- libs: cdk-constructs (core, extensions, utils), event-processor, agent-orchestrator, event-types, test-support, integration-testing
- SSM: advisory-hub (models/sonnet), decision-workflow-ctrl (memory/id), market-intelligence-ctrl (agent/runtimeUrl)
- AgentCore Memory API (CreateEvent, RetrieveMemoryRecords, GetMemoryRecord, ListMemoryRecords, ListEvents, ListActors, ListSessions)
- AgentCore Runtime (InvokeAgentRuntime)
