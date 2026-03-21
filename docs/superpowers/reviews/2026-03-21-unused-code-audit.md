# Unused Code Audit - Services Directory

**Date:** 2026-03-21
**Scope:** `/services/` (14 services across 4 domains)
**Method:** Grepped every exported symbol against the entire project; only listing items found in 1 file (definition only) or definition + barrel re-export only.

---

## 1. Unused Type Exports - EventType Unions (19 items)

Every service defines a union type like `export type XxxEventType = ...` that is exported via the barrel `index.ts` but never imported by any consumer. The constituent `const` object (e.g., `LedgerCtrlEventTypes`) IS used; only the union type alias is dead.

| Service | File | Line | Symbol |
|---|---|---|---|
| ledger-ctrl | `services/ledger/ledger-ctrl/src/domain/events.ts` | 9 | `LedgerCtrlEventType` |
| ledger-adpt | `services/ledger/ledger-adpt/src/domain/events.ts` | 17 | `LedgerCrossDomainEventType` |
| reconciliation-ctrl | `services/ledger/reconciliation-ctrl/src/domain/events.ts` | 13 | `ReconciliationEventType` |
| broker-adpt | `services/execution/broker-adpt/src/domain/events.ts` | 19 | `ExecutionAdptEventType` |
| execution-ctrl | `services/execution/execution-ctrl/src/domain/events.ts` | 8 | `ExecutionCtrlEventType` |
| execution-adpt | `services/execution/execution-adpt/src/domain/events.ts` | 25 | `ExecutionCrossDomainEventType` |
| investor-adpt | `services/investor/investor-adpt/src/domain/events.ts` | 19 | `InvestorCrossDomainEventType` |
| investor-ctrl | `services/investor/investor-ctrl/src/domain/events.ts` | 8 | `InvestorCtrlEventType` |
| onboarding-agent-bff | `services/investor/onboarding-agent-bff/src/domain/events.ts` | 4 | `OnboardingEventType` |
| investor-bff | `services/investor/investor-bff/src/domain/events.ts` | 27 | `InvestorBffEventType` |
| investor-profile-ctrl | `services/advisory/investor-profile-ctrl/src/domain/events.ts` | 8 | `InvestorProfileEventType` |
| compliance-ctrl | `services/advisory/compliance-ctrl/src/domain/events.ts` | 12 | `ComplianceEventType` |
| advisory-adpt | `services/advisory/advisory-adpt/src/domain/events.ts` | 22 | `AdvisoryCrossDomainEventType` |
| advisory-ctrl | `services/advisory/advisory-ctrl/src/domain/events.ts` | 37 | `AdvisoryCtrlEventType` |
| decision-workflow-ctrl | `services/advisory/decision-workflow-ctrl/src/domain/events.ts` | 24 | `DecisionWorkflowEventType` |
| portfolio-engine-ctrl | `services/advisory/portfolio-engine-ctrl/src/domain/events.ts` | 8 | `PortfolioEngineEventType` |
| advisory-narrative-ctrl | `services/advisory/advisory-narrative-ctrl/src/domain/events.ts` | 7 | `NarrativeEventType` |
| advisory-bff | `services/advisory/advisory-bff/src/domain/events.ts` | 7 | `AdvisoryBffEventType` |
| market-intelligence-ctrl | `services/advisory/market-intelligence-ctrl/src/domain/events.ts` | 6 | `MarketIntelligenceEventType` |

---

## 2. Unused Type Exports - Domain Model Interfaces (7 items)

These interfaces/types are exported but never imported anywhere in the project.

| Service | File | Line | Symbol |
|---|---|---|---|
| investor-profile-ctrl | `services/advisory/investor-profile-ctrl/src/domain/models.ts` | 1 | `InvestorProfileInput` |
| investor-profile-ctrl | `services/advisory/investor-profile-ctrl/src/domain/models.ts` | 24 | `InvestorProfileResult` |
| decision-workflow-ctrl | `services/advisory/decision-workflow-ctrl/src/domain/models.ts` | 34 | `AgentTriggerPayload` |
| decision-workflow-ctrl | `services/advisory/decision-workflow-ctrl/src/domain/models.ts` | 41 | `AgentCompletionPayload` |
| market-intelligence-ctrl | `services/advisory/market-intelligence-ctrl/src/domain/models.ts` | 1 | `MarketAnalysisInput` |
| market-intelligence-ctrl | `services/advisory/market-intelligence-ctrl/src/domain/models.ts` | 8 | `MarketSignal` |
| market-intelligence-ctrl | `services/advisory/market-intelligence-ctrl/src/domain/models.ts` | 24 | `FeedContent` |

---

## 3. Unused Type Exports - Non-Domain Files (7 items)

Exported types in handler/construct/repository files that exist only in their definition file.

| Service | File | Line | Symbol |
|---|---|---|---|
| onboarding-agent-bff | `services/investor/onboarding-agent-bff/src/agent/graph.ts` | 13 | `GraphDeps` |
| onboarding-agent-bff | `services/investor/onboarding-agent-bff/src/agent/phase-node.ts` | 6 | `PhaseNodeDeps` |
| decision-workflow-ctrl | `services/advisory/decision-workflow-ctrl/src/repositories/decision-packet.repository.ts` | 11 | `CreateDecisionPacketInput` |
| decision-workflow-ctrl | `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts` | 8 | `DecisionStateMachineProps` |
| decision-workflow-ctrl | `services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts` | 11 | `AssemblePacketDeps` |
| portfolio-engine-ctrl | `services/advisory/portfolio-engine-ctrl/src/handlers/tools/portfolio-lookup.ts` | 4 | `PortfolioLookupDeps` |
| sec-edgar-adpt | `services/advisory/sec-edgar-adpt/src/clients/edgar-api.ts` | 12 | `EdgarSubmissions` |

---

## 4. Unused Type Exports - Zod-inferred Types (1 item)

| Service | File | Line | Symbol |
|---|---|---|---|
| onboarding-agent-bff | `services/investor/onboarding-agent-bff/src/domain/schemas.ts` | 6 | `OnboardingPhase` |

---

## 5. Dead Source Files (2 items)

Entire files whose exports are never imported by any other `.ts` file.

| Service | File | Description |
|---|---|---|
| dashboard-bff | `services/investor/dashboard-bff/src/pipes/simulation-summary.pipe.ts` | `SimulationSummaryPipe` class -- not wired into any event listener or test |
| advisory-ctrl | `services/advisory/advisory-ctrl/src/agents/fixtures/golden-contexts.ts` | 5 exported fixture constants (`MODERATE_INVESTOR_CONTEXT`, etc.) -- never imported |

---

## 6. Unused Repository Methods

**None found.** All 100+ repository methods are referenced in at least one handler, resolver, or test file.

## 7. Unused Handler/Resolver Functions

**None found.** All exported handler and resolver functions are referenced in CDK stacks or tests.

## 8. Dead Imports

**None confirmed.** All imports in service source files are consumed in their file bodies.

---

## Summary

| Category | Count |
|---|---|
| Unused EventType union types | 19 |
| Unused domain model interfaces | 7 |
| Unused non-domain type exports | 7 |
| Unused Zod-inferred types | 1 |
| Dead source files | 2 |
| **Total unused items** | **36** |
