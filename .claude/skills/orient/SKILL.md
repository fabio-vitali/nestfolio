---
name: orient
description: Full system orientation — domains, services, libs, frontend, infrastructure. Use when you need to understand the Nestfolio system broadly.
---

## When This Skill Applies
- Starting a new conversation and need system context
- Asked to explain the architecture
- Need to understand how components relate before making changes

## System Overview

Nestfolio is a robo-advisory investment platform. 4 DDD domains, 33 services, event-driven serverless on AWS.

### Domains & Services

**Advisory** (15 services) — Investment decision-making
- `advisory-ctrl` — Domain orchestrator
- `advisory-bff` — BFF for advisory UI features
- `advisory-hub` — Event aggregation/projection store
- `advisory-adpt` — Cross-domain event ingestion (Investor, Execution, Ledger → Advisory)
- `decision-workflow-ctrl` — 5-phase decision cycle orchestrator (Step Functions + LangGraph agents)
- `advisory-narrative-ctrl` — Decision narrative generation
- `compliance-ctrl` — Compliance rule checking
- `investor-profile-ctrl` — Investor risk/preference profile management
- `market-intelligence-ctrl` — Market data analysis and signals
- `portfolio-engine-ctrl` — Portfolio optimization calculations
- `alpha-vantage-adpt` — Alpha Vantage market data ingestion
- `fred-adpt` — FRED economic data ingestion
- `marketwatch-adpt` — MarketWatch data ingestion
- `sec-edgar-adpt` — SEC EDGAR filings ingestion
- `yahoo-finance-adpt` — Yahoo Finance data ingestion

**Execution** (6 services) — Order routing and lifecycle
- `execution-ctrl` — Execution orchestrator
- `execution-hub` — Event aggregation/projection store
- `execution-adpt` — Cross-domain event ingestion (Advisory, Investor → Execution)
- `broker-ctrl` — Broker routing state machine (order lifecycle orchestration)
- `broker-sim-adpt` — Simulated broker (paper trading)
- `broker-alpaca-adpt` — Alpaca live broker integration + circuit breaker owner (HealStateMachine, EB Connection)

**Investor** (7 services) — Investor management and UI
- `investor-ctrl` — Investor entity management
- `investor-bff` — Investor portal BFF
- `investor-hub` — Event aggregation/projection store
- `investor-adpt` — Cross-domain event ingestion (Advisory, Execution, Ledger → Investor)
- `dashboard-bff` — Dashboard BFF
- `onboarding-bff` — Onboarding wizard (LangGraph + CopilotKit, 7-phase)
- `investor-web` — Angular PWA frontend (Native Federation host)

**Ledger** (5 services) — Financial record-keeping
- `ledger-ctrl` — Financial ledger management
- `ledger-bff` — Ledger reporting BFF
- `ledger-hub` — Event aggregation/projection store
- `ledger-adpt` — Cross-domain event ingestion (Execution → Ledger)
- `reconciliation-ctrl` — Balance reconciliation

### Shared Libraries
- `libs/event-processor` — SQS ingestion + DDB Stream CDC pipelines, test harnesses
- `libs/cdk-constructs` — ServiceStack base class + 6 constructs (State/Ingress/Egress/Facade/Orchestration in core/, AgentRuntime in extensions/)
- `libs/agent-orchestrator` — Bedrock agent orchestration
- `libs/shell` — Angular shell for MFE host
- `libs/ui` — Shared UI component library
- `libs/event-types` — Branded EventName type and compile-time event name safety
- `libs/integration-testing` — Integration test fixtures (EventBusTrap, TableAssertions, MockApiFixture, resilience helpers)
- `libs/test-support` — Shared test infrastructure (TestContext, CognitoFixture, EventBridgeClient, AppSyncClient)

### Frontend Apps (Micro-Frontends)
- `apps/nestfolio-host` — Angular shell host (Native Federation)
- `apps/advisory-mfe` — Advisory domain micro-frontend
- `apps/dashboard-mfe` — Dashboard micro-frontend
- `apps/investor-mfe` — Investor domain micro-frontend
- `apps/ledger-mfe` — Ledger domain micro-frontend
- `apps/onboarding-mfe` — Onboarding wizard micro-frontend

### Service Naming Convention
| Suffix | Role | Has State? |
|--------|------|-----------|
| `-ctrl` | Domain logic, orchestration | Yes |
| `-bff` | Backend-for-Frontend (GraphQL/REST) | Yes |
| `-hub` | Event aggregation, projection store | Yes |
| `-adpt` | Cross-domain event ingestion OR external integration | No (ingestion) / Yes (external) |

### Communication Pattern
```
Producer service → DynamoDB write → DDB Stream (CDC) → Egress Lambda → EventBridge
  → [same domain] SQS → Ingress Lambda → Consumer service
  → [cross domain] Consumer adapter deploys EB rule on producer's bus → Consumer's EventBridge → SQS → Ingress Lambda
```

### Key File Paths
| What | Where |
|------|-------|
| Service stack | `services/{domain}/{svc}/src/service.stack.ts` |
| Service handlers | `services/{domain}/{svc}/src/handlers/` |
| Event types | `services/{domain}/{svc}/src/domain/events.ts` |
| Service tests | `services/{domain}/{svc}/test/` |
| Service config | `services/{domain}/{svc}/project.json` |
| CDK constructs | `libs/cdk-constructs/src/core/` |
| Pipeline types | `libs/event-processor/src/pipelines/` |
| Test harnesses | `libs/event-processor/src/testing/` |
| Service card | `services/{domain}/{svc}/CLAUDE.md` |
| Flow specs | `flows/*.flow.yaml` |

## Anti-Patterns
- NEVER import from `services/` — only from `libs/`
- NEVER call between services via API — events only
- NEVER write raw Lambda handlers — use event-processor pipelines
- NEVER hand-edit service cards — run `audit-service` to regenerate
