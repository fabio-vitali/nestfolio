# market-intelligence-ctrl

Domain: advisory | Bus: advisoryBus
Stack: services/advisory/market-intelligence-ctrl/src/service.stack.ts

## State
- DynamoDB table (streams enabled)
- MarketKB (S3 + Bedrock Knowledge Base): market news, sentiment, macro indicators from 5 feed sources

## Ingress
- advisoryBus → market-intelligence-ctrl-ingress (SQS → Lambda)
  Subscriptions: ANALYZE_MARKET, YAHOO_FINANCE_UPDATED, MARKETWATCH_UPDATED, SEC_8K_FILED, FRED_INDICATORS_UPDATED, ALPHA_VANTAGE_NEWS_UPDATED
  Grants: AgentCore Memory API

## Egress
- CDC: DynamoDB Streams → market-intelligence-ctrl-egress (Lambda)
  Emits: MARKET_SIGNAL_DETECTED (AgentInvocation, insert only)

## AgentRuntime
- market_intelligence_agents: market-research (Sonnet) single agent with tool access
  Models: Sonnet (SSM from advisory-hub)
  Tools: none wired to AgentRuntime (standalone tool Lambdas exist)

## Standalone Lambdas
- KBIngestion: Ingests feed data into MarketKB (triggered by 5 feed ingestion events)
- MarketDataTool: Retrieve market data from State table (reads DDB)
- InstrumentUniverseTool: Retrieve instrument universe from State table (reads DDB)

## Handlers
- event-listener.ts — Ingress event handler (ANALYZE_MARKET)
- event-publisher.ts — Egress CDC publisher
- kb-ingestion-handler.ts — KB ingestion for 5 market feed sources
- tools/market-data.handler.ts — Market data tool Lambda
- tools/instrument-universe.handler.ts — Instrument universe tool Lambda

## Event Types (domain/events.ts)
- MarketIntelligenceEventTypes: MARKET_ANALYSIS_COMPLETED, MARKET_SIGNAL_DETECTED
- HANDLED_EVENT_TYPES: ANALYZE_MARKET
- FEED_INGESTION_EVENT_TYPES: YAHOO_FINANCE_UPDATED, MARKETWATCH_UPDATED, SEC_8K_FILED, FRED_INDICATORS_UPDATED, ALPHA_VANTAGE_NEWS_UPDATED

## Tests
- agent-service.test.ts
- event-listener.test.ts
- kb-ingestion-handler.test.ts
- service.stack.test.ts
- tools/instrument-universe.handler.test.ts
- tools/market-data.handler.test.ts

## Dependencies
- libs: cdk-constructs (core, extensions, utils), event-processor
- SSM: advisory-hub (models/sonnet), decision-workflow-ctrl (memory/id)
- AgentCore Memory API (CreateEvent, RetrieveMemoryRecords, GetMemoryRecord, ListMemoryRecords, ListEvents, ListActors, ListSessions)
