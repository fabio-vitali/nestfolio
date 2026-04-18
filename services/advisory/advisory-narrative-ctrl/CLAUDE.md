# advisory-narrative-ctrl

Domain: advisory | Bus: advisoryBus
Stack: services/advisory/advisory-narrative-ctrl/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## KnowledgeBase
- ExplainabilityKB: Financial literacy content, communication templates, feedback-driven corpus
  Storage: S3 Vector Bucket (CfnVectorBucket + CfnIndex, float32/1024d/cosine)
  Embedding: amazon.titan-embed-text-v2:0
  Data source: S3 bucket (versioned)

## Ingress
- advisoryBus -> advisory-narrative-ctrl-ingress (SQS -> Lambda)
  Subscriptions: GENERATE_NARRATIVE, DECISION_FEEDBACK
  Grants: KB bucket read/write, Bedrock KB sync, AgentCore Memory API

## Egress
- CDC: DynamoDB Streams -> advisory-narrative-ctrl-egress (Lambda)
  Emits:
  - ReasoningOutput -> EXPLANATION_GENERATED (insert only)

## AgentRuntime
Agent folder: agents/advisory-narrative/
- advisory_narrative_agents: explainability (Sonnet, 8192 tokens) agent with feedback loop KB
  Models: Sonnet (SSM from advisory-hub)
  Tools: none (all context arrives in event payload)

## Handlers
- event-listener.ts -- Ingress event handler (GENERATE_NARRATIVE)
- event-publisher.ts -- Egress CDC publisher
- feedback-correlator.ts -- Processes DECISION_FEEDBACK events, updates KB corpus

## Event Types (domain/events.ts)
- NarrativeEventTypes: NARRATIVE_COMPLETED, EXPLANATION_GENERATED
- HANDLED_EVENT_TYPES: GENERATE_NARRATIVE, DECISION_FEEDBACK
- FEEDBACK_EVENT_TYPES: DECISION_FEEDBACK

## Tests
- agent-service.test.ts
- event-listener.test.ts
- feedback-correlator.test.ts
- graph.test.ts
- service.stack.test.ts

## Dependencies
- libs: cdk-constructs (core, extensions, utils), event-processor
- SSM: advisory-hub (models/sonnet), decision-workflow-ctrl (memory/id)
- AgentCore Memory API (CreateEvent, RetrieveMemoryRecords, GetMemoryRecord, ListMemoryRecords, ListEvents, ListActors, ListSessions)
