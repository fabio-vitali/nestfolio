# market-intelligence-ctrl

Domain: advisory | Bus: AdvisoryBus
Stack: services/advisory/market-intelligence-ctrl/src/service.stack.ts

## State
- DynamoDB table (streams enabled)
- MarketKB (S3, Bedrock Knowledge Base): market news, sentiment, macro indicators from 5 feed sources

## Ingress
- AdvisoryBus -> market-intelligence-ctrl-ingress (SQS -> Lambda)
  Subscriptions: ANALYZE_MARKET, YAHOO_FINANCE_UPDATED, MARKETWATCH_UPDATED, SEC_8K_FILED, FRED_INDICATORS_UPDATED, ALPHA_VANTAGE_NEWS_UPDATED

## Egress
- CDC: DynamoDB Streams -> market-intelligence-ctrl-egress (Lambda)
  Emits: AgentInvocation, ReasoningOutput

## AgentRuntime
- market_intelligence_agents: market analysis agent (Sonnet)
  Tools: market-data, instrument-universe

## Handlers
- event-listener.ts
- event-publisher.ts
- kb-ingestion-handler.ts
- tools/market-data.handler.ts
- tools/instrument-universe.handler.ts

## Tests
- agent-service.test.ts
- event-listener.test.ts
- kb-ingestion-handler.test.ts
- service.stack.test.ts
- tools/

## Dependencies
- libs: cdk-constructs (core, extensions, utils)
- SSM: advisory-hub (models/sonnet), decision-workflow-ctrl (memory/id)
- AgentCore Memory API (CreateEvent, RetrieveMemoryRecords, etc.)
