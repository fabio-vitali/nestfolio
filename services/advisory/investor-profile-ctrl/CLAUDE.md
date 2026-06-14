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
<!-- card-drift:ingress (generated — `nx run event-processor:card-drift -- --fix`) -->
- Ingress: DECISION_APPROVED, DECISION_BLOCKED, INVESTOR_PROFILE_UPDATED, MANDATE_ISSUED
<!-- /card-drift:ingress -->
- advisoryBus -> investor-profile-ctrl-ingress (SQS -> Lambda)
  Note: OPERATING_MODE_CHANGED was dropped (2026-06-03) — investor-bff re-sourced it from the Mandate CDC row, so the event subject now carries Mandate fields (mandateId/level/status/operatingMode/effectiveDate) rather than the full InvestorProfile. Feeding a Mandate row to the snapshot agent would produce degraded output. operatingMode changes still rebuild the snapshot via INVESTOR_PROFILE_UPDATED, which investor-bff's dual-write co-fires on every operatingMode change (touching the InvestorProfile row → its `always` carrier).
  Profile: agentProps (1024 MB / batchSize 1 / concurrency 5) with timing overrides — lambdaTimeout 150s, SQS visibilityTimeout 240s (fast native redrive on maxVms; no production deadline — see agentcore-invocation-resilience spec)
  Grants: AgentCore Memory API, InvokeAgentRuntime, AgentRuntimeUrl SSM read
  Pattern: materializeToTable (continuous projection — snapshot writer)
  errorEventType: INVESTOR_PROFILE_CTRL_FAILED

## Egress
<!-- card-drift:egress (generated — `nx run event-processor:card-drift -- --fix`) -->
- InvestorProfileSnapshot: INVESTOR_PROFILE_SNAPSHOT_CREATED, INVESTOR_PROFILE_SNAPSHOT_UPDATED
<!-- /card-drift:egress -->
- CDC: DynamoDB Streams -> investor-profile-ctrl-egress (Lambda)
  (AgentInvocation + ReasoningOutput rows are still written but NOT CDC-emitted — GOAL_INTERPRETATION_PRODUCED + RISK_EVALUATION_PRODUCED were stop-emitted; zero consumers.)

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
<!-- card-drift:handlers (generated — `nx run event-processor:card-drift -- --fix`) -->
- kb-ingestion-handler.ts
<!-- /card-drift:handlers -->
- event-listener.ts -- Ingress snapshot writer (materializeToTable). The handler map parses each trigger per event type at the consumer seam: INVESTOR_PROFILE_UPDATED via `parseSubject(payload, InvestorProfileUpdatedSchema)`, MANDATE_ISSUED via `parseSubject(payload, MandateSchema)` (both imported from `@nestfolio/investor-adpt/domain`; consumer-parse-subject / WS-3). Each resolves `subject.operatingMode` (a required enum on both schemas) + runs the agent + records both an AgentInvocation row and an InvestorProfileSnapshot row keyed by (tenantId, userId). DuplicateInvocationError → deduplicated short-circuit. A contract violation (incl. a missing/invalid operatingMode) poison-pills via ZodError at the parseSubject seam — the former UnknownOperatingModeError guard + the `subject.mandate.operatingMode` fallback were removed (operatingMode is now schema-required).
- event-publisher.ts -- Egress CDC publisher (changeDataCapture pipeline, typed-subject mode)
- publisher-schemas.ts — typed-subject registry: maps each emitted __typename → its producer zod contract (subjectSchemas) + exemptTypenames; the publisher emits schema.parse(row) (the DRY subject) for covered types, the fat row for exempt. Exempt: none (every emitted __typename now has a row-level contract — InvestorProfileSnapshot → InvestorProfileSnapshotSchema).
- kb-ingestion-handler.ts -- KB ingestion for regulatory precedents

## Read model
- ReadModelOwnership registered in src/read-model-ownership.ts
  - CommandOwned (own-aggregate written via update() upsert + atomic `__version` ADD, WS-B): InvestorProfileSnapshot — rebuilds every decision cycle (INVESTOR_PROFILE_UPDATED/MANDATE_ISSUED); INVESTOR_PROFILE_SNAPSHOT_UPDATED fires on each rebuild carrying the incrementing `__version`
  - (DWC mirror of InvestorProfileSnapshot is registered Projection<'P1'> in WS-C, not here.)
- Enforced by `nx run investor-profile-ctrl:typecheck` (test/types/read-model-ownership.type-test.ts)

## Event Types (domain/events.ts)
<!-- card-drift:event-types (generated — `nx run event-processor:card-drift -- --fix`) -->
- InvestorProfileEventTypes: GOAL_INTERPRETATION_PRODUCED, INVESTOR_PROFILE_AGENT_INVOCATION_TRACED, INVESTOR_PROFILE_SNAPSHOT_CREATED, INVESTOR_PROFILE_SNAPSHOT_UPDATED, RISK_EVALUATION_PRODUCED
<!-- /card-drift:event-types -->
- HANDLED_EVENT_TYPES (inbound triggers): INVESTOR_PROFILE_UPDATED, MANDATE_ISSUED
- KB_INGESTION_EVENT_TYPES (inbound, KB-only): DECISION_BLOCKED, DECISION_APPROVED

## Event Payload Contracts (domain/contracts.ts → @nestfolio/investor-profile-ctrl/contracts)
Producer-owned zod payload contracts, exported via the dedicated `/contracts` alias (`@nestfolio/investor-profile-ctrl/contracts`). DRY domain subjects — identity travels in the event context (RequestContext), not on the subject.
- InvestorProfileSnapshotSchema / InvestorProfileSnapshot — subject carried on INVESTOR_PROFILE_SNAPSHOT_CREATED / INVESTOR_PROFILE_SNAPSHOT_UPDATED. Fields: agentOutput (COMPOSITE object: `{decisionId: string, goals: GoalInterpretation, risk: RiskEvaluation, metadata: {durationMs, modelTiers?}}`), sourceEventId?, __version?. Verified against agent-service.ts return value + InvestorProfileSnapshotRow in domain/models.ts + the update() intent in handlers/event-listener.ts.
  - GoalInterpretation: `{goals: string[], timeHorizon, riskWillingness, confidence}` (from agents/schemas.ts)
  - RiskEvaluation: `{riskScore, riskCategory: 'CONSERVATIVE'|'MODERATE'|'AGGRESSIVE', regulatoryFlags: string[], suitabilityAssessment, confidence}` (from agents/schemas.ts)
  - NOTE (corrected 2026-06-10 by e2e validation gate): the previously declared flat agentOutput `{goals[], timeHorizon, riskScore, riskCategory, …}` was WRONG — the real agent-service.ts return is the composite above. A co-wrong unit fixture had hidden the drift. The gate caught the mismatch against the real deployed emission.
- Consumed cross-domain by decision-workflow-ctrl (snapshot-projector.ts) via `parseSubject` at the seam; a payload change breaks the consumer build.
Note (row type, 2026-06-10): `InvestorProfileSnapshotRow` (domain/models.ts) is now `TableEntry<InvestorProfileSnapshot, RequestContext> & { __typename: 'InvestorProfileSnapshot'; sk: 'InvestorProfileSnapshot'; sourceEventType: 'INVESTOR_PROFILE_UPDATED'|'MANDATE_ISSUED'; agentInvocationId: string }`. It was previously a hand-rolled interface that re-declared pk/sk/__typename alongside the identity fields. The dry subject (agentOutput/sourceEventId/__version) now comes directly from the producer contract type; identity (tenantId/userId/region) is supplied by RequestContext — no duplication.

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
- npm: zod (payload contract schema in domain/contracts.ts + agent schemas)
- Cross-domain event-type imports (producer-domain adapter `/domain`): investor-adpt/domain (InvestorCrossDomainEventTypes.INVESTOR_PROFILE_UPDATED, MANDATE_ISSUED)
- Intra-domain event-type imports: compliance-ctrl (DECISION_BLOCKED, DECISION_APPROVED)
- Cross-service contract consumers: decision-workflow-ctrl imports InvestorProfileSnapshotSchema from `@nestfolio/investor-profile-ctrl/contracts`
- SSM: advisory-hub (models/opus, models/haiku), decision-workflow-ctrl (memory/id)
- AgentCore Memory API (CreateEvent, RetrieveMemoryRecords, GetMemoryRecord, ListEvents, ListActors, ListSessions)
- AgentCore Runtime (InvokeAgentRuntime)

## DDB Entities
<!-- card-drift:ddb-entities (generated — `nx run event-processor:card-drift -- --fix`) -->
- AgentInvocation
- InvestorProfileSnapshot
<!-- /card-drift:ddb-entities -->
