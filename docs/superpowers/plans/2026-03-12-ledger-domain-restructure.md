# Ledger Domain Restructure — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a Ledger domain as the single event-sourced source of truth for all financial state, restructuring the system from 3 to 4 domains.

**Architecture:** New Ledger domain with ledger-ctrl (event-sourced financial ledger), ledger-bff (financial queries), reconciliation-ctrl (drift detection), and ledger-hub (EventBridge bus). Existing services in investor and execution domains are modified to consume authoritative events from Ledger instead of maintaining independent financial state.

**Tech Stack:** AWS CDK, DynamoDB (single-table), DynamoDB Streams, EventBridge, Lambda (Node.js), AppSync (JS pipeline resolvers), Zod, Jest

**Spec:** `docs/superpowers/specs/2026-03-12-ledger-domain-restructure-design.md`

---

## Chunk 1: command-core Library Restructure

### Task 1: Rename PortfolioState → AccountState

**Files:**
- Modify: `libs/command-core/src/state/portfolio-state.ts` → rename to `account-state.ts`
- Modify: `libs/command-core/src/index.ts`
- Modify: all command files referencing PortfolioState

- [ ] **Step 1: Rename the state file and update types**

Rename `libs/command-core/src/state/portfolio-state.ts` to `libs/command-core/src/state/account-state.ts`. Update contents:

```typescript
export interface PositionState {
  readonly symbol: string;
  readonly quantity: number;
  readonly averageCostBasis: number;
  readonly totalCostBasis: number;
  readonly lastFillPrice: number;
}

export interface AccountState {
  readonly positions: Readonly<Record<string, PositionState>>;
  readonly cashBalanceCents: number;
  readonly lastEventSequence: number;
}

export const INITIAL_ACCOUNT_STATE: AccountState = {
  positions: {},
  cashBalanceCents: 10_000_000,
  lastEventSequence: 0,
};

/** @deprecated Use AccountState */
export type PortfolioState = AccountState;
/** @deprecated Use INITIAL_ACCOUNT_STATE */
export const INITIAL_PORTFOLIO_STATE = INITIAL_ACCOUNT_STATE;
```

- [ ] **Step 2: Update barrel export in index.ts**

In `libs/command-core/src/index.ts`, update the state export:

```typescript
export {
  type PositionState,
  type AccountState,
  type PortfolioState, // deprecated alias
  INITIAL_ACCOUNT_STATE,
  INITIAL_PORTFOLIO_STATE, // deprecated alias
} from './state/account-state';
```

- [ ] **Step 3: Run all command-core tests**

Run: `npx nx test command-core`
Expected: All tests pass (deprecated aliases maintain backward compat)

- [ ] **Step 4: Commit**

```bash
git add libs/command-core/
git commit -m "refactor(command-core): rename PortfolioState → AccountState with deprecated aliases"
```

### Task 2: Move commands to ledger/ and order/ folders

**Files:**
- Create: `libs/command-core/src/commands/ledger/` (move record-deposit, record-withdrawal, record-fill)
- Create: `libs/command-core/src/commands/order/` (move submit-order, cancel-order)
- Delete: `libs/command-core/src/commands/execution/`
- Modify: `libs/command-core/src/index.ts`

- [ ] **Step 1: Create ledger/ folder and move financial commands**

Create `libs/command-core/src/commands/ledger/` and move:
- `record-deposit.ts` — update import to `../../state/account-state` and type to `AccountState`
- `record-withdrawal.ts` — same updates
- `record-fill.ts` — same updates

Example for record-deposit.ts after move:

```typescript
import { z } from 'zod';
import { defineCommand } from '../../command';
import { type AccountState } from '../../state/account-state';

export const RecordDepositSchema = z.object({
  depositId: z.string().min(1),
  amountCents: z.number().int().positive(),
  depositedAt: z.string().min(1),
});

export type RecordDepositPayload = z.infer<typeof RecordDepositSchema>;

export const RecordDeposit = defineCommand<RecordDepositPayload, AccountState>({
  type: 'RecordDeposit',
  schema: RecordDepositSchema,
  apply: (state, payload) => ({
    ...state,
    cashBalanceCents: state.cashBalanceCents + payload.amountCents,
  }),
});
```

- [ ] **Step 2: Create order/ folder and move order lifecycle commands**

Create `libs/command-core/src/commands/order/` and move:
- `submit-order.ts` — update import to `../../state/account-state` and type to `AccountState`
- `cancel-order.ts` — same updates

- [ ] **Step 3: Update barrel exports in index.ts**

Update `libs/command-core/src/index.ts` to reference new paths:

```typescript
// Ledger domain commands
export { RecordFill, RecordFillSchema, type RecordFillPayload } from './commands/ledger/record-fill';
export { RecordDeposit, RecordDepositSchema, type RecordDepositPayload } from './commands/ledger/record-deposit';
export { RecordWithdrawal, RecordWithdrawalSchema, type RecordWithdrawalPayload } from './commands/ledger/record-withdrawal';

// Order lifecycle commands
export { SubmitOrder, SubmitOrderSchema, type SubmitOrderPayload } from './commands/order/submit-order';
export { CancelOrder, CancelOrderSchema, type CancelOrderPayload } from './commands/order/cancel-order';
```

- [ ] **Step 4: Delete old execution/ folder**

Delete `libs/command-core/src/commands/execution/`

- [ ] **Step 5: Run all tests**

Run: `npx nx test command-core`
Expected: All tests pass

- [ ] **Step 6: Run full workspace test to catch downstream breakage**

Run: `npx nx run-many -t test --all`
Expected: All projects pass (barrel re-exports maintain same public API)

- [ ] **Step 7: Commit**

```bash
git add libs/command-core/
git commit -m "refactor(command-core): reorganize commands into ledger/ and order/ folders"
```

### Task 3: Add RecordCorporateAction command

**Files:**
- Create: `libs/command-core/src/commands/ledger/record-corporate-action.ts`
- Create: `libs/command-core/src/commands/ledger/record-corporate-action.test.ts`
- Modify: `libs/command-core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/command-core/src/commands/ledger/record-corporate-action.test.ts`:

```typescript
import { applyCommand } from '../../command';
import { RecordCorporateAction } from './record-corporate-action';
import { type AccountState, INITIAL_ACCOUNT_STATE } from '../../state/account-state';

describe('RecordCorporateAction', () => {
  const stateWithPosition: AccountState = {
    ...INITIAL_ACCOUNT_STATE,
    positions: {
      AAPL: { symbol: 'AAPL', quantity: 100, averageCostBasis: 150, totalCostBasis: 15000, lastFillPrice: 150 },
    },
  };

  it('applies a 2:1 stock split', () => {
    const result = applyCommand(RecordCorporateAction, {
      actionId: 'ca-1',
      symbol: 'AAPL',
      actionType: 'STOCK_SPLIT',
      quantityMultiplier: 2,
      costBasisDivisor: 2,
      appliedAt: '2026-03-12T00:00:00Z',
    }, stateWithPosition);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.nextState.positions['AAPL'].quantity).toBe(200);
      expect(result.value.nextState.positions['AAPL'].averageCostBasis).toBe(75);
      expect(result.value.nextState.positions['AAPL'].totalCostBasis).toBe(15000);
      expect(result.value.nextState.cashBalanceCents).toBe(INITIAL_ACCOUNT_STATE.cashBalanceCents);
    }
  });

  it('applies a cash dividend', () => {
    const result = applyCommand(RecordCorporateAction, {
      actionId: 'ca-2',
      symbol: 'AAPL',
      actionType: 'DIVIDEND',
      dividendPerShareCents: 50,
      appliedAt: '2026-03-12T00:00:00Z',
    }, stateWithPosition);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.nextState.cashBalanceCents).toBe(INITIAL_ACCOUNT_STATE.cashBalanceCents + 5000);
      expect(result.value.nextState.positions['AAPL'].quantity).toBe(100);
    }
  });

  it('fails for unknown symbol', () => {
    const result = applyCommand(RecordCorporateAction, {
      actionId: 'ca-3',
      symbol: 'UNKNOWN',
      actionType: 'STOCK_SPLIT',
      quantityMultiplier: 2,
      costBasisDivisor: 2,
      appliedAt: '2026-03-12T00:00:00Z',
    }, stateWithPosition);

    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test command-core -- --testPathPattern=record-corporate-action`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `libs/command-core/src/commands/ledger/record-corporate-action.ts`:

```typescript
import { z } from 'zod';
import { defineCommand } from '../../command';
import { type AccountState } from '../../state/account-state';

export const RecordCorporateActionSchema = z.object({
  actionId: z.string().min(1),
  symbol: z.string().min(1),
  actionType: z.enum(['STOCK_SPLIT', 'REVERSE_SPLIT', 'DIVIDEND']),
  quantityMultiplier: z.number().positive().optional(),
  costBasisDivisor: z.number().positive().optional(),
  dividendPerShareCents: z.number().int().nonnegative().optional(),
  appliedAt: z.string().min(1),
});

export type RecordCorporateActionPayload = z.infer<typeof RecordCorporateActionSchema>;

export const RecordCorporateAction = defineCommand<RecordCorporateActionPayload, AccountState>({
  type: 'RecordCorporateAction',
  schema: RecordCorporateActionSchema,
  apply: (state, payload) => {
    const position = state.positions[payload.symbol];
    if (!position) throw new Error(`No position for symbol ${payload.symbol}`);

    if (payload.actionType === 'DIVIDEND') {
      const dividendCents = (payload.dividendPerShareCents ?? 0) * position.quantity;
      return {
        ...state,
        cashBalanceCents: state.cashBalanceCents + dividendCents,
      };
    }

    const multiplier = payload.quantityMultiplier ?? 1;
    const divisor = payload.costBasisDivisor ?? 1;
    const newQuantity = position.quantity * multiplier;
    const newAvgCost = position.averageCostBasis / divisor;

    return {
      ...state,
      positions: {
        ...state.positions,
        [payload.symbol]: {
          ...position,
          quantity: newQuantity,
          averageCostBasis: newAvgCost,
          lastFillPrice: position.lastFillPrice / divisor,
        },
      },
    };
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test command-core -- --testPathPattern=record-corporate-action`
Expected: PASS (3 tests)

- [ ] **Step 5: Add export to barrel**

Add to `libs/command-core/src/index.ts`:

```typescript
export {
  RecordCorporateAction,
  RecordCorporateActionSchema,
  type RecordCorporateActionPayload,
} from './commands/ledger/record-corporate-action';
```

- [ ] **Step 6: Run all command-core tests**

Run: `npx nx test command-core`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add libs/command-core/
git commit -m "feat(command-core): add RecordCorporateAction command for splits and dividends"
```

---

## Chunk 2: ledger-hub Service

### Task 4: Create ledger-hub project scaffolding

**Files:**
- Create: `services/ledger/ledger-hub/project.json`
- Create: `services/ledger/ledger-hub/tsconfig.json`
- Create: `services/ledger/ledger-hub/tsconfig.spec.json`
- Create: `services/ledger/ledger-hub/jest.config.js`
- Create: `services/ledger/ledger-hub/src/main.ts`
- Create: `services/ledger/ledger-hub/src/service.stack.ts`
- Create: `services/ledger/ledger-hub/src/service.stack.test.ts`

- [ ] **Step 1: Create project.json**

Create `services/ledger/ledger-hub/project.json`:

```json
{
  "name": "ledger-hub",
  "$schema": "../../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "services/ledger/ledger-hub/src",
  "projectType": "application",
  "targets": {
    "deploy": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx cdk deploy --app 'npx ts-node -r ./tools/register-paths.js services/ledger/ledger-hub/src/main.ts' --require-approval never -c prefix={args.prefix}"
      }
    },
    "destroy": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx cdk destroy --app 'npx ts-node -r ./tools/register-paths.js services/ledger/ledger-hub/src/main.ts' --force -c prefix={args.prefix}"
      }
    },
    "test": {
      "executor": "@nx/jest:jest",
      "options": { "jestConfig": "services/ledger/ledger-hub/jest.config.js" }
    },
    "lint": { "executor": "@nx/eslint:lint" }
  },
  "tags": ["scope:ledger", "type:hub"]
}
```

- [ ] **Step 2: Create tsconfig files**

Create `services/ledger/ledger-hub/tsconfig.json`:

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": { "outDir": "../../../dist/services/ledger/ledger-hub" },
  "include": ["src/**/*.ts"],
  "references": [{ "path": "./tsconfig.spec.json" }]
}
```

Create `services/ledger/ledger-hub/tsconfig.spec.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "types": ["jest", "node"] },
  "include": ["src/**/*.test.ts", "src/**/*.spec.ts"]
}
```

- [ ] **Step 3: Create jest.config.js**

Create `services/ledger/ledger-hub/jest.config.js`:

```javascript
const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'ledger-hub',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.spec.json',
      diagnostics: false,
    }],
  },
  moduleNameMapper: {
    '^@nestfolio/cdk-constructs$': '<rootDir>/../../../libs/cdk-constructs/src/index.ts',
  },
};
```

- [ ] **Step 4: Write the CDK stack test**

Create `services/ledger/ledger-hub/src/service.stack.test.ts`:

```typescript
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { LedgerHubStack } from './service.stack';

describe('LedgerHubStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App({ context: { prefix: 'test' } });
    const stack = new LedgerHubStack(app, 'TestLedgerHub');
    template = Template.fromStack(stack);
  });

  it('creates an EventBridge bus', () => {
    template.hasResourceProperties('AWS::Events::EventBus', {
      Name: { 'Fn::Join': ['', [{ Ref: 'AWS::StackName' }, '-ledger-bus']] },
    });
  });

  it('creates an archive', () => {
    template.resourceCountIs('AWS::Events::Archive', 1);
  });

  it('publishes bus ARN to SSM', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Description: 'Ledger event hub bus ARN',
    });
  });

  it('creates forwarding rule to investor-hub', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: {
        'detail-type': [
          'BALANCE_UPDATED',
          'PORTFOLIO_UPDATED',
          'RECONCILIATION_COMPLETED',
          'RECONCILIATION_FAILED',
          'LEDGER_PROCESSING_FAILED',
        ],
      },
    });
  });

  it('creates forwarding rule to advisory-hub', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: {
        'detail-type': [
          'PORTFOLIO_UPDATED',
          'PORTFOLIO_DRIFT_DETECTED',
          'RECONCILIATION_FAILED',
        ],
      },
    });
  });

  it('creates DLQs for forwarding targets', () => {
    template.resourceCountIs('AWS::SQS::Queue', 2);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx nx test ledger-hub`
Expected: FAIL — stack module not found

- [ ] **Step 6: Write the CDK stack**

Create `services/ledger/ledger-hub/src/service.stack.ts`:

```typescript
import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { EventBus, Archive, Rule } from 'aws-cdk-lib/aws-events';
import { EventBus as EventBusTarget } from 'aws-cdk-lib/aws-events-targets';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { createNamingService, Monitoring, ServiceDashboard, applyStandardTags } from '@nestfolio/cdk-constructs';

export class LedgerHubStack extends Stack {
  readonly bus: EventBus;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const naming = createNamingService(this, {
      subsystem: 'ledger',
      service: 'ledger-hub',
    });

    const prefix = this.node.tryGetContext('prefix');
    if (!prefix) throw new Error('CDK context "prefix" is required. Pass -c prefix=dev|staging|prod');
    applyStandardTags(this, { service: 'ledger-hub', domain: 'ledger', environment: prefix });

    // Domain bus
    this.bus = new EventBus(this, 'LedgerBus', {
      eventBusName: naming.eventBusName(),
    });

    // Event archive for replay
    new Archive(this, 'Archive', {
      sourceEventBus: this.bus,
      archiveName: `${naming.eventBusName()}-archive`,
      retention: Duration.days(365),
      eventPattern: { source: [{ prefix: '' }] as any },
    });

    // Publish bus ARN to SSM for cross-domain discovery
    new StringParameter(this, 'BusArnParam', {
      parameterName: naming.ssmParameterPath('event-hub/busArn'),
      stringValue: this.bus.eventBusArn,
      description: 'Ledger event hub bus ARN',
    });

    // Cross-domain forwarding: Ledger --> Investor
    const investorBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${prefix}-investor/event-hub/busArn`,
    );
    const investorBus = EventBus.fromEventBusArn(this, 'InvestorBus', investorBusArn);
    const toInvestorDlq = new Queue(this, 'ToInvestorDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    new Rule(this, 'ToInvestor', {
      eventBus: this.bus,
      eventPattern: {
        detailType: [
          'BALANCE_UPDATED',
          'PORTFOLIO_UPDATED',
          'RECONCILIATION_COMPLETED',
          'RECONCILIATION_FAILED',
          'LEDGER_PROCESSING_FAILED',
        ],
      },
      targets: [new EventBusTarget(investorBus, { deadLetterQueue: toInvestorDlq })],
    });

    // Cross-domain forwarding: Ledger --> Advisory
    const advisoryBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${prefix}-advisory/event-hub/busArn`,
    );
    const advisoryBus = EventBus.fromEventBusArn(this, 'AdvisoryBus', advisoryBusArn);
    const toAdvisoryDlq = new Queue(this, 'ToAdvisoryDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    new Rule(this, 'ToAdvisory', {
      eventBus: this.bus,
      eventPattern: {
        detailType: [
          'PORTFOLIO_UPDATED',
          'PORTFOLIO_DRIFT_DETECTED',
          'RECONCILIATION_FAILED',
        ],
      },
      targets: [new EventBusTarget(advisoryBus, { deadLetterQueue: toAdvisoryDlq })],
    });

    // Monitoring
    new Monitoring(this, 'Monitoring', {
      dlqs: [toInvestorDlq, toAdvisoryDlq],
      eventBusBusNames: [naming.eventBusName()],
    });

    // Dashboard
    new ServiceDashboard(this, 'Dashboard', {
      serviceName: 'ledger-hub',
      lambdaFunctions: [],
      dlqs: [toInvestorDlq, toAdvisoryDlq],
      eventBusNames: [naming.eventBusName()],
    });
  }
}
```

- [ ] **Step 7: Create main.ts entry point**

Create `services/ledger/ledger-hub/src/main.ts`:

```typescript
import { App } from 'aws-cdk-lib';
import { LedgerHubStack } from './service.stack';

const app = new App();
const prefix = app.node.tryGetContext('prefix') ?? 'dev';

new LedgerHubStack(app, `${prefix}-ledger-hub`);
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx nx test ledger-hub`
Expected: PASS (6 tests)

- [ ] **Step 9: Commit**

```bash
git add services/ledger/ledger-hub/
git commit -m "feat(ledger-hub): create Ledger domain EventBridge hub with cross-domain forwarding"
```

---

## Chunk 3: ledger-ctrl Service — Repository & Reducer

### Task 5: Create ledger-ctrl project scaffolding

**Files:**
- Create: `services/ledger/ledger-ctrl/project.json`
- Create: `services/ledger/ledger-ctrl/tsconfig.json`
- Create: `services/ledger/ledger-ctrl/tsconfig.spec.json`
- Create: `services/ledger/ledger-ctrl/jest.config.js`

- [ ] **Step 1: Create project.json**

Create `services/ledger/ledger-ctrl/project.json`:

```json
{
  "name": "ledger-ctrl",
  "$schema": "../../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "services/ledger/ledger-ctrl/src",
  "projectType": "application",
  "targets": {
    "deploy": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx cdk deploy --app 'npx ts-node -r ./tools/register-paths.js services/ledger/ledger-ctrl/src/main.ts' --require-approval never -c prefix={args.prefix}"
      }
    },
    "destroy": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx cdk destroy --app 'npx ts-node -r ./tools/register-paths.js services/ledger/ledger-ctrl/src/main.ts' --force -c prefix={args.prefix}"
      }
    },
    "test": {
      "executor": "@nx/jest:jest",
      "options": { "jestConfig": "services/ledger/ledger-ctrl/jest.config.js" }
    },
    "lint": { "executor": "@nx/eslint:lint" }
  },
  "tags": ["scope:ledger", "type:service"]
}
```

- [ ] **Step 2: Create tsconfig and jest config**

Create tsconfig.json, tsconfig.spec.json (same pattern as ledger-hub), and jest.config.js:

```javascript
const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'ledger-ctrl',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.spec.json',
      diagnostics: false,
    }],
  },
  moduleNameMapper: {
    '^@nestfolio/platform-core$': '<rootDir>/../../../libs/platform-core/src/index.ts',
    '^@nestfolio/platform-core/(.*)$': '<rootDir>/../../../libs/platform-core/src/$1',
    '^@nestfolio/domain-core$': '<rootDir>/../../../libs/domain-core/src/index.ts',
    '^@nestfolio/domain-core/(.*)$': '<rootDir>/../../../libs/domain-core/src/$1',
    '^@nestfolio/lambda-utils$': '<rootDir>/../../../libs/lambda-utils/src/index.ts',
    '^@nestfolio/lambda-utils/(.*)$': '<rootDir>/../../../libs/lambda-utils/src/$1',
    '^@nestfolio/command-core$': '<rootDir>/../../../libs/command-core/src/index.ts',
    '^@nestfolio/command-core/(.*)$': '<rootDir>/../../../libs/command-core/src/$1',
    '^@nestfolio/cdk-constructs$': '<rootDir>/../../../libs/cdk-constructs/src/index.ts',
  },
};
```

- [ ] **Step 3: Commit**

```bash
git add services/ledger/ledger-ctrl/
git commit -m "chore(ledger-ctrl): scaffold project with Nx configuration"
```

### Task 6: Create account.reducer.ts

**Files:**
- Create: `services/ledger/ledger-ctrl/src/reducers/account.reducer.ts`
- Create: `services/ledger/ledger-ctrl/src/reducers/account.reducer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/ledger/ledger-ctrl/src/reducers/account.reducer.test.ts`:

```typescript
import { type LedgerEntry, INITIAL_ACCOUNT_STATE, replayEvents } from '@nestfolio/command-core';
import { accountReducer } from './account.reducer';

describe('accountReducer', () => {
  it('applies DEPOSIT_DETECTED', () => {
    const entry: LedgerEntry = {
      eventId: 'e1', eventType: 'DEPOSIT_DETECTED', sequenceNo: 1,
      timestamp: '2026-03-12T00:00:00Z',
      payload: { depositId: 'd1', amountCents: 500_00, depositedAt: '2026-03-12T00:00:00Z' },
    };

    const next = accountReducer(INITIAL_ACCOUNT_STATE, entry);
    expect(next.cashBalanceCents).toBe(INITIAL_ACCOUNT_STATE.cashBalanceCents + 500_00);
  });

  it('applies WITHDRAWAL_COMPLETED', () => {
    const entry: LedgerEntry = {
      eventId: 'e2', eventType: 'WITHDRAWAL_COMPLETED', sequenceNo: 1,
      timestamp: '2026-03-12T00:00:00Z',
      payload: { withdrawalId: 'w1', amountCents: 200_00, completedAt: '2026-03-12T00:00:00Z' },
    };

    const next = accountReducer(INITIAL_ACCOUNT_STATE, entry);
    expect(next.cashBalanceCents).toBe(INITIAL_ACCOUNT_STATE.cashBalanceCents - 200_00);
  });

  it('applies ORDER_FILLED (BUY)', () => {
    const entry: LedgerEntry = {
      eventId: 'e3', eventType: 'ORDER_FILLED', sequenceNo: 1,
      timestamp: '2026-03-12T00:00:00Z',
      payload: { orderId: 'o1', symbol: 'AAPL', side: 'BUY', quantity: 10, fillPrice: 150_00, filledAt: '2026-03-12T00:00:00Z' },
    };

    const next = accountReducer(INITIAL_ACCOUNT_STATE, entry);
    expect(next.positions['AAPL']).toBeDefined();
    expect(next.positions['AAPL'].quantity).toBe(10);
    expect(next.cashBalanceCents).toBe(INITIAL_ACCOUNT_STATE.cashBalanceCents - 10 * 150_00);
  });

  it('applies ORDER_FILLED (SELL)', () => {
    const stateWithPosition = {
      ...INITIAL_ACCOUNT_STATE,
      positions: { AAPL: { symbol: 'AAPL', quantity: 10, averageCostBasis: 150_00, totalCostBasis: 1_500_00, lastFillPrice: 150_00 } },
    };
    const entry: LedgerEntry = {
      eventId: 'e4', eventType: 'ORDER_FILLED', sequenceNo: 1,
      timestamp: '2026-03-12T00:00:00Z',
      payload: { orderId: 'o2', symbol: 'AAPL', side: 'SELL', quantity: 5, fillPrice: 160_00, filledAt: '2026-03-12T00:00:00Z' },
    };

    const next = accountReducer(stateWithPosition, entry);
    expect(next.positions['AAPL'].quantity).toBe(5);
    expect(next.cashBalanceCents).toBe(stateWithPosition.cashBalanceCents + 5 * 160_00);
  });

  it('applies CORPORATE_ACTION_PROCESSED (stock split)', () => {
    const stateWithPosition = {
      ...INITIAL_ACCOUNT_STATE,
      positions: { AAPL: { symbol: 'AAPL', quantity: 100, averageCostBasis: 150, totalCostBasis: 15000, lastFillPrice: 150 } },
    };
    const entry: LedgerEntry = {
      eventId: 'e5', eventType: 'CORPORATE_ACTION_PROCESSED', sequenceNo: 1,
      timestamp: '2026-03-12T00:00:00Z',
      payload: { actionId: 'ca1', symbol: 'AAPL', actionType: 'STOCK_SPLIT', quantityMultiplier: 2, costBasisDivisor: 2, appliedAt: '2026-03-12T00:00:00Z' },
    };

    const next = accountReducer(stateWithPosition, entry);
    expect(next.positions['AAPL'].quantity).toBe(200);
    expect(next.positions['AAPL'].averageCostBasis).toBe(75);
  });

  it('passes through ORDER_REJECTED unchanged', () => {
    const entry: LedgerEntry = {
      eventId: 'e6', eventType: 'ORDER_REJECTED', sequenceNo: 1,
      timestamp: '2026-03-12T00:00:00Z',
      payload: { orderId: 'o3', reason: 'insufficient funds' },
    };

    const next = accountReducer(INITIAL_ACCOUNT_STATE, entry);
    expect(next).toEqual(INITIAL_ACCOUNT_STATE);
  });

  it('replays a sequence of events correctly', () => {
    const events: LedgerEntry[] = [
      { eventId: 'e1', eventType: 'DEPOSIT_DETECTED', sequenceNo: 1, timestamp: '2026-03-12T00:00:00Z', payload: { depositId: 'd1', amountCents: 1000_00, depositedAt: '2026-03-12T00:00:00Z' } },
      { eventId: 'e2', eventType: 'ORDER_FILLED', sequenceNo: 2, timestamp: '2026-03-12T01:00:00Z', payload: { orderId: 'o1', symbol: 'AAPL', side: 'BUY', quantity: 5, fillPrice: 100_00, filledAt: '2026-03-12T01:00:00Z' } },
      { eventId: 'e3', eventType: 'WITHDRAWAL_COMPLETED', sequenceNo: 3, timestamp: '2026-03-12T02:00:00Z', payload: { withdrawalId: 'w1', amountCents: 200_00, completedAt: '2026-03-12T02:00:00Z' } },
    ];

    const final = replayEvents(INITIAL_ACCOUNT_STATE, events, accountReducer);
    expect(final.cashBalanceCents).toBe(INITIAL_ACCOUNT_STATE.cashBalanceCents + 1000_00 - 5 * 100_00 - 200_00);
    expect(final.positions['AAPL'].quantity).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test ledger-ctrl -- --testPathPattern=account.reducer`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `services/ledger/ledger-ctrl/src/reducers/account.reducer.ts`:

```typescript
import {
  type EventReducer,
  type AccountState,
  applyCommand,
  RecordDeposit,
  RecordWithdrawal,
  RecordFill,
  RecordCorporateAction,
} from '@nestfolio/command-core';

export const accountReducer: EventReducer<AccountState> = (state, entry) => {
  const p = entry.payload as Record<string, unknown>;

  switch (entry.eventType) {
    case 'DEPOSIT_DETECTED': {
      const result = applyCommand(RecordDeposit, {
        depositId: p['depositId'] as string,
        amountCents: p['amountCents'] as number,
        depositedAt: p['depositedAt'] as string,
      }, state);
      return result.ok ? result.value.nextState : state;
    }

    case 'WITHDRAWAL_COMPLETED': {
      const result = applyCommand(RecordWithdrawal, {
        withdrawalId: p['withdrawalId'] as string,
        amountCents: p['amountCents'] as number,
        withdrawnAt: p['completedAt'] as string,
      }, state);
      return result.ok ? result.value.nextState : state;
    }

    case 'ORDER_FILLED':
    case 'ORDER_PARTIALLY_FILLED': {
      const result = applyCommand(RecordFill, {
        orderId: p['orderId'] as string,
        symbol: p['symbol'] as string,
        side: p['side'] as 'BUY' | 'SELL',
        quantity: p['quantity'] as number,
        priceCents: p['fillPrice'] as number,
        filledAt: p['filledAt'] as string,
      }, state);
      return result.ok ? result.value.nextState : state;
    }

    case 'CORPORATE_ACTION_PROCESSED': {
      const result = applyCommand(RecordCorporateAction, {
        actionId: p['actionId'] as string,
        symbol: p['symbol'] as string,
        actionType: p['actionType'] as 'STOCK_SPLIT' | 'REVERSE_SPLIT' | 'DIVIDEND',
        quantityMultiplier: p['quantityMultiplier'] as number | undefined,
        costBasisDivisor: p['costBasisDivisor'] as number | undefined,
        dividendPerShareCents: p['dividendPerShareCents'] as number | undefined,
        appliedAt: p['appliedAt'] as string,
      }, state);
      return result.ok ? result.value.nextState : state;
    }

    case 'ORDER_REJECTED':
    case 'ORDER_CANCELLED':
    default:
      return state;
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test ledger-ctrl -- --testPathPattern=account.reducer`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add services/ledger/ledger-ctrl/
git commit -m "feat(ledger-ctrl): add accountReducer with event-to-command mapping"
```

### Task 7: Create ledger.repository.ts

**Files:**
- Create: `services/ledger/ledger-ctrl/src/repositories/ledger.repository.ts`
- Create: `services/ledger/ledger-ctrl/src/repositories/ledger.repository.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/ledger/ledger-ctrl/src/repositories/ledger.repository.test.ts`:

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { LedgerRepository } from './ledger.repository';

// Mock DynamoDBClient
jest.mock('@aws-sdk/client-dynamodb');

describe('LedgerRepository', () => {
  let repo: LedgerRepository;
  let mockSend: jest.Mock;

  beforeEach(() => {
    mockSend = jest.fn();
    (DynamoDBClient as jest.MockedClass<typeof DynamoDBClient>).mockImplementation(() => ({
      send: mockSend,
    }) as any);
    repo = new LedgerRepository('test-table', new DynamoDBClient({}));
  });

  describe('putLedgerEntry', () => {
    it('writes a LedgerEntry with correct pk/sk format', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.putLedgerEntry({
        tenantId: 't1',
        streamType: 'actual',
        eventId: 'e1',
        eventType: 'DEPOSIT_DETECTED',
        payload: { amountCents: 100 },
        timestamp: '2026-03-12T00:00:00Z',
        sequenceNo: 1,
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const putArgs = mockSend.mock.calls[0][0].input;
      expect(putArgs.Item.pk).toBe('Account#t1#actual');
      expect(putArgs.Item.sk).toMatch(/^Event#0+1#e1$/);
      expect(putArgs.Item.__typename).toBe('LedgerEntry');
    });
  });

  describe('nextSequence', () => {
    it('atomically increments and returns the next sequence number', async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: { counter: { N: '5' } },
      });

      const seq = await repo.nextSequence('t1', 'actual');

      expect(seq).toBe(5);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('getLatestSnapshot', () => {
    it('returns null when no snapshot exists', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await repo.getLatestSnapshot('t1', 'actual');
      expect(result).toBeNull();
    });

    it('returns snapshot when it exists', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { pk: 'Account#t1#actual', sk: 'Snapshot#latest', cashBalanceCents: 1000 },
      });

      const result = await repo.getLatestSnapshot('t1', 'actual');
      expect(result).toBeDefined();
      expect(result!['cashBalanceCents']).toBe(1000);
    });
  });

  describe('saveSnapshotWithEvents', () => {
    it('writes snapshot + BalanceEvent + PortfolioEvent in a transaction', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.saveSnapshotWithEvents('t1', 'actual', {
        state: { cashBalanceCents: 1000, positions: {}, lastEventSequence: 1 },
        version: 1,
        lastEventSequence: 1,
        balanceChanged: true,
        positionsChanged: false,
        deltaCents: 500,
        causeEventType: 'DEPOSIT_DETECTED',
        causeEventId: 'e1',
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const txItems = mockSend.mock.calls[0][0].input.TransactItems;
      // Snapshot + BalanceEvent (no PortfolioEvent since positionsChanged=false)
      expect(txItems.length).toBe(2);
      expect(txItems[0].Put.Item.__typename).toBe('AccountSnapshot');
      expect(txItems[1].Put.Item.__typename).toBe('BalanceEvent');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test ledger-ctrl -- --testPathPattern=ledger.repository`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `services/ledger/ledger-ctrl/src/repositories/ledger.repository.ts`:

```typescript
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { PutCommand, GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { TableRepository } from '@nestfolio/platform-core';
import { getUUID, getTime } from '@nestfolio/platform-core';

interface PutLedgerEntryInput {
  tenantId: string;
  streamType: string;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  timestamp: string;
  sequenceNo: number;
  decisionId?: string;
}

interface SaveSnapshotInput {
  state: Record<string, unknown>;
  version: number;
  lastEventSequence: number;
  balanceChanged: boolean;
  positionsChanged: boolean;
  deltaCents?: number;
  changedSymbols?: string[];
  causeEventType: string;
  causeEventId: string;
}

export class LedgerRepository extends TableRepository {
  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  async putLedgerEntry(input: PutLedgerEntryInput): Promise<void> {
    const pk = `Account#${input.tenantId}#${input.streamType}`;
    const sk = `Event#${String(input.sequenceNo).padStart(10, '0')}#${input.eventId}`;

    await this.docClient.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        pk,
        sk,
        __typename: 'LedgerEntry',
        tenantId: input.tenantId,
        streamType: input.streamType,
        eventId: input.eventId,
        eventType: input.eventType,
        payload: input.payload,
        timestamp: input.timestamp,
        sequenceNo: input.sequenceNo,
        ...(input.decisionId ? { decisionId: input.decisionId } : {}),
      },
    }));
  }

  async nextSequence(tenantId: string, streamType: string): Promise<number> {
    const result = await this.client.send(new UpdateItemCommand({
      TableName: this.tableName,
      Key: {
        pk: { S: `Sequence#${tenantId}#${streamType}` },
        sk: { S: 'Counter' },
      },
      UpdateExpression: 'ADD #c :inc',
      ExpressionAttributeNames: { '#c': 'counter' },
      ExpressionAttributeValues: { ':inc': { N: '1' } },
      ReturnValues: 'ALL_NEW',
    }));

    return parseInt(result.Attributes!['counter'].N!, 10);
  }

  async getLatestSnapshot(tenantId: string, streamType: string): Promise<Record<string, unknown> | null> {
    const result = await this.docClient.send(new GetCommand({
      TableName: this.tableName,
      Key: { pk: `Account#${tenantId}#${streamType}`, sk: 'Snapshot#latest' },
    }));
    return (result.Item as Record<string, unknown>) ?? null;
  }

  async saveSnapshotWithEvents(
    tenantId: string,
    streamType: string,
    input: SaveSnapshotInput,
  ): Promise<void> {
    const pk = `Account#${tenantId}#${streamType}`;
    const now = getTime();

    const transactItems: Array<{ Put: { TableName: string; Item: Record<string, unknown> } }> = [
      {
        Put: {
          TableName: this.tableName,
          Item: {
            pk,
            sk: 'Snapshot#latest',
            __typename: 'AccountSnapshot',
            tenantId,
            streamType,
            ...input.state,
            lastEventSequence: input.lastEventSequence,
            version: input.version,
            snapshotAt: now,
          },
        },
      },
    ];

    if (input.balanceChanged) {
      transactItems.push({
        Put: {
          TableName: this.tableName,
          Item: {
            pk: `Event#${tenantId}`,
            sk: `BalanceEvent#${now}#${getUUID()}`,
            __typename: 'BalanceEvent',
            tenantId,
            balanceCents: (input.state['cashBalanceCents'] as number),
            deltaCents: input.deltaCents ?? 0,
            causeEventType: input.causeEventType,
            causeEventId: input.causeEventId,
            timestamp: now,
          },
        },
      });
    }

    if (input.positionsChanged) {
      transactItems.push({
        Put: {
          TableName: this.tableName,
          Item: {
            pk: `Event#${tenantId}`,
            sk: `PortfolioEvent#${now}#${getUUID()}`,
            __typename: 'PortfolioEvent',
            tenantId,
            positions: input.state['positions'],
            changedSymbols: input.changedSymbols ?? [],
            causeEventType: input.causeEventType,
            causeEventId: input.causeEventId,
            timestamp: now,
          },
        },
      });
    }

    // Always write a LedgerEntryEvent for ledger-bff consumption
    transactItems.push({
      Put: {
        TableName: this.tableName,
        Item: {
          pk: `Event#${tenantId}`,
          sk: `LedgerEntryEvent#${now}#${getUUID()}`,
          __typename: 'LedgerEntryEvent',
          tenantId,
          streamType,
          sequenceNo: input.lastEventSequence,
          causeEventType: input.causeEventType,
          causeEventId: input.causeEventId,
          timestamp: now,
        },
      },
    });

    await this.docClient.send(new TransactWriteCommand({ TransactItems: transactItems }));
  }

  async queryEntriesSince(
    tenantId: string,
    streamType: string,
    sinceSequence: number,
  ): Promise<Record<string, unknown>[]> {
    const pk = `Account#${tenantId}#${streamType}`;
    const startSk = `Event#${String(sinceSequence + 1).padStart(10, '0')}`;

    const result = await this.docClient.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk AND sk >= :startSk',
      FilterExpression: '__typename = :typename',
      ExpressionAttributeValues: {
        ':pk': pk,
        ':startSk': startSk,
        ':typename': 'LedgerEntry',
      },
      ScanIndexForward: true,
    }));

    return (result.Items ?? []) as Record<string, unknown>[];
  }

  async saveCheckpoint(
    tenantId: string,
    streamType: string,
    date: string,
    state: Record<string, unknown>,
  ): Promise<boolean> {
    try {
      await this.docClient.send(new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `Account#${tenantId}#${streamType}`,
          sk: `Checkpoint#${date}`,
          __typename: 'AccountCheckpoint',
          tenantId,
          streamType,
          ...state,
          checkpointDate: date,
          createdAt: getTime(),
        },
        ConditionExpression: 'attribute_not_exists(sk)',
      }));
      return true;
    } catch (error: unknown) {
      if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
        return false; // Checkpoint already exists for today
      }
      throw error;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test ledger-ctrl -- --testPathPattern=ledger.repository`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add services/ledger/ledger-ctrl/
git commit -m "feat(ledger-ctrl): add LedgerRepository with event store and snapshot management"
```

---

## Chunk 4: ledger-ctrl Service — Event Listener, Reducer Handler & CDK Stack

### Task 8: Create event-listener.ts

**Files:**
- Create: `services/ledger/ledger-ctrl/src/handlers/event-listener.ts`
- Create: `services/ledger/ledger-ctrl/src/handlers/event-listener.test.ts`
- Create: `services/ledger/ledger-ctrl/src/services/shadow-fill.service.ts` (copy from order-ledger-bff)

- [ ] **Step 1: Copy shadow-fill.service.ts from order-ledger-bff**

Copy `services/execution/order-ledger-bff/src/services/shadow-fill.service.ts` to `services/ledger/ledger-ctrl/src/services/shadow-fill.service.ts`. No changes needed — it's a pure function service.

- [ ] **Step 2: Write the event listener test**

Create `services/ledger/ledger-ctrl/src/handlers/event-listener.test.ts`:

```typescript
import { type SQSEvent } from 'aws-lambda';
import { createHandler } from './event-listener';

const mockDeps = () => ({
  repository: {
    nextSequence: jest.fn().mockResolvedValue(1),
    putLedgerEntry: jest.fn().mockResolvedValue(undefined),
  },
  idempotencyGuard: {
    ensureOnce: jest.fn().mockResolvedValue(true),
  },
  bus: {
    publish: jest.fn().mockResolvedValue(undefined),
  },
  metrics: {
    addMetric: jest.fn(),
    publishStoredMetrics: jest.fn(),
  },
  shadowFill: {
    simulateFill: jest.fn().mockResolvedValue({ price: 150_00 }),
  },
});

const makeSQSEvent = (eventType: string, payload: Record<string, unknown> = {}): SQSEvent => ({
  Records: [{
    messageId: 'msg-1',
    body: JSON.stringify({
      detail: {
        id: 'evt-1',
        type: eventType,
        timestamp: '2026-03-12T00:00:00Z',
        context: { tenantId: 'tenant-1' },
        subject: payload,
      },
    }),
  }],
} as any);

describe('ledger-ctrl event-listener', () => {
  it('processes DEPOSIT_DETECTED as actual event', async () => {
    const deps = mockDeps();
    const handler = createHandler(deps as any);

    const result = await handler(makeSQSEvent('DEPOSIT_DETECTED', { depositId: 'd1', amountCents: 500 }));

    expect(result.batchItemFailures).toHaveLength(0);
    expect(deps.idempotencyGuard.ensureOnce).toHaveBeenCalledWith('DEPOSIT_DETECTED', 'evt-1');
    expect(deps.repository.nextSequence).toHaveBeenCalledWith('tenant-1', 'actual');
    expect(deps.repository.putLedgerEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        streamType: 'actual',
        eventType: 'DEPOSIT_DETECTED',
      }),
    );
    expect(deps.metrics.addMetric).toHaveBeenCalledWith('EventProcessed', expect.anything(), 1);
  });

  it('processes DECISION_PACKET_CREATED as simulation event', async () => {
    const deps = mockDeps();
    const handler = createHandler(deps as any);

    const event = makeSQSEvent('DECISION_PACKET_CREATED', {
      decisionPacketId: 'dp1',
      proposedTrades: [{ symbol: 'AAPL', side: 'BUY', quantity: 10 }],
    });

    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(0);
    expect(deps.idempotencyGuard.ensureOnce).toHaveBeenCalledWith('SIM_DECISION_PACKET_CREATED', 'evt-1');
    expect(deps.repository.putLedgerEntry).toHaveBeenCalledWith(
      expect.objectContaining({ streamType: 'simulated', eventType: 'ORDER_FILLED' }),
    );
    expect(deps.metrics.addMetric).toHaveBeenCalledWith('SimulationProcessed', expect.anything(), 1);
  });

  it('skips duplicate events', async () => {
    const deps = mockDeps();
    deps.idempotencyGuard.ensureOnce.mockResolvedValue(false);
    const handler = createHandler(deps as any);

    await handler(makeSQSEvent('DEPOSIT_DETECTED'));

    expect(deps.repository.putLedgerEntry).not.toHaveBeenCalled();
  });

  it('skips unknown event types', async () => {
    const deps = mockDeps();
    const handler = createHandler(deps as any);

    await handler(makeSQSEvent('UNKNOWN_EVENT'));

    expect(deps.repository.putLedgerEntry).not.toHaveBeenCalled();
  });

  it('reports retryable failures in batchItemFailures', async () => {
    const deps = mockDeps();
    const retryableError = new Error('DynamoDB timeout');
    (retryableError as any).retryable = true;
    deps.repository.putLedgerEntry.mockRejectedValue(retryableError);
    const handler = createHandler(deps as any);

    const result = await handler(makeSQSEvent('DEPOSIT_DETECTED', { depositId: 'd1', amountCents: 500 }));

    expect(result.batchItemFailures).toHaveLength(1);
    expect(deps.metrics.addMetric).toHaveBeenCalledWith('EventFailed', expect.anything(), 1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx nx test ledger-ctrl -- --testPathPattern=event-listener`
Expected: FAIL — module not found

- [ ] **Step 4: Write the event listener implementation**

Create `services/ledger/ledger-ctrl/src/handlers/event-listener.ts`. This is structurally identical to order-ledger-bff's event-listener, with these changes:
- SERVICE_NAME: `'ledger-ctrl'`
- Error event: `'LEDGER_PROCESSING_FAILED'` and `'LEDGER_SIMULATION_FAILED'`
- Bus name from `naming.eventBusName()` for ledger domain
- Import repository from `../repositories/ledger.repository`

(Follow the exact same pattern from `services/execution/order-ledger-bff/src/handlers/event-listener.ts`, updating service name, error event names, and import paths.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx nx test ledger-ctrl -- --testPathPattern=event-listener`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add services/ledger/ledger-ctrl/
git commit -m "feat(ledger-ctrl): add event listener with actual + simulation stream handling"
```

### Task 9: Create reducer.ts handler

**Files:**
- Create: `services/ledger/ledger-ctrl/src/handlers/reducer.ts`
- Create: `services/ledger/ledger-ctrl/src/handlers/reducer.test.ts`

- [ ] **Step 1: Write the reducer handler test**

Create `services/ledger/ledger-ctrl/src/handlers/reducer.test.ts`:

```typescript
import { type DynamoDBStreamEvent } from 'aws-lambda';
import { INITIAL_ACCOUNT_STATE } from '@nestfolio/command-core';
import { createReducer } from './reducer';

const mockDeps = () => ({
  repository: {
    getLatestSnapshot: jest.fn().mockResolvedValue(null),
    queryEntriesSince: jest.fn().mockResolvedValue([
      { eventId: 'e1', eventType: 'DEPOSIT_DETECTED', payload: { depositId: 'd1', amountCents: 500_00, depositedAt: '2026-03-12T00:00:00Z' }, timestamp: '2026-03-12T00:00:00Z', sequenceNo: 1 },
    ]),
    saveSnapshotWithEvents: jest.fn().mockResolvedValue(undefined),
    saveCheckpoint: jest.fn().mockResolvedValue(true),
  },
  metrics: {
    addMetric: jest.fn(),
    publishStoredMetrics: jest.fn(),
  },
});

const makeStreamEvent = (tenantId: string, streamType: string): DynamoDBStreamEvent => ({
  Records: [{
    eventName: 'INSERT',
    dynamodb: {
      NewImage: {
        pk: { S: `Account#${tenantId}#${streamType}` },
        sk: { S: 'Event#0000000001#e1' },
        __typename: { S: 'LedgerEntry' },
        tenantId: { S: tenantId },
        streamType: { S: streamType },
        eventId: { S: 'e1' },
        eventType: { S: 'DEPOSIT_DETECTED' },
        sequenceNo: { N: '1' },
        timestamp: { S: '2026-03-12T00:00:00Z' },
        payload: { M: { amountCents: { N: '50000' } } },
      },
    },
  }],
} as any);

describe('ledger-ctrl reducer', () => {
  it('replays events and saves snapshot with balance event', async () => {
    const deps = mockDeps();
    const handler = createReducer(deps as any);

    await handler(makeStreamEvent('t1', 'actual'));

    expect(deps.repository.getLatestSnapshot).toHaveBeenCalledWith('t1', 'actual');
    expect(deps.repository.queryEntriesSince).toHaveBeenCalledWith('t1', 'actual', 0);
    expect(deps.repository.saveSnapshotWithEvents).toHaveBeenCalledWith(
      't1', 'actual',
      expect.objectContaining({
        balanceChanged: true,
        positionsChanged: false,
        state: expect.objectContaining({
          cashBalanceCents: INITIAL_ACCOUNT_STATE.cashBalanceCents + 500_00,
        }),
      }),
    );
    expect(deps.metrics.addMetric).toHaveBeenCalledWith('SnapshotUpdated', expect.anything(), 1);
  });

  it('saves daily checkpoint on first event of new day', async () => {
    const deps = mockDeps();
    const handler = createReducer(deps as any);

    await handler(makeStreamEvent('t1', 'actual'));

    expect(deps.repository.saveCheckpoint).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test ledger-ctrl -- --testPathPattern=reducer.test`
Expected: FAIL — module not found

- [ ] **Step 3: Write the reducer handler implementation**

Create `services/ledger/ledger-ctrl/src/handlers/reducer.ts`. Follow the pattern from order-ledger-bff's reducer, with these key differences:
- Import `accountReducer` from `../reducers/account.reducer` instead of `portfolioReducer`
- Import `INITIAL_ACCOUNT_STATE` instead of `INITIAL_PORTFOLIO_STATE`
- Use `saveSnapshotWithEvents()` (new method) that writes snapshot + BalanceEvent/PortfolioEvent/LedgerEntryEvent records in a transaction
- Compare previous and next state to determine `balanceChanged` and `positionsChanged` flags
- SERVICE_NAME: `'ledger-ctrl'`

```typescript
import { DynamoDBStreamEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { logger } from '@nestfolio/platform-core';
import {
  requireEnv,
  createServiceMetrics,
  MetricUnit,
  applyMiddleware,
  withLambdaContext,
  withTiming,
} from '@nestfolio/lambda-utils';
import {
  replayEvents,
  INITIAL_ACCOUNT_STATE,
  type LedgerEntry,
  type AccountState,
} from '@nestfolio/command-core';
import { LedgerRepository } from '../repositories/ledger.repository';
import { accountReducer } from '../reducers/account.reducer';

interface ReducerDeps {
  readonly repository: LedgerRepository;
  readonly metrics: ReturnType<typeof createServiceMetrics>;
}

interface StreamGroup {
  tenantId: string;
  streamType: string;
  entries: LedgerEntry[];
}

function groupByStream(records: DynamoDBStreamEvent['Records']): Map<string, StreamGroup> {
  const groups = new Map<string, StreamGroup>();

  for (const record of records) {
    if (record.eventName !== 'INSERT' || !record.dynamodb?.NewImage) continue;

    const image = unmarshall(record.dynamodb.NewImage as Record<string, any>);
    if (image['__typename'] !== 'LedgerEntry') continue;

    const tenantId = image['tenantId'] as string;
    const streamType = image['streamType'] as string;
    const key = `${tenantId}#${streamType}`;

    if (!groups.has(key)) {
      groups.set(key, { tenantId, streamType, entries: [] });
    }

    groups.get(key)!.entries.push({
      eventId: image['eventId'] as string,
      eventType: image['eventType'] as string,
      payload: image['payload'] as Record<string, unknown>,
      timestamp: image['timestamp'] as string,
      sequenceNo: image['sequenceNo'] as number,
    });
  }

  return groups;
}

function detectChanges(
  prev: AccountState,
  next: AccountState,
  lastEntry: LedgerEntry,
): { balanceChanged: boolean; positionsChanged: boolean; deltaCents: number; changedSymbols: string[] } {
  const balanceChanged = prev.cashBalanceCents !== next.cashBalanceCents;
  const deltaCents = next.cashBalanceCents - prev.cashBalanceCents;

  const allSymbols = new Set([...Object.keys(prev.positions), ...Object.keys(next.positions)]);
  const changedSymbols: string[] = [];
  for (const sym of allSymbols) {
    const prevPos = prev.positions[sym];
    const nextPos = next.positions[sym];
    if (!prevPos || !nextPos || prevPos.quantity !== nextPos.quantity || prevPos.averageCostBasis !== nextPos.averageCostBasis) {
      changedSymbols.push(sym);
    }
  }

  return { balanceChanged, positionsChanged: changedSymbols.length > 0, deltaCents, changedSymbols };
}

export const createReducer = (deps: ReducerDeps) =>
  async (event: DynamoDBStreamEvent): Promise<void> => {
    const groups = groupByStream(event.Records);

    for (const [streamKey, group] of groups) {
      try {
        logger.info('Processing stream group', { streamKey, entryCount: group.entries.length });

        const snapshot = await deps.repository.getLatestSnapshot(group.tenantId, group.streamType);
        const currentState = snapshot
          ? ({
              positions: snapshot['positions'] as Record<string, any>,
              cashBalanceCents: snapshot['cashBalanceCents'] as number,
              lastEventSequence: snapshot['lastEventSequence'] as number,
            } as unknown as AccountState)
          : INITIAL_ACCOUNT_STATE;

        const lastSeq = snapshot ? (snapshot['lastEventSequence'] as number) : 0;
        const newEntries = await deps.repository.queryEntriesSince(group.tenantId, group.streamType, lastSeq);

        if (newEntries.length === 0) {
          logger.info('No new entries to process', { streamKey });
          continue;
        }

        const ledgerEntries: LedgerEntry[] = newEntries.map((e) => ({
          eventId: e['eventId'] as string,
          eventType: e['eventType'] as string,
          payload: e['payload'] as Record<string, unknown>,
          timestamp: e['timestamp'] as string,
          sequenceNo: e['sequenceNo'] as number,
        }));

        const nextState = replayEvents(currentState, ledgerEntries, accountReducer);
        const maxSeq = ledgerEntries.reduce((max, e) => Math.max(max, e.sequenceNo), 0);
        const lastEntry = ledgerEntries[ledgerEntries.length - 1];
        const changes = detectChanges(currentState, nextState, lastEntry);
        const newVersion = (snapshot ? (snapshot['version'] as number) : 0) + 1;

        await deps.repository.saveSnapshotWithEvents(group.tenantId, group.streamType, {
          state: nextState as unknown as Record<string, unknown>,
          version: newVersion,
          lastEventSequence: maxSeq,
          ...changes,
          causeEventType: lastEntry.eventType,
          causeEventId: lastEntry.eventId,
        });

        // Daily checkpoint
        const today = new Date().toISOString().slice(0, 10);
        await deps.repository.saveCheckpoint(
          group.tenantId, group.streamType, today,
          nextState as unknown as Record<string, unknown>,
        );

        deps.metrics.addMetric('SnapshotUpdated', MetricUnit.Count, 1);
        logger.info('Stream group processed', { streamKey, newVersion });
      } catch (error) {
        logger.error('Failed to process stream group', {
          streamKey,
          error: error instanceof Error ? error.message : String(error),
        });
        deps.metrics.addMetric('ReducerFailed', MetricUnit.Count, 1);
        throw error;
      }
    }

    deps.metrics.publishStoredMetrics();
  };

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const repository = new LedgerRepository(TABLE_NAME, new DynamoDBClient({}));
const metrics = createServiceMetrics('ledger-ctrl');

const deps: ReducerDeps = { repository, metrics };

export const handler = applyMiddleware(
  createReducer(deps) as (event: unknown) => Promise<void>,
  withLambdaContext(),
  withTiming('ledger-ctrl-reducer'),
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test ledger-ctrl -- --testPathPattern=reducer.test`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add services/ledger/ledger-ctrl/
git commit -m "feat(ledger-ctrl): add reducer handler with change detection and event emission"
```

### Task 10: Create ledger-ctrl CDK stack

**Files:**
- Create: `services/ledger/ledger-ctrl/src/main.ts`
- Create: `services/ledger/ledger-ctrl/src/service.stack.ts`
- Create: `services/ledger/ledger-ctrl/src/service.stack.test.ts`

- [ ] **Step 1: Write the CDK stack test**

Create `services/ledger/ledger-ctrl/src/service.stack.test.ts`:

```typescript
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { LedgerCtrlStack } from './service.stack';

describe('LedgerCtrlStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App({ context: { prefix: 'test' } });
    const stack = new LedgerCtrlStack(app, 'TestLedgerCtrl');
    template = Template.fromStack(stack);
  });

  it('creates a DynamoDB table', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
  });

  it('creates EventListener Lambda', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: { SERVICE_NAME: 'ledger-ctrl' } },
    });
  });

  it('creates Reducer Lambda with DDB Stream event source', () => {
    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      FilterCriteria: {
        Filters: [{ Pattern: expect.stringContaining('LedgerEntry') }],
      },
    });
  });

  it('creates Egress for BalanceEvent, PortfolioEvent, LedgerEntryEvent', () => {
    // Egress construct creates a publisher Lambda + DDB stream source
    // with filter on publishableTypes
    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      FilterCriteria: {
        Filters: [{ Pattern: expect.stringContaining('BalanceEvent') }],
      },
    });
  });

  it('creates Ingress from ledger-hub bus', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: {
        'detail-type': expect.arrayContaining(['DEPOSIT_DETECTED', 'ORDER_FILLED']),
      },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test ledger-ctrl -- --testPathPattern=service.stack`
Expected: FAIL — module not found

- [ ] **Step 3: Write the CDK stack**

Create `services/ledger/ledger-ctrl/src/service.stack.ts`:

```typescript
import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { StartingPosition, FilterCriteria, FilterRule } from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { join } from 'path';
import {
  State,
  Ingress,
  Egress,
  Monitoring,
  ServiceDashboard,
  createNamingService,
  defaultLambdaProps,
  applyStandardTags,
} from '@nestfolio/cdk-constructs';

export class LedgerCtrlStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const naming = createNamingService(this, {
      subsystem: 'ledger',
      service: 'ledger-ctrl',
    });

    const prefix = this.node.tryGetContext('prefix');
    if (!prefix) throw new Error('CDK context "prefix" is required. Pass -c prefix=dev|staging|prod');
    applyStandardTags(this, { service: 'ledger-ctrl', domain: 'ledger', environment: prefix });

    // State: DynamoDB table
    const state = new State(this, 'State');

    // Event listener Lambda
    const eventListener = new NodejsFunction(this, 'EventListener', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'event-listener.ts'),
      environment: { TABLE_NAME: state.table.tableName, BUS_NAME: naming.eventBusName(), SERVICE_NAME: 'ledger-ctrl' },
    });
    state.table.grantReadWriteData(eventListener);
    eventListener.addToRolePolicy(new PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [`arn:aws:events:${Stack.of(this).region}:${Stack.of(this).account}:event-bus/${naming.eventBusName()}`],
    }));

    // Ingress: from ledger-hub bus
    const ledgerBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${prefix}-ledger/event-hub/busArn`,
    );
    const ledgerBus = EventBus.fromEventBusArn(this, 'LedgerBus', ledgerBusArn);
    const ingress = new Ingress(this, 'Ingress', {
      eventBus: ledgerBus,
      eventTypes: [
        'ORDER_FILLED',
        'ORDER_PARTIALLY_FILLED',
        'ORDER_REJECTED',
        'ORDER_CANCELLED',
        'DEPOSIT_DETECTED',
        'WITHDRAWAL_COMPLETED',
        'CORPORATE_ACTION_PROCESSED',
        'DECISION_PACKET_CREATED',
      ],
      handler: eventListener,
    });

    // Reducer Lambda (DDB Stream consumer)
    const reducerFn = new NodejsFunction(this, 'ReducerFn', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'reducer.ts'),
      environment: { TABLE_NAME: state.table.tableName, SERVICE_NAME: 'ledger-ctrl' },
    });
    state.table.grantReadWriteData(reducerFn);

    reducerFn.addEventSource(new DynamoEventSource(state.table, {
      startingPosition: StartingPosition.LATEST,
      bisectBatchOnError: true,
      retryAttempts: 3,
      batchSize: 100,
      maxBatchingWindow: Duration.seconds(5),
      reportBatchItemFailures: true,
      filters: [
        FilterCriteria.filter({
          eventName: FilterRule.isEqual('INSERT'),
          dynamodb: {
            NewImage: {
              __typename: { S: FilterRule.isEqual('LedgerEntry') },
            },
          },
        }),
      ],
    }));

    // Egress: publishes BalanceEvent, PortfolioEvent, LedgerEntryEvent to ledger-hub
    const egress = new Egress(this, 'Egress', {
      table: state.table,
      busName: naming.eventBusName(),
      serviceName: 'ledger-ctrl',
      publishableTypes: ['BalanceEvent', 'PortfolioEvent', 'LedgerEntryEvent'],
      customEventTypeMap: {
        'BalanceEvent:INSERT': 'BALANCE_UPDATED',
        'PortfolioEvent:INSERT': 'PORTFOLIO_UPDATED',
        'LedgerEntryEvent:INSERT': 'LEDGER_ENTRY_RECORDED',
      },
    });

    // Monitoring
    new Monitoring(this, 'Monitoring', {
      lambdaFunctions: [eventListener, reducerFn],
      dlqs: [ingress.dlq, egress.dlq],
    });

    // Dashboard
    new ServiceDashboard(this, 'Dashboard', {
      serviceName: 'ledger-ctrl',
      lambdaFunctions: [eventListener, reducerFn],
      dlqs: [ingress.dlq, egress.dlq],
    });
  }
}
```

- [ ] **Step 4: Create main.ts**

Create `services/ledger/ledger-ctrl/src/main.ts`:

```typescript
import { App } from 'aws-cdk-lib';
import { LedgerCtrlStack } from './service.stack';

const app = new App();
const prefix = app.node.tryGetContext('prefix') ?? 'dev';

new LedgerCtrlStack(app, `${prefix}-ledger-ctrl`);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx nx test ledger-ctrl -- --testPathPattern=service.stack`
Expected: PASS

- [ ] **Step 6: Run all ledger-ctrl tests**

Run: `npx nx test ledger-ctrl`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add services/ledger/ledger-ctrl/
git commit -m "feat(ledger-ctrl): add CDK stack with Ingress, Reducer, Egress, Monitoring"
```

---

## Chunk 5: ledger-bff Service

### Task 11: Create ledger-bff project scaffolding and repository

**Files:**
- Create: `services/ledger/ledger-bff/project.json`
- Create: `services/ledger/ledger-bff/tsconfig.json`, `tsconfig.spec.json`, `jest.config.js`
- Create: `services/ledger/ledger-bff/src/repositories/portfolio.repository.ts`
- Create: `services/ledger/ledger-bff/src/repositories/portfolio.repository.test.ts`

- [ ] **Step 1: Create project scaffolding**

Same pattern as ledger-ctrl. project.json with `"tags": ["scope:ledger", "type:bff"]`.

- [ ] **Step 2: Write repository test and implementation**

Create `services/ledger/ledger-bff/src/repositories/portfolio.repository.ts` with methods:
- `upsertBalance(tenantId, balanceCents, deltaCents)` — writes/updates `Portfolio#{tenantId}#Latest`
- `upsertPosition(tenantId, symbol, position)` — writes `Portfolio#{tenantId}#Position#{symbol}`
- `appendHistory(tenantId, entry)` — writes `History#{tenantId}##{sequenceNo}#{eventId}`
- `saveCheckpoint(tenantId, date, state)` — conditional PutItem on `Checkpoint#{tenantId}##{date}`
- `upsertSimulation(tenantId, state)` — writes `Simulation#{tenantId}#Latest`
- `getLatest(tenantId)` — read `Portfolio#{tenantId}#Latest`
- `getPositions(tenantId)` — query `Portfolio#{tenantId}#Position#*`
- `getHistory(tenantId, options)` — paginated query on `History#{tenantId}`
- `getCheckpoints(tenantId)` — query `Checkpoint#{tenantId}`
- `getCheckpointBefore(tenantId, date)` — query for nearest checkpoint before date
- `getEntriesSince(tenantId, sinceSeq)` — query `History#` entries after sequence
- `getSimulationLatest(tenantId)` — read `Simulation#{tenantId}#Latest`

Follow the same `TableRepository` base class pattern.

- [ ] **Step 3: Run tests, commit**

```bash
git add services/ledger/ledger-bff/
git commit -m "feat(ledger-bff): scaffold project and add PortfolioRepository"
```

### Task 12: Create event listener and pipes

**Files:**
- Create: `services/ledger/ledger-bff/src/handlers/event-listener.ts`
- Create: `services/ledger/ledger-bff/src/handlers/event-listener.test.ts`
- Create: `services/ledger/ledger-bff/src/pipes/balance-updated.pipe.ts`
- Create: `services/ledger/ledger-bff/src/pipes/portfolio-updated.pipe.ts`
- Create: `services/ledger/ledger-bff/src/pipes/ledger-entry-recorded.pipe.ts`

- [ ] **Step 1: Write pipe tests**

Test each pipe: BalanceUpdatedPipe updates Portfolio#Latest cash fields, PortfolioUpdatedPipe updates Position records, LedgerEntryRecordedPipe appends to History and conditionally saves checkpoints.

- [ ] **Step 2: Write pipe implementations**

Each pipe follows the existing pipe pattern (`process(uow)` method):

```typescript
export class BalanceUpdatedPipe {
  constructor(private readonly repo: PortfolioRepository) {}

  async process(uow: { event: Record<string, unknown> }): Promise<void> {
    const subject = uow.event['subject'] as Record<string, unknown>;
    await this.repo.upsertBalance(
      subject['tenantId'] as string,
      subject['balanceCents'] as number,
      subject['deltaCents'] as number,
    );
  }
}
```

- [ ] **Step 3: Write event listener test and implementation**

Follow the standard event listener pattern with pipe routing:

```typescript
const PIPE_MAP: Record<string, (deps: Deps) => Pipe> = {
  'BALANCE_UPDATED': (d) => new BalanceUpdatedPipe(d.repository),
  'PORTFOLIO_UPDATED': (d) => new PortfolioUpdatedPipe(d.repository),
  'LEDGER_ENTRY_RECORDED': (d) => new LedgerEntryRecordedPipe(d.repository),
};
```

- [ ] **Step 4: Run tests, commit**

```bash
git add services/ledger/ledger-bff/
git commit -m "feat(ledger-bff): add event listener with balance/portfolio/entry pipes"
```

### Task 13: Create GraphQL schema and JS pipeline resolvers

**Files:**
- Create: `services/ledger/ledger-bff/src/schema.graphql`
- Create: `services/ledger/ledger-bff/src/graphql/js-function/utils/check-auth.fn.js`
- Create: `services/ledger/ledger-bff/src/graphql/js-function/get-balance.fn.js`
- Create: `services/ledger/ledger-bff/src/graphql/js-function/get-portfolio.fn.js`
- Create: `services/ledger/ledger-bff/src/graphql/js-function/get-positions.fn.js`
- Create: `services/ledger/ledger-bff/src/graphql/js-function/get-performance.fn.js`
- Create: `services/ledger/ledger-bff/src/graphql/js-function/get-order-history.fn.js`
- Create: `services/ledger/ledger-bff/src/graphql/js-function/get-time-travel-availability.fn.js`
- Create: `services/ledger/ledger-bff/src/handlers/graphql-resolver.ts` (Lambda for getPortfolioAt + getSimulationComparison)
- Create: `services/ledger/ledger-bff/src/handlers/graphql-resolver.test.ts`

- [ ] **Step 1: Create GraphQL schema**

```graphql
type Query {
  getBalance: Balance
  getPortfolio: Portfolio
  getPositions(symbol: String): [Position]
  getPerformance: Performance
  getOrderHistory(limit: Int, nextToken: String): OrderHistoryPage
  getTimeTravelAvailability: TimeTravelAvailability
  getPortfolioAt(timestamp: String!): Portfolio
  getSimulationComparison: SimulationComparison
}

type Balance {
  cashBalanceCents: Int!
}

type Portfolio {
  cashBalanceCents: Int!
  positions: [Position!]!
  totalValueCents: Int
}

type Position {
  symbol: String!
  quantity: Int!
  averageCostBasis: Float!
  totalCostBasis: Float!
  lastFillPrice: Float!
}

type Performance {
  totalValueCents: Int!
  cashBalanceCents: Int!
  investedValueCents: Int!
  returnPercent: Float
}

type OrderHistoryPage {
  items: [OrderHistoryEntry!]!
  nextToken: String
}

type OrderHistoryEntry {
  eventType: String!
  payload: AWSJSON!
  timestamp: String!
  sequenceNo: Int!
}

type TimeTravelAvailability {
  earliestDate: String
  latestDate: String
}

type SimulationComparison {
  actual: Portfolio!
  simulated: Portfolio!
  cashDeltaCents: Int!
  positionDiffs: [PositionDiff!]!
}

type PositionDiff {
  symbol: String!
  actualQuantity: Int!
  simulatedQuantity: Int!
  quantityDiff: Int!
}
```

- [ ] **Step 2: Create JS pipeline resolver functions**

Follow the exact same JS resolver pattern from order-ledger-bff. Each resolver function is a `.fn.js` file using APPSYNC_JS runtime with DynamoDB data source. Use `check-auth.fn.js` from existing BFF patterns.

- [ ] **Step 3: Create Lambda resolver for getPortfolioAt and getSimulationComparison**

Follow the same pattern as order-ledger-bff's graphql-resolver.ts. Uses `createHandler(deps)` pattern with repository dependency injection.

- [ ] **Step 4: Run tests, commit**

```bash
git add services/ledger/ledger-bff/
git commit -m "feat(ledger-bff): add GraphQL schema with 6 JS pipeline + 2 Lambda resolvers"
```

### Task 14: Create ledger-bff CDK stack

**Files:**
- Create: `services/ledger/ledger-bff/src/service.stack.ts`
- Create: `services/ledger/ledger-bff/src/service.stack.test.ts`
- Create: `services/ledger/ledger-bff/src/main.ts`

- [ ] **Step 1: Write CDK stack test**

Test that the stack creates: State table, EventListener Lambda, Ingress from ledger-hub (BALANCE_UPDATED, PORTFOLIO_UPDATED, LEDGER_ENTRY_RECORDED), Facade with 6 JS + 2 Lambda resolvers, Monitoring, Dashboard. No Egress (pure read-model).

- [ ] **Step 2: Write CDK stack**

Follow the order-ledger-bff stack pattern, but:
- Ingress from ledger-hub (not execution-hub)
- Event types: `BALANCE_UPDATED`, `PORTFOLIO_UPDATED`, `LEDGER_ENTRY_RECORDED`
- No Reducer Lambda (event listener handles all state updates)
- No Egress (pure read-model, no events published)
- Facade with 6 JS pipeline resolvers + 2 Lambda resolvers

- [ ] **Step 3: Run all ledger-bff tests**

Run: `npx nx test ledger-bff`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add services/ledger/ledger-bff/
git commit -m "feat(ledger-bff): add CDK stack with Ingress, Facade, Monitoring"
```

---

## Chunk 6: reconciliation-ctrl Service

### Task 15: Create reconciliation-ctrl

**Files:**
- Create: `services/ledger/reconciliation-ctrl/` (full service)

- [ ] **Step 1: Copy portfolio-ctrl as starting point**

Copy `services/execution/portfolio-ctrl/` to `services/ledger/reconciliation-ctrl/`. Update:
- `project.json`: name → `reconciliation-ctrl`, tags → `["scope:ledger", "type:service"]`
- `service.stack.ts`: Stack class name → `ReconciliationCtrlStack`, naming subsystem → `ledger`, service → `reconciliation-ctrl`, domain tag → `ledger`
- Event listener: Update event types consumed (PORTFOLIO_UPDATED from ledger-ctrl, PORTFOLIO_SNAPSHOT_IMPORTED and CORPORATE_ACTION_APPLIED from execution-hub via ledger-hub)
- Egress: publishableTypes include `ReconciliationResult`, `DriftRecord`, customEventTypeMap for RECONCILIATION_COMPLETED, RECONCILIATION_FAILED, PORTFOLIO_DRIFT_DETECTED, CORPORATE_ACTION_PROCESSED
- Remove portfolio state management logic (ledger-ctrl owns that)
- Keep: reconciliation logic, drift detection

- [ ] **Step 2: Update tests**

Update all test files to reflect new service name, new event types, removed portfolio state logic.

- [ ] **Step 3: Run tests**

Run: `npx nx test reconciliation-ctrl`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add services/ledger/reconciliation-ctrl/
git commit -m "feat(reconciliation-ctrl): create from portfolio-ctrl with drift detection focus"
```

---

## Chunk 7: Rewire Existing Services

### Task 16: Update execution-hub forwarding rules

**Files:**
- Modify: `services/execution/execution-hub/src/service.stack.ts`
- Modify: `services/execution/execution-hub/src/service.stack.test.ts`

- [ ] **Step 1: Add forwarding to ledger-hub**

Add a new `ToLedger` rule that forwards financial events to ledger-hub:

```typescript
const ledgerBusArn = StringParameter.valueForStringParameter(
  this,
  `/nestfolio/${prefix}-ledger/event-hub/busArn`,
);
const ledgerBus = EventBus.fromEventBusArn(this, 'LedgerBus', ledgerBusArn);
const toLedgerDlq = new Queue(this, 'ToLedgerDLQ', {
  retentionPeriod: Duration.days(14),
  encryption: QueueEncryption.KMS_MANAGED,
});
new Rule(this, 'ToLedger', {
  eventBus: this.bus,
  eventPattern: {
    detailType: [
      'ORDER_FILLED',
      'ORDER_PARTIALLY_FILLED',
      'ORDER_REJECTED',
      'ORDER_CANCELLED',
      'DEPOSIT_DETECTED',
      'WITHDRAWAL_COMPLETED',
      'CORPORATE_ACTION_APPLIED',
      'PORTFOLIO_SNAPSHOT_IMPORTED',
    ],
  },
  targets: [new EventBusTarget(ledgerBus, { deadLetterQueue: toLedgerDlq })],
});
```

- [ ] **Step 2: Remove financial events from ToInvestor rule**

Update the ToInvestor rule — remove ORDER_FILLED, ORDER_PARTIALLY_FILLED, DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, CORPORATE_ACTION_APPLIED, RECONCILIATION_COMPLETED, RECONCILIATION_FAILED. Keep only ORDER_STAGED (notification) and non-financial events:

```typescript
new Rule(this, 'ToInvestor', {
  eventBus: this.bus,
  eventPattern: {
    detailType: [
      'ORDER_STAGED',
      'ORDER_REJECTED',
      'ORDER_CANCELLED',
      'WITHDRAWAL_REJECTED',
    ],
  },
  targets: [new EventBusTarget(investorBus, { deadLetterQueue: toInvestorDlq })],
});
```

- [ ] **Step 3: Update Monitoring/Dashboard DLQ lists**

Add `toLedgerDlq` to Monitoring and ServiceDashboard constructs.

- [ ] **Step 4: Update tests, run, commit**

Run: `npx nx test execution-hub`
Expected: All tests pass

```bash
git add services/execution/execution-hub/
git commit -m "feat(execution-hub): add forwarding to ledger-hub, remove financial events from investor forwarding"
```

### Task 17: Update investor-bff — remove financial state, add BALANCE_UPDATED consumer

**Files:**
- Modify: `services/investor/investor-bff/src/handlers/event-listener.ts`
- Modify: `services/investor/investor-bff/src/handlers/event-listener.test.ts`
- Delete: `services/investor/investor-bff/src/pipes/deposit-detected.pipe.ts`
- Delete: `services/investor/investor-bff/src/pipes/deposit-detected.pipe.test.ts`
- Delete: `services/investor/investor-bff/src/pipes/withdrawal-completed.pipe.ts`
- Delete: `services/investor/investor-bff/src/pipes/withdrawal-completed.pipe.test.ts`
- Create: `services/investor/investor-bff/src/pipes/balance-updated.pipe.ts`
- Create: `services/investor/investor-bff/src/pipes/balance-updated.pipe.test.ts`
- Modify: `services/investor/investor-bff/src/repositories/investor-profile.repository.ts` (remove updateCashBalance, withdrawCashConditional, getCashBalance)
- Modify: `services/investor/investor-bff/src/service.stack.ts` (update Ingress event types)

- [ ] **Step 1: Create BalanceUpdatedPipe**

```typescript
export class BalanceUpdatedPipe {
  constructor(private readonly repo: InvestorProfileRepository) {}

  async process(uow: UnitOfWork): Promise<void> {
    const { tenantId, balanceCents } = uow.event.subject;
    await this.repo.upsertReadOnlyBalance(tenantId, uow.event.subject.userId, balanceCents);
  }
}
```

- [ ] **Step 2: Update event listener**

Remove DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, ORDER_FILLED handlers. Add BALANCE_UPDATED handler mapping to BalanceUpdatedPipe.

- [ ] **Step 3: Delete old pipes and their tests**

Delete deposit-detected.pipe.ts/test.ts, withdrawal-completed.pipe.ts/test.ts, and the updateCashBalanceFromFill function.

- [ ] **Step 4: Update repository**

Remove `updateCashBalance`, `withdrawCashConditional`, `getCashBalance` methods. Add `upsertReadOnlyBalance(tenantId, userId, balanceCents)` — simple PutItem on the existing CashBalance entity.

- [ ] **Step 5: Update Ingress event types in CDK stack**

Remove DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, ORDER_FILLED from Ingress eventTypes. Add BALANCE_UPDATED.

- [ ] **Step 6: Run tests, commit**

Run: `npx nx test investor-bff`
Expected: All tests pass

```bash
git add services/investor/investor-bff/
git commit -m "refactor(investor-bff): replace financial pipes with BALANCE_UPDATED read-only projection"
```

### Task 18: Update dashboard-bff — consume ledger events

**Files:**
- Modify: `services/investor/dashboard-bff/src/handlers/event-listener.ts`
- Modify: `services/investor/dashboard-bff/src/handlers/event-listener.test.ts`
- Modify/Create pipes for BALANCE_UPDATED, PORTFOLIO_UPDATED (replacing raw financial event pipes)
- Modify: `services/investor/dashboard-bff/src/service.stack.ts` (update Ingress event types)

- [ ] **Step 1: Update event listener to consume BALANCE_UPDATED/PORTFOLIO_UPDATED**

Replace pipes that handle ORDER_FILLED, DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED with new pipes for BALANCE_UPDATED (updates PortfolioSummary.cashBalanceCents) and PORTFOLIO_UPDATED (updates PositionSnapshot records).

- [ ] **Step 2: Update Ingress event types**

Remove raw financial events. Add BALANCE_UPDATED, PORTFOLIO_UPDATED, RECONCILIATION_COMPLETED, RECONCILIATION_FAILED, LEDGER_PROCESSING_FAILED.

- [ ] **Step 3: Run tests, commit**

Run: `npx nx test dashboard-bff`
Expected: All tests pass

```bash
git add services/investor/dashboard-bff/
git commit -m "refactor(dashboard-bff): consume BALANCE_UPDATED/PORTFOLIO_UPDATED from ledger-hub"
```

### Task 19: Update investor-hub — add ingress from ledger-hub

**Files:**
- Modify: `services/investor/investor-hub/src/service.stack.ts`
- Modify: `services/investor/investor-hub/src/service.stack.test.ts`

investor-hub currently receives no events from ledger-hub (it doesn't exist yet). It needs to receive BALANCE_UPDATED, PORTFOLIO_UPDATED, RECONCILIATION_COMPLETED, RECONCILIATION_FAILED, LEDGER_PROCESSING_FAILED from ledger-hub. These events are then consumed by investor-bff (BALANCE_UPDATED), dashboard-bff (BALANCE_UPDATED, PORTFOLIO_UPDATED, RECONCILIATION_*, LEDGER_PROCESSING_FAILED), and investor-ctrl (BALANCE_UPDATED, LEDGER_PROCESSING_FAILED).

Note: investor-hub does NOT forward to ledger. Events arrive on investor-hub's bus from ledger-hub's forwarding rules. The services on investor-hub (investor-bff, dashboard-bff, investor-ctrl) already have Ingress constructs that filter by detailType from their own domain bus. No new rules needed on investor-hub itself — the events arrive via ledger-hub's ToInvestor rule.

**This task is actually a no-op for investor-hub's stack.** The ledger-hub ToInvestor rule (Task 4) already sends events to investor-hub's bus. The services' Ingress constructs already listen on investor-hub's bus and will pick up the new event types once their eventTypes arrays are updated (done in Tasks 17 and 18).

- [ ] **Step 1: Verify no investor-hub changes needed**

Confirm that the ledger-hub ToInvestor forwarding rule (Task 4) puts events directly onto investor-hub's bus, and that investor-bff/dashboard-bff Ingress constructs listen on that bus.

- [ ] **Step 2: Update investor-hub tests to verify new events pass through**

Add test assertions that BALANCE_UPDATED events forwarded from ledger-hub are visible on the investor bus.

- [ ] **Step 3: Run tests, commit**

Run: `npx nx test investor-hub`

```bash
git add services/investor/investor-hub/
git commit -m "test(investor-hub): verify ledger events arrive via ledger-hub forwarding"
```

### Task 20: Update advisory-hub — receive PORTFOLIO_UPDATED from ledger-hub

**Files:**
- Modify: `services/advisory/advisory-hub/src/service.stack.ts`
- Modify: `services/advisory/advisory-hub/src/service.stack.test.ts`

Same reasoning as investor-hub: the ledger-hub ToAdvisory rule (Task 4) puts PORTFOLIO_UPDATED, PORTFOLIO_DRIFT_DETECTED, RECONCILIATION_FAILED events directly onto advisory-hub's bus. advisory-ctrl's Ingress already listens on advisory-hub's bus.

However, execution-hub currently forwards ORDER_FILLED to advisory-hub (for decision feedback). This should remain — advisory-ctrl uses ORDER_FILLED to close the decision lifecycle, separate from the PORTFOLIO_UPDATED event which is about financial state. Do NOT remove ORDER_FILLED from execution-hub's ToAdvisory rule.

- [ ] **Step 1: Verify no advisory-hub stack changes needed**

The events arrive via ledger-hub forwarding. advisory-ctrl already listens for PORTFOLIO_UPDATED (was renamed from raw ORDER_FILLED for portfolio context — but advisory-ctrl also needs raw ORDER_FILLED for decision feedback). Verify both paths coexist.

- [ ] **Step 2: Run tests, commit**

Run: `npx nx test advisory-hub`

```bash
git add services/advisory/advisory-hub/
git commit -m "test(advisory-hub): verify PORTFOLIO_UPDATED arrives via ledger-hub forwarding"
```

### Task 21: Update investor-ctrl — add BALANCE_UPDATED notification trigger

**Files:**
- Modify: `services/investor/investor-ctrl/src/handlers/event-listener.ts`
- Modify: `services/investor/investor-ctrl/src/handlers/event-listener.test.ts`
- Modify: `services/investor/investor-ctrl/src/service.stack.ts` (add BALANCE_UPDATED to Ingress eventTypes)

- [ ] **Step 1: Add BALANCE_UPDATED to event listener**

In the event listener, add a new case for BALANCE_UPDATED that triggers a notification creation:

```typescript
case 'BALANCE_UPDATED':
  await deps.lifecycleService.executeNotificationLifecycle({
    tenantId,
    triggerEvent: uow.event,
  });
  break;
```

- [ ] **Step 2: Add BALANCE_UPDATED to Ingress eventTypes in CDK stack**

In `service.stack.ts`, add `'BALANCE_UPDATED'` to the `eventTypes` array in the Ingress construct.

- [ ] **Step 3: Add test for BALANCE_UPDATED handling**

```typescript
it('processes BALANCE_UPDATED and creates notification', async () => {
  const handler = createHandler(mockDeps);
  await handler(makeSQSEvent('BALANCE_UPDATED', { tenantId: 't1', balanceCents: 1050000, deltaCents: 50000 }));
  expect(mockDeps.lifecycleService.executeNotificationLifecycle).toHaveBeenCalledWith(
    expect.objectContaining({ tenantId: 't1' }),
  );
});
```

- [ ] **Step 4: Run tests, commit**

Run: `npx nx test investor-ctrl`

```bash
git add services/investor/investor-ctrl/
git commit -m "feat(investor-ctrl): add BALANCE_UPDATED as notification trigger"
```

### Task 22: Update ledger-mfe AppSync endpoint (was Task 19)

**Files:**
- Modify: `apps/ledger-mfe/src/app/` (or wherever the GraphQL client config is)
- Modify: `apps/nestfolio-host/src/` (provideGraphqlFor mapping)

- [ ] **Step 1: Update provideGraphqlFor mapping**

In nestfolio-host, update the route for ledger-mfe to point to `ledger-bff` AppSync endpoint instead of `order-ledger-bff`.

- [ ] **Step 2: Verify ledger-mfe builds**

Run: `npx nx build ledger-mfe`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add apps/
git commit -m "refactor(ledger-mfe): update AppSync endpoint from order-ledger-bff to ledger-bff"
```

---

## Chunk 8: Cleanup & Documentation

### Task 23: Delete portfolio-bff

**Files:**
- Delete: `services/execution/portfolio-bff/` (entire directory)

- [ ] **Step 1: Delete the service**

```bash
rm -rf services/execution/portfolio-bff
```

- [ ] **Step 2: Run full workspace test**

Run: `npx nx run-many -t test --all`
Expected: All projects pass (no other project imports from portfolio-bff)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: delete portfolio-bff (queries moved to ledger-bff)"
```

### Task 24: Delete order-ledger-bff

**Files:**
- Delete: `services/execution/order-ledger-bff/` (entire directory)

- [ ] **Step 1: Delete the service**

```bash
rm -rf services/execution/order-ledger-bff
```

- [ ] **Step 2: Run full workspace test**

Run: `npx nx run-many -t test --all`
Expected: All projects pass

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: delete order-ledger-bff (replaced by ledger-ctrl)"
```

### Task 25: Delete portfolio-ctrl

**Files:**
- Delete: `services/execution/portfolio-ctrl/` (entire directory)

- [ ] **Step 1: Delete the service**

```bash
rm -rf services/execution/portfolio-ctrl
```

- [ ] **Step 2: Run full workspace test**

Run: `npx nx run-many -t test --all`
Expected: All projects pass

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: delete portfolio-ctrl (replaced by reconciliation-ctrl)"
```

### Task 26: Update architecture specification

**Files:**
- Modify: `specifications/03-event-driven-architecture.md`

- [ ] **Step 1: Add 1:1 MFE-BFF rule**

Add a new section documenting the architectural rule:

```markdown
## MFE-BFF Pairing Rule

Each user-facing micro-frontend (MFE) communicates with exactly one backend-for-frontend (BFF)
via a single AppSync endpoint. An MFE must never query multiple BFFs directly.

If an MFE needs data owned by another domain, its paired BFF consumes events and maintains
a read-only projection. This ensures:
- Clear ownership boundaries
- No cross-service state sharing
- Single point of failure per user-facing feature
```

- [ ] **Step 2: Update domain descriptions**

Add Ledger domain description. Update Execution domain (shrunk). Update event routing tables.

- [ ] **Step 3: Commit**

```bash
git add specifications/
git commit -m "docs: update architecture spec with Ledger domain and 1:1 MFE-BFF rule"
```

### Task 27: Remove deprecated aliases from command-core

**Files:**
- Modify: `libs/command-core/src/state/account-state.ts`
- Modify: `libs/command-core/src/index.ts`

- [ ] **Step 1: Remove deprecated PortfolioState alias and INITIAL_PORTFOLIO_STATE**

After all consumers have been updated (order-ledger-bff deleted, reducer.ts in ledger-ctrl uses AccountState), remove the deprecated aliases.

- [ ] **Step 2: Search for remaining references**

Run: `grep -r 'PortfolioState\|INITIAL_PORTFOLIO_STATE' --include='*.ts' services/ libs/`
Expected: No references found

- [ ] **Step 3: Run full workspace test**

Run: `npx nx run-many -t test --all`
Expected: All projects pass

- [ ] **Step 4: Commit**

```bash
git add libs/command-core/
git commit -m "refactor(command-core): remove deprecated PortfolioState aliases"
```

### Task 28: Final verification

- [ ] **Step 1: Run full workspace test**

Run: `npx nx run-many -t test --all`
Expected: All projects pass

- [ ] **Step 2: Verify project count**

Run: `npx nx show projects | wc -l`
Expected: Same count or net +1 (added ledger-hub, ledger-ctrl, ledger-bff, reconciliation-ctrl; removed portfolio-bff, order-ledger-bff, portfolio-ctrl = net +1)

- [ ] **Step 3: Verify no cross-service state sharing**

Run: `grep -r 'grantReadData\|grantReadWriteData' --include='*.stack.ts' services/`
Verify: Every `grantReadData`/`grantReadWriteData` call uses `state.table` (own table only)

- [ ] **Step 4: Final commit if any loose changes**

```bash
git status
# If clean: done!
```
