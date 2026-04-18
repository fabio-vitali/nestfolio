# investor-profile-ctrl

Domain: advisory | Bus: advisoryBus
Stack: services/advisory/investor-profile-ctrl/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## KnowledgeBase
- RegulatoryKB: Regulatory frameworks, suitability rules, compliance precedents
  Storage: S3 Vector Bucket (CfnVectorBucket + CfnIndex, float32/1024d/cosine)
  Embedding: amazon.titan-embed-text-v2:0
  Data source: S3 bucket (versioned)

## Ingress
- advisoryBus -> investor-profile-ctrl-ingress (SQS -> Lambda)
  Subscriptions: ANALYZE_INVESTOR_PROFILE, DECISION_BLOCKED, DECISION_APPROVED
  Grants: AgentCore Memory API

## Egress
- CDC: DynamoDB Streams -> investor-profile-ctrl-egress (Lambda)
  Emits:
  - AgentInvocation -> GOAL_INTERPRETATION_PRODUCED (insert only)
  - ReasoningOutput -> RISK_EVALUATION_PRODUCED (insert only)

## AgentRuntime
Agent folder: agents/investor-profile/
- investor_profile_agents: user-goals (Haiku) + risk-assessment (Opus) parallel orchestration
  Models: Opus, Haiku (SSM from advisory-hub)
  Tools: none (RAG only)

## Standalone Lambdas
- KBIngestion: Ingests compliance precedents into RegulatoryKB (triggered by DECISION_BLOCKED, DECISION_APPROVED)

## Handlers
- event-listener.ts -- Ingress event handler (ANALYZE_INVESTOR_PROFILE)
- event-publisher.ts -- Egress CDC publisher
- kb-ingestion-handler.ts -- KB ingestion for regulatory precedents

## Event Types (domain/events.ts)
- InvestorProfileEventTypes: INVESTOR_PROFILE_COMPLETED, GOAL_INTERPRETATION_PRODUCED, RISK_EVALUATION_PRODUCED
- HANDLED_EVENT_TYPES: ANALYZE_INVESTOR_PROFILE
- KB_INGESTION_EVENT_TYPES: DECISION_BLOCKED, DECISION_APPROVED

## Tests
- agent-service.test.ts
- event-listener.test.ts
- graph.test.ts
- kb-ingestion-handler.test.ts
- service.stack.test.ts

## Dependencies
- libs: cdk-constructs (core, extensions, utils), event-processor
- SSM: advisory-hub (models/opus, models/haiku), decision-workflow-ctrl (memory/id)
- AgentCore Memory API (CreateEvent, RetrieveMemoryRecords, GetMemoryRecord, ListMemoryRecords, ListEvents, ListActors, ListSessions)
