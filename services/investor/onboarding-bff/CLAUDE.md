# onboarding-bff

Domain: investor | Bus: investorBus
Stack: services/investor/onboarding-bff/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## KnowledgeBase
- OnboardingKB (nestfolio-docs): Nestfolio product documentation for onboarding agent
  Storage: S3 Vector Bucket (CfnVectorBucket + CfnIndex, float32/1024d/cosine)
  Embedding: amazon.titan-embed-text-v2:0
  Data source: S3 bucket (versioned)

## Egress
<!-- card-drift:egress (generated — `nx run event-processor:card-drift -- --fix`) -->
- GoLiveConfirmed: GO_LIVE_CONFIRMED
- OnboardingCompleted: ONBOARDING_COMPLETED
<!-- /card-drift:egress -->
- CDC: DynamoDB Streams -> onboarding-bff-egress (Lambda)
  Emits:
  - OnboardingCompleted -> ONBOARDING_COMPLETED (insert only)
  - GoLiveConfirmed -> GO_LIVE_CONFIRMED (insert only)

## AgentRuntime
Agent folder: agents/onboarding/  (graph.ts + server.ts + Dockerfile)
Tooling support code remains under src/agent/ (tools, prompts, state, router, session, phase-node).
- onboarding_agent: Conversational onboarding agent for investor onboarding
  Models: Sonnet (SSM from advisory-hub)
  Tools: search_knowledge_base (SearchKbFn Lambda, search-kb.schema.json, 15s timeout)
  Environment: TABLE_NAME, KNOWLEDGE_BASE_ID, AGENT_RUNTIME=true, EVENT_BUS_NAME
  TraceEmitter: EventBridgeTraceEmitter, source `agent-orchestrator@onboarding-bff`, detailType `ONBOARDING_AGENT_INVOCATION_TRACED`
  PutEvents grant: investorBus.grantPutEventsTo(agentRuntime.runtime.grantPrincipal)
  Emission lives in the `POST /invocations` request handler, not in `invokeOrchestrator` — see `agents/onboarding/server.ts`. Identity is parsed from the `x-amzn-bedrock-agentcore-runtime-session-id` header (`${tenantId}/${sessionId}`).
  SSM runtime URL export param: `/nestfolio/${prefix}-onboarding-bff/agent/runtimeUrl`

## Standalone Lambdas
- SearchKbFn: RAG search over knowledge base (invoked by AgentRuntime tool, not via Ingress)

## Handlers
<!-- card-drift:handlers (generated — `nx run event-processor:card-drift -- --fix`) -->
- search-kb.handler.ts
<!-- /card-drift:handlers -->
- event-publisher.ts -- Egress CDC publisher (changeDataCapture pipeline, typed-subject mode)
- publisher-schemas.ts — typed-subject registry: maps each emitted __typename → its producer zod contract (subjectSchemas) + exemptTypenames; the publisher emits schema.parse(row) (the DRY subject) for covered types, the fat row for exempt.
- agent/tools/search-kb.handler.ts -- KB search tool for AgentRuntime
- agent/tools/commit-phase.ts -- Commit onboarding phase
- agent/tools/compute-risk.ts -- Compute risk profile
- agent/tools/render-ui.ts -- Render UI components

## Event Types (domain/events.ts)
<!-- card-drift:event-types (generated — `nx run event-processor:card-drift -- --fix`) -->
- (top-level exports): GO_LIVE_CONFIRMED, ONBOARDING_COMPLETED, ONBOARDING_STARTED
- OnboardingBffEventTypes: ONBOARDING_AGENT_INVOCATION_TRACED
<!-- /card-drift:event-types -->
- Inbound: ONBOARDING_STARTED
- Outbound (CDC): ONBOARDING_COMPLETED, GO_LIVE_CONFIRMED
- Outbound (direct PutEvents): ONBOARDING_AGENT_INVOCATION_TRACED

## MFE Hosting
- MfeBucket (mfeKey=onboarding): S3 bucket "{account}-{prefix}-nestfolio-mfe-onboarding"
  - CloudFront OAC bucket policy (scoped via AWS:SourceArn to investor-web distribution)
  - SSM exports: mfe/bucketName, mfe/key
  - No api/graphqlUrl or api/realtimeUrl: this MFE talks to onboarding-bff via the CopilotKit /api/copilotkit* bridge, not /graphql/onboarding

## SSM Parameters Published
- mfe/bucketName
- mfe/key
- agent/runtimeUrl (existing)

## Tests
- test/unit/service.stack.test.ts
- test/unit/agent/router.test.ts
- test/unit/agent/graph.test.ts
- test/unit/agent/state.test.ts
- test/unit/agent/session.test.ts
- test/unit/domain/schemas.test.ts
- test/unit/repositories/onboarding.repository.test.ts
- test/unit/runtime/server.test.ts
- test/unit/tools/search-kb.test.ts
- test/unit/tools/commit-phase.test.ts
- test/unit/tools/compute-risk.test.ts
- test/unit/tools/render-ui.test.ts
- test/integration/onboarding-bff.integration.test.ts

## Exports (package subpaths)
- `./contracts` — producer-owned zod payload contracts (`event-subject-payload-build-tripwire`), consumed via `parseSubject` for CDC subject type-checking: `OnboardingCompletedRecordSchema`/`OnboardingCompletedRecord` (ONBOARDING_COMPLETED) and `GoLiveConfirmedSchema`/`GoLiveConfirmed` (GO_LIVE_CONFIRMED, aliased from `GoLiveConfirmedRecord{,Schema}`). DRY domain subjects — identity travels in the event context (RequestContext), not on the subject. Re-exported from `src/domain/schemas.ts` (zod-only, no heavy deps). Consumed by investor-bff (onboarding-completed transform + event-listener).
- `./events` — domain event types (`OnboardingBffEventTypes`). Consumed by e2e-feature-tests.

## Dependencies
- libs: cdk-constructs (core, extensions, utils), event-processor, agent-orchestrator
- SSM: advisory-hub (models/sonnet)

## DDB Entities
<!-- card-drift:ddb-entities (generated — `nx run event-processor:card-drift -- --fix`) -->
- GoLiveConfirmed
- OnboardingCompleted
<!-- /card-drift:ddb-entities -->
