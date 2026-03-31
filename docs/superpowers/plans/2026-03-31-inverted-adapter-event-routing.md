# Inverted Adapter Event Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the push model (adapter forwards events to external buses) with a pull model (adapter ingests events from external buses into its own domain bus) for consumer autonomy.

**Architecture:** Each `{domain}-adpt` deploys EB rules on foreign domain buses filtered by `detailType`, targeting its own domain bus with a DLQ per source. The hub bus resource policy is expanded to allow rule management from consuming accounts. Existing `CrossDomainEventTypes` remain (used by same-domain services); new `IngestEventTypes` are added per adapter.

**Tech Stack:** AWS CDK (TypeScript), EventBridge, SQS, SSM

**Spec:** `docs/superpowers/specs/2026-03-31-inverted-adapter-event-routing-design.md`

---

## File Structure

### Shared Library (modify)
- `libs/cdk-constructs/src/extensions/cross-account.ts` — expand `CrossAccountBusPolicy` actions

### Investor Adapter (modify)
- `services/investor/investor-adpt/src/domain/events.ts` — add `InvestorIngestEventTypes`
- `services/investor/investor-adpt/src/domain/index.ts` — export new type
- `services/investor/investor-adpt/src/service.stack.ts` — rewrite: pull from Advisory, Execution, Ledger buses
- `services/investor/investor-adpt/test/service.stack.test.ts` — rewrite tests

### Advisory Adapter (modify)
- `services/advisory/advisory-adpt/src/domain/events.ts` — add `AdvisoryIngestEventTypes`
- `services/advisory/advisory-adpt/src/domain/index.ts` — export new type
- `services/advisory/advisory-adpt/src/service.stack.ts` — rewrite: pull from Investor, Execution, Ledger buses
- `services/advisory/advisory-adpt/test/service.stack.test.ts` — rewrite tests

### Execution Adapter (modify)
- `services/execution/execution-adpt/src/domain/events.ts` — add `ExecutionIngestEventTypes`
- `services/execution/execution-adpt/src/domain/index.ts` — export new type
- `services/execution/execution-adpt/src/service.stack.ts` — rewrite: pull from Advisory, Investor buses
- `services/execution/execution-adpt/test/service.stack.test.ts` — rewrite tests

### Ledger Adapter (modify)
- `services/ledger/ledger-adpt/src/domain/events.ts` — add `LedgerIngestEventTypes`
- `services/ledger/ledger-adpt/src/domain/index.ts` — export new type
- `services/ledger/ledger-adpt/src/service.stack.ts` — rewrite: pull from Execution bus
- `services/ledger/ledger-adpt/test/service.stack.test.ts` — rewrite tests

### Documentation (modify)
- `services/investor/investor-adpt/CLAUDE.md`
- `services/advisory/advisory-adpt/CLAUDE.md`
- `services/execution/execution-adpt/CLAUDE.md`
- `services/ledger/ledger-adpt/CLAUDE.md`

---

## Task 1: Expand CrossAccountBusPolicy

**Files:**
- Modify: `libs/cdk-constructs/src/extensions/cross-account.ts:88-105`

- [ ] **Step 1: Update the CfnEventBusPolicy statement to include rule-management actions**

In `libs/cdk-constructs/src/extensions/cross-account.ts`, replace the `CrossAccountBusPolicy` constructor body:

```typescript
export class CrossAccountBusPolicy extends Construct {
  constructor(scope: Construct, id: string, props: CrossAccountBusPolicyProps) {
    super(scope, id);

    const stack = Stack.of(this);
    const busArn = `arn:aws:events:${stack.region}:${stack.account}:event-bus/${props.eventBus.eventBusName}`;

    new CfnEventBusPolicy(this, 'Policy', {
      eventBusName: props.eventBus.eventBusName,
      statementId: 'AllowCrossAccountEventRouting',
      statement: {
        Effect: 'Allow',
        Principal: { AWS: props.consumerAccountIds.map(id => `arn:aws:iam::${id}:root`) },
        Action: [
          'events:PutEvents',
          'events:PutRule',
          'events:DeleteRule',
          'events:PutTargets',
          'events:RemoveTargets',
          'events:DescribeRule',
        ],
        Resource: busArn,
      },
    });
  }
}
```

- [ ] **Step 2: Verify the build passes**

Run: `pnpm nx run cdk-constructs:build`
Expected: BUILD SUCCESS

- [ ] **Step 3: Commit**

```bash
git add libs/cdk-constructs/src/extensions/cross-account.ts
git commit -m "feat(cdk-constructs): expand CrossAccountBusPolicy to allow rule management"
```

---

## Task 2: Investor Adapter — Ingest Event Types + Stack Rewrite

**Files:**
- Modify: `services/investor/investor-adpt/src/domain/events.ts`
- Modify: `services/investor/investor-adpt/src/domain/index.ts`
- Modify: `services/investor/investor-adpt/src/service.stack.ts`
- Modify: `services/investor/investor-adpt/test/service.stack.test.ts`

The investor domain consumes events from 3 external domains:
- **From Advisory:** DECISION_PACKET_CREATED, USER_CONFIRMATION_REQUESTED, EXPLANATION_GENERATED, DECISION_APPROVED, DECISION_BLOCKED, ESCALATION_TRIGGERED, CIRCUIT_BREAKER_TRIGGERED, CIRCUIT_BREAKER_RESET, INCIDENT_DETECTED, INCIDENT_RESOLVED
- **From Execution:** ORDER_STAGED, ORDER_REJECTED, ORDER_CANCELLED, WITHDRAWAL_REJECTED, WITHDRAWAL_COMPLETED, ORDER_ESCALATED, BROKER_CIRCUIT_OPEN
- **From Ledger:** BALANCE_UPDATED, PORTFOLIO_UPDATED, LEDGER_ENTRY_RECORDED, RECONCILIATION_COMPLETED, RECONCILIATION_FAILED, LEDGER_PROCESSING_FAILED

- [ ] **Step 1: Add InvestorIngestEventTypes to events.ts**

Append to `services/investor/investor-adpt/src/domain/events.ts` after the existing `InvestorCrossDomainEventTypes`:

```typescript
/**
 * Events ingested by the investor domain from external domain buses.
 * The investor adapter deploys EB rules on these foreign buses to pull events into InvestorBus.
 */
export const InvestorIngestEventTypes = {
  // From Advisory
  DECISION_PACKET_CREATED: 'DECISION_PACKET_CREATED',
  USER_CONFIRMATION_REQUESTED: 'USER_CONFIRMATION_REQUESTED',
  EXPLANATION_GENERATED: 'EXPLANATION_GENERATED',
  DECISION_APPROVED: 'DECISION_APPROVED',
  DECISION_BLOCKED: 'DECISION_BLOCKED',
  ESCALATION_TRIGGERED: 'ESCALATION_TRIGGERED',
  CIRCUIT_BREAKER_TRIGGERED: 'CIRCUIT_BREAKER_TRIGGERED',
  CIRCUIT_BREAKER_RESET: 'CIRCUIT_BREAKER_RESET',
  INCIDENT_DETECTED: 'INCIDENT_DETECTED',
  INCIDENT_RESOLVED: 'INCIDENT_RESOLVED',
  // From Execution
  ORDER_STAGED: 'ORDER_STAGED',
  ORDER_REJECTED: 'ORDER_REJECTED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  WITHDRAWAL_REJECTED: 'WITHDRAWAL_REJECTED',
  WITHDRAWAL_COMPLETED: 'WITHDRAWAL_COMPLETED',
  ORDER_ESCALATED: 'ORDER_ESCALATED',
  BROKER_CIRCUIT_OPEN: 'BROKER_CIRCUIT_OPEN',
  // From Ledger
  BALANCE_UPDATED: 'BALANCE_UPDATED',
  PORTFOLIO_UPDATED: 'PORTFOLIO_UPDATED',
  LEDGER_ENTRY_RECORDED: 'LEDGER_ENTRY_RECORDED',
  RECONCILIATION_COMPLETED: 'RECONCILIATION_COMPLETED',
  RECONCILIATION_FAILED: 'RECONCILIATION_FAILED',
  LEDGER_PROCESSING_FAILED: 'LEDGER_PROCESSING_FAILED',
} as const;
```

- [ ] **Step 2: Update index.ts barrel export**

Replace contents of `services/investor/investor-adpt/src/domain/index.ts`:

```typescript
export { InvestorCrossDomainEventTypes, InvestorIngestEventTypes } from './events';

/** Mandate level determines whether user confirmation is required. */
export type MandateLevel = 'ADVISORY' | 'DISCRETIONARY';
```

- [ ] **Step 3: Rewrite the stack — pull from foreign buses**

Replace the full contents of `services/investor/investor-adpt/src/service.stack.ts`:

```typescript
import { Duration } from 'aws-cdk-lib';
import { EventBus, Rule } from 'aws-cdk-lib/aws-events';
import { EventBus as EventBusTarget } from 'aws-cdk-lib/aws-events-targets';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps } from '@nestfolio/cdk-constructs/core';
import { Monitoring, ServiceDashboard } from '@nestfolio/cdk-constructs/observability';
import { getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';
import { InvestorIngestEventTypes } from './domain/events';

export class InvestorAdptStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props });

    const prefix = this.prefix;
    const domainAccounts = getDomainAccounts(this);

    // Consumer's own domain bus (target for all ingested events)
    const investorBusArn = resolveBusArn(this, 'InvestorBus', prefix, 'investor', domainAccounts);
    const investorBus = EventBus.fromEventBusArn(this, 'InvestorBus', investorBusArn);

    // External source buses
    const advisoryBusArn = resolveBusArn(this, 'AdvisoryBus', prefix, 'advisory', domainAccounts);
    const advisoryBus = EventBus.fromEventBusArn(this, 'AdvisoryBus', advisoryBusArn);

    const executionBusArn = resolveBusArn(this, 'ExecutionBus', prefix, 'execution', domainAccounts);
    const executionBus = EventBus.fromEventBusArn(this, 'ExecutionBus', executionBusArn);

    const ledgerBusArn = resolveBusArn(this, 'LedgerBus', prefix, 'ledger', domainAccounts);
    const ledgerBus = EventBus.fromEventBusArn(this, 'LedgerBus', ledgerBusArn);

    // Ingest: Advisory → Investor
    const fromAdvisoryDlq = new Queue(this, 'FromAdvisoryDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    new Rule(this, 'InvestorIngress-FromAdvisory', {
      eventBus: advisoryBus,
      eventPattern: {
        detailType: [
          InvestorIngestEventTypes.DECISION_PACKET_CREATED,
          InvestorIngestEventTypes.USER_CONFIRMATION_REQUESTED,
          InvestorIngestEventTypes.EXPLANATION_GENERATED,
          InvestorIngestEventTypes.DECISION_APPROVED,
          InvestorIngestEventTypes.DECISION_BLOCKED,
          InvestorIngestEventTypes.ESCALATION_TRIGGERED,
          InvestorIngestEventTypes.CIRCUIT_BREAKER_TRIGGERED,
          InvestorIngestEventTypes.CIRCUIT_BREAKER_RESET,
          InvestorIngestEventTypes.INCIDENT_DETECTED,
          InvestorIngestEventTypes.INCIDENT_RESOLVED,
        ],
      },
      targets: [new EventBusTarget(investorBus, { deadLetterQueue: fromAdvisoryDlq })],
    });

    // Ingest: Execution → Investor
    const fromExecutionDlq = new Queue(this, 'FromExecutionDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    new Rule(this, 'InvestorIngress-FromExecution', {
      eventBus: executionBus,
      eventPattern: {
        detailType: [
          InvestorIngestEventTypes.ORDER_STAGED,
          InvestorIngestEventTypes.ORDER_REJECTED,
          InvestorIngestEventTypes.ORDER_CANCELLED,
          InvestorIngestEventTypes.WITHDRAWAL_REJECTED,
          InvestorIngestEventTypes.WITHDRAWAL_COMPLETED,
          InvestorIngestEventTypes.ORDER_ESCALATED,
          InvestorIngestEventTypes.BROKER_CIRCUIT_OPEN,
        ],
      },
      targets: [new EventBusTarget(investorBus, { deadLetterQueue: fromExecutionDlq })],
    });

    // Ingest: Ledger → Investor
    const fromLedgerDlq = new Queue(this, 'FromLedgerDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    new Rule(this, 'InvestorIngress-FromLedger', {
      eventBus: ledgerBus,
      eventPattern: {
        detailType: [
          InvestorIngestEventTypes.BALANCE_UPDATED,
          InvestorIngestEventTypes.PORTFOLIO_UPDATED,
          InvestorIngestEventTypes.LEDGER_ENTRY_RECORDED,
          InvestorIngestEventTypes.RECONCILIATION_COMPLETED,
          InvestorIngestEventTypes.RECONCILIATION_FAILED,
          InvestorIngestEventTypes.LEDGER_PROCESSING_FAILED,
        ],
      },
      targets: [new EventBusTarget(investorBus, { deadLetterQueue: fromLedgerDlq })],
    });

    if (this.observability) {
      new Monitoring(this, 'Monitoring', {
        dlqs: [fromAdvisoryDlq, fromExecutionDlq, fromLedgerDlq],
        eventBusBusNames: [this.naming.eventBusName()],
      });

      new ServiceDashboard(this, 'Dashboard', {
        serviceName: 'investor-adpt',
        lambdaFunctions: [],
        dlqs: [fromAdvisoryDlq, fromExecutionDlq, fromLedgerDlq],
        eventBusNames: [this.naming.eventBusName()],
      });
    }
  }
}
```

- [ ] **Step 4: Rewrite the stack test**

Replace the full contents of `services/investor/investor-adpt/test/service.stack.test.ts`:

```typescript
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { InvestorAdptStack } from '../src/service.stack';

describe('InvestorAdptStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App({ context: { prefix: 'test' } });
    const stack = new InvestorAdptStack(app, 'test-investor-adpt', {
      prefix: 'test',
      subsystem: 'investor',
      service: 'investor-adpt',
    });
    template = Template.fromStack(stack);
  });

  it('creates 3 ingestion rules (one per source domain)', () => {
    template.resourceCountIs('AWS::Events::Rule', 3);
  });

  it('ingests from advisory bus', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': Match.arrayWith(['DECISION_PACKET_CREATED']),
      }),
    });
  });

  it('ingests from execution bus', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': Match.arrayWith(['ORDER_STAGED']),
      }),
    });
  });

  it('ingests from ledger bus', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': Match.arrayWith(['BALANCE_UPDATED']),
      }),
    });
  });

  it('creates DLQs with 14-day retention', () => {
    template.resourceCountIs('AWS::SQS::Queue', 3);
    template.hasResourceProperties('AWS::SQS::Queue', {
      MessageRetentionPeriod: 1209600,
    });
  });

  it('applies standard tags', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'Service', Value: 'investor-adpt' }),
      ]),
    });
  });
});
```

- [ ] **Step 5: Run the test**

Run: `pnpm nx test investor-adpt`
Expected: ALL TESTS PASS

- [ ] **Step 6: Commit**

```bash
git add services/investor/investor-adpt/src/domain/events.ts services/investor/investor-adpt/src/domain/index.ts services/investor/investor-adpt/src/service.stack.ts services/investor/investor-adpt/test/service.stack.test.ts
git commit -m "feat(investor-adpt): rewrite to pull model — ingest from Advisory, Execution, Ledger buses"
```

---

## Task 3: Advisory Adapter — Ingest Event Types + Stack Rewrite

**Files:**
- Modify: `services/advisory/advisory-adpt/src/domain/events.ts`
- Modify: `services/advisory/advisory-adpt/src/domain/index.ts`
- Modify: `services/advisory/advisory-adpt/src/service.stack.ts`
- Modify: `services/advisory/advisory-adpt/test/service.stack.test.ts`

The advisory domain consumes events from 3 external domains:
- **From Investor:** GOAL_UPDATED, RISK_PROFILE_UPDATED, OPERATING_MODE_CHANGED, MANDATE_GRANTED, MANDATE_UPDATED, MANDATE_REVOKED
- **From Execution:** ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED, PORTFOLIO_DRIFT_DETECTED, BROKER_SESSION_LOST, STREAM_DISCONNECTED, RECONCILIATION_FAILED
- **From Ledger:** PORTFOLIO_UPDATED, PORTFOLIO_DRIFT_DETECTED, RECONCILIATION_FAILED

- [ ] **Step 1: Add AdvisoryIngestEventTypes to events.ts**

Append to `services/advisory/advisory-adpt/src/domain/events.ts` after the existing `AdvisoryCrossDomainEventTypes`:

```typescript
/**
 * Events ingested by the advisory domain from external domain buses.
 * The advisory adapter deploys EB rules on these foreign buses to pull events into AdvisoryBus.
 */
export const AdvisoryIngestEventTypes = {
  // From Investor
  GOAL_UPDATED: 'GOAL_UPDATED',
  RISK_PROFILE_UPDATED: 'RISK_PROFILE_UPDATED',
  OPERATING_MODE_CHANGED: 'OPERATING_MODE_CHANGED',
  MANDATE_GRANTED: 'MANDATE_GRANTED',
  MANDATE_UPDATED: 'MANDATE_UPDATED',
  MANDATE_REVOKED: 'MANDATE_REVOKED',
  // From Execution
  ORDER_FILLED: 'ORDER_FILLED',
  ORDER_REJECTED: 'ORDER_REJECTED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  DEPOSIT_DETECTED: 'DEPOSIT_DETECTED',
  PORTFOLIO_DRIFT_DETECTED: 'PORTFOLIO_DRIFT_DETECTED',
  BROKER_SESSION_LOST: 'BROKER_SESSION_LOST',
  STREAM_DISCONNECTED: 'STREAM_DISCONNECTED',
  RECONCILIATION_FAILED: 'RECONCILIATION_FAILED',
  // From Ledger
  PORTFOLIO_UPDATED: 'PORTFOLIO_UPDATED',
  LEDGER_PORTFOLIO_DRIFT_DETECTED: 'PORTFOLIO_DRIFT_DETECTED',
  LEDGER_RECONCILIATION_FAILED: 'RECONCILIATION_FAILED',
} as const;
```

> **Note:** `PORTFOLIO_DRIFT_DETECTED` and `RECONCILIATION_FAILED` appear from both Execution and Ledger. The `detailType` string values are the same, so they share enum entries. The `LEDGER_` prefixed keys are aliases mapping to the same `detailType` string — they exist only for documentation clarity in the enum. In the rule `detailType` arrays they are deduplicated (see stack step).

- [ ] **Step 2: Update index.ts barrel export**

Replace contents of `services/advisory/advisory-adpt/src/domain/index.ts`:

```typescript
export { AdvisoryCrossDomainEventTypes, AdvisoryIngestEventTypes } from './events';

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

- [ ] **Step 3: Rewrite the stack — pull from foreign buses**

Replace the full contents of `services/advisory/advisory-adpt/src/service.stack.ts`:

```typescript
import { Duration } from 'aws-cdk-lib';
import { EventBus, Rule } from 'aws-cdk-lib/aws-events';
import { EventBus as EventBusTarget } from 'aws-cdk-lib/aws-events-targets';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps } from '@nestfolio/cdk-constructs/core';
import { Monitoring, ServiceDashboard } from '@nestfolio/cdk-constructs/observability';
import { getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';
import { AdvisoryIngestEventTypes } from './domain/events';

export class AdvisoryAdptStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props });

    const prefix = this.prefix;
    const domainAccounts = getDomainAccounts(this);

    // Consumer's own domain bus (target for all ingested events)
    const advisoryBusArn = resolveBusArn(this, 'AdvisoryBus', prefix, 'advisory', domainAccounts);
    const advisoryBus = EventBus.fromEventBusArn(this, 'AdvisoryBus', advisoryBusArn);

    // External source buses
    const investorBusArn = resolveBusArn(this, 'InvestorBus', prefix, 'investor', domainAccounts);
    const investorBus = EventBus.fromEventBusArn(this, 'InvestorBus', investorBusArn);

    const executionBusArn = resolveBusArn(this, 'ExecutionBus', prefix, 'execution', domainAccounts);
    const executionBus = EventBus.fromEventBusArn(this, 'ExecutionBus', executionBusArn);

    const ledgerBusArn = resolveBusArn(this, 'LedgerBus', prefix, 'ledger', domainAccounts);
    const ledgerBus = EventBus.fromEventBusArn(this, 'LedgerBus', ledgerBusArn);

    // Ingest: Investor → Advisory
    const fromInvestorDlq = new Queue(this, 'FromInvestorDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    new Rule(this, 'AdvisoryIngress-FromInvestor', {
      eventBus: investorBus,
      eventPattern: {
        detailType: [
          AdvisoryIngestEventTypes.GOAL_UPDATED,
          AdvisoryIngestEventTypes.RISK_PROFILE_UPDATED,
          AdvisoryIngestEventTypes.OPERATING_MODE_CHANGED,
          AdvisoryIngestEventTypes.MANDATE_GRANTED,
          AdvisoryIngestEventTypes.MANDATE_UPDATED,
          AdvisoryIngestEventTypes.MANDATE_REVOKED,
        ],
      },
      targets: [new EventBusTarget(advisoryBus, { deadLetterQueue: fromInvestorDlq })],
    });

    // Ingest: Execution → Advisory
    const fromExecutionDlq = new Queue(this, 'FromExecutionDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    new Rule(this, 'AdvisoryIngress-FromExecution', {
      eventBus: executionBus,
      eventPattern: {
        detailType: [
          AdvisoryIngestEventTypes.ORDER_FILLED,
          AdvisoryIngestEventTypes.ORDER_REJECTED,
          AdvisoryIngestEventTypes.ORDER_CANCELLED,
          AdvisoryIngestEventTypes.DEPOSIT_DETECTED,
          AdvisoryIngestEventTypes.PORTFOLIO_DRIFT_DETECTED,
          AdvisoryIngestEventTypes.BROKER_SESSION_LOST,
          AdvisoryIngestEventTypes.STREAM_DISCONNECTED,
          AdvisoryIngestEventTypes.RECONCILIATION_FAILED,
        ],
      },
      targets: [new EventBusTarget(advisoryBus, { deadLetterQueue: fromExecutionDlq })],
    });

    // Ingest: Ledger → Advisory
    const fromLedgerDlq = new Queue(this, 'FromLedgerDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    new Rule(this, 'AdvisoryIngress-FromLedger', {
      eventBus: ledgerBus,
      eventPattern: {
        detailType: [
          AdvisoryIngestEventTypes.PORTFOLIO_UPDATED,
          AdvisoryIngestEventTypes.LEDGER_PORTFOLIO_DRIFT_DETECTED,
          AdvisoryIngestEventTypes.LEDGER_RECONCILIATION_FAILED,
        ],
      },
      targets: [new EventBusTarget(advisoryBus, { deadLetterQueue: fromLedgerDlq })],
    });

    if (this.observability) {
      new Monitoring(this, 'Monitoring', {
        dlqs: [fromInvestorDlq, fromExecutionDlq, fromLedgerDlq],
        eventBusBusNames: [this.naming.eventBusName()],
      });

      new ServiceDashboard(this, 'Dashboard', {
        serviceName: 'advisory-adpt',
        lambdaFunctions: [],
        dlqs: [fromInvestorDlq, fromExecutionDlq, fromLedgerDlq],
        eventBusNames: [this.naming.eventBusName()],
      });
    }
  }
}
```

- [ ] **Step 4: Rewrite the stack test**

Replace the full contents of `services/advisory/advisory-adpt/test/service.stack.test.ts`:

```typescript
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { AdvisoryAdptStack } from '../src/service.stack';

describe('AdvisoryAdptStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App({ context: { prefix: 'test' } });
    const stack = new AdvisoryAdptStack(app, 'test-advisory-adpt', {
      prefix: 'test',
      subsystem: 'advisory',
      service: 'advisory-adpt',
    });
    template = Template.fromStack(stack);
  });

  it('creates 3 ingestion rules (one per source domain)', () => {
    template.resourceCountIs('AWS::Events::Rule', 3);
  });

  it('ingests from investor bus', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': Match.arrayWith(['GOAL_UPDATED']),
      }),
    });
  });

  it('ingests from execution bus', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': Match.arrayWith(['ORDER_FILLED']),
      }),
    });
  });

  it('ingests from ledger bus', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': Match.arrayWith(['PORTFOLIO_UPDATED']),
      }),
    });
  });

  it('creates DLQs with 14-day retention', () => {
    template.resourceCountIs('AWS::SQS::Queue', 3);
    template.hasResourceProperties('AWS::SQS::Queue', {
      MessageRetentionPeriod: 1209600,
    });
  });

  it('applies standard tags', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'Service', Value: 'advisory-adpt' }),
      ]),
    });
  });
});
```

- [ ] **Step 5: Run the test**

Run: `pnpm nx test advisory-adpt`
Expected: ALL TESTS PASS

- [ ] **Step 6: Commit**

```bash
git add services/advisory/advisory-adpt/src/domain/events.ts services/advisory/advisory-adpt/src/domain/index.ts services/advisory/advisory-adpt/src/service.stack.ts services/advisory/advisory-adpt/test/service.stack.test.ts
git commit -m "feat(advisory-adpt): rewrite to pull model — ingest from Investor, Execution, Ledger buses"
```

---

## Task 4: Execution Adapter — Ingest Event Types + Stack Rewrite

**Files:**
- Modify: `services/execution/execution-adpt/src/domain/events.ts`
- Modify: `services/execution/execution-adpt/src/domain/index.ts`
- Modify: `services/execution/execution-adpt/src/service.stack.ts`
- Modify: `services/execution/execution-adpt/test/service.stack.test.ts`

The execution domain consumes events from 2 external domains:
- **From Advisory:** DECISION_APPROVED, DECISION_PACKET_CREATED, USER_CONFIRMED, CIRCUIT_BREAKER_TRIGGERED, CIRCUIT_BREAKER_RESET
- **From Investor:** DEPOSIT_INITIATED, WITHDRAWAL_REQUESTED, ACCOUNT_CLOSURE_REQUESTED, EXECUTION_MODE_CHANGED

- [ ] **Step 1: Add ExecutionIngestEventTypes to events.ts**

Append to `services/execution/execution-adpt/src/domain/events.ts` after the existing `ExecutionCrossDomainEventTypes`:

```typescript
/**
 * Events ingested by the execution domain from external domain buses.
 * The execution adapter deploys EB rules on these foreign buses to pull events into ExecutionBus.
 */
export const ExecutionIngestEventTypes = {
  // From Advisory
  DECISION_APPROVED: 'DECISION_APPROVED',
  DECISION_PACKET_CREATED: 'DECISION_PACKET_CREATED',
  USER_CONFIRMED: 'USER_CONFIRMED',
  CIRCUIT_BREAKER_TRIGGERED: 'CIRCUIT_BREAKER_TRIGGERED',
  CIRCUIT_BREAKER_RESET: 'CIRCUIT_BREAKER_RESET',
  // From Investor
  DEPOSIT_INITIATED: 'DEPOSIT_INITIATED',
  WITHDRAWAL_REQUESTED: 'WITHDRAWAL_REQUESTED',
  ACCOUNT_CLOSURE_REQUESTED: 'ACCOUNT_CLOSURE_REQUESTED',
  EXECUTION_MODE_CHANGED: 'EXECUTION_MODE_CHANGED',
} as const;
```

- [ ] **Step 2: Update index.ts barrel export**

Replace contents of `services/execution/execution-adpt/src/domain/index.ts`:

```typescript
export { ExecutionCrossDomainEventTypes, ExecutionIngestEventTypes } from './events';
```

- [ ] **Step 3: Rewrite the stack — pull from foreign buses**

Replace the full contents of `services/execution/execution-adpt/src/service.stack.ts`:

```typescript
import { Duration } from 'aws-cdk-lib';
import { EventBus, Rule } from 'aws-cdk-lib/aws-events';
import { EventBus as EventBusTarget } from 'aws-cdk-lib/aws-events-targets';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps } from '@nestfolio/cdk-constructs/core';
import { Monitoring, ServiceDashboard } from '@nestfolio/cdk-constructs/observability';
import { getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';
import { ExecutionIngestEventTypes } from './domain/events';

export class ExecutionAdptStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props });

    const prefix = this.prefix;
    const domainAccounts = getDomainAccounts(this);

    // Consumer's own domain bus (target for all ingested events)
    const executionBusArn = resolveBusArn(this, 'ExecutionBus', prefix, 'execution', domainAccounts);
    const executionBus = EventBus.fromEventBusArn(this, 'ExecutionBus', executionBusArn);

    // External source buses
    const advisoryBusArn = resolveBusArn(this, 'AdvisoryBus', prefix, 'advisory', domainAccounts);
    const advisoryBus = EventBus.fromEventBusArn(this, 'AdvisoryBus', advisoryBusArn);

    const investorBusArn = resolveBusArn(this, 'InvestorBus', prefix, 'investor', domainAccounts);
    const investorBus = EventBus.fromEventBusArn(this, 'InvestorBus', investorBusArn);

    // Ingest: Advisory → Execution
    const fromAdvisoryDlq = new Queue(this, 'FromAdvisoryDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    new Rule(this, 'ExecutionIngress-FromAdvisory', {
      eventBus: advisoryBus,
      eventPattern: {
        detailType: [
          ExecutionIngestEventTypes.DECISION_APPROVED,
          ExecutionIngestEventTypes.DECISION_PACKET_CREATED,
          ExecutionIngestEventTypes.USER_CONFIRMED,
          ExecutionIngestEventTypes.CIRCUIT_BREAKER_TRIGGERED,
          ExecutionIngestEventTypes.CIRCUIT_BREAKER_RESET,
        ],
      },
      targets: [new EventBusTarget(executionBus, { deadLetterQueue: fromAdvisoryDlq })],
    });

    // Ingest: Investor → Execution
    const fromInvestorDlq = new Queue(this, 'FromInvestorDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    new Rule(this, 'ExecutionIngress-FromInvestor', {
      eventBus: investorBus,
      eventPattern: {
        detailType: [
          ExecutionIngestEventTypes.DEPOSIT_INITIATED,
          ExecutionIngestEventTypes.WITHDRAWAL_REQUESTED,
          ExecutionIngestEventTypes.ACCOUNT_CLOSURE_REQUESTED,
          ExecutionIngestEventTypes.EXECUTION_MODE_CHANGED,
        ],
      },
      targets: [new EventBusTarget(executionBus, { deadLetterQueue: fromInvestorDlq })],
    });

    if (this.observability) {
      new Monitoring(this, 'Monitoring', {
        dlqs: [fromAdvisoryDlq, fromInvestorDlq],
        eventBusBusNames: [this.naming.eventBusName()],
      });

      new ServiceDashboard(this, 'Dashboard', {
        serviceName: 'execution-adpt',
        lambdaFunctions: [],
        dlqs: [fromAdvisoryDlq, fromInvestorDlq],
        eventBusNames: [this.naming.eventBusName()],
      });
    }
  }
}
```

- [ ] **Step 4: Rewrite the stack test**

Replace the full contents of `services/execution/execution-adpt/test/service.stack.test.ts`:

```typescript
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { ExecutionAdptStack } from '../src/service.stack';

describe('ExecutionAdptStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App({ context: { prefix: 'test' } });
    const stack = new ExecutionAdptStack(app, 'test-execution-adpt', {
      prefix: 'test',
      subsystem: 'execution',
      service: 'execution-adpt',
    });
    template = Template.fromStack(stack);
  });

  it('creates 2 ingestion rules (one per source domain)', () => {
    template.resourceCountIs('AWS::Events::Rule', 2);
  });

  it('ingests from advisory bus', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': Match.arrayWith(['DECISION_APPROVED']),
      }),
    });
  });

  it('ingests from investor bus', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': Match.arrayWith(['DEPOSIT_INITIATED']),
      }),
    });
  });

  it('creates DLQs with 14-day retention', () => {
    template.resourceCountIs('AWS::SQS::Queue', 2);
    template.hasResourceProperties('AWS::SQS::Queue', {
      MessageRetentionPeriod: 1209600,
    });
  });

  it('applies standard tags', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'Service', Value: 'execution-adpt' }),
      ]),
    });
  });
});
```

- [ ] **Step 5: Run the test**

Run: `pnpm nx test execution-adpt`
Expected: ALL TESTS PASS

- [ ] **Step 6: Commit**

```bash
git add services/execution/execution-adpt/src/domain/events.ts services/execution/execution-adpt/src/domain/index.ts services/execution/execution-adpt/src/service.stack.ts services/execution/execution-adpt/test/service.stack.test.ts
git commit -m "feat(execution-adpt): rewrite to pull model — ingest from Advisory, Investor buses"
```

---

## Task 5: Ledger Adapter — Ingest Event Types + Stack Rewrite

**Files:**
- Modify: `services/ledger/ledger-adpt/src/domain/events.ts`
- Modify: `services/ledger/ledger-adpt/src/domain/index.ts`
- Modify: `services/ledger/ledger-adpt/src/service.stack.ts`
- Modify: `services/ledger/ledger-adpt/test/service.stack.test.ts`

The ledger domain consumes events from 1 external domain:
- **From Execution:** ORDER_FILLED, ORDER_PARTIALLY_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, CORPORATE_ACTION_APPLIED, PORTFOLIO_SNAPSHOT_IMPORTED, ALPACA_ACCOUNT_SNAPSHOT

- [ ] **Step 1: Add LedgerIngestEventTypes to events.ts**

Append to `services/ledger/ledger-adpt/src/domain/events.ts` after the existing `LedgerCrossDomainEventTypes`:

```typescript
/**
 * Events ingested by the ledger domain from external domain buses.
 * The ledger adapter deploys EB rules on these foreign buses to pull events into LedgerBus.
 */
export const LedgerIngestEventTypes = {
  // From Execution
  ORDER_FILLED: 'ORDER_FILLED',
  ORDER_PARTIALLY_FILLED: 'ORDER_PARTIALLY_FILLED',
  ORDER_REJECTED: 'ORDER_REJECTED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  DEPOSIT_DETECTED: 'DEPOSIT_DETECTED',
  WITHDRAWAL_COMPLETED: 'WITHDRAWAL_COMPLETED',
  CORPORATE_ACTION_APPLIED: 'CORPORATE_ACTION_APPLIED',
  PORTFOLIO_SNAPSHOT_IMPORTED: 'PORTFOLIO_SNAPSHOT_IMPORTED',
  ALPACA_ACCOUNT_SNAPSHOT: 'ALPACA_ACCOUNT_SNAPSHOT',
} as const;
```

- [ ] **Step 2: Update index.ts barrel export**

Replace contents of `services/ledger/ledger-adpt/src/domain/index.ts`:

```typescript
export { LedgerCrossDomainEventTypes, LedgerIngestEventTypes } from './events';
```

- [ ] **Step 3: Rewrite the stack — pull from foreign buses**

Replace the full contents of `services/ledger/ledger-adpt/src/service.stack.ts`:

```typescript
import { Duration } from 'aws-cdk-lib';
import { EventBus, Rule } from 'aws-cdk-lib/aws-events';
import { EventBus as EventBusTarget } from 'aws-cdk-lib/aws-events-targets';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps } from '@nestfolio/cdk-constructs/core';
import { Monitoring, ServiceDashboard } from '@nestfolio/cdk-constructs/observability';
import { getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';
import { LedgerIngestEventTypes } from './domain/events';

export class LedgerAdptStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props });

    const prefix = this.prefix;
    const domainAccounts = getDomainAccounts(this);

    // Consumer's own domain bus (target for all ingested events)
    const ledgerBusArn = resolveBusArn(this, 'LedgerBus', prefix, 'ledger', domainAccounts);
    const ledgerBus = EventBus.fromEventBusArn(this, 'LedgerBus', ledgerBusArn);

    // External source bus
    const executionBusArn = resolveBusArn(this, 'ExecutionBus', prefix, 'execution', domainAccounts);
    const executionBus = EventBus.fromEventBusArn(this, 'ExecutionBus', executionBusArn);

    // Ingest: Execution → Ledger
    const fromExecutionDlq = new Queue(this, 'FromExecutionDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    new Rule(this, 'LedgerIngress-FromExecution', {
      eventBus: executionBus,
      eventPattern: {
        detailType: [
          LedgerIngestEventTypes.ORDER_FILLED,
          LedgerIngestEventTypes.ORDER_PARTIALLY_FILLED,
          LedgerIngestEventTypes.ORDER_REJECTED,
          LedgerIngestEventTypes.ORDER_CANCELLED,
          LedgerIngestEventTypes.DEPOSIT_DETECTED,
          LedgerIngestEventTypes.WITHDRAWAL_COMPLETED,
          LedgerIngestEventTypes.CORPORATE_ACTION_APPLIED,
          LedgerIngestEventTypes.PORTFOLIO_SNAPSHOT_IMPORTED,
          LedgerIngestEventTypes.ALPACA_ACCOUNT_SNAPSHOT,
        ],
      },
      targets: [new EventBusTarget(ledgerBus, { deadLetterQueue: fromExecutionDlq })],
    });

    if (this.observability) {
      new Monitoring(this, 'Monitoring', {
        dlqs: [fromExecutionDlq],
        eventBusBusNames: [this.naming.eventBusName()],
      });

      new ServiceDashboard(this, 'Dashboard', {
        serviceName: 'ledger-adpt',
        lambdaFunctions: [],
        dlqs: [fromExecutionDlq],
        eventBusNames: [this.naming.eventBusName()],
      });
    }
  }
}
```

- [ ] **Step 4: Rewrite the stack test**

Replace the full contents of `services/ledger/ledger-adpt/test/service.stack.test.ts`:

```typescript
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { LedgerAdptStack } from '../src/service.stack';

describe('LedgerAdptStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App({ context: { prefix: 'test' } });
    const stack = new LedgerAdptStack(app, 'test-ledger-adpt', {
      prefix: 'test',
      subsystem: 'ledger',
      service: 'ledger-adpt',
    });
    template = Template.fromStack(stack);
  });

  it('creates 1 ingestion rule (from execution)', () => {
    template.resourceCountIs('AWS::Events::Rule', 1);
  });

  it('ingests from execution bus', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': Match.arrayWith(['ORDER_FILLED']),
      }),
    });
  });

  it('creates DLQ with 14-day retention', () => {
    template.resourceCountIs('AWS::SQS::Queue', 1);
    template.hasResourceProperties('AWS::SQS::Queue', {
      MessageRetentionPeriod: 1209600,
    });
  });

  it('applies standard tags', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'Service', Value: 'ledger-adpt' }),
      ]),
    });
  });
});
```

- [ ] **Step 5: Run the test**

Run: `pnpm nx test ledger-adpt`
Expected: ALL TESTS PASS

- [ ] **Step 6: Commit**

```bash
git add services/ledger/ledger-adpt/src/domain/events.ts services/ledger/ledger-adpt/src/domain/index.ts services/ledger/ledger-adpt/src/service.stack.ts services/ledger/ledger-adpt/test/service.stack.test.ts
git commit -m "feat(ledger-adpt): rewrite to pull model — ingest from Execution bus"
```

---

## Task 6: Update Adapter Service Cards (CLAUDE.md)

**Files:**
- Modify: `services/investor/investor-adpt/CLAUDE.md`
- Modify: `services/advisory/advisory-adpt/CLAUDE.md`
- Modify: `services/execution/execution-adpt/CLAUDE.md`
- Modify: `services/ledger/ledger-adpt/CLAUDE.md`

- [ ] **Step 1: Update investor-adpt CLAUDE.md**

Replace the full contents of `services/investor/investor-adpt/CLAUDE.md`:

```markdown
# investor-adpt

Domain: investor | Bus: InvestorBus
Stack: services/investor/investor-adpt/src/service.stack.ts

## State
None (stateless adapter)

## Cross-Domain Ingestion Rules (Pull Model)
- AdvisoryBus → InvestorBus:
  DECISION_PACKET_CREATED, USER_CONFIRMATION_REQUESTED, EXPLANATION_GENERATED, DECISION_APPROVED, DECISION_BLOCKED, ESCALATION_TRIGGERED, CIRCUIT_BREAKER_TRIGGERED, CIRCUIT_BREAKER_RESET, INCIDENT_DETECTED, INCIDENT_RESOLVED
- ExecutionBus → InvestorBus:
  ORDER_STAGED, ORDER_REJECTED, ORDER_CANCELLED, WITHDRAWAL_REJECTED, WITHDRAWAL_COMPLETED, ORDER_ESCALATED, BROKER_CIRCUIT_OPEN
- LedgerBus → InvestorBus:
  BALANCE_UPDATED, PORTFOLIO_UPDATED, LEDGER_ENTRY_RECORDED, RECONCILIATION_COMPLETED, RECONCILIATION_FAILED, LEDGER_PROCESSING_FAILED

## DLQs
- FromAdvisoryDLQ, FromExecutionDLQ, FromLedgerDLQ (14-day retention, KMS encrypted)

## Event Types (domain/events.ts)
- InvestorCrossDomainEventTypes: events published by investor domain (used by same-domain services)
- InvestorIngestEventTypes: events consumed from external domain buses

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/observability, cdk-constructs/extensions
```

- [ ] **Step 2: Update advisory-adpt CLAUDE.md**

Replace the full contents of `services/advisory/advisory-adpt/CLAUDE.md`:

```markdown
# advisory-adpt

Domain: advisory | Bus: AdvisoryBus
Stack: services/advisory/advisory-adpt/src/service.stack.ts

## State
None (stateless adapter)

## Cross-Domain Ingestion Rules (Pull Model)
- InvestorBus → AdvisoryBus:
  GOAL_UPDATED, RISK_PROFILE_UPDATED, OPERATING_MODE_CHANGED, MANDATE_GRANTED, MANDATE_UPDATED, MANDATE_REVOKED
- ExecutionBus → AdvisoryBus:
  ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED, PORTFOLIO_DRIFT_DETECTED, BROKER_SESSION_LOST, STREAM_DISCONNECTED, RECONCILIATION_FAILED
- LedgerBus → AdvisoryBus:
  PORTFOLIO_UPDATED, PORTFOLIO_DRIFT_DETECTED, RECONCILIATION_FAILED

## DLQs
- FromInvestorDLQ, FromExecutionDLQ, FromLedgerDLQ (14-day retention, KMS encrypted)

## Event Types (domain/events.ts)
- AdvisoryCrossDomainEventTypes: events published by advisory domain (used by same-domain services)
- AdvisoryIngestEventTypes: events consumed from external domain buses

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/observability, cdk-constructs/extensions
```

- [ ] **Step 3: Update execution-adpt CLAUDE.md**

Replace the full contents of `services/execution/execution-adpt/CLAUDE.md`:

```markdown
# execution-adpt

Domain: execution | Bus: ExecutionBus
Stack: services/execution/execution-adpt/src/service.stack.ts

## State
None (stateless adapter)

## Cross-Domain Ingestion Rules (Pull Model)
- AdvisoryBus → ExecutionBus:
  DECISION_APPROVED, DECISION_PACKET_CREATED, USER_CONFIRMED, CIRCUIT_BREAKER_TRIGGERED, CIRCUIT_BREAKER_RESET
- InvestorBus → ExecutionBus:
  DEPOSIT_INITIATED, WITHDRAWAL_REQUESTED, ACCOUNT_CLOSURE_REQUESTED, EXECUTION_MODE_CHANGED

## DLQs
- FromAdvisoryDLQ, FromInvestorDLQ (14-day retention, KMS encrypted)

## Event Types (domain/events.ts)
- ExecutionCrossDomainEventTypes: events published by execution domain (used by same-domain services)
- ExecutionIngestEventTypes: events consumed from external domain buses

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/observability, cdk-constructs/extensions
```

- [ ] **Step 4: Update ledger-adpt CLAUDE.md**

Replace the full contents of `services/ledger/ledger-adpt/CLAUDE.md`:

```markdown
# ledger-adpt

Domain: ledger | Bus: LedgerBus
Stack: services/ledger/ledger-adpt/src/service.stack.ts

## State
None (stateless adapter)

## Cross-Domain Ingestion Rules (Pull Model)
- ExecutionBus → LedgerBus:
  ORDER_FILLED, ORDER_PARTIALLY_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, CORPORATE_ACTION_APPLIED, PORTFOLIO_SNAPSHOT_IMPORTED, ALPACA_ACCOUNT_SNAPSHOT

## DLQs
- FromExecutionDLQ (14-day retention, KMS encrypted)

## Event Types (domain/events.ts)
- LedgerCrossDomainEventTypes: events published by ledger domain (used by same-domain services)
- LedgerIngestEventTypes: events consumed from external domain buses

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/observability, cdk-constructs/extensions
```

- [ ] **Step 5: Commit**

```bash
git add services/investor/investor-adpt/CLAUDE.md services/advisory/advisory-adpt/CLAUDE.md services/execution/execution-adpt/CLAUDE.md services/ledger/ledger-adpt/CLAUDE.md
git commit -m "docs: update adapter service cards for pull model"
```

---

## Task 7: Run All Adapter Tests

- [ ] **Step 1: Run all 4 adapter test suites**

Run: `pnpm nx run-many -t test -p investor-adpt advisory-adpt execution-adpt ledger-adpt`
Expected: ALL TESTS PASS across all 4 projects

- [ ] **Step 2: Run lint across all 4 adapters**

Run: `pnpm nx run-many -t lint -p investor-adpt advisory-adpt execution-adpt ledger-adpt`
Expected: NO LINT ERRORS
