# portfolio-engine-ctrl

Domain: advisory | Bus: advisoryBus
Stack: services/advisory/portfolio-engine-ctrl/src/service.stack.ts

## State
- DynamoDB table (streams enabled)
- FundKB (S3 + Bedrock Knowledge Base): ETF prospectuses, risk factors, instrument data, allocation history

## Ingress
- advisoryBus → portfolio-engine-ctrl-ingress (SQS → Lambda)
  Subscriptions: CONSTRUCT_PORTFOLIO, SEC_PROSPECTUS_UPDATED, SEC_10K_UPDATED
  Grants: AgentCore Memory API

## Egress
- CDC: DynamoDB Streams → portfolio-engine-ctrl-egress (Lambda)
  Emits: PORTFOLIO_CONSTRUCTION_PROPOSED (AgentInvocation, insert only), REBALANCE_PLAN_PRODUCED (ReasoningOutput, insert only)

## AgentRuntime
- portfolio_engine_agents: portfolio-construction (Opus) + rebalance-planner (Sonnet) parallel orchestration
  Models: Opus, Sonnet (SSM from advisory-hub)
  Tools: none wired to AgentRuntime

## Standalone Lambdas
- KBIngestion: Ingests SEC prospectus/10-K data into FundKB (triggered by SEC_PROSPECTUS_UPDATED, SEC_10K_UPDATED)
- PortfolioLookup: Retrieve current portfolio positions from State table (reads DDB)

## Handlers
- event-listener.ts — Ingress event handler (CONSTRUCT_PORTFOLIO)
- event-publisher.ts — Egress CDC publisher
- kb-ingestion-handler.ts — KB ingestion for SEC filing data
- tools/portfolio-lookup.ts — Portfolio positions tool Lambda

## Event Types (domain/events.ts)
- PortfolioEngineEventTypes: PORTFOLIO_COMPLETED, PORTFOLIO_CONSTRUCTION_PROPOSED, REBALANCE_PLAN_PRODUCED
- HANDLED_EVENT_TYPES: CONSTRUCT_PORTFOLIO, SEC_PROSPECTUS_UPDATED, SEC_10K_UPDATED
- KB_INGESTION_EVENT_TYPES: SEC_PROSPECTUS_UPDATED, SEC_10K_UPDATED

## Tests
- agent-service.test.ts
- event-listener.test.ts
- kb-ingestion-handler.test.ts
- portfolio-lookup.test.ts
- service.stack.test.ts

## Dependencies
- libs: cdk-constructs (core, extensions, utils), event-processor
- SSM: advisory-hub (models/opus, models/sonnet), decision-workflow-ctrl (memory/id)
- AgentCore Memory API (CreateEvent, RetrieveMemoryRecords, GetMemoryRecord, ListMemoryRecords, ListEvents, ListActors, ListSessions)
