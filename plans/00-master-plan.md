# 00 — Nestfolio Master Implementation Plan

> Strategy and coordination document for the Nestfolio implementation.
> Scope: Build a complete, reusable reference architecture for an AI-managed investment platform.

---

## Table of Contents

1. [Project Summary](#1-project-summary)
2. [Key Architectural Decisions](#2-key-architectural-decisions)
3. [Plan Structure](#3-plan-structure)
4. [Implementation Phases](#4-implementation-phases)
5. [Critical Path & Dependencies](#5-critical-path--dependencies)
6. [Milestone Definitions](#6-milestone-definitions)
7. [Completion Criteria](#7-completion-criteria)
8. [Constraints & Assumptions](#8-constraints--assumptions)
9. [Cross-References](#9-cross-references)

---

## 1. Project Summary

**Nestfolio** is an AI-managed investment platform for novice investors, built on an event-driven serverless architecture on AWS. It operates through a Platform + Licensed Partner model, with Interactive Brokers as the custodian/broker.

### Purpose

Nestfolio serves two purposes:

1. **Working prototype** — A fully functional system that validates the core value proposition: multiple specialized AI agents collaborate through a structured decision lifecycle to produce safe, auditable, explainable investment decisions.
2. **Reusable reference architecture** — The platform patterns (event-driven CQRS, multi-agent orchestration via AWS Bedrock AgentCore, deterministic compliance pipeline, multi-tenant DynamoDB, microfrontend PWA) are designed to transfer to other domains. The investment domain is the first implementation, not the only one.

### What This System Does

```
1. User signs up and completes a conversational onboarding flow
2. Onboarding captures goals, risk profile, operating mode → grants mandate
3. Mandate grant triggers the advisory-ctrl decision lifecycle
4. Multiple AI agents (Bedrock models, tiered by complexity) collaborate:
   - Analyze goals, assess risk, research market context
   - Construct target portfolio, plan rebalancing trades
   - Generate human-readable explanation ("Why?")
5. Decision Packet is composed and sent to compliance-ctrl
6. Compliance engine (deterministic, no LLM) approves or blocks
7. Approved decisions flow to execution (simulation or live broker)
8. User sees recommendation on dashboard, can drill into "Why?"
   - Agent attribution badges (which model produced what)
   - Expandable sections: Market Context, Risk Impact, Trades, Compliance
   - Audit footer: decision ID, model versions, trace link
9. Full event trace visible across 3 EventBridge buses
10. Runs as a PWA on mobile — full-screen, no browser chrome
```

### What We're Building

1. **Event-driven multi-agent architecture** — 3 domain buses, 14 services, end-to-end event flows
2. **AWS Bedrock AgentCore for agent orchestration** — managed runtimes, versioned deployments, gateway-based tool integration
3. **LangGraph.js inside AgentCore Runtimes** — graph-based multi-agent coordination with parallel execution waves
4. **Bedrock model tiering** — Opus for deep reasoning, Sonnet for balanced tasks, Haiku for simple extraction. Each agent declares its model tier in config.
5. **Deterministic compliance pipeline** — separate service, pure rule engine, no LLM
6. **Decision Detail screen** — the UX centerpiece: agent attribution, expandable reasoning, audit trail
7. **Observable system** — X-Ray traces, CloudWatch dashboards, structured logging across all services
8. **Mobile-first PWA** — Angular with at least one microfrontend remote via Native Federation

### What We're Deferring

- Licensed partner integration and regulatory compliance sign-off
- Real user onboarding and KYC/AML
- Production deployment (multi-AZ, DR, advanced security)
- IBKR live integration (see [07-production-next-steps.md](./07-production-next-steps.md))
- Performance optimization at scale
- Revenue collection and billing

---

## 2. Key Architectural Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| **AD-1** | **Nx v20+ monorepo** with Node.js 22 LTS, TypeScript 5.x, pnpm | Latest LTS versions; Nx provides build caching, affected commands, and generators for solo dev velocity |
| **AD-2** | **Angular (latest stable)** with microfrontend architecture | Microfrontends via Native Federation (esbuild-compatible). One shell host (`investor-web`) loads 3 MFE remotes — one per BFF (`portfolio-mfe`, `advisory-mfe`, `investor-mfe`). Each remote is deployed independently to its BFF's S3 bucket. Enables independent deployment per BFF. |
| **AD-3** | **AWS AppSync** for all BFF GraphQL APIs and real-time subscriptions | Provides built-in auth, subscriptions, and offline support. Multiple AppSync APIs (one per BFF). |
| **AD-4** | **LLM-powered agents from Phase 1** using Bedrock model tiering | Full LLM integration from the start to validate the AI value proposition. Bedrock models tiered by task complexity. Compliance is the sole exception — deterministic rule engine, no LLM. |
| **AD-5** | **Event-driven architecture** with 3 EventBridge buses | Domain isolation via bus-per-domain topology. All inter-service communication via events. Event schemas validated via Zod at publish time. |
| **AD-6** | **AWS CDK v2** for all infrastructure | Shared CDK constructs library for the 5-construct pattern (State, Ingress, Egress, Facade, AgentRuntime). |
| **AD-7** | **DynamoDB table-per-service** with single-table design patterns within each table, and event sourcing (EditEvents) | Each service owns its own DynamoDB table (e.g., `investor-bff-table`, `portfolio-bff-table`). Within each table, single-table design patterns are used: composite PK/SK keys (`{EntityType}#{tenantId}#{entityId}`), heterogeneous entity types colocated by access pattern, GSIs for cross-entity queries. This is **not** a global single-table for the entire system — it is table-per-service with single-table patterns inside. JSON Patch operations for audit trail. DynamoDB Streams CDC → EventBridge for change propagation. |
| **AD-8** | **AWS Bedrock AgentCore** for agent deployment and orchestration | Agent code (LangGraph.js) runs inside AgentCore Runtimes — managed, containerized, versioned. AgentCore handles compute scaling, lifecycle, and deployment. No direct Lambda/ECS/EKS for agent workloads. Gateways expose tools (DynamoDB, EventBridge, external APIs) via MCP protocol. Memory construct for agent context persistence. |
| **AD-9** | **AWS Cognito** for authentication | User pools with JWT. Auth integrated into both AppSync APIs and AgentCore Runtime endpoints. |
| **AD-10** | **Multi-tenancy from day one** | `tenant_id` in partition keys, event context, JWT claims, and ABAC policies. Higher near-term cost but avoids painful retrofit. |
| **AD-11** | **Regulatory deferred** | Technical platform first. Architecture supports compliance requirements (audit trails, decision packets, immutable events) but no compliance features implemented until partner acquisition. |
| **AD-12** | **VPC for IBKR connectivity** | Deferred to production phase. AgentCore Runtimes use public network by default; VPC configuration added when IBKR integration begins. |
| **AD-13** | **LangGraph.js (`@langchain/langgraph`) + `@langchain/aws`** for agent internals | LangGraph provides the graph-based multi-agent orchestrator running inside AgentCore Runtimes. `@langchain/aws` provides `ChatBedrockConverse` for Bedrock model invocation with structured output (`.withStructuredOutput(zodSchema)`). Single SDK for all model access. **Version pinning**: Pin both `@langchain/langgraph` and `@langchain/aws` to the latest stable version at project start (exact versions recorded in `pnpm-lock.yaml`). LangGraph.js has had breaking changes between minor versions — do not use `^` ranges. |
| **AD-14** | **Bedrock model tiering** — Opus for complex agents, Sonnet for balanced, Haiku for simple, Deterministic for compliance | All models accessed via Bedrock. Risk Assessment and Portfolio Construction use Claude Opus (deepest reasoning). Market Research, Rebalance Planner, and Explainability use Claude Sonnet (balanced). User & Goals uses Claude Haiku (fast, cheap — simple extraction task). Compliance Agent is deterministic (rule engine, no LLM). Model selection is config-driven, not code-driven. |
| **AD-15** | **PWA for mobile experience with offline support** | Angular PWA with `display: standalone` manifest. Full-screen, native-feeling experience when installed via "Add to Home Screen". Mobile-first responsive design throughout. **Offline behavior implemented in prototype**: cached portfolio data shown with staleness indicator, offline banner, read-only mode (no mutations), optimistic UI for confirmations with revert on reconnect failure. See [04-frontend.md § Offline Behavior](./04-frontend.md) for per-screen details. |
| **AD-16** | **Hybrid development: local fast loop + AWS integration testing** | Unit tests and agent pipeline tests run locally without AWS. Integration tests run against real AWS services in a dev account. Lambda handlers testable locally via test harness. No LocalStack dependency. |
| **AD-17** | **Mobile-first UI, conversational chat onboarding** | 7-step conversational chat flow with typing indicators, one question at a time, progressive disclosure. Mobile-first responsive design throughout. |
| **AD-18** | **Platform/domain library separation** | `libs/platform-core` contains reusable patterns ported from the `@event-lab/event-processor` library: BusEvent, Bus interface, EventBridgeBus, Pipe interface, UnitOfWork, TableRepository, EventRepository, BucketRepository, NotRetryableError, error handling (handleClientError, handleErrors), Highland.js stream processing, logger with `@log()` decorator, and Awilix DI container setup. `libs/domain-core` contains Nestfolio-specific types (investment events, agent schemas). When adapting to a new domain, copy `platform-core` and `cdk-constructs`, write new `domain-core`. |
| **AD-19** | **compliance-ctrl is the sole compliance authority** | No inline compliance check in the advisory-ctrl decision graph. advisory-ctrl runs the LLM agents, composes the Decision Packet, and publishes `DECISION_PACKET_CREATED` to advisory-hub. compliance-ctrl (separate service) receives the event, runs the deterministic rule engine, and publishes `DECISION_APPROVED` or `DECISION_BLOCKED`. Clean separation: advisory-ctrl owns AI reasoning, compliance-ctrl owns authorization. Compliance engine uses a rule registry pattern for extensibility across domains. |
| **AD-20** | **Event-carried state transfer for cross-domain data** | advisory-ctrl receives investor profile and portfolio snapshots as payload in the triggering event (e.g., `MANDATE_GRANTED`, `DRIFT_DETECTED`). No cross-domain DynamoDB reads, no cross-stack IAM roles. Clean domain boundaries. EventBridge 256KB limit noted — fallback to entity references + lookup if payloads grow. |
| **AD-21** | **Event schema governance via Zod — producer exports, consumer validates** | Event schemas are defined and exported by the producing service (in `libs/domain-core/{domain}/events.ts`), alongside the event type constants. Consumer services import these schemas and validate incoming events at ingestion time (in the Ingress handler, before passing to the pipeline). **Dual validation**: (1) Egress publisher validates at publish time — prevents malformed events from reaching the bus. (2) Ingress consumer validates at consumption time — protects against schema drift between producer and consumer deployments. Schema violations at publish time are hard errors (event not published). Schema violations at consumption time are logged, emitted as error events, and the message is sent to DLQ for investigation. |

---

## 3. Plan Structure

This master plan references the following sub-plans:

| Document | Scope |
|----------|-------|
| [01-foundation.md](./01-foundation.md) | Nx monorepo, shared libraries, CDK constructs (including AgentCore), CI/CD, dev environment |
| [02-backend-services.md](./02-backend-services.md) | All backend services across 3 domains, event flows, implementation order |
| [03-ai-agent-system.md](./03-ai-agent-system.md) | Bedrock AgentCore architecture, LangGraph.js agent internals, model tiering, decision lifecycle |
| [04-frontend.md](./04-frontend.md) | Angular PWA, microfrontend architecture (with at least one remote MFE), design system, screens |
| [05-testing-operations.md](./05-testing-operations.md) | Testing strategy, observability, deployment, X-Ray tracing |
| [06-seed-data.md](./06-seed-data.md) | Test personas (Maria/Luca/Sofia), seeded portfolios, decision scenarios, pipeline-based seeding |
| [07-production-next-steps.md](./07-production-next-steps.md) | IBKR integration, production hardening, regulatory path |

---

## 4. Implementation Phases

The implementation is organized into **5 phases** reflecting architectural completeness. Each phase is independently valuable as a reference.

### Phase 1 — Foundation

**Goal**: Buildable, testable, deployable monorepo with core infrastructure on real AWS.

| # | Deliverable |
|---|-------------|
| 1 | Nx monorepo scaffold (workspace, project configs, pnpm, TypeScript) |
| 2 | Shared `libs/platform-core` (BusEvent, TenantContext, UnitOfWork, Pipe interface, event schemas) |
| 3 | Shared `libs/domain-core` (Nestfolio-specific event types, domain models) |
| 4 | Shared `libs/cdk-constructs` (State, Ingress, Egress, Facade, AgentRuntime constructs) |
| 5 | Shared `libs/lambda-utils` (handler base, DI container, error types, idempotency) |
| 6 | 3 Event Hub services (investor-hub, advisory-hub, execution-hub) — EventBridge buses + cross-domain rules |
| 7 | CI/CD pipeline (GitHub Actions + OIDC + Nx affected + CDK deploy + pipeline.json per service) |
| 8 | Angular PWA shell scaffold + Cognito setup |
| 9 | CloudWatch billing alarm + AWS Budget monthly threshold |

### Phase 2 — Core Domain Services

**Goal**: Complete Investor and Execution domain services with one representative flow each, fully implemented (not stubbed).

| # | Area | Deliverable |
|---|------|-------------|
| 1 | Frontend | Landing page, Cognito auth flow |
| 2 | Frontend | Conversational chat onboarding (7-step, typing indicators) |
| 3 | Backend | `investor-web` — Cognito User Pool, auth triggers |
| 4 | Backend | `investor-bff` — onboarding flow, profile creation, mandate grant, notifications inbox |
| 5 | Backend | `investor-ctrl` — one complete notification pipeline flow (Step Functions) |
| 6 | Backend | `execution-ctrl` — order lifecycle orchestration (Step Functions) |
| 7 | Backend | `execution-adpt` — simulation engine (virtual ledger, virtual cash, simulated fills) |
| 8 | Backend | `portfolio-bff` — portfolio projection, dashboard data |
| 9 | Backend | `portfolio-ctrl` — one complete reconciliation pipeline (drift detection) |

### Phase 3 — AI Agent System

**Goal**: Full multi-agent decision lifecycle via Bedrock AgentCore, with real LLM invocations, compliance validation, and end-to-end event flow.

| # | Area | Deliverable |
|---|------|-------------|
| 1 | Agents | `libs/agent-core` — LangGraph.js graph definitions, prompt templates, Zod output schemas |
| 2 | Infra | AgentCore Runtime deployment (containerized LangGraph agent) |
| 3 | Infra | AgentCore Gateway with tool targets (DynamoDB lookup, EventBridge publish) |
| 4 | Backend | `advisory-ctrl` — event listener triggers AgentCore Runtime, handles compliance callbacks |
| 5 | Backend | `compliance-ctrl` — deterministic rule engine with extensible rule registry |
| 6 | Backend | `advisory-bff` — recommendation projections, "Why?" view, confirmation flow |
| 7 | Integration | End-to-end: mandate grant → agent pipeline → compliance → execution → portfolio update |

### Phase 4 — Frontend & UX

**Goal**: Complete user-facing application with at least one microfrontend remote, mobile-first design, and the Decision Detail screen.

| # | Deliverable |
|---|-------------|
| 1 | Design system component library (`libs/ui-components`) |
| 2 | Dashboard with portfolio value, recommendations, real-time subscriptions |
| 3 | **Decision Detail screen** — agent attribution, expandable sections, audit footer |
| 4 | All 3 microfrontend remotes via Native Federation (`portfolio-mfe`, `advisory-mfe`, `investor-mfe`) |
| 5 | PWA manifest, service worker, offline-aware patterns |
| 6 | Mobile-first responsive polish across all screens |

### Phase 5 — Observability & Hardening

**Goal**: Production-grade observability, seed data pipeline, and system validation.

| # | Deliverable |
|---|-------------|
| 1 | X-Ray tracing across all services and AgentCore Runtimes |
| 2 | CloudWatch dashboards (Operations, Compliance, AI Governance) |
| 3 | Seed data pipeline — invokes real agent pipeline to generate decision packets |
| 4 | Event schema validation enforcement (Zod schemas at publish time) |
| 5 | E2E testing (Playwright) for critical user flows |
| 6 | Performance baseline and cold start optimization |

Post-prototype phases (IBKR sandbox integration, production hardening, regulatory path) are documented in [07-production-next-steps.md](./07-production-next-steps.md).

---

## 5. Critical Path & Dependencies

```
cdk-constructs (State, Ingress, Egress, Facade, AgentRuntime)
    │
    ▼
platform-core + domain-core (event types, schemas, tenant context)
    │
    ▼
agent-core (LangGraph.js graph definitions, prompt templates, Zod schemas)
    │
    ▼
AgentCore Runtime deployed (containerized agent + Gateway tools)
    │
    ▼
advisory-ctrl (event listener → Runtime invocation → compliance handoff)
    │
    ├──▶ compliance-ctrl (deterministic rule engine, sole compliance authority — AD-19)
    │
    ▼
Decision Detail screen (agent attribution, expandable reasoning, audit footer)
```

The critical path is a straight line. Everything else can be parallelized around it.

**Why this is the critical path**:
- `cdk-constructs` blocks all service and agent deployment
- `platform-core` + `domain-core` define the event contracts everything communicates through
- `agent-core` blocks all agent development — graph definitions, prompt templates, output schemas
- AgentCore Runtime deployment validates the entire agent infrastructure (managed compute, Bedrock access, tool gateway)
- `advisory-ctrl` is the core of the product — if the decision lifecycle doesn't work end-to-end, the system has no value
- `compliance-ctrl` is the sole compliance authority (AD-19) — must approve before execution
- Decision Detail is the UX proof that the architecture produces value the user can see and understand

---

## 6. Milestone Definitions

### M1: Foundation on AWS

- [ ] Nx monorepo builds and tests successfully
- [ ] All shared libraries published to workspace (`platform-core`, `domain-core`, `cdk-constructs`, `lambda-utils`)
- [ ] 3 Event Hub stacks deployed to AWS dev account
- [ ] CI/CD pipeline runs Nx affected on push
- [ ] Angular PWA shell loads with Cognito auth
- [ ] At least one Lambda handler deploys and processes a test event
- [ ] Event schema validation works (Zod schema check at publish time and consumption time)
- [ ] CloudWatch billing alarm and AWS Budget monthly threshold configured

### M2: Core Services End-to-End

- [ ] User can sign up via Cognito
- [ ] Onboarding chat flow captures goals, risk profile, operating mode
- [ ] Mandate grant publishes event to EventBridge
- [ ] Execution simulation engine processes orders (virtual ledger, simulated fills)
- [ ] Portfolio projection updates from execution events
- [ ] One complete notification pipeline flow works (investor-ctrl)
- [ ] One complete reconciliation pipeline flow works (portfolio-ctrl)

### M3: AI Agent Pipeline

- [ ] AgentCore Runtime deployed with containerized LangGraph agent
- [ ] Gateway exposes tool targets (DynamoDB lookup, EventBridge publish)
- [ ] Mandate grant triggers advisory-ctrl → AgentCore Runtime invocation
- [ ] Multiple Bedrock models (Opus/Sonnet/Haiku) produce agent proposals
- [ ] Decision Packet is composed and persisted
- [ ] compliance-ctrl deterministic engine approves/blocks decisions
- [ ] Full event trace visible in X-Ray across all 3 buses + agent Runtime
- [ ] Seed data pipeline invokes real agent pipeline to generate decision packets

### M4: Complete Application

- [ ] Dashboard shows portfolio value and recommendations
- [ ] Decision Detail screen shows agent attribution badges
- [ ] Expandable sections work: Market Context, Risk Impact, Trades, Compliance
- [ ] Audit footer displays decision ID, model versions, trace link
- [ ] All 3 microfrontend remotes loaded via Native Federation (`portfolio-mfe`, `advisory-mfe`, `investor-mfe`)
- [ ] PWA installs via "Add to Home Screen" on mobile (full-screen standalone)
- [ ] Conversational chat onboarding works smoothly
- [ ] Real-time subscription updates on dashboard

### M5: Observable & Validated

- [ ] X-Ray traces show complete decision flows across services and agent Runtimes
- [ ] CloudWatch dashboards operational (Operations, Compliance, AI Governance)
- [ ] E2E tests pass for onboarding, decision lifecycle, and dashboard flows
- [ ] Seed data produces 3 realistic persona scenarios via real pipeline
- [ ] No console errors, no blank screens, no unhandled loading states
- [ ] Performance acceptable on mobile (no jarring delays)

---

## 7. Completion Criteria

The prototype is complete when all patterns are implemented and validated end-to-end.

### Architecture Patterns (must all be working)

- [ ] Event-driven CQRS with 3 EventBridge buses and cross-domain forwarding
- [ ] DynamoDB single-table design with event sourcing (EditEvents + JSON Patch)
- [ ] Multi-agent orchestration via Bedrock AgentCore (Runtime + Gateway + Memory)
- [ ] LangGraph.js StateGraph with parallel execution waves inside AgentCore Runtime
- [ ] Bedrock model tiering (Opus/Sonnet/Haiku) with config-driven selection
- [ ] Deterministic compliance pipeline with extensible rule registry
- [ ] Multi-tenant isolation (tenant_id enforced at every layer)
- [ ] Event schema governance (Zod validation at publish time)
- [ ] All 3 microfrontend remotes via Native Federation
- [ ] PWA with offline support (cached data, staleness indicator, offline banner, read-only mode)

### Functional Flows (must all work end-to-end)

- [ ] Sign up → onboard → mandate grant → decision lifecycle → execution → portfolio update
- [ ] Decision Detail "Why?" screen with agent attribution and expandable reasoning
- [ ] Notification delivery for decision outcomes
- [ ] Drift detection → reconciliation → rebalance trigger
- [ ] Real-time dashboard updates via AppSync subscriptions

### Operational Readiness

- [ ] X-Ray tracing across all services and AgentCore Runtimes
- [ ] CloudWatch dashboards with key metrics
- [ ] Seed data generated through real pipeline (not hardcoded)
- [ ] CI/CD pipeline deploys affected services on merge

---

## 8. Constraints & Assumptions

### Constraints

1. **Solo developer**: All work done by one person with AI assistance. No delegation to other humans.
2. **Prototype with reuse intent**: This is a working prototype, not a production product. However, patterns must be complete enough to copy to other domains. No hollow stubs — each service implements at least one representative flow properly.
3. **LangGraph.js dependency**: LangGraph.js (`@langchain/langgraph`) is a stable, actively maintained framework backed by LangChain Inc. Runs inside AgentCore Runtime containers. Mitigate version risk by pinning to exact versions.
4. **AgentCore alpha status**: `@aws-cdk/aws-bedrock-agentcore-alpha` is experimental. API may change. Acceptable for a prototype — using the latest AWS primitives is part of the point.
5. **LLM non-determinism**: Bedrock model outputs are probabilistic. All outputs must be validated against Zod schemas and bounded by deterministic guardrails. Compliance Agent is fully deterministic (no LLM).
6. **Hybrid development model**: Unit tests and agent logic run locally. Integration tests run against real AWS. No LocalStack.

### Assumptions

1. AWS account is available with appropriate permissions (AdministratorAccess for dev)
2. AWS Bedrock access is available for Claude (Opus/Sonnet/Haiku) and optionally Mistral Small, with sufficient throughput
3. AgentCore is available in the target AWS region (check availability before starting)
4. GitHub is available for source control and CI/CD
5. A mobile device (Android or iOS) is available for PWA testing
6. The event-processing patterns from `@event-lab/event-processor` will be ported into `libs/platform-core` during Phase 1. The library provides: Bus/EventBridgeBus, Pipe/UnitOfWork stream processing (Highland.js), TableRepository/EventRepository/BucketRepository, NotRetryableError/handleClientError error classification, structured logger with `@log()` decorator, and Awilix DI container integration. These patterns are adapted (not imported as a dependency) to keep Nestfolio self-contained.

---

## 9. Cross-References

| Topic | Document |
|-------|----------|
| Monorepo structure, CDK constructs (including AgentCore), CI/CD | [01-foundation.md](./01-foundation.md) |
| Service implementations, event flows, DynamoDB design | [02-backend-services.md](./02-backend-services.md) |
| Bedrock AgentCore agents, LangGraph.js, model tiering, decision lifecycle | [03-ai-agent-system.md](./03-ai-agent-system.md) |
| Angular PWA, microfrontend architecture, design system | [04-frontend.md](./04-frontend.md) |
| Testing, observability, X-Ray tracing, deployment | [05-testing-operations.md](./05-testing-operations.md) |
| Test personas, seed data, pipeline-based seeding | [06-seed-data.md](./06-seed-data.md) |
| IBKR integration, production hardening, regulatory path | [07-production-next-steps.md](./07-production-next-steps.md) |
| Original specifications | [../specifications/](../specifications/) |

---

*This plan defines the strategy for building Nestfolio as a working prototype and reusable reference architecture. Every pattern — event-driven CQRS, multi-agent orchestration, deterministic compliance, microfrontend PWA — is implemented completely enough to serve as a starting point for future projects in any domain.*
