# Onboarding Isolation Design

**Date:** 2026-03-24
**Status:** Draft
**Scope:** Isolate onboarding-bff (formerly onboarding-agent-bff) with its own DynamoDB table, onboarding-native domain model, single fat event to investor-bff, new onboarding-mfe, and shell routing guards.

## Problem

`onboarding-agent-bff` shares `investor-bff`'s DynamoDB table via SSM lookup. This violates the rule that services must never share internal resources. It also causes:

1. **Partial state pollution** — each onboarding phase writes investor entities directly (Goal, RiskProfile, etc.). If the user abandons mid-flow, half-baked entities persist in investor-bff's table and CDC fires premature events to downstream services.
2. **Schema coupling** — onboarding-agent-bff duplicates investor-bff's entity schemas (Goal, RiskProfile, Mandate, etc.) and writes them in investor-bff's key patterns.
3. **No domain boundary** — onboarding-agent-bff has no Egress, publishes no events. `ONBOARDING_STARTED` and `ONBOARDING_COMPLETED` are defined as stubs but never emitted.
4. **SSM exposure** — the investor hub stack exports its table name to SSM (`/${prefix}/investor-hub/table-name`), exposing an internal resource.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Event payload | Fat event — full raw onboarding data | Self-contained, no cross-service queries |
| Event emission | CDC via Egress construct | Consistent with all other services, built-in retries/DLQ |
| Payload vocabulary | Onboarding-native (raw) | Producer publishes what it knows; consumer interprets |
| Routing guard | Shell-level | Single decision point, avoids duplication across MFEs |
| InvestorProfile lifecycle | Shell profile on USER_REGISTERED, enriched on ONBOARDING_COMPLETED | Harmless anchor; onboardingCompletedAt flag drives guard |
| Service rename | onboarding-agent-bff → onboarding-bff | Aligns with BFF naming convention |
| Domain model | Full separation — onboarding-native schemas | No investor entity shapes in onboarding-bff |
| Risk scoring authority | investor-bff | Onboarding collects raw indices; investor-bff computes authoritative RiskProfile |

## Architecture

### Event Flow

```
User completes onboarding (phase 7: mandate accepted)
  → onboarding-bff writes OnboardingCompleted record to own table
  → DynamoDB Stream triggers Egress CDC handler
  → CDC publishes ONBOARDING_COMPLETED to investor EventBridge bus
  → investor-bff Ingress consumes event
  → investor-bff handler: transactWrite creates all domain entities atomically
  → investor-bff CDC fires: GOAL_CREATED, RISK_PROFILE_CREATED, MANDATE_GRANTED, OPERATING_MODE_SELECTED
  → downstream services see a fully formed investor
  → investor-ctrl consumes ONBOARDING_COMPLETED → welcome notification
```

### Frontend Flow

```
User authenticates
  → shell authStore loads profile (includes onboardingCompletedAt)
  → onboardingCompletedAt is null?
    → YES: onboardingPendingGuard routes to /onboarding → onboarding-mfe
    → NO:  onboardingCompletedGuard allows /dashboard, /investor, etc.
```

## Section 1: onboarding-bff Internal Domain Model

onboarding-bff uses a single `OnboardingSession` aggregate that accumulates phase data in its own vocabulary. No investor entity shapes.

### DynamoDB Model (onboarding-bff's own table)

```
pk: OnboardingSession#{tenantId}#{userId}
sk: OnboardingSession#{sessionId}

{
  __typename: 'OnboardingSession',
  status: 'in_progress' | 'completed' | 'abandoned',
  currentPhase: 'goal' | 'horizon' | 'mode' | 'capital' | 'risk' | 'operating_mode' | 'mandate' | 'completed',
  phaseIndex: number,

  phases: {
    goal?: { objective: string },
    horizon?: { years: number },
    mode?: { accountMode: 'simulation' | 'live' },
    capital?: { amount: number, currency: string },
    risk?: { toleranceIdx: number, experienceIdx: number, score: number, category: string },
    operatingMode?: { mode: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE' },
    mandate?: { accepted: boolean }
  },

  agentMemorySessionId: string,
  startedAt: string,
  completedAt?: string,
  ttl: number  // 7-day expiry
}
```

### Changes from Current Model

- Single item per session replaces 6 separate entity records (Goal, RiskProfile, AccountMode, OperatingModeRecord, Mandate, OnboardingSession)
- `phases` map accumulates data — each `commit_phase` call updates one key
- `commit_phase` becomes a single `UpdateItem`: `SET phases.#phase = :data, currentPhase = :next, phaseIndex = :idx`
- Session rehydration is one `GetItem` — returns everything
- No schema coupling to investor-bff entity shapes

### Repository Rewrite

**Removed methods:** `commitGoal`, `commitHorizon`, `commitAccountMode`, `commitRiskProfile`, `commitOperatingMode`, `commitMandate`, `advanceSession`

**New methods:**
- `createSession(tenantId, userId, sessionId)` — creates the OnboardingSession item
- `updatePhase(tenantId, userId, sessionId, phase, data)` — updates one key in `phases` map + advances `currentPhase`/`phaseIndex`
- `completeSession(tenantId, userId, sessionId)` — sets `status: 'completed'`, `completedAt: now` + writes the CDC record (see Section 2)
- `getActiveSession(tenantId, userId)` — unchanged pattern, single GetItem

### Note on Risk Scoring

`compute_risk_profile` can remain in onboarding-bff for **display purposes only** — the agent shows the user their risk category during the conversation. The event payload carries raw indices (`toleranceIdx`, `experienceIdx`). investor-bff owns the authoritative `computeRiskProfile` implementation that creates the `RiskProfile` entity.

## Section 2: Event Emission — ONBOARDING_COMPLETED via CDC

When the user accepts the mandate (phase 7), `completeSession` writes a CDC record alongside the session update.

### CDC Record

```
pk: OnboardingCompleted#{tenantId}#{userId}
sk: OnboardingCompleted#{sessionId}

{
  __typename: 'OnboardingCompleted',
  tenantId: string,
  userId: string,

  // Raw onboarding data — onboarding's vocabulary
  goal: { objective: string },
  horizonYears: number,
  accountMode: 'simulation' | 'live',
  capitalAmount: number,
  currency: 'EUR',
  riskTolerance: number,       // raw index 0-3
  riskExperience: number,      // raw index 0-3
  operatingMode: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE',
  mandateAccepted: true
}
```

- Write-once (INSERT only) — CDC fires exactly once
- TTL set for cleanup after propagation
- Flat, raw, no investor-domain knowledge

### Egress Construct

```typescript
new Egress(this, 'Egress', {
  publishableTypes: ['OnboardingCompleted'],
});
```

### CDC Handler (event-publisher.ts)

```typescript
export const handler = changeDataCapture({
  serviceName: 'onboarding-bff',
  eventTypeMap: buildEventTypeMap(
    ['OnboardingCompleted'],
    { 'OnboardingCompleted:INSERT': 'ONBOARDING_COMPLETED' },
  ),
});
```

## Section 3: investor-bff Ingress — ONBOARDING_COMPLETED Handler

investor-bff adds `ONBOARDING_COMPLETED` to its Ingress subscription (joining `USER_REGISTERED`, `NOTIFICATION_CREATED`, `BALANCE_UPDATED`).

### Handler: onboardingCompleted Transform

Receives the raw payload and creates all domain entities in a single `transactWrite`:

```
TransactWriteItems:
  1. Update InvestorProfile (exists from USER_REGISTERED)
     - SET operatingMode, onboardingCompletedAt, updatedAt

  2. Put Goal
     - pk/sk: InvestorProfile#{t}#{u} / Goal#{goalId}
     - objective from event
     - timeHorizonMonths = horizonYears * 12
     - targetAmountCents: 0, targetReturn: 0, currency from event

  3. Put RiskProfile
     - pk/sk: InvestorProfile#{t}#{u} / RiskProfile
     - computeRiskProfile(riskTolerance, riskExperience) → score, band, category
     - tolerance/experienceLevel mapped from indices to labels
     - version: 1

  4. Put OperatingModeRecord
     - pk/sk: InvestorProfile#{t}#{u} / OperatingMode
     - mode from event, selectedAt: now

  5. Put AccountMode
     - pk/sk: InvestorProfile#{t}#{u} / AccountMode
     - mode, capitalAmount, currency from event

  6. Put Mandate
     - pk/sk: InvestorProfile#{t}#{u} / Mandate
     - level: ADVISORY (investor-bff business rule)
     - monthlyTurnoverCapPercent: 10 (investor-bff business rule)
     - maxSingleTradePercent: 5 (investor-bff business rule)
     - coolDownDays: 1 (investor-bff business rule)
     - rebalanceCadence: QUARTERLY (investor-bff business rule)
     - version: 1, effectiveDate: now
```

### Key Points

- `computeRiskProfile` lives in investor-bff as the authoritative implementation
- Mandate defaults are investor-bff's business rules, not onboarding's
- Single `transactWrite` — all 6 entities created atomically or none
- CDC fires naturally: `GOAL_CREATED`, `RISK_PROFILE_CREATED`, `MANDATE_GRANTED`, `OPERATING_MODE_SELECTED`
- Downstream services see a fully formed investor, never a partial one

## Section 4: onboarding-bff CDK Stack Changes

### Refactored Stack

```typescript
export class OnboardingBffStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });
    // Own table created by default State construct (stateProps not false)

    // Egress — CDC for ONBOARDING_COMPLETED
    new Egress(this, 'Egress', {
      publishableTypes: ['OnboardingCompleted'],
    });

    // Model IDs from SSM (shared with advisory services)
    const sonnetModelId = StringParameter.valueForStringParameter(
      this, `/${props.prefix}/advisory-hub/sonnet-model-id`,
    );

    // Knowledge Base for product documentation RAG
    const knowledgeBase = new KnowledgeBase(this, 'OnboardingKB', { ... });

    // Lambda handler for RAG search tool
    const searchKbFn = new NodejsFunction(this, 'SearchKbFn', { ... });

    // AgentRuntime — uses own table
    new AgentRuntime(this, 'OnboardingAgent', {
      tables: [this.state.table],
      environmentVariables: {
        TABLE_NAME: this.state.table.tableName,
        KNOWLEDGE_BASE_ID: knowledgeBase.knowledgeBaseId,
        AGENT_RUNTIME: 'true',
      },
      ...
    });
  }
}
```

### Removed

- `StringParameter.valueForStringParameter(this, '/${prefix}/investor-hub/table-name')` — gone
- `Table.fromTableName(this, 'InvestorTable', tableName)` — gone

### Added

- Default `State` construct (implicit from ServiceStack)
- `Egress` construct with CDC handler

### Investor Hub Stack Cleanup

- Remove SSM export of `/${prefix}/investor-hub/table-name` — no service should expose internal DynamoDB resources

### Service Rename

- `services/investor/onboarding-agent-bff/` → `services/investor/onboarding-bff/`
- Update `project.json`, Nx workspace references, hub stack registration

## Section 5: onboarding-mfe + Shell Routing

### New App: apps/onboarding-mfe/

```
apps/onboarding-mfe/
  federation.config.js          # exposes ./routes
  src/
    app/
      remote-routes.ts          # single route: '' → OnboardingChatComponent
      onboarding/
        onboarding-chat.component.ts   # moved from investor-mfe
        stores/
          onboarding.store.ts          # moved from investor-mfe
        renderers/                     # moved from investor-mfe
```

- Federation config: exposes `./routes`, shares same deps as other MFEs
- `HttpAgent` SSE endpoint URL changes to point to onboarding-bff's own endpoint
- 5 MFEs ↔ 5 BFFs (onboarding-mfe ↔ onboarding-bff)

### Shell Changes (apps/nestfolio-host/)

```typescript
// app.routes.ts

// New onboarding route
{
  path: 'onboarding',
  canActivate: [onboardingPendingGuard],
  loadChildren: () => loadRemoteModule('onboarding-mfe', './routes'),
}

// Existing protected routes gain onboardingCompletedGuard
{
  path: 'dashboard',
  canActivate: [authGuard, onboardingCompletedGuard],
  ...
}
// Same for investor, advisory, ledger routes
```

### Guards (libs/shell/src/auth/)

- `onboardingPendingGuard` — allows access only if `onboardingCompletedAt === null`, redirects to `/dashboard` otherwise
- `onboardingCompletedGuard` — allows access only if `onboardingCompletedAt !== null`, redirects to `/onboarding` otherwise

### Onboarding Status Source

The `authStore` is enriched at login with the user's profile (includes `onboardingCompletedAt`). This can come from a lightweight profile query at session init or a Cognito custom attribute.

### Removed from investor-mfe

- `onboarding/` directory (component, store, renderers)
- `/investor/onboarding` route from `remote-routes.ts`
- Onboarding-related imports

## Section 6: Cleanup and Migration Summary

### Removed

| What | Where | Why |
|------|-------|-----|
| SSM `/${prefix}/investor-hub/table-name` | investor hub stack | No service exposes internal resources |
| SSM table lookup + `Table.fromTableName` | onboarding-bff stack | Uses own table now |
| `onboarding/` directory | investor-mfe | Moved to onboarding-mfe |
| `/investor/onboarding` route | investor-mfe remote-routes.ts | Route lives in onboarding-mfe |
| `commitGoal`, `commitHorizon`, `commitAccountMode`, `commitRiskProfile`, `commitOperatingMode`, `commitMandate` | onboarding-bff repository | Replaced by `updatePhase` + `completeSession` |
| `Goal`, `AccountMode`, `RiskProfile`, `OperatingModeRecord`, `Mandate` schemas | onboarding-bff domain | Replaced by `OnboardingSession` aggregate |

### Added

| What | Where | Why |
|------|-------|-----|
| `Egress` construct + `event-publisher.ts` | onboarding-bff | CDC for `ONBOARDING_COMPLETED` |
| `onboardingCompleted` ingress handler | investor-bff | Creates all domain entities from raw event |
| `computeRiskProfile` function | investor-bff domain | Authoritative scoring — moved from onboarding-bff |
| `apps/onboarding-mfe/` | new app | Dedicated frontend for onboarding |
| `onboardingPendingGuard` + `onboardingCompletedGuard` | shell auth lib | Routing based on onboarding status |
| `/onboarding` route | shell app.routes.ts | Points to onboarding-mfe |

### Modified

| What | Change |
|------|--------|
| `services/investor/onboarding-agent-bff/` | Renamed to `services/investor/onboarding-bff/` |
| onboarding-bff `service.stack.ts` | Own table, Egress, no SSM imports |
| onboarding-bff repository | Single `OnboardingSession` aggregate, `updatePhase()`, `completeSession()` |
| onboarding-bff `commit-phase.ts` tool | Updates phase map, writes CDC record on final phase |
| investor-bff `service.stack.ts` | Add `ONBOARDING_COMPLETED` to Ingress eventTypes |
| investor-bff `event-listener.ts` | New `onboardingCompleted` handler with `transactWrite` |
| investor-bff `domain/schemas.ts` | Expand `OnboardingCompletedSchema` to match raw payload |
| investor hub stack | Remove table-name SSM export |
| shell `authStore` | Enrich with `onboardingCompletedAt` |
| shell `app.routes.ts` | Add `/onboarding` route, add guards to existing routes |
