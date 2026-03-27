# advisory-narrative-ctrl

Domain: advisory | Bus: AdvisoryBus
Stack: services/advisory/advisory-narrative-ctrl/src/service.stack.ts

## State
- DynamoDB table (streams enabled)
- ExplainabilityKB (S3, Bedrock Knowledge Base): financial literacy content, communication templates, feedback-driven corpus

## Ingress
- AdvisoryBus -> advisory-narrative-ctrl-ingress (SQS -> Lambda)
  Subscriptions: GENERATE_NARRATIVE, DECISION_FEEDBACK

## Egress
- CDC: DynamoDB Streams -> advisory-narrative-ctrl-egress (Lambda)
  Emits: AgentInvocation, ReasoningOutput

## AgentRuntime
- advisory_narrative_agents: explainability agent (Sonnet, 8192 tokens)
  No tool Lambdas (all context arrives in event payload)

## Handlers
- event-listener.ts
- event-publisher.ts
- feedback-correlator.ts

## Tests
- agent-service.test.ts
- event-listener.test.ts
- feedback-correlator.test.ts

## Dependencies
- libs: cdk-constructs (core, extensions, utils)
- SSM: advisory-hub (models/sonnet), decision-workflow-ctrl (memory/id)
- AgentCore Memory API (CreateEvent, RetrieveMemoryRecords, etc.)
