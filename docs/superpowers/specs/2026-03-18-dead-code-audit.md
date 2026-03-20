# Dead Code Audit — 2026-03-18

## Summary

| Category | Dead Items | Impact |
|----------|-----------|--------|
| Domain barrel exports | 10 types/interfaces | Low — unused cross-domain types |
| Orphaned source files | 49 files | High — entire files never imported |
| Shared lib unused exports | ~279 exports (65% of total) | Medium — bloated public API surface |
| Unused GraphQL definitions | 31 query/fragment exports | Medium — stale client definitions |
| Dead CDK stack files | 4 files | High — duplicate stacks in wrong dirs |
| Unused CDK construct | 1 (KnowledgeBase) | Low — never instantiated |
| Unused CDK props | 4 props across 2 constructs | Low |
| Duplicate type definitions | 2 types (ProposedTrade 4x, FillResult 2x) | Medium — maintenance risk |
| Test-only validation utils | 3 functions | Low |

---

## 1. Dead Domain Barrel Exports

### advisory-adpt/src/domain/index.ts
| Export | Why Dead |
|--------|----------|
| `DecisionStatus` | Never imported — consumers redefine locally |
| `ComplianceLevel` | Never imported |
| `ComplianceResult` | Never imported |
| `ComplianceCheck` | Never imported — advisory-mfe redefines locally |

### execution-adpt/src/domain/index.ts
| Export | Why Dead |
|--------|----------|
| `ExecutionAdptEventTypes` | Never imported (only `ExecutionCrossDomainEventTypes` is used) |
| `ExecutionAdptEventType` | Type alias never imported |
| `OrderFilledEvent` | Never imported by any consumer |
| `DepositDetectedEvent` | Never imported by any consumer |

### investor-adpt/src/domain/index.ts
| Export | Why Dead |
|--------|----------|
| `MandateLevel` | Redefined locally in investor-bff models |
| `RebalanceCadence` | Never imported outside investor-adpt |

---

## 2. Orphaned Source Files (49 files)

### Frontend Services (6 files — never imported)
- `apps/dashboard-mfe/src/app/services/dashboard.service.ts`
- `apps/investor-mfe/src/app/services/notification.service.ts`
- `apps/investor-mfe/src/app/services/onboarding.service.ts`
- `apps/advisory-mfe/src/app/services/advisory.service.ts`
- `apps/ledger-mfe/src/app/services/comparison.service.ts`
- `apps/ledger-mfe/src/app/services/time-travel.service.ts`

### libs/event-processor (14 files)
Utility functions, repositories, pipelines, and middleware components that are exported from barrels but the individual files are never directly imported.

### libs/ui-components (9 files)
Angular components (pipes, badges, layouts) scaffolded but not yet integrated into consuming apps.

### libs/shared-state (7 files)
Store features and utilities not yet wired into applications.

### libs/command-core (6 files)
Order/ledger command implementations.

### libs/appsync-client (4 files)
Per-BFF GraphQL query definition files.

### Service-level (3 files)
- Advisory-ctrl golden test fixtures (2 files)
- Dashboard-bff simulation summary pipe (1 file)

---

## 3. Shared Lib Unused Exports (~279 exports)

### event-processor — 100 of 144 exports unused
Sub-barrel exports (`platform/`, `lambda/`, `domain/`) are re-exported from main barrel but many individual symbols have no external consumers. Key unused:
- `createDynamoRepository`, `createS3Repository` — repository factories
- `withRetry`, `withCircuitBreaker` — resilience middleware
- `createPipeline` — pipeline factory
- Various platform types and FP utilities

### cdk-constructs — 35 of 55 exports unused
- `KnowledgeBase` construct (never instantiated)
- Most `*Props` interfaces (TypeScript structural typing means they don't need explicit import)
- `enableWaf`, `wafRateLimit` on Facade props (defined but never read in constructor)
- `maxRetries`, `maxBatchingWindowMs` on Ingress props (superseded by other props)

### command-core — 19 of 29 exports unused
- Unused command schemas and types for order/ledger operations

### agent-core — 13 of 19 exports unused
- Legacy validation patterns (`ValidationError`, `buildEscalationPath`)
- Unused agent configuration types

### appsync-client — 1 of 4 barrel exports unused
- `AppSyncConfig` type

### i18n — 1 of 3 exports unused
- `Locale` type

---

## 4. Unused GraphQL Definitions (31 exports)

### ledger-bff.queries.ts (7)
`GET_BALANCE`, `GET_PORTFOLIO`, `GET_POSITIONS`, `GET_PERFORMANCE`, `GET_ORDER_HISTORY`, `PORTFOLIO_FIELDS`, `POSITION_FIELDS`

### dashboard-bff.queries.ts (7)
`PORTFOLIO_SUMMARY_FIELDS`, `POSITION_SNAPSHOT_FIELDS`, `ACTIVITY_ENTRY_FIELDS`, `ADVISORY_STATUS_FIELDS`, `INVESTOR_SNAPSHOT_FIELDS`, `DASHBOARD_FIELDS`, `ON_DASHBOARD_UPDATE`

### investor-bff.queries.ts (11)
`GET_PROFILE`, `GET_GOALS`, `PROFILE_FIELDS`, `GOAL_FIELDS`, `INITIATE_DEPOSIT`, `REQUEST_WITHDRAWAL`, `REQUEST_ACCOUNT_CLOSURE`, `MANDATE_FIELDS`, `UPDATE_MANDATE`, `REVOKE_MANDATE`, `NOTIFICATION_FIELDS`, `UPDATE_GOAL`

### advisory-bff.queries.ts (5)
`DECISION_FIELDS`, `AGENT_INVOCATION_FIELDS`, `COMPLIANCE_CHECK_FIELDS`, `GET_DECISION_HISTORY`, `GET_PENDING_DECISIONS`

---

## 5. Dead CDK Infrastructure

### Dead Stack Files (4 — duplicates in wrong directory)
- `services/advisory/investor-profile-ctrl/stacks/service.stack.ts`
- `services/advisory/portfolio-engine-ctrl/stacks/service.stack.ts`
- `services/advisory/advisory-narrative-ctrl/stacks/service.stack.ts`
- `services/advisory/market-intelligence-ctrl/stacks/service.stack.ts`

Each has an active counterpart in `src/` that's actually used.

### Unused Construct
- `libs/cdk-constructs/src/knowledge-base.ts` — Bedrock KnowledgeBase, ~70 lines, never instantiated

### Unused Construct Props
- **Facade**: `enableWaf`, `wafRateLimit` — defined but never read in constructor
- **Ingress**: `maxRetries`, `maxBatchingWindowMs` — superseded/unused

---

## 6. Duplicate Type Definitions

| Type | Locations |
|------|-----------|
| `ProposedTrade` | advisory-adpt/domain, advisory-ctrl/service-domain, portfolio-engine-ctrl/service-domain, ledger-ctrl/shadow-fill.service |
| `FillResult` | ledger-ctrl/shadow-fill.service, broker-adpt/simulation-engine.service |

---

## 7. Test-Only Validation Utils

**File:** `services/advisory/advisory-ctrl/src/agents/validation.ts`
- `getValidationConfig()` — only referenced in tests
- `isValidTicker()` — only referenced in tests
- `VALIDATION_RULES` — only referenced in tests

---

## Recommended Cleanup Priority

1. **High**: Delete 4 dead stack files in `stacks/` directories
2. **High**: Remove 6 orphaned frontend service files (replaced by stores)
3. **Medium**: Clean up 31 unused GraphQL query definitions
4. **Medium**: Remove 10 dead domain barrel exports
5. **Medium**: Consolidate `ProposedTrade` to single source of truth
6. **Low**: Prune unused shared lib exports (tree-shaking handles this at build time)
7. **Low**: Remove unused CDK construct props and KnowledgeBase construct
8. **Low**: Move test-only validation utils to test helpers
