# onboarding-bff

Domain: investor | Bus: InvestorBus
Stack: services/investor/onboarding-bff/src/service.stack.ts

## State
- Table (DynamoDB, streams enabled)

## Egress
- CDC: DynamoDB Streams → onboarding-bff-egress (Lambda)
  Emits:
  - OnboardingCompleted → insert: ONBOARDING_COMPLETED
  - GoLiveConfirmed → insert: GO_LIVE_CONFIRMED

## AgentRuntime
- OnboardingAgent (Bedrock): conversational onboarding agent
  - Model: Claude Sonnet (via SSM parameter from advisory-hub)
  - KnowledgeBase: nestfolio-docs (product documentation RAG)
  - Tool: search_knowledge_base — search Nestfolio documentation (backed by SearchKbFn Lambda, 15s timeout)
  - Environment: TABLE_NAME, KNOWLEDGE_BASE_ID, AGENT_RUNTIME=true

## Standalone Lambdas
- SearchKbFn: RAG search over knowledge base (invoked by AgentRuntime tool, not via Ingress)

## Handlers
- event-publisher.ts — CDC (changeDataCapture)

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
- libs: cdk-constructs/core, cdk-constructs/extensions, event-processor
