# investor-profile-ctrl

Domain: advisory | Bus: AdvisoryBus
Stack: services/advisory/investor-profile-ctrl/src/service.stack.ts

## State
- DynamoDB table (streams enabled)
- RegulatoryKB (S3, Bedrock Knowledge Base): regulatory frameworks, suitability rules, compliance precedents

## Ingress
- AdvisoryBus -> investor-profile-ctrl-ingress (SQS -> Lambda)
  Subscriptions: ANALYZE_INVESTOR_PROFILE, DECISION_BLOCKED, DECISION_APPROVED

## Egress
- CDC: DynamoDB Streams -> investor-profile-ctrl-egress (Lambda)
  Emits: AgentInvocation, ReasoningOutput

## AgentRuntime
- investor_profile_agents: investor profile analysis agent (Opus + Haiku)
  No tool Lambdas (RAG only)

## Handlers
- event-listener.ts
- event-publisher.ts
- kb-ingestion-handler.ts

## Tests
- agent-service.test.ts
- event-listener.test.ts
- kb-ingestion-handler.test.ts
- service.stack.test.ts

## Dependencies
- libs: cdk-constructs (core, extensions, utils)
- SSM: advisory-hub (models/opus, models/haiku), decision-workflow-ctrl (memory/id)
- AgentCore Memory API (CreateEvent, RetrieveMemoryRecords, etc.)
