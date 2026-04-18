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
  Environment: TABLE_NAME, KNOWLEDGE_BASE_ID, AGENT_RUNTIME=true

## Standalone Lambdas
- SearchKbFn: RAG search over knowledge base (invoked by AgentRuntime tool, not via Ingress)

## Handlers
- event-publisher.ts -- Egress CDC publisher
- agent/tools/search-kb.handler.ts -- KB search tool for AgentRuntime
- agent/tools/commit-phase.ts -- Commit onboarding phase
- agent/tools/compute-risk.ts -- Compute risk profile
- agent/tools/render-ui.ts -- Render UI components

## Event Types (domain/events.ts)
- ONBOARDING_STARTED, ONBOARDING_COMPLETED, GO_LIVE_CONFIRMED

## Tests
- agent/router.test.ts
- agent/graph.test.ts
- agent/state.test.ts
- agent/session.test.ts
- domain/schemas.test.ts
- repositories/onboarding.repository.test.ts
- runtime/server.test.ts
- tools/search-kb.test.ts
- tools/commit-phase.test.ts
- tools/compute-risk.test.ts
- tools/render-ui.test.ts

## Dependencies
- libs: cdk-constructs (core, extensions, utils), event-processor
- SSM: advisory-hub (models/sonnet)
