# investor-profile-ctrl

Domain: advisory | Bus: advisoryBus
Stack: services/advisory/investor-profile-ctrl/src/service.stack.ts

## State
- DynamoDB table (streams enabled). Holds AgentInvocation + ReasoningOutput rows plus the continuously-projected InvestorProfileSnapshot row (pk=`InvestorProfileSnapshot#{tenantId}#{userId}`, sk='InvestorProfileSnapshot').

## KnowledgeBase
- RegulatoryKB: Regulatory frameworks, suitability rules, compliance precedents
  Storage: S3 Vector Bucket (CfnVectorBucket + CfnIndex, float32/1024d/cosine)
  Embedding: amazon.titan-embed-text-v2:0
  Data source: S3 bucket (versioned)

## Ingress
- advisoryBus -> investor-profile-ctrl-ingress (SQS -> Lambda)
  Subscriptions: INVESTOR_PROFILE_UPDATED, MANDATE_ISSUED, OPERATING_MODE_CHANGED, DECISION_BLOCKED, DECISION_APPROVED
  Profile: agentProps (1024 MB / batchSize 1 / concurrency 5) with timing overrides — lambdaTimeout 150s, SQS visibilityTimeout 240s (fast native redrive on maxVms; no production deadline — see agentcore-invocation-resilience spec)
  Grants: AgentCore Memory API, InvokeAgentRuntime, AgentRuntimeUrl SSM read
  Pattern: materializeToTable (continuous projection — snapshot writer)
  errorEventType: INVESTOR_PROFILE_CTRL_FAILED

## Egress
- CDC: DynamoDB Streams -> investor-profile-ctrl-egress (Lambda)
  Emits:
  - AgentInvocation -> GOAL_INTERPRETATION_PRODUCED (insert only)
  - ReasoningOutput -> RISK_EVALUATION_PRODUCED (insert only)
  - InvestorProfileSnapshot -> INVESTOR_PROFILE_SNAPSHOT_CREATED (insert), INVESTOR_PROFILE_SNAPSHOT_UPDATED (modify)

## AgentRuntime
Agent folder: agents/investor-profile/
- investor_profile_agents: user-goals (Haiku) + risk-assessment (Sonnet 4.6) parallel orchestration
  Note: risk-assessment agent uses hardcoded us.anthropic.claude-sonnet-4-6 (not SSM-resolved). CDK stack wires MODEL_OPUS_ID env var (legacy) but risk-assessment.config.ts no longer reads it. modelTiers metadata: ['haiku', 'sonnet'].
  Models: Opus (CDK grant only — unused by agent), Haiku (SSM from advisory-hub)
  Tools: none (RAG only)
  PutEvents grant: eventBus.grantPutEventsTo(agentRuntime.runtime.grantPrincipal)
  SSM runtime URL param: `/nestfolio/${prefix}-investor-profile-ctrl/agent/runtimeUrl`

## Standalone Lambdas
- KBIngestion: Ingests compliance precedents into RegulatoryKB (triggered by DECISION_BLOCKED, DECISION_APPROVED)

## Handlers
- event-listener.ts -- Ingress snapshot writer (materializeToTable). Each trigger event resolves operatingMode + runs the agent + records both an AgentInvocation row and an InvestorProfileSnapshot row keyed by (tenantId, userId). DuplicateInvocationError → deduplicated short-circuit. UnknownOperatingModeError is thrown when neither subject.operatingMode nor subject.mandate.operatingMode is present.
- event-publisher.ts -- Egress CDC publisher (changeDataCapture pipeline)
- kb-ingestion-handler.ts -- KB ingestion for regulatory precedents

## Event Types (domain/events.ts)
- InvestorProfileEventTypes (outbound): GOAL_INTERPRETATION_PRODUCED, RISK_EVALUATION_PRODUCED, INVESTOR_PROFILE_AGENT_INVOCATION_TRACED, INVESTOR_PROFILE_SNAPSHOT_CREATED, INVESTOR_PROFILE_SNAPSHOT_UPDATED
- HANDLED_EVENT_TYPES (inbound triggers): INVESTOR_PROFILE_UPDATED, MANDATE_ISSUED, OPERATING_MODE_CHANGED
- KB_INGESTION_EVENT_TYPES (inbound, KB-only): DECISION_BLOCKED, DECISION_APPROVED

## IAM trace
- Memory API: CreateEvent, RetrieveMemoryRecords, GetMemoryRecord, ListEvents, ListActors, ListSessions (resources: *)
- InvokeAgentRuntime on runtime ARN + endpoint sub-resource
- KB bucket write + bedrock-knowledge-base StartIngestionJob (KBIngestion only)
- **NO `states:SendTask*` grants.** Post-precomputation, this service no longer resumes per-cycle SF callbacks — it materializes a snapshot row and DWC's SnapshotProjectorIngress + SF read it via DDB GetItem. Lockdown asserted workspace-wide by Task 12's CDK invariant test.

## Tests
- test/unit/agent-service.test.ts
- test/unit/event-listener.test.ts
- test/unit/graph.test.ts
- test/unit/kb-ingestion-handler.test.ts
- test/unit/service.stack.test.ts
- test/unit/agents/* (fallbacks, golden-fixtures, schemas, validation)
- test/integration/investor-profile-ctrl.integration.test.ts
- test/integration/investor-profile-ctrl.resilience.integration.test.ts

## Dependencies
- libs: cdk-constructs (core, extensions, utils), event-processor, agent-orchestrator, event-types
- Cross-service event-type imports: investor-bff (INVESTOR_PROFILE_UPDATED, MANDATE_ISSUED, OPERATING_MODE_CHANGED), compliance-ctrl (DECISION_BLOCKED, DECISION_APPROVED)
- SSM: advisory-hub (models/opus, models/haiku), decision-workflow-ctrl (memory/id)
- AgentCore Memory API (CreateEvent, RetrieveMemoryRecords, GetMemoryRecord, ListEvents, ListActors, ListSessions)
- AgentCore Runtime (InvokeAgentRuntime)
