# Dead Code Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all verified dead code from the nestfolio monorepo — dead exports, dead files, unused constructs, and stale GraphQL definitions.

**Architecture:** Pure deletion/trimming — no behavioral changes. Each chunk removes one category of dead code, followed by a full test run to confirm nothing breaks.

**Tech Stack:** TypeScript, Angular, AWS CDK, GraphQL, Nx workspace

**Spec:** `docs/superpowers/specs/2026-03-18-dead-code-audit.md`

---

## Corrected Scope (vs. Audit Spec)

The audit agents flagged several **false positives** that are excluded from this plan:
- **6 frontend service files** — all actively injected via components/routes (NOT orphaned)
- **CDK props** (enableWaf, wafRateLimit, maxRetries, maxBatchingWindowMs) — all read in constructors
- **ProposedTrade in advisory-adpt** — used by execution-ctrl (3 files import it)
- **MandateLevel in investor-adpt** — used by compliance-ctrl/rule-engine
- **VALIDATION_RULES / getValidationConfig / isValidTicker** — used by decision-lifecycle.service.ts and internally
- **~279 "unused" shared lib exports** — many are used internally via barrel re-exports; tree-shaking handles build-time elimination. Not worth the risk of breakage.

**Verified dead code to remove:**
1. 4 dead CDK stack re-export shims (stacks/ dirs)
2. 1 unused CDK construct (KnowledgeBase)
3. 8 dead domain barrel exports across 3 adpt services
4. 16 dead GraphQL query/mutation/subscription exports across 4 files
5. Un-export fragment constants that are only used via template interpolation within the same file

---

## File Structure

| Action | File |
|--------|------|
| Delete | `services/advisory/investor-profile-ctrl/stacks/service.stack.ts` |
| Delete | `services/advisory/portfolio-engine-ctrl/stacks/service.stack.ts` |
| Delete | `services/advisory/advisory-narrative-ctrl/stacks/service.stack.ts` |
| Delete | `services/advisory/market-intelligence-ctrl/stacks/service.stack.ts` |
| Delete | `libs/cdk-constructs/src/knowledge-base.ts` |
| Delete | `libs/cdk-constructs/test/knowledge-base.test.ts` |
| Modify | `libs/cdk-constructs/src/index.ts` — remove KnowledgeBase export |
| Modify | `services/advisory/advisory-adpt/src/domain/index.ts` — remove 4 dead exports |
| Modify | `services/execution/execution-adpt/src/domain/index.ts` — remove 4 dead exports |
| Modify | `services/investor/investor-adpt/src/domain/index.ts` — remove 2 dead exports |
| Modify | `libs/appsync-client/src/graphql/advisory-bff.queries.ts` — remove 2 dead queries, un-export 3 fragments |
| Modify | `libs/appsync-client/src/graphql/dashboard-bff.queries.ts` — remove 1 dead subscription, un-export 5 fragments |
| Modify | `libs/appsync-client/src/graphql/investor-bff.queries.ts` — remove 8 dead queries/mutations, un-export 4 fragments |
| Modify | `libs/appsync-client/src/graphql/ledger-bff.queries.ts` — remove 5 dead queries, un-export 2 fragments |

---

### Task 1: Delete Dead CDK Stack Re-Export Shims

**Files:**
- Delete: `services/advisory/investor-profile-ctrl/stacks/service.stack.ts`
- Delete: `services/advisory/portfolio-engine-ctrl/stacks/service.stack.ts`
- Delete: `services/advisory/advisory-narrative-ctrl/stacks/service.stack.ts`
- Delete: `services/advisory/market-intelligence-ctrl/stacks/service.stack.ts`

These are 1-line re-export shims (`export { XStack } from '../src/service.stack'`) in `stacks/` directories. Nothing imports from them — the active stacks live in `src/service.stack.ts`.

- [ ] **Step 1: Delete the 4 dead stack files**

```bash
rm services/advisory/investor-profile-ctrl/stacks/service.stack.ts
rm services/advisory/portfolio-engine-ctrl/stacks/service.stack.ts
rm services/advisory/advisory-narrative-ctrl/stacks/service.stack.ts
rm services/advisory/market-intelligence-ctrl/stacks/service.stack.ts
```

- [ ] **Step 2: Remove empty stacks/ directories if they exist**

```bash
rmdir services/advisory/investor-profile-ctrl/stacks/ 2>/dev/null || true
rmdir services/advisory/portfolio-engine-ctrl/stacks/ 2>/dev/null || true
rmdir services/advisory/advisory-narrative-ctrl/stacks/ 2>/dev/null || true
rmdir services/advisory/market-intelligence-ctrl/stacks/ 2>/dev/null || true
```

- [ ] **Step 3: Verify build passes**

```bash
pnpm nx run-many -t build --projects=investor-profile-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl,market-intelligence-ctrl
```

Expected: All 4 builds pass (the stacks/ files were never referenced).

- [ ] **Step 4: Commit**

```bash
git add -u services/advisory/investor-profile-ctrl/stacks/ services/advisory/portfolio-engine-ctrl/stacks/ services/advisory/advisory-narrative-ctrl/stacks/ services/advisory/market-intelligence-ctrl/stacks/
git commit -m "chore: delete dead stack re-export shims in stacks/ directories"
```

---

### Task 2: Remove Unused KnowledgeBase CDK Construct

**Files:**
- Delete: `libs/cdk-constructs/src/knowledge-base.ts`
- Delete: `libs/cdk-constructs/test/knowledge-base.test.ts`
- Modify: `libs/cdk-constructs/src/index.ts:16` — remove KnowledgeBase export line

The `KnowledgeBase` construct (114 lines, Bedrock KB + S3 + IAM) is never instantiated in any stack. The `investor-profile-ctrl` stack creates its own KB bucket directly instead.

- [ ] **Step 1: Remove the KnowledgeBase export from the barrel**

In `libs/cdk-constructs/src/index.ts`, delete line 16:
```typescript
// DELETE THIS LINE:
export { KnowledgeBase, KnowledgeBaseProps } from './knowledge-base';
```

- [ ] **Step 2: Delete the construct file and its test**

```bash
rm libs/cdk-constructs/src/knowledge-base.ts
rm libs/cdk-constructs/test/knowledge-base.test.ts
```

- [ ] **Step 3: Run tests for cdk-constructs**

```bash
pnpm nx test cdk-constructs
```

Expected: All remaining tests pass.

- [ ] **Step 4: Run build for cdk-constructs and a consuming stack**

```bash
pnpm nx run-many -t build --projects=cdk-constructs,investor-profile-ctrl
```

Expected: Both pass.

- [ ] **Step 5: Commit**

```bash
git add libs/cdk-constructs/src/knowledge-base.ts libs/cdk-constructs/test/knowledge-base.test.ts libs/cdk-constructs/src/index.ts
git commit -m "chore: remove unused KnowledgeBase CDK construct and its test"
```

---

### Task 3: Remove Dead Domain Barrel Exports

**Files:**
- Modify: `services/advisory/advisory-adpt/src/domain/index.ts:7-47` — remove DecisionStatus, ComplianceLevel, ComplianceResult, ComplianceCheck (keep ProposedTrade — used by execution-ctrl)
- Modify: `services/execution/execution-adpt/src/domain/index.ts:7-59` — remove ExecutionAdptEventTypes, ExecutionAdptEventType, OrderFilledEvent, DepositDetectedEvent
- Modify: `services/investor/investor-adpt/src/domain/index.ts:7-14` — remove OperatingMode, RebalanceCadence (keep MandateLevel — used by compliance-ctrl)

- [ ] **Step 1: Edit advisory-adpt/src/domain/index.ts**

Keep lines 1-2 (AdvisoryCrossDomainEventTypes exports) and lines 28-36 (ProposedTrade interface). Remove everything else:

```typescript
export { AdvisoryCrossDomainEventTypes } from './events';
export type { AdvisoryCrossDomainEventType } from './events';

/** A proposed trade within a decision packet. */
export interface ProposedTrade {
  readonly symbol: string;
  readonly assetClass: string;
  readonly side: 'BUY' | 'SELL';
  readonly quantityOrAmountCents: number;
  readonly targetWeightPercent: number;
  readonly rationale: string;
}
```

- [ ] **Step 2: Edit execution-adpt/src/domain/index.ts**

Keep only lines 1-2 (ExecutionCrossDomainEventTypes). Remove everything from line 4 onwards:

```typescript
export { ExecutionCrossDomainEventTypes } from './events';
export type { ExecutionCrossDomainEventType } from './events';
```

- [ ] **Step 3: Edit investor-adpt/src/domain/index.ts**

Keep lines 1-2 (InvestorCrossDomainEventTypes) and MandateLevel. Remove OperatingMode and RebalanceCadence:

```typescript
export { InvestorCrossDomainEventTypes } from './events';
export type { InvestorCrossDomainEventType } from './events';

/** Mandate level determines whether user confirmation is required. */
export type MandateLevel = 'ADVISORY' | 'DISCRETIONARY';
```

- [ ] **Step 4: Run tests for affected services**

```bash
pnpm nx run-many -t test --projects=advisory-adpt,execution-adpt,investor-adpt,execution-ctrl,compliance-ctrl
```

Expected: All pass. execution-ctrl imports ProposedTrade, compliance-ctrl imports MandateLevel — both kept.

- [ ] **Step 5: Run build for all adpt services and their consumers**

```bash
pnpm nx run-many -t build --projects=advisory-adpt,execution-adpt,investor-adpt,execution-ctrl,compliance-ctrl,advisory-ctrl,dashboard-bff,investor-ctrl,ledger-ctrl,broker-adpt
```

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add services/advisory/advisory-adpt/src/domain/index.ts services/execution/execution-adpt/src/domain/index.ts services/investor/investor-adpt/src/domain/index.ts
git commit -m "chore: remove 8 dead domain barrel exports from adpt services"
```

---

### Task 4: Clean Up Dead GraphQL Query Definitions

**Files:**
- Modify: `libs/appsync-client/src/graphql/advisory-bff.queries.ts`
- Modify: `libs/appsync-client/src/graphql/dashboard-bff.queries.ts`
- Modify: `libs/appsync-client/src/graphql/investor-bff.queries.ts`
- Modify: `libs/appsync-client/src/graphql/ledger-bff.queries.ts`

**What to keep vs. remove per file:**

**advisory-bff.queries.ts** — KEEP: GET_DECISION, GET_AGENT_INVOCATIONS, GET_COMPLIANCE_CHECKS, CONFIRM_DECISION, REJECT_DECISION, RECORD_EXPLANATION_VIEW, ON_DECISION_UPDATE. REMOVE: GET_PENDING_DECISIONS, GET_DECISION_HISTORY. Un-export fragments (remove `export` keyword from DECISION_FIELDS, AGENT_INVOCATION_FIELDS, COMPLIANCE_CHECK_FIELDS — they're only used as template interpolation within the same file).

**dashboard-bff.queries.ts** — KEEP: GET_DASHBOARD, GET_POSITION_SNAPSHOTS, GET_RECENT_ACTIVITY, GET_SIMULATION_SUMMARY. REMOVE: ON_DASHBOARD_UPDATE. Un-export fragments (PORTFOLIO_SUMMARY_FIELDS, POSITION_SNAPSHOT_FIELDS, ACTIVITY_ENTRY_FIELDS, ADVISORY_STATUS_FIELDS, INVESTOR_SNAPSHOT_FIELDS, DASHBOARD_FIELDS).

**investor-bff.queries.ts** — KEEP: RECORD_ONBOARDING_ANSWER, SET_GOAL, SET_RISK_PROFILE, SELECT_OPERATING_MODE, GRANT_MANDATE, GET_NOTIFICATIONS, GET_UNREAD_COUNT, MARK_NOTIFICATION_READ, ON_NOTIFICATION. REMOVE: GET_PROFILE, GET_GOALS, UPDATE_GOAL, INITIATE_DEPOSIT, REQUEST_WITHDRAWAL, REQUEST_ACCOUNT_CLOSURE, UPDATE_MANDATE, REVOKE_MANDATE. Un-export fragments (PROFILE_FIELDS, GOAL_FIELDS, NOTIFICATION_FIELDS, MANDATE_FIELDS).

**ledger-bff.queries.ts** — KEEP: GET_TIME_TRAVEL_AVAILABILITY, GET_PORTFOLIO_AT, GET_SIMULATION_COMPARISON. REMOVE: GET_BALANCE, GET_PORTFOLIO, GET_POSITIONS, GET_PERFORMANCE, GET_ORDER_HISTORY. Un-export fragments (POSITION_FIELDS, PORTFOLIO_FIELDS).

- [ ] **Step 1: Rewrite advisory-bff.queries.ts**

```typescript
// --- Fragments (internal — used via template interpolation) ---

const DECISION_FIELDS = `
  fragment DecisionFields on Decision {
    decisionId
    tenantId
    status
    rationale
    proposedActions {
      actionType
      symbol
      side
      quantity
      limitPrice
      currency
    }
    complianceStatus
    confirmedAt
    confirmedBy
    rejectedAt
    rejectionReason
    rejectedBy
    version
    createdAt
    updatedAt
  }
`;

const AGENT_INVOCATION_FIELDS = `
  fragment AgentInvocationFields on AgentInvocation {
    invocationId
    decisionId
    agentName
    tier
    input
    output
    durationMs
    status
    invokedAt
  }
`;

const COMPLIANCE_CHECK_FIELDS = `
  fragment ComplianceCheckFields on ComplianceCheck {
    checkId
    decisionId
    ruleName
    result
    details
    checkedAt
  }
`;

// --- Queries ---

export const GET_DECISION = `
  query GetDecision($decisionId: ID!) {
    getDecision(decisionId: $decisionId) {
      ...DecisionFields
    }
  }
  ${DECISION_FIELDS}
`;

export const GET_AGENT_INVOCATIONS = `
  query GetAgentInvocations($decisionId: ID!) {
    getAgentInvocations(decisionId: $decisionId) {
      ...AgentInvocationFields
    }
  }
  ${AGENT_INVOCATION_FIELDS}
`;

export const GET_COMPLIANCE_CHECKS = `
  query GetComplianceChecks($decisionId: ID!) {
    getComplianceChecks(decisionId: $decisionId) {
      ...ComplianceCheckFields
    }
  }
  ${COMPLIANCE_CHECK_FIELDS}
`;

// --- Mutations ---

export const CONFIRM_DECISION = `
  mutation ConfirmDecision($decisionId: ID!) {
    confirmDecision(decisionId: $decisionId) {
      ...DecisionFields
    }
  }
  ${DECISION_FIELDS}
`;

export const REJECT_DECISION = `
  mutation RejectDecision($decisionId: ID!, $reason: String!) {
    rejectDecision(decisionId: $decisionId, reason: $reason) {
      ...DecisionFields
    }
  }
  ${DECISION_FIELDS}
`;

export const RECORD_EXPLANATION_VIEW = `
  mutation RecordExplanationView($decisionId: ID!) {
    recordExplanationView(decisionId: $decisionId) {
      decisionId
      viewedAt
    }
  }
`;

// --- Subscriptions ---

export const ON_DECISION_UPDATE = `
  subscription OnDecisionUpdate {
    onDecisionUpdate {
      ...DecisionFields
    }
  }
  ${DECISION_FIELDS}
`;
```

- [ ] **Step 2: Rewrite dashboard-bff.queries.ts**

```typescript
// --- Fragments (internal — used via template interpolation) ---

const PORTFOLIO_SUMMARY_FIELDS = `
  fragment PortfolioSummaryFields on PortfolioSummary {
    totalValueCents
    cashBalanceCents
    positionCount
    driftPercent
    updatedAt
  }
`;

const POSITION_SNAPSHOT_FIELDS = `
  fragment PositionSnapshotFields on PositionSnapshot {
    symbol
    assetClass
    quantity
    avgCostBasisCents
    currentPriceCents
    marketValueCents
    weightPercent
    unrealizedPnlCents
    lastUpdatedAt
  }
`;

const ACTIVITY_ENTRY_FIELDS = `
  fragment ActivityEntryFields on ActivityEntry {
    activityType
    description
    timestamp
    metadata
  }
`;

const ADVISORY_STATUS_FIELDS = `
  fragment AdvisoryStatusFields on AdvisoryStatus {
    pendingDecisionsCount
    lastRecommendationAt
    lastDecisionStatus
    updatedAt
  }
`;

const INVESTOR_SNAPSHOT_FIELDS = `
  fragment InvestorSnapshotFields on InvestorSnapshot {
    goalType
    riskLevel
    operatingMode
    mandateLevel
    onboardedAt
    updatedAt
  }
`;

const DASHBOARD_FIELDS = `
  fragment DashboardFields on Dashboard {
    portfolioSummary {
      ...PortfolioSummaryFields
    }
    advisoryStatus {
      ...AdvisoryStatusFields
    }
    investorSnapshot {
      ...InvestorSnapshotFields
    }
  }
  ${PORTFOLIO_SUMMARY_FIELDS}
  ${ADVISORY_STATUS_FIELDS}
  ${INVESTOR_SNAPSHOT_FIELDS}
`;

// --- Queries ---

export const GET_DASHBOARD = `
  query GetDashboard {
    getDashboard {
      ...DashboardFields
    }
  }
  ${DASHBOARD_FIELDS}
`;

export const GET_POSITION_SNAPSHOTS = `
  query GetPositionSnapshots {
    getPositionSnapshots {
      ...PositionSnapshotFields
    }
  }
  ${POSITION_SNAPSHOT_FIELDS}
`;

export const GET_RECENT_ACTIVITY = `
  query GetRecentActivity($limit: Int) {
    getRecentActivity(limit: $limit) {
      ...ActivityEntryFields
    }
  }
  ${ACTIVITY_ENTRY_FIELDS}
`;

export const GET_SIMULATION_SUMMARY = `
  query GetSimulationSummary {
    getSimulationSummary {
      actualTotalValueCents
      simulatedTotalValueCents
      actualReturnPercent
      simulatedReturnPercent
      returnDifferencePercent
      updatedAt
    }
  }
`;
```

- [ ] **Step 3: Rewrite investor-bff.queries.ts**

```typescript
// --- Fragments (internal — used via template interpolation) ---

const GOAL_FIELDS = `
  fragment GoalFields on Goal {
    goalId
    tenantId
    objective
    targetAmountCents
    currency
    timeHorizonMonths
    targetReturn
    createdAt
    updatedAt
  }
`;

const NOTIFICATION_FIELDS = `
  fragment NotificationFields on Notification {
    notificationId
    tenantId
    channel
    title
    body
    status
    relatedEntityType
    relatedEntityId
    createdAt
    sentAt
    deliveredAt
    readAt
  }
`;

const MANDATE_FIELDS = `
  fragment MandateFields on Mandate {
    mandateId
    tenantId
    level
    monthlyTurnoverCapPercent
    maxSingleTradePercent
    coolDownDays
    rebalanceCadence
    effectiveDate
    revokedAt
    version
  }
`;

// --- Queries ---

export const GET_NOTIFICATIONS = `
  query GetNotifications($limit: Int, $cursor: String) {
    getNotifications(limit: $limit, cursor: $cursor) {
      items {
        ...NotificationFields
      }
      nextCursor
    }
  }
  ${NOTIFICATION_FIELDS}
`;

export const GET_UNREAD_COUNT = `
  query GetUnreadCount {
    getUnreadCount
  }
`;

// --- Mutations ---

export const RECORD_ONBOARDING_ANSWER = `
  mutation RecordOnboardingAnswer($input: OnboardingAnswerInput!) {
    recordOnboardingAnswer(input: $input) {
      step
      answeredAt
    }
  }
`;

export const SET_GOAL = `
  mutation SetGoal($input: GoalInput!) {
    setGoal(input: $input) {
      ...GoalFields
    }
  }
  ${GOAL_FIELDS}
`;

export const SET_RISK_PROFILE = `
  mutation SetRiskProfile($input: RiskProfileInput!) {
    setRiskProfile(input: $input) {
      profileId
      tenantId
      score
      band { minEquity maxEquity }
      assessedAt
      version
    }
  }
`;

export const SELECT_OPERATING_MODE = `
  mutation SelectOperatingMode($mode: OperatingMode!) {
    selectOperatingMode(mode: $mode) {
      operatingMode
      updatedAt
    }
  }
`;

export const GRANT_MANDATE = `
  mutation GrantMandate($input: MandateInput!) {
    grantMandate(input: $input) {
      ...MandateFields
    }
  }
  ${MANDATE_FIELDS}
`;

export const MARK_NOTIFICATION_READ = `
  mutation MarkNotificationRead($notificationId: ID!) {
    markNotificationRead(notificationId: $notificationId) {
      ...NotificationFields
    }
  }
  ${NOTIFICATION_FIELDS}
`;

// --- Subscriptions ---

export const ON_NOTIFICATION = `
  subscription OnNotification {
    onNotification {
      ...NotificationFields
    }
  }
  ${NOTIFICATION_FIELDS}
`;
```

- [ ] **Step 4: Rewrite ledger-bff.queries.ts**

```typescript
// --- Fragments (internal — used via template interpolation) ---

const POSITION_FIELDS = `
  fragment PositionFields on Position {
    symbol
    quantity
    averageCostBasis
    totalCostBasis
    lastFillPrice
  }
`;

const PORTFOLIO_FIELDS = `
  fragment PortfolioFields on Portfolio {
    cashBalanceCents
    totalValueCents
    positions {
      ...PositionFields
    }
  }
  ${POSITION_FIELDS}
`;

// --- Queries ---

export const GET_TIME_TRAVEL_AVAILABILITY = `
  query GetTimeTravelAvailability {
    getTimeTravelAvailability {
      earliestDate
      latestDate
    }
  }
`;

export const GET_PORTFOLIO_AT = `
  query GetPortfolioAt($timestamp: String!) {
    getPortfolioAt(timestamp: $timestamp) {
      ...PortfolioFields
    }
  }
  ${PORTFOLIO_FIELDS}
`;

export const GET_SIMULATION_COMPARISON = `
  query GetSimulationComparison {
    getSimulationComparison {
      actual {
        ...PortfolioFields
      }
      simulated {
        ...PortfolioFields
      }
      cashDeltaCents
      positionDiffs {
        symbol
        actualQuantity
        simulatedQuantity
        quantityDiff
      }
    }
  }
  ${PORTFOLIO_FIELDS}
`;
```

- [ ] **Step 5: Run tests for appsync-client and all MFE apps**

```bash
pnpm nx run-many -t test --projects=appsync-client,investor-mfe,dashboard-mfe,advisory-mfe,ledger-mfe
```

Expected: All pass. The removed exports were never imported by any consumer.

- [ ] **Step 6: Run build for appsync-client and all MFE apps**

```bash
pnpm nx run-many -t build --projects=appsync-client,investor-mfe,dashboard-mfe,advisory-mfe,ledger-mfe
```

Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add libs/appsync-client/src/graphql/
git commit -m "chore: remove 16 dead GraphQL exports and un-export internal fragments"
```

---

### Task 5: Final Verification — Full Test Suite

- [ ] **Step 1: Run the full test suite across all projects**

```bash
pnpm nx run-many -t test
```

Expected: All projects pass.

- [ ] **Step 2: Run the full build across all projects**

```bash
pnpm nx run-many -t build
```

Expected: All projects build successfully.

---

## Summary

| Task | What | Files Changed | Lines Removed (approx) |
|------|------|---------------|----------------------|
| 1 | Dead stack re-export shims | 4 deleted | ~4 |
| 2 | Unused KnowledgeBase construct + test | 2 deleted, 1 modified | ~250 |
| 3 | Dead domain barrel exports | 3 modified | ~50 |
| 4 | Dead GraphQL exports + un-export fragments | 4 modified | ~90 |
| 5 | Full verification | — | — |
| **Total** | | **6 deleted, 8 modified** | **~394 lines** |
