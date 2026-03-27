# portfolio-engine-ctrl

Domain: advisory | Bus: AdvisoryBus
Stack: services/advisory/portfolio-engine-ctrl/src/service.stack.ts

## State
- DynamoDB table (streams enabled)
- FundKB (S3, Bedrock Knowledge Base): ETF prospectuses, risk factors, instrument data, allocation history

## Ingress
- AdvisoryBus -> portfolio-engine-ctrl-ingress (SQS -> Lambda)
  Subscriptions: CONSTRUCT_PORTFOLIO, SEC_PROSPECTUS_UPDATED, SEC_10K_UPDATED

## Egress
- CDC: DynamoDB Streams -> portfolio-engine-ctrl-egress (Lambda)
  Emits: AgentInvocation, ReasoningOutput

## AgentRuntime
- portfolio_engine_agents: portfolio construction agent (Opus + Sonnet)
  Tools: portfolio-lookup

## Handlers
- event-listener.ts
- event-publisher.ts
- kb-ingestion-handler.ts
- tools/portfolio-lookup.ts

## Tests
- agent-service.test.ts
- event-listener.test.ts
- kb-ingestion-handler.test.ts
- portfolio-lookup.test.ts
- service.stack.test.ts

## Dependencies
- libs: cdk-constructs (core, extensions, utils)
- SSM: advisory-hub (models/opus, models/sonnet), decision-workflow-ctrl (memory/id)
- AgentCore Memory API (CreateEvent, RetrieveMemoryRecords, etc.)
