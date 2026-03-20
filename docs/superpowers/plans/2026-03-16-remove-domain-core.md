# Remove domain-core Library — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the `@nestfolio/domain-core` library by distributing its contents to their rightful owners: event types/schemas/models move to the publishing service, shared infrastructure types move to `@nestfolio/event-processor`. Consumer services import event type constants from the producer via tsconfig path aliases, giving compile-time safety on event type changes.

**Architecture:** Publisher-owns-events principle — each service defines the events it publishes, the schemas that validate them, and the models that represent its domain entities. Consumer services import event type constants from the producer service via `@nestfolio/<service>/domain` path aliases, so breaking changes in event names cause compile errors. Cross-cutting event infrastructure (BusEventSchema, errors) moves to event-processor since every service already depends on it.

**Tech Stack:** TypeScript, Zod, Nx, Jest

---

## Publisher → Event Ownership Map

| Publisher Service | Event Type Constants Object | Events |
|---|---|---|
| **investor-bff** | `InvestorBffEventTypes` | USER_REGISTERED, ONBOARDING_COMPLETED, GOAL_SET, GOAL_UPDATED, RISK_PROFILE_UPDATED, MANDATE_GRANTED, OPERATING_MODE_CHANGED, DEPOSIT_INITIATED, WITHDRAWAL_REQUESTED, ACCOUNT_CLOSURE_REQUESTED, ... |
| **investor-ctrl** | `InvestorCtrlEventTypes` | NOTIFICATION_CREATED, NOTIFICATION_SENT, NOTIFICATION_DELIVERED, MONTHLY_REPORT_GENERATED |
| **advisory-ctrl** | `AdvisoryCtrlEventTypes` | DECISION_PACKET_CREATED, DECISION_PACKET_ENRICHED, USER_CONFIRMATION_REQUESTED, CIRCUIT_BREAKER_TRIGGERED/RESET, ... |
| **advisory-bff** | `AdvisoryBffEventTypes` | USER_CONFIRMED, USER_REJECTED, USER_VIEWED_EXPLANATION |
| **compliance-ctrl** | `ComplianceEventTypes` | DECISION_APPROVED, DECISION_BLOCKED, GUARDRAIL_VIOLATION_DETECTED, ... |
| **execution-ctrl** | `ExecutionCtrlEventTypes` | ORDER_SUBMITTED, ORDER_STAGED, EXECUTION_PAUSED/RESUMED |
| **execution-adpt** | `ExecutionAdptEventTypes` | ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, PORTFOLIO_SNAPSHOT_IMPORTED, ... |
| **ledger-ctrl** | `LedgerCtrlEventTypes` | BALANCE_UPDATED, PORTFOLIO_UPDATED, LEDGER_ENTRY_RECORDED, ... |
| **reconciliation-ctrl** | `ReconciliationEventTypes` | PORTFOLIO_DRIFT_DETECTED, RECONCILIATION_COMPLETED, CORPORATE_ACTION_APPLIED, ... |

## Consumer → Producer Import Map

Each consumer event-listener.ts replaces string literals with typed imports:

| Consumer | Imports From |
|---|---|
| **investor-bff** | own events + `@nestfolio/investor-ctrl/domain` + `@nestfolio/ledger-ctrl/domain` |
| **investor-ctrl** | `@nestfolio/investor-bff/domain` + `@nestfolio/compliance-ctrl/domain` + `@nestfolio/execution-adpt/domain` + `@nestfolio/ledger-ctrl/domain` |
| **dashboard-bff** | `@nestfolio/ledger-ctrl/domain` + `@nestfolio/reconciliation-ctrl/domain` + `@nestfolio/advisory-ctrl/domain` + `@nestfolio/compliance-ctrl/domain` (+ `INVESTOR_SNAPSHOT_UPDATED` stays as string literal) |
| **advisory-ctrl** | `@nestfolio/investor-bff/domain` + `@nestfolio/advisory-bff/domain` + `@nestfolio/compliance-ctrl/domain` + `@nestfolio/execution-adpt/domain` + `@nestfolio/reconciliation-ctrl/domain` |
| **advisory-bff** | `@nestfolio/advisory-ctrl/domain` + `@nestfolio/compliance-ctrl/domain` |
| **compliance-ctrl** | `@nestfolio/advisory-ctrl/domain` + `@nestfolio/investor-bff/domain` |
| **execution-ctrl** | `@nestfolio/compliance-ctrl/domain` + `@nestfolio/advisory-bff/domain` + `@nestfolio/advisory-ctrl/domain` + `@nestfolio/investor-bff/domain` |
| **execution-adpt** | `@nestfolio/execution-ctrl/domain` + `@nestfolio/investor-bff/domain` |
| **ledger-ctrl** | `@nestfolio/execution-adpt/domain` + `@nestfolio/advisory-ctrl/domain` (+ `CORPORATE_ACTION_PROCESSED` stays as string literal) |
| **ledger-bff** | `@nestfolio/ledger-ctrl/domain` |
| **reconciliation-ctrl** | `@nestfolio/ledger-ctrl/domain` + `@nestfolio/execution-adpt/domain` (+ `CORPORATE_ACTION_APPLIED` stays as string literal) |

## Schema Ownership (publisher-owns)

| Schema | Publisher |
|---|---|
| MandateGrantedSchema, GoalUpdatedSchema, RiskProfileUpdatedSchema, OnboardingCompletedSchema, DepositInitiatedSchema | **investor-bff** |
| DecisionPacketCreatedSchema, UserConfirmationRequestedSchema | **advisory-ctrl** |
| DecisionApprovedSchema, DecisionBlockedSchema | **compliance-ctrl** |
| OrderSubmittedSchema | **execution-ctrl** |
| OrderFilledSchema, DepositDetectedSchema | **execution-adpt** |
| PortfolioDriftDetectedSchema | **reconciliation-ctrl** |

---

## Chunk 1: Move shared infrastructure to event-processor

### Task 1: Create domain errors in event-processor

**Files:**
- Create: `libs/event-processor/src/domain/errors.ts`
- Create: `libs/event-processor/test/domain/errors.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// libs/event-processor/test/domain/errors.test.ts
import {
  DomainError,
  DomainValidationError,
  EntityNotFoundError,
  BusinessRuleViolationError,
  TenantAccessDeniedError,
} from '../../src/domain/errors';

describe('DomainError', () => {
  it('should set name, message, and code', () => {
    const err = new DomainError('msg', 'CODE');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('DomainError');
    expect(err.message).toBe('msg');
    expect(err.code).toBe('CODE');
  });
});

describe('DomainValidationError', () => {
  it('should include validation details', () => {
    const details = [{ path: '/name', message: 'required' }];
    const err = new DomainValidationError('invalid', details);
    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe('DOMAIN_VALIDATION_ERROR');
    expect(err.details).toEqual(details);
  });
});

describe('EntityNotFoundError', () => {
  it('should format entity type and id', () => {
    const err = new EntityNotFoundError('Order', '123');
    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe('ENTITY_NOT_FOUND');
    expect(err.entityType).toBe('Order');
    expect(err.entityId).toBe('123');
    expect(err.message).toBe("Order with id '123' not found");
  });
});

describe('BusinessRuleViolationError', () => {
  it('should include rule name', () => {
    const err = new BusinessRuleViolationError('MAX_TRADE', 'too large');
    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe('BUSINESS_RULE_VIOLATION');
    expect(err.rule).toBe('MAX_TRADE');
  });
});

describe('TenantAccessDeniedError', () => {
  it('should include tenant and resource', () => {
    const err = new TenantAccessDeniedError('t-1', 'Order:123');
    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe('TENANT_ACCESS_DENIED');
    expect(err.message).toContain('t-1');
    expect(err.message).toContain('Order:123');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx nx test event-processor -- --testPathPattern=domain/errors`
Expected: FAIL — cannot resolve `../../src/domain/errors`

- [ ] **Step 3: Create the errors module**

Copy `libs/domain-core/src/shared/errors.ts` verbatim (including JSDoc comments) to `libs/event-processor/src/domain/errors.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx nx test event-processor -- --testPathPattern=domain/errors`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/src/domain/errors.ts libs/event-processor/test/domain/errors.test.ts
git commit -m "feat(event-processor): add domain error classes from domain-core"
```

---

### Task 2: Create domain schemas in event-processor

**Files:**
- Create: `libs/event-processor/src/domain/schemas.ts`
- Create: `libs/event-processor/test/domain/schemas.test.ts`

- [ ] **Step 1: Write the failing tests**

Copy `libs/domain-core/test/shared/types.test.ts` to `libs/event-processor/test/domain/schemas.test.ts`, updating the import to `../../src/domain/schemas`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx nx test event-processor -- --testPathPattern=domain/schemas`
Expected: FAIL — cannot resolve `../../src/domain/schemas`

- [ ] **Step 3: Create the schemas module**

Copy `libs/domain-core/src/shared/types.ts` verbatim to `libs/event-processor/src/domain/schemas.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx nx test event-processor -- --testPathPattern=domain/schemas`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/src/domain/schemas.ts libs/event-processor/test/domain/schemas.test.ts
git commit -m "feat(event-processor): add bus event schemas from domain-core"
```

---

### Task 3: Wire domain barrel + update event-processor index

**Files:**
- Create: `libs/event-processor/src/domain/index.ts`
- Modify: `libs/event-processor/src/index.ts`

- [ ] **Step 1: Create domain barrel**

```typescript
// libs/event-processor/src/domain/index.ts
export {
  DomainError,
  DomainValidationError,
  EntityNotFoundError,
  BusinessRuleViolationError,
  TenantAccessDeniedError,
} from './errors';

export {
  BusEventSchema,
  TenantContextSchema,
  EditEventSchema,
  EditOperationSchema,
} from './schemas';

export type {
  BusEvent,
  TenantContext,
  EditEvent,
  EditOperation,
} from './schemas';
```

- [ ] **Step 2: Add domain exports to event-processor barrel**

Add at the end of `libs/event-processor/src/index.ts`:

```typescript
// Domain (shared infrastructure types & errors)
export {
  DomainError,
  DomainValidationError,
  EntityNotFoundError,
  BusinessRuleViolationError,
  TenantAccessDeniedError,
  BusEventSchema,
  TenantContextSchema,
  EditEventSchema,
  EditOperationSchema,
} from './domain';
export type {
  BusEvent,
  TenantContext,
  EditEvent,
  EditOperation,
} from './domain';
```

- [ ] **Step 3: Run full event-processor test suite**

Run: `npx nx test event-processor`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add libs/event-processor/src/domain/index.ts libs/event-processor/src/index.ts
git commit -m "feat(event-processor): export domain types from barrel"
```

---

## Chunk 2: Distribute events, schemas, and models to publishing services

Each publishing service gets a `src/domain/` folder with `events.ts` (+ optional `schemas.ts`, `models.ts`) and an `index.ts` barrel that exports everything. The barrel is what consumers import via the tsconfig alias.

### Task 4: investor-bff — events, schemas, models, barrel

**Files:**
- Create: `services/investor/investor-bff/src/domain/events.ts`
- Create: `services/investor/investor-bff/src/domain/schemas.ts`
- Create: `services/investor/investor-bff/src/domain/models.ts`
- Create: `services/investor/investor-bff/src/domain/index.ts`

- [ ] **Step 1: Create events.ts**

```typescript
// services/investor/investor-bff/src/domain/events.ts
export const InvestorBffEventTypes = {
  // investor-web
  USER_REGISTERED: 'USER_REGISTERED',
  USER_AUTHENTICATED: 'USER_AUTHENTICATED',
  USER_SESSION_EXPIRED: 'USER_SESSION_EXPIRED',
  USER_DELETION_REQUESTED: 'USER_DELETION_REQUESTED',
  PII_REMOVED: 'PII_REMOVED',
  TENANT_ANONYMIZED: 'TENANT_ANONYMIZED',
  // investor-bff
  ONBOARDING_ANSWER_RECORDED: 'ONBOARDING_ANSWER_RECORDED',
  ONBOARDING_COMPLETED: 'ONBOARDING_COMPLETED',
  GOAL_SET: 'GOAL_SET',
  GOAL_UPDATED: 'GOAL_UPDATED',
  RISK_PROFILE_SET: 'RISK_PROFILE_SET',
  RISK_PROFILE_UPDATED: 'RISK_PROFILE_UPDATED',
  MANDATE_GRANTED: 'MANDATE_GRANTED',
  MANDATE_UPDATED: 'MANDATE_UPDATED',
  MANDATE_REVOKED: 'MANDATE_REVOKED',
  OPERATING_MODE_SELECTED: 'OPERATING_MODE_SELECTED',
  OPERATING_MODE_CHANGED: 'OPERATING_MODE_CHANGED',
  DEPOSIT_INITIATED: 'DEPOSIT_INITIATED',
  WITHDRAWAL_REQUESTED: 'WITHDRAWAL_REQUESTED',
  ACCOUNT_CLOSURE_REQUESTED: 'ACCOUNT_CLOSURE_REQUESTED',
  ACCOUNT_CLOSED: 'ACCOUNT_CLOSED',
  BROKER_AUTHORIZATION_REVOKED: 'BROKER_AUTHORIZATION_REVOKED',
  NOTIFICATION_READ: 'NOTIFICATION_READ',
} as const;

export type InvestorBffEventType =
  (typeof InvestorBffEventTypes)[keyof typeof InvestorBffEventTypes];
```

- [ ] **Step 2: Create schemas.ts**

Copy `libs/domain-core/src/investor/schemas.ts` verbatim, but change the import:
```typescript
// OLD: import { BusEventSchema } from '../shared/types';
// NEW:
import { BusEventSchema } from '@nestfolio/event-processor';
```

- [ ] **Step 3: Create models.ts**

Copy `libs/domain-core/src/investor/models.ts` verbatim.

- [ ] **Step 4: Create barrel index.ts**

```typescript
// services/investor/investor-bff/src/domain/index.ts
export { InvestorBffEventTypes } from './events';
export type { InvestorBffEventType } from './events';

export {
  MandateGrantedSchema,
  GoalUpdatedSchema,
  RiskProfileUpdatedSchema,
  OnboardingCompletedSchema,
  DepositInitiatedSchema,
} from './schemas';
export type {
  MandateGrantedEvent,
  GoalUpdatedEvent,
  RiskProfileUpdatedEvent,
  OnboardingCompletedEvent,
  DepositInitiatedEvent,
} from './schemas';

export type {
  InvestorProfile, Goal, RiskProfile, Mandate,
  OperatingMode, MandateLevel, RebalanceCadence,
  Notification, NotificationChannel, NotificationStatus,
} from './models';
```

- [ ] **Step 5: Commit**

```bash
git add services/investor/investor-bff/src/domain/
git commit -m "feat(investor-bff): add domain events, schemas, and models (from domain-core)"
```

---

### Task 5: investor-ctrl — events + barrel

**Files:**
- Create: `services/investor/investor-ctrl/src/domain/events.ts`
- Create: `services/investor/investor-ctrl/src/domain/index.ts`

- [ ] **Step 1: Create events.ts**

```typescript
// services/investor/investor-ctrl/src/domain/events.ts
export const InvestorCtrlEventTypes = {
  NOTIFICATION_CREATED: 'NOTIFICATION_CREATED',
  NOTIFICATION_SENT: 'NOTIFICATION_SENT',
  NOTIFICATION_DELIVERED: 'NOTIFICATION_DELIVERED',
  MONTHLY_REPORT_GENERATED: 'MONTHLY_REPORT_GENERATED',
} as const;

export type InvestorCtrlEventType =
  (typeof InvestorCtrlEventTypes)[keyof typeof InvestorCtrlEventTypes];
```

- [ ] **Step 2: Create barrel**

```typescript
// services/investor/investor-ctrl/src/domain/index.ts
export { InvestorCtrlEventTypes } from './events';
export type { InvestorCtrlEventType } from './events';
```

- [ ] **Step 3: Commit**

```bash
git add services/investor/investor-ctrl/src/domain/
git commit -m "feat(investor-ctrl): add domain events (from domain-core)"
```

---

### Task 6: advisory-ctrl — events, schemas, models, barrel

**Files:**
- Create: `services/advisory/advisory-ctrl/src/domain/events.ts`
- Create: `services/advisory/advisory-ctrl/src/domain/schemas.ts`
- Create: `services/advisory/advisory-ctrl/src/domain/models.ts`
- Create: `services/advisory/advisory-ctrl/src/domain/index.ts`

- [ ] **Step 1: Create events.ts**

```typescript
// services/advisory/advisory-ctrl/src/domain/events.ts
export const AdvisoryCtrlEventTypes = {
  // advisory-ctrl
  AGENT_INVOCATION_STARTED: 'AGENT_INVOCATION_STARTED',
  AGENT_INVOCATION_COMPLETED: 'AGENT_INVOCATION_COMPLETED',
  AGENT_EXECUTION_FAILED: 'AGENT_EXECUTION_FAILED',
  GOAL_INTERPRETATION_PRODUCED: 'GOAL_INTERPRETATION_PRODUCED',
  RISK_EVALUATION_PRODUCED: 'RISK_EVALUATION_PRODUCED',
  MARKET_SIGNAL_DETECTED: 'MARKET_SIGNAL_DETECTED',
  PORTFOLIO_CONSTRUCTION_PROPOSED: 'PORTFOLIO_CONSTRUCTION_PROPOSED',
  REBALANCE_PLAN_PRODUCED: 'REBALANCE_PLAN_PRODUCED',
  RECOMMENDATION_PROPOSED: 'RECOMMENDATION_PROPOSED',
  EXPLANATION_GENERATED: 'EXPLANATION_GENERATED',
  DECISION_PACKET_CREATED: 'DECISION_PACKET_CREATED',
  DECISION_PACKET_ENRICHED: 'DECISION_PACKET_ENRICHED',
  USER_CONFIRMATION_REQUESTED: 'USER_CONFIRMATION_REQUESTED',
  // operations-ctrl
  INCIDENT_DETECTED: 'INCIDENT_DETECTED',
  INCIDENT_CONTAINED: 'INCIDENT_CONTAINED',
  INCIDENT_ESCALATED: 'INCIDENT_ESCALATED',
  INCIDENT_RESOLVED: 'INCIDENT_RESOLVED',
  CIRCUIT_BREAKER_TRIGGERED: 'CIRCUIT_BREAKER_TRIGGERED',
  CIRCUIT_BREAKER_RESET: 'CIRCUIT_BREAKER_RESET',
  HEALTH_CHECK_COMPLETED: 'HEALTH_CHECK_COMPLETED',
  MODEL_REGISTERED: 'MODEL_REGISTERED',
  SHADOW_RUN_STARTED: 'SHADOW_RUN_STARTED',
  SHADOW_RUN_COMPLETED: 'SHADOW_RUN_COMPLETED',
  MODEL_PROMOTION_REQUESTED: 'MODEL_PROMOTION_REQUESTED',
  MODEL_PROMOTION_APPROVED: 'MODEL_PROMOTION_APPROVED',
  MODEL_PROMOTED: 'MODEL_PROMOTED',
  MODEL_ROLLBACK_TRIGGERED: 'MODEL_ROLLBACK_TRIGGERED',
  TENANT_BUDGET_APPROACHING: 'TENANT_BUDGET_APPROACHING',
  TENANT_BUDGET_EXCEEDED: 'TENANT_BUDGET_EXCEEDED',
  REASONING_TIER_CHANGED: 'REASONING_TIER_CHANGED',
  OPERATOR_ACTION_PERFORMED: 'OPERATOR_ACTION_PERFORMED',
  EVENT_DELIVERY_FAILED: 'EVENT_DELIVERY_FAILED',
  EVENT_REPLAYED: 'EVENT_REPLAYED',
} as const;

export type AdvisoryCtrlEventType =
  (typeof AdvisoryCtrlEventTypes)[keyof typeof AdvisoryCtrlEventTypes];
```

- [ ] **Step 2: Create schemas.ts**

Only schemas for events advisory-ctrl publishes (NOT DecisionApprovedSchema/DecisionBlockedSchema — those belong to compliance-ctrl):

```typescript
// services/advisory/advisory-ctrl/src/domain/schemas.ts
import { z } from 'zod';
import { BusEventSchema } from '@nestfolio/event-processor';

export const DecisionPacketCreatedSchema = BusEventSchema.extend({
  type: z.literal('DECISION_PACKET_CREATED'),
  subject: z.object({
    decisionId: z.string(),
    trigger: z.string(),
    tenantId: z.string().uuid(),
  }),
});

export type DecisionPacketCreatedEvent = z.infer<typeof DecisionPacketCreatedSchema>;

export const UserConfirmationRequestedSchema = BusEventSchema.extend({
  type: z.literal('USER_CONFIRMATION_REQUESTED'),
  subject: z.object({
    decisionId: z.string(),
    tenantId: z.string().uuid(),
    summary: z.string(),
    expiresAt: z.string().datetime(),
  }),
});

export type UserConfirmationRequestedEvent = z.infer<typeof UserConfirmationRequestedSchema>;
```

- [ ] **Step 3: Create models.ts**

Copy `libs/domain-core/src/advisory/models.ts` verbatim.

- [ ] **Step 4: Create barrel**

```typescript
// services/advisory/advisory-ctrl/src/domain/index.ts
export { AdvisoryCtrlEventTypes } from './events';
export type { AdvisoryCtrlEventType } from './events';

export {
  DecisionPacketCreatedSchema,
  UserConfirmationRequestedSchema,
} from './schemas';
export type {
  DecisionPacketCreatedEvent,
  UserConfirmationRequestedEvent,
} from './schemas';

export type {
  DecisionPacket, ProposedTrade, ComplianceCheck, AgentInvocation,
  DecisionStatus, ComplianceLevel, ComplianceResult,
} from './models';
```

- [ ] **Step 5: Commit**

```bash
git add services/advisory/advisory-ctrl/src/domain/
git commit -m "feat(advisory-ctrl): add domain events, schemas, and models (from domain-core)"
```

---

### Task 7: advisory-bff — events + barrel

**Files:**
- Create: `services/advisory/advisory-bff/src/domain/events.ts`
- Create: `services/advisory/advisory-bff/src/domain/index.ts`

- [ ] **Step 1: Create events.ts**

```typescript
// services/advisory/advisory-bff/src/domain/events.ts
export const AdvisoryBffEventTypes = {
  USER_CONFIRMED: 'USER_CONFIRMED',
  USER_REJECTED: 'USER_REJECTED',
  USER_VIEWED_EXPLANATION: 'USER_VIEWED_EXPLANATION',
} as const;

export type AdvisoryBffEventType =
  (typeof AdvisoryBffEventTypes)[keyof typeof AdvisoryBffEventTypes];
```

- [ ] **Step 2: Create barrel**

```typescript
// services/advisory/advisory-bff/src/domain/index.ts
export { AdvisoryBffEventTypes } from './events';
export type { AdvisoryBffEventType } from './events';
```

- [ ] **Step 3: Commit**

```bash
git add services/advisory/advisory-bff/src/domain/
git commit -m "feat(advisory-bff): add domain events (from domain-core)"
```

---

### Task 8: compliance-ctrl — events, schemas, barrel

**Files:**
- Create: `services/advisory/compliance-ctrl/src/domain/events.ts`
- Create: `services/advisory/compliance-ctrl/src/domain/schemas.ts`
- Create: `services/advisory/compliance-ctrl/src/domain/index.ts`

- [ ] **Step 1: Create events.ts**

```typescript
// services/advisory/compliance-ctrl/src/domain/events.ts
export const ComplianceEventTypes = {
  DECISION_APPROVED: 'DECISION_APPROVED',
  DECISION_BLOCKED: 'DECISION_BLOCKED',
  GUARDRAIL_VIOLATION_DETECTED: 'GUARDRAIL_VIOLATION_DETECTED',
  ESCALATION_TRIGGERED: 'ESCALATION_TRIGGERED',
  COMPLIANCE_APPROVAL_GRANTED: 'COMPLIANCE_APPROVAL_GRANTED',
  AUDIT_ARTIFACT_CREATED: 'AUDIT_ARTIFACT_CREATED',
  SUITABILITY_CHECK_PASSED: 'SUITABILITY_CHECK_PASSED',
  SUITABILITY_CHECK_FAILED: 'SUITABILITY_CHECK_FAILED',
} as const;

export type ComplianceEventType =
  (typeof ComplianceEventTypes)[keyof typeof ComplianceEventTypes];
```

- [ ] **Step 2: Create schemas.ts**

Compliance-ctrl publishes DECISION_APPROVED and DECISION_BLOCKED:

```typescript
// services/advisory/compliance-ctrl/src/domain/schemas.ts
import { z } from 'zod';
import { BusEventSchema } from '@nestfolio/event-processor';

export const DecisionApprovedSchema = BusEventSchema.extend({
  type: z.literal('DECISION_APPROVED'),
  subject: z.object({
    decisionId: z.string(),
    complianceLevel: z.enum(['L1', 'L2', 'L3']),
    approvedAt: z.string().datetime(),
  }),
});

export type DecisionApprovedEvent = z.infer<typeof DecisionApprovedSchema>;

export const DecisionBlockedSchema = BusEventSchema.extend({
  type: z.literal('DECISION_BLOCKED'),
  subject: z.object({
    decisionId: z.string(),
    reason: z.string(),
    violatedRules: z.array(z.string()),
    blockedAt: z.string().datetime(),
  }),
});

export type DecisionBlockedEvent = z.infer<typeof DecisionBlockedSchema>;
```

- [ ] **Step 3: Create barrel**

```typescript
// services/advisory/compliance-ctrl/src/domain/index.ts
export { ComplianceEventTypes } from './events';
export type { ComplianceEventType } from './events';

export { DecisionApprovedSchema, DecisionBlockedSchema } from './schemas';
export type { DecisionApprovedEvent, DecisionBlockedEvent } from './schemas';
```

- [ ] **Step 4: Commit**

```bash
git add services/advisory/compliance-ctrl/src/domain/
git commit -m "feat(compliance-ctrl): add domain events and schemas (from domain-core)"
```

---

### Task 9: execution-ctrl — events, schemas, models, barrel

**Files:**
- Create: `services/execution/execution-ctrl/src/domain/events.ts`
- Create: `services/execution/execution-ctrl/src/domain/schemas.ts`
- Create: `services/execution/execution-ctrl/src/domain/models.ts`
- Create: `services/execution/execution-ctrl/src/domain/index.ts`

- [ ] **Step 1: Create events.ts**

Only events published by execution-ctrl:

```typescript
// services/execution/execution-ctrl/src/domain/events.ts
export const ExecutionCtrlEventTypes = {
  ORDER_SUBMITTED: 'ORDER_SUBMITTED',
  ORDER_STAGED: 'ORDER_STAGED',
  EXECUTION_PAUSED: 'EXECUTION_PAUSED',
  EXECUTION_RESUMED: 'EXECUTION_RESUMED',
} as const;

export type ExecutionCtrlEventType =
  (typeof ExecutionCtrlEventTypes)[keyof typeof ExecutionCtrlEventTypes];
```

- [ ] **Step 2: Create schemas.ts**

Only the schema for events execution-ctrl publishes (ORDER_SUBMITTED):

```typescript
// services/execution/execution-ctrl/src/domain/schemas.ts
import { z } from 'zod';
import { BusEventSchema } from '@nestfolio/event-processor';

export const OrderSubmittedSchema = BusEventSchema.extend({
  type: z.literal('ORDER_SUBMITTED'),
  subject: z.object({
    orderId: z.string(),
    decisionId: z.string(),
    symbol: z.string(),
    side: z.enum(['BUY', 'SELL']),
    type: z.enum(['MARKET', 'LIMIT']),
    quantity: z.number().positive(),
    limitPrice: z.number().positive().nullable(),
    currency: z.string().length(3),
  }),
});

export type OrderSubmittedEvent = z.infer<typeof OrderSubmittedSchema>;
```

- [ ] **Step 3: Create models.ts**

Copy `libs/domain-core/src/execution/models.ts` but **exclude** `Reconciliation` and `ReconciliationStatus` (those belong to reconciliation-ctrl). Keep: `Order`, `Portfolio`, `Position`, `OrderStatus`, `OrderSide`, `OrderType`.

- [ ] **Step 4: Create barrel**

```typescript
// services/execution/execution-ctrl/src/domain/index.ts
export { ExecutionCtrlEventTypes } from './events';
export type { ExecutionCtrlEventType } from './events';

export { OrderSubmittedSchema } from './schemas';
export type { OrderSubmittedEvent } from './schemas';

export type {
  Order, Portfolio, Position,
  OrderStatus, OrderSide, OrderType,
} from './models';
```

- [ ] **Step 5: Commit**

```bash
git add services/execution/execution-ctrl/src/domain/
git commit -m "feat(execution-ctrl): add domain events, schemas, and models (from domain-core)"
```

---

### Task 10: execution-adpt — events, schemas, barrel

**Files:**
- Create: `services/execution/execution-adpt/src/domain/events.ts`
- Create: `services/execution/execution-adpt/src/domain/schemas.ts`
- Create: `services/execution/execution-adpt/src/domain/index.ts`

- [ ] **Step 1: Create events.ts**

```typescript
// services/execution/execution-adpt/src/domain/events.ts
export const ExecutionAdptEventTypes = {
  ORDER_ACCEPTED: 'ORDER_ACCEPTED',
  ORDER_PARTIALLY_FILLED: 'ORDER_PARTIALLY_FILLED',
  ORDER_FILLED: 'ORDER_FILLED',
  ORDER_REJECTED: 'ORDER_REJECTED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  PORTFOLIO_SNAPSHOT_IMPORTED: 'PORTFOLIO_SNAPSHOT_IMPORTED',
  BROKER_SESSION_ESTABLISHED: 'BROKER_SESSION_ESTABLISHED',
  BROKER_SESSION_LOST: 'BROKER_SESSION_LOST',
  STREAM_CONNECTED: 'STREAM_CONNECTED',
  STREAM_DISCONNECTED: 'STREAM_DISCONNECTED',
  BROKER_AUTHORIZATION_REVOKED: 'BROKER_AUTHORIZATION_REVOKED',
  DEPOSIT_DETECTED: 'DEPOSIT_DETECTED',
  WITHDRAWAL_SUBMITTED: 'WITHDRAWAL_SUBMITTED',
  WITHDRAWAL_COMPLETED: 'WITHDRAWAL_COMPLETED',
  WITHDRAWAL_REJECTED: 'WITHDRAWAL_REJECTED',
} as const;

export type ExecutionAdptEventType =
  (typeof ExecutionAdptEventTypes)[keyof typeof ExecutionAdptEventTypes];
```

- [ ] **Step 2: Create schemas.ts**

Schemas for events published by execution-adpt:

```typescript
// services/execution/execution-adpt/src/domain/schemas.ts
import { z } from 'zod';
import { BusEventSchema } from '@nestfolio/event-processor';

export const OrderFilledSchema = BusEventSchema.extend({
  type: z.literal('ORDER_FILLED'),
  subject: z.object({
    orderId: z.string(),
    brokerOrderId: z.string(),
    filledQuantity: z.number().positive(),
    averageFillPrice: z.number().positive(),
    filledAt: z.string().datetime(),
  }),
});

export type OrderFilledEvent = z.infer<typeof OrderFilledSchema>;

export const DepositDetectedSchema = BusEventSchema.extend({
  type: z.literal('DEPOSIT_DETECTED'),
  subject: z.object({
    depositId: z.string(),
    amountCents: z.number().int().positive(),
    currency: z.string().length(3),
    detectedAt: z.string().datetime(),
  }),
});

export type DepositDetectedEvent = z.infer<typeof DepositDetectedSchema>;
```

- [ ] **Step 3: Create barrel**

```typescript
// services/execution/execution-adpt/src/domain/index.ts
export { ExecutionAdptEventTypes } from './events';
export type { ExecutionAdptEventType } from './events';

export { OrderFilledSchema, DepositDetectedSchema } from './schemas';
export type { OrderFilledEvent, DepositDetectedEvent } from './schemas';
```

- [ ] **Step 4: Commit**

```bash
git add services/execution/execution-adpt/src/domain/
git commit -m "feat(execution-adpt): add domain events and schemas (from domain-core)"
```

---

### Task 11: ledger-ctrl — events + barrel

**Files:**
- Create: `services/ledger/ledger-ctrl/src/domain/events.ts`
- Create: `services/ledger/ledger-ctrl/src/domain/index.ts`

- [ ] **Step 1: Create events.ts**

```typescript
// services/ledger/ledger-ctrl/src/domain/events.ts
export const LedgerCtrlEventTypes = {
  BALANCE_UPDATED: 'BALANCE_UPDATED',
  PORTFOLIO_UPDATED: 'PORTFOLIO_UPDATED',
  LEDGER_ENTRY_RECORDED: 'LEDGER_ENTRY_RECORDED',
  LEDGER_PROCESSING_FAILED: 'LEDGER_PROCESSING_FAILED',
  LEDGER_SIMULATION_FAILED: 'LEDGER_SIMULATION_FAILED',
} as const;

export type LedgerCtrlEventType =
  (typeof LedgerCtrlEventTypes)[keyof typeof LedgerCtrlEventTypes];
```

- [ ] **Step 2: Create barrel**

```typescript
// services/ledger/ledger-ctrl/src/domain/index.ts
export { LedgerCtrlEventTypes } from './events';
export type { LedgerCtrlEventType } from './events';
```

- [ ] **Step 3: Commit**

```bash
git add services/ledger/ledger-ctrl/src/domain/
git commit -m "feat(ledger-ctrl): add domain events (from domain-core)"
```

---

### Task 12: reconciliation-ctrl — events, schemas, models, barrel

**Files:**
- Create: `services/ledger/reconciliation-ctrl/src/domain/events.ts`
- Create: `services/ledger/reconciliation-ctrl/src/domain/schemas.ts`
- Create: `services/ledger/reconciliation-ctrl/src/domain/models.ts`
- Create: `services/ledger/reconciliation-ctrl/src/domain/index.ts`

- [ ] **Step 1: Create events.ts**

```typescript
// services/ledger/reconciliation-ctrl/src/domain/events.ts
export const ReconciliationEventTypes = {
  PORTFOLIO_DRIFT_DETECTED: 'PORTFOLIO_DRIFT_DETECTED',
  RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
  RECONCILIATION_STARTED: 'RECONCILIATION_STARTED',
  RECONCILIATION_COMPLETED: 'RECONCILIATION_COMPLETED',
  RECONCILIATION_FAILED: 'RECONCILIATION_FAILED',
  RECONCILIATION_LOCK_ACQUIRED: 'RECONCILIATION_LOCK_ACQUIRED',
  RECONCILIATION_LOCK_RELEASED: 'RECONCILIATION_LOCK_RELEASED',
  PROJECTION_REBUILT: 'PROJECTION_REBUILT',
  CORPORATE_ACTION_APPLIED: 'CORPORATE_ACTION_APPLIED',
} as const;

export type ReconciliationEventType =
  (typeof ReconciliationEventTypes)[keyof typeof ReconciliationEventTypes];
```

- [ ] **Step 2: Create schemas.ts**

```typescript
// services/ledger/reconciliation-ctrl/src/domain/schemas.ts
import { z } from 'zod';
import { BusEventSchema } from '@nestfolio/event-processor';

export const PortfolioDriftDetectedSchema = BusEventSchema.extend({
  type: z.literal('PORTFOLIO_DRIFT_DETECTED'),
  subject: z.object({
    portfolioId: z.string(),
    driftPercent: z.number().min(0),
    threshold: z.number().min(0),
    driftDetails: z.array(
      z.object({
        symbol: z.string(),
        currentWeight: z.number(),
        targetWeight: z.number(),
        delta: z.number(),
      }),
    ),
  }),
});

export type PortfolioDriftDetectedEvent = z.infer<typeof PortfolioDriftDetectedSchema>;
```

- [ ] **Step 3: Create models.ts**

Extract `Reconciliation` and `ReconciliationStatus` from `libs/domain-core/src/execution/models.ts`:

```typescript
// services/ledger/reconciliation-ctrl/src/domain/models.ts
/** Reconciliation status. */
export type ReconciliationStatus =
  | 'REQUIRED'
  | 'STARTED'
  | 'COMPLETED'
  | 'FAILED';

/** Result of a portfolio reconciliation. */
export interface Reconciliation {
  readonly reconciliationId: string;
  readonly tenantId: string;
  readonly portfolioId: string;
  readonly status: ReconciliationStatus;
  readonly discrepancies: ReadonlyArray<{
    readonly symbol: string;
    readonly expectedQuantity: number;
    readonly actualQuantity: number;
    readonly delta: number;
  }>;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly failedAt: string | null;
  readonly failureReason: string | null;
}
```

- [ ] **Step 4: Create barrel**

```typescript
// services/ledger/reconciliation-ctrl/src/domain/index.ts
export { ReconciliationEventTypes } from './events';
export type { ReconciliationEventType } from './events';

export { PortfolioDriftDetectedSchema } from './schemas';
export type { PortfolioDriftDetectedEvent } from './schemas';

export type { Reconciliation, ReconciliationStatus } from './models';
```

- [ ] **Step 5: Commit**

```bash
git add services/ledger/reconciliation-ctrl/src/domain/
git commit -m "feat(reconciliation-ctrl): add domain events, schemas, and models (from domain-core)"
```

---

## Chunk 3: Add tsconfig aliases + rewire source imports

### Task 13: Add service domain path aliases to tsconfig.base.json

**Files:**
- Modify: `tsconfig.base.json`

- [ ] **Step 1: Add path aliases for all 9 publisher services**

Add these entries to the `paths` object in `tsconfig.base.json`:

```json
"@nestfolio/investor-bff/domain": ["services/investor/investor-bff/src/domain/index.ts"],
"@nestfolio/investor-ctrl/domain": ["services/investor/investor-ctrl/src/domain/index.ts"],
"@nestfolio/advisory-ctrl/domain": ["services/advisory/advisory-ctrl/src/domain/index.ts"],
"@nestfolio/advisory-bff/domain": ["services/advisory/advisory-bff/src/domain/index.ts"],
"@nestfolio/compliance-ctrl/domain": ["services/advisory/compliance-ctrl/src/domain/index.ts"],
"@nestfolio/execution-ctrl/domain": ["services/execution/execution-ctrl/src/domain/index.ts"],
"@nestfolio/execution-adpt/domain": ["services/execution/execution-adpt/src/domain/index.ts"],
"@nestfolio/ledger-ctrl/domain": ["services/ledger/ledger-ctrl/src/domain/index.ts"],
"@nestfolio/reconciliation-ctrl/domain": ["services/ledger/reconciliation-ctrl/src/domain/index.ts"]
```

- [ ] **Step 2: Commit**

```bash
git add tsconfig.base.json
git commit -m "build: add tsconfig path aliases for service domain barrels"
```

---

### Task 14: Rewire source file imports (9 files that import from @nestfolio/domain-core)

**Files:**
- Modify: `services/investor/investor-bff/src/repositories/investor-profile.repository.ts`
- Modify: `services/advisory/advisory-ctrl/src/services/decision-lifecycle.service.ts`
- Modify: `services/advisory/compliance-ctrl/src/repositories/compliance.repository.ts`
- Modify: `services/advisory/compliance-ctrl/src/rules/rule-engine.ts`
- Modify: `services/execution/execution-ctrl/src/repositories/order.repository.ts`
- Modify: `services/execution/execution-ctrl/src/services/order-lifecycle.service.ts`
- Modify: `services/execution/execution-ctrl/src/services/safety-checks.service.ts`
- Modify: `apps/investor-mfe/src/app/services/onboarding.service.ts`

- [ ] **Step 1: investor-bff — investor-profile.repository.ts**

Change:
```typescript
import { EntityNotFoundError } from '@nestfolio/domain-core';
import type {
  Goal, RiskProfile, Mandate, OperatingMode,
  MandateLevel, RebalanceCadence, Notification,
} from '@nestfolio/domain-core';
```

To:
```typescript
import { EntityNotFoundError } from '@nestfolio/event-processor';
import type {
  Goal, RiskProfile, Mandate, OperatingMode,
  MandateLevel, RebalanceCadence, Notification,
} from '../domain/models';
```

- [ ] **Step 2: advisory-ctrl — decision-lifecycle.service.ts**

Change:
```typescript
import type { ProposedTrade } from '@nestfolio/domain-core';
```

To:
```typescript
import type { ProposedTrade } from '../domain/models';
```

- [ ] **Step 3: compliance-ctrl — compliance.repository.ts**

Change:
```typescript
import { EntityNotFoundError } from '@nestfolio/domain-core';
```

To:
```typescript
import { EntityNotFoundError } from '@nestfolio/event-processor';
```

- [ ] **Step 4: compliance-ctrl — rule-engine.ts**

Change:
```typescript
import type { MandateLevel } from '@nestfolio/domain-core';
```

To (import from the publisher):
```typescript
import type { MandateLevel } from '@nestfolio/investor-bff/domain';
```

- [ ] **Step 5: execution-ctrl — 3 files (order.repository.ts, order-lifecycle.service.ts, safety-checks.service.ts)**

In all three files, change:
```typescript
import type { ProposedTrade } from '@nestfolio/domain-core';
```

To (import from the publisher — advisory-ctrl owns ProposedTrade):
```typescript
import type { ProposedTrade } from '@nestfolio/advisory-ctrl/domain';
```

- [ ] **Step 6: investor-mfe — onboarding.service.ts**

Change:
```typescript
import type { Goal, Mandate, RiskProfile } from '@nestfolio/domain-core';
```

To (import from the publisher):
```typescript
import type { Goal, Mandate, RiskProfile } from '@nestfolio/investor-bff/domain';
```

- [ ] **Step 7: Verify no remaining @nestfolio/domain-core imports in source files**

Run: `grep -r "@nestfolio/domain-core" --include="*.ts" libs/*/src/ services/*/src/ services/*/*/src/ apps/*/src/`
Expected: NO MATCHES (test files may still match — handled in Task 16)

- [ ] **Step 8: Commit**

```bash
git add services/investor/investor-bff/src/repositories/investor-profile.repository.ts \
  services/advisory/advisory-ctrl/src/services/decision-lifecycle.service.ts \
  services/advisory/compliance-ctrl/src/repositories/compliance.repository.ts \
  services/advisory/compliance-ctrl/src/rules/rule-engine.ts \
  services/execution/execution-ctrl/src/repositories/order.repository.ts \
  services/execution/execution-ctrl/src/services/order-lifecycle.service.ts \
  services/execution/execution-ctrl/src/services/safety-checks.service.ts \
  apps/investor-mfe/src/app/services/onboarding.service.ts
git commit -m "refactor: replace all @nestfolio/domain-core source imports with event-processor + service domain aliases"
```

---

### Task 15: Rewire event-listener.ts files to use typed imports from producers

Replace string literals in each consumer's event-listener.ts with imported constants from the producer service. Event types not originating from domain-core (e.g., `ADVISORY_STATUS_CHANGED` in dashboard-bff) remain as string literals.

**Files:** All 11 `event-listener.ts` files across services.

- [ ] **Step 1: investor-bff event-listener.ts**

Add imports:
```typescript
import { InvestorBffEventTypes } from '../domain/events';
import { InvestorCtrlEventTypes } from '@nestfolio/investor-ctrl/domain';
import { LedgerCtrlEventTypes } from '@nestfolio/ledger-ctrl/domain';
```

Replace string literals:
- `'USER_REGISTERED'` → `InvestorBffEventTypes.USER_REGISTERED`
- `'NOTIFICATION_CREATED'` → `InvestorCtrlEventTypes.NOTIFICATION_CREATED`
- `'BALANCE_UPDATED'` → `LedgerCtrlEventTypes.BALANCE_UPDATED`

- [ ] **Step 2: investor-ctrl event-listener.ts**

Add imports:
```typescript
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/domain';
import { ComplianceEventTypes } from '@nestfolio/compliance-ctrl/domain';
import { ExecutionAdptEventTypes } from '@nestfolio/execution-adpt/domain';
import { LedgerCtrlEventTypes } from '@nestfolio/ledger-ctrl/domain';
```

Replace string literals:
- `'ONBOARDING_COMPLETED'` → `InvestorBffEventTypes.ONBOARDING_COMPLETED`
- `'MANDATE_GRANTED'` → `InvestorBffEventTypes.MANDATE_GRANTED`
- `'GOAL_UPDATED'` → `InvestorBffEventTypes.GOAL_UPDATED`
- `'DEPOSIT_INITIATED'` → `InvestorBffEventTypes.DEPOSIT_INITIATED`
- `'OPERATING_MODE_CHANGED'` → `InvestorBffEventTypes.OPERATING_MODE_CHANGED`
- `'DECISION_APPROVED'` → `ComplianceEventTypes.DECISION_APPROVED`
- `'ORDER_FILLED'` → `ExecutionAdptEventTypes.ORDER_FILLED`
- `'BALANCE_UPDATED'` → `LedgerCtrlEventTypes.BALANCE_UPDATED`

- [ ] **Step 3: dashboard-bff event-listener.ts**

Add imports:
```typescript
import { LedgerCtrlEventTypes } from '@nestfolio/ledger-ctrl/domain';
import { ReconciliationEventTypes } from '@nestfolio/reconciliation-ctrl/domain';
import { AdvisoryCtrlEventTypes } from '@nestfolio/advisory-ctrl/domain';
import { ComplianceEventTypes } from '@nestfolio/compliance-ctrl/domain';
```

Replace string literals:
- `'BALANCE_UPDATED'` → `LedgerCtrlEventTypes.BALANCE_UPDATED`
- `'PORTFOLIO_UPDATED'` → `LedgerCtrlEventTypes.PORTFOLIO_UPDATED`
- `'LEDGER_ENTRY_RECORDED'` → `LedgerCtrlEventTypes.LEDGER_ENTRY_RECORDED`
- `'RECONCILIATION_COMPLETED'` → `ReconciliationEventTypes.RECONCILIATION_COMPLETED`
- `'DECISION_PACKET_CREATED'` → `AdvisoryCtrlEventTypes.DECISION_PACKET_CREATED`
- `'USER_CONFIRMATION_REQUESTED'` → `AdvisoryCtrlEventTypes.USER_CONFIRMATION_REQUESTED`
- `'DECISION_APPROVED'` → `ComplianceEventTypes.DECISION_APPROVED`
- `'DECISION_BLOCKED'` → `ComplianceEventTypes.DECISION_BLOCKED`

Leave `INVESTOR_SNAPSHOT_UPDATED` as string literal (not from domain-core).

- [ ] **Step 4: advisory-ctrl event-listener.ts**

Add imports:
```typescript
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/domain';
import { AdvisoryBffEventTypes } from '@nestfolio/advisory-bff/domain';
import { ComplianceEventTypes } from '@nestfolio/compliance-ctrl/domain';
import { ExecutionAdptEventTypes } from '@nestfolio/execution-adpt/domain';
import { ReconciliationEventTypes } from '@nestfolio/reconciliation-ctrl/domain';
```

Replace string literals:
- `'MANDATE_GRANTED'` → `InvestorBffEventTypes.MANDATE_GRANTED`
- `'GOAL_UPDATED'` → `InvestorBffEventTypes.GOAL_UPDATED`
- `'RISK_PROFILE_UPDATED'` → `InvestorBffEventTypes.RISK_PROFILE_UPDATED`
- `'OPERATING_MODE_CHANGED'` → `InvestorBffEventTypes.OPERATING_MODE_CHANGED`
- `'ORDER_FILLED'` → `ExecutionAdptEventTypes.ORDER_FILLED`
- `'ORDER_REJECTED'` → `ExecutionAdptEventTypes.ORDER_REJECTED`
- `'ORDER_CANCELLED'` → `ExecutionAdptEventTypes.ORDER_CANCELLED`
- `'DEPOSIT_DETECTED'` → `ExecutionAdptEventTypes.DEPOSIT_DETECTED`
- `'PORTFOLIO_DRIFT_DETECTED'` → `ReconciliationEventTypes.PORTFOLIO_DRIFT_DETECTED`
- `'USER_CONFIRMED'` → `AdvisoryBffEventTypes.USER_CONFIRMED`
- `'USER_REJECTED'` → `AdvisoryBffEventTypes.USER_REJECTED`
- `'DECISION_APPROVED'` → `ComplianceEventTypes.DECISION_APPROVED`
- `'DECISION_BLOCKED'` → `ComplianceEventTypes.DECISION_BLOCKED`

- [ ] **Step 5: advisory-bff event-listener.ts**

Add imports:
```typescript
import { AdvisoryCtrlEventTypes } from '@nestfolio/advisory-ctrl/domain';
import { ComplianceEventTypes } from '@nestfolio/compliance-ctrl/domain';
```

Replace string literals:
- `'DECISION_PACKET_CREATED'` → `AdvisoryCtrlEventTypes.DECISION_PACKET_CREATED`
- `'DECISION_PACKET_ENRICHED'` → `AdvisoryCtrlEventTypes.DECISION_PACKET_ENRICHED`
- `'USER_CONFIRMATION_REQUESTED'` → `AdvisoryCtrlEventTypes.USER_CONFIRMATION_REQUESTED`
- `'DECISION_APPROVED'` → `ComplianceEventTypes.DECISION_APPROVED`
- `'DECISION_BLOCKED'` → `ComplianceEventTypes.DECISION_BLOCKED`

- [ ] **Step 6: compliance-ctrl event-listener.ts**

Add imports:
```typescript
import { AdvisoryCtrlEventTypes } from '@nestfolio/advisory-ctrl/domain';
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/domain';
```

Replace string literals:
- `'DECISION_PACKET_CREATED'` → `AdvisoryCtrlEventTypes.DECISION_PACKET_CREATED`
- `'DECISION_PACKET_ENRICHED'` → `AdvisoryCtrlEventTypes.DECISION_PACKET_ENRICHED`
- `'MANDATE_GRANTED'` → `InvestorBffEventTypes.MANDATE_GRANTED`
- `'MANDATE_UPDATED'` → `InvestorBffEventTypes.MANDATE_UPDATED`
- `'MANDATE_REVOKED'` → `InvestorBffEventTypes.MANDATE_REVOKED`
- `'OPERATING_MODE_CHANGED'` → `InvestorBffEventTypes.OPERATING_MODE_CHANGED`

- [ ] **Step 7: execution-ctrl event-listener.ts**

Add imports:
```typescript
import { ComplianceEventTypes } from '@nestfolio/compliance-ctrl/domain';
import { AdvisoryBffEventTypes } from '@nestfolio/advisory-bff/domain';
import { AdvisoryCtrlEventTypes } from '@nestfolio/advisory-ctrl/domain';
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/domain';
```

Replace string literals:
- `'DECISION_APPROVED'` → `ComplianceEventTypes.DECISION_APPROVED`
- `'USER_CONFIRMED'` → `AdvisoryBffEventTypes.USER_CONFIRMED`
- `'CIRCUIT_BREAKER_TRIGGERED'` → `AdvisoryCtrlEventTypes.CIRCUIT_BREAKER_TRIGGERED`
- `'CIRCUIT_BREAKER_RESET'` → `AdvisoryCtrlEventTypes.CIRCUIT_BREAKER_RESET`
- `'ACCOUNT_CLOSURE_REQUESTED'` → `InvestorBffEventTypes.ACCOUNT_CLOSURE_REQUESTED`

- [ ] **Step 8: execution-adpt event-listener.ts**

Add imports:
```typescript
import { ExecutionCtrlEventTypes } from '@nestfolio/execution-ctrl/domain';
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/domain';
```

Replace string literals:
- `'ORDER_SUBMITTED'` → `ExecutionCtrlEventTypes.ORDER_SUBMITTED`
- `'WITHDRAWAL_REQUESTED'` → `InvestorBffEventTypes.WITHDRAWAL_REQUESTED`
- `'DEPOSIT_INITIATED'` → `InvestorBffEventTypes.DEPOSIT_INITIATED`

- [ ] **Step 9: ledger-ctrl event-listener.ts**

Add imports:
```typescript
import { ExecutionAdptEventTypes } from '@nestfolio/execution-adpt/domain';
import { AdvisoryCtrlEventTypes } from '@nestfolio/advisory-ctrl/domain';
```

Replace string literals:
- `'ORDER_FILLED'` → `ExecutionAdptEventTypes.ORDER_FILLED`
- `'ORDER_PARTIALLY_FILLED'` → `ExecutionAdptEventTypes.ORDER_PARTIALLY_FILLED`
- `'ORDER_REJECTED'` → `ExecutionAdptEventTypes.ORDER_REJECTED`
- `'ORDER_CANCELLED'` → `ExecutionAdptEventTypes.ORDER_CANCELLED`
- `'DEPOSIT_DETECTED'` → `ExecutionAdptEventTypes.DEPOSIT_DETECTED`
- `'WITHDRAWAL_COMPLETED'` → `ExecutionAdptEventTypes.WITHDRAWAL_COMPLETED`
- `'DECISION_PACKET_CREATED'` → `AdvisoryCtrlEventTypes.DECISION_PACKET_CREATED`
- `'CORPORATE_ACTION_PROCESSED'` stays as string literal (not from domain-core)

- [ ] **Step 10: ledger-bff event-listener.ts**

Add imports:
```typescript
import { LedgerCtrlEventTypes } from '@nestfolio/ledger-ctrl/domain';
```

Replace string literals:
- `'BALANCE_UPDATED'` → `LedgerCtrlEventTypes.BALANCE_UPDATED`
- `'PORTFOLIO_UPDATED'` → `LedgerCtrlEventTypes.PORTFOLIO_UPDATED`
- `'LEDGER_ENTRY_RECORDED'` → `LedgerCtrlEventTypes.LEDGER_ENTRY_RECORDED`

- [ ] **Step 11: reconciliation-ctrl event-listener.ts**

Add imports:
```typescript
import { LedgerCtrlEventTypes } from '@nestfolio/ledger-ctrl/domain';
import { ExecutionAdptEventTypes } from '@nestfolio/execution-adpt/domain';
```

Replace string literals:
- `'PORTFOLIO_UPDATED'` → `LedgerCtrlEventTypes.PORTFOLIO_UPDATED`
- `'PORTFOLIO_SNAPSHOT_IMPORTED'` → `ExecutionAdptEventTypes.PORTFOLIO_SNAPSHOT_IMPORTED`
- `'CORPORATE_ACTION_APPLIED'` stays as string literal (not from domain-core)

- [ ] **Step 12: Run full test suite to verify**

Run: `npx nx run-many -t test --all`
Expected: ALL PASS

- [ ] **Step 13: Commit**

```bash
git add services/*/src/handlers/event-listener.ts services/*/*/src/handlers/event-listener.ts
git commit -m "refactor: replace event type string literals with typed imports from producer services"
```

---

## Chunk 4: Fix test mocks + delete domain-core

### Task 16: Remove jest.mock('@nestfolio/domain-core') from all 18 test files

All 18 test files use `jest.mock('@nestfolio/domain-core', () => ({}))` as a safeguard. Since domain-core no longer exists, these mocks must be removed. Source files now import from `@nestfolio/event-processor` or `@nestfolio/<service>/domain`, so no replacement mock is needed — the real modules are used.

**Files (18 total):**

advisory-bff (4):
- `services/advisory/advisory-bff/test/decision-packet-created.pipe.test.ts`
- `services/advisory/advisory-bff/test/advisory.repository.test.ts`
- `services/advisory/advisory-bff/test/decision-status-changed.pipe.test.ts`
- `services/advisory/advisory-bff/test/event-listener.test.ts`

advisory-ctrl (2):
- `services/advisory/advisory-ctrl/test/event-listener.test.ts`
- `services/advisory/advisory-ctrl/test/decision-lifecycle.service.test.ts`

compliance-ctrl (2):
- `services/advisory/compliance-ctrl/test/compliance.repository.test.ts`
- `services/advisory/compliance-ctrl/test/event-listener.test.ts`

execution-ctrl (4):
- `services/execution/execution-ctrl/test/event-listener.test.ts`
- `services/execution/execution-ctrl/test/order.repository.test.ts`
- `services/execution/execution-ctrl/test/safety-checks.service.test.ts`
- `services/execution/execution-ctrl/test/order-lifecycle.service.test.ts`

investor-bff (2):
- `services/investor/investor-bff/test/investor-profile.repository.test.ts`
- `services/investor/investor-bff/test/event-listener.test.ts`

investor-ctrl (2):
- `services/investor/investor-ctrl/test/event-listener.test.ts`
- `services/investor/investor-ctrl/test/notification-lifecycle.service.test.ts`

reconciliation-ctrl (2):
- `services/ledger/reconciliation-ctrl/test/event-listener.test.ts`
- `services/ledger/reconciliation-ctrl/test/reconciliation.service.test.ts`

- [ ] **Step 1: Remove the mock line from all 18 files**

In each file, delete the line:
```typescript
jest.mock('@nestfolio/domain-core', () => ({}));
```

- [ ] **Step 2: Verify no remaining references to @nestfolio/domain-core**

Run: `grep -r "@nestfolio/domain-core" --include="*.ts" libs/ services/ apps/`
Expected: NO MATCHES

- [ ] **Step 3: Run full test suite**

Run: `npx nx run-many -t test --all`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add services/
git commit -m "test: remove jest.mock('@nestfolio/domain-core') from 18 test files"
```

---

### Task 17: Delete domain-core library

**Files:**
- Delete: `libs/domain-core/` (entire directory)
- Modify: `tsconfig.base.json` (remove path alias)

- [ ] **Step 1: Remove path aliases from tsconfig.base.json**

Remove these two lines from the `paths` object:
```json
"@nestfolio/domain-core": ["libs/domain-core/src/index.ts"],
"@nestfolio/domain-core/*": ["libs/domain-core/src/*"],
```

- [ ] **Step 2: Delete the domain-core library**

```bash
rm -rf libs/domain-core
```

- [ ] **Step 3: Run full test suite**

Run: `npx nx run-many -t test --all`
Expected: ALL projects PASS

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove domain-core library — events/models distributed to services, shared types to event-processor"
```

---

## Summary

| Chunk | Tasks | What happens |
|-------|-------|-------------|
| **1** | 1–3 | Shared errors + schemas → `event-processor/src/domain/` |
| **2** | 4–12 | Events/schemas/models → 9 publishing services' `src/domain/` (with barrel index.ts each) |
| **3** | 13–15 | tsconfig aliases + rewire 9 source imports + rewire 11 event-listener.ts (string literals → typed imports) |
| **4** | 16–17 | Remove 18 test mocks + delete `libs/domain-core/` |

**Total: 17 tasks, ~35 files created, ~30 files modified, 1 directory deleted.**
