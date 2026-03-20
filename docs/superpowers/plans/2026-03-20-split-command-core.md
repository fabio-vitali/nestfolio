# Split command-core into command-core + ledger-core

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract ledger domain code (AccountState, commands, accountReducer) from `libs/command-core` into a new `libs/ledger-core` lib, leaving only generic event-sourcing infrastructure in command-core.

**Architecture:** command-core keeps generic infrastructure (`defineCommand`, `applyCommand`, `replayEvents`, types). New ledger-core lib owns the ledger domain unit: `AccountState`, 6 command definitions, and the `accountReducer` (currently duplicated in ledger-bff and ledger-ctrl). Three consumers update imports: ledger-bff, ledger-ctrl, dashboard-bff.

**Tech Stack:** TypeScript, Nx, Jest, Zod

---

## File Map

### libs/command-core (modify — remove domain exports)

| File | Action |
|---|---|
| `libs/command-core/src/index.ts` | Remove domain re-exports, keep generic infra only |
| `libs/command-core/src/state/account-state.ts` | Delete |
| `libs/command-core/src/commands/ledger/record-fill.ts` | Delete |
| `libs/command-core/src/commands/ledger/record-deposit.ts` | Delete |
| `libs/command-core/src/commands/ledger/record-withdrawal.ts` | Delete |
| `libs/command-core/src/commands/ledger/record-corporate-action.ts` | Delete |
| `libs/command-core/src/commands/order/submit-order.ts` | Delete |
| `libs/command-core/src/commands/order/cancel-order.ts` | Delete |
| `libs/command-core/test/state/account-state.test.ts` | Delete |
| `libs/command-core/test/commands/ledger/*.test.ts` | Delete (4 files) |
| `libs/command-core/test/commands/order/*.test.ts` | Delete (2 files) |

### libs/ledger-core (create — new ledger domain lib)

| File | Action |
|---|---|
| `libs/ledger-core/project.json` | Create — Nx project config |
| `libs/ledger-core/tsconfig.json` | Create |
| `libs/ledger-core/tsconfig.lib.json` | Create |
| `libs/ledger-core/tsconfig.spec.json` | Create |
| `libs/ledger-core/jest.config.js` | Create |
| `libs/ledger-core/src/index.ts` | Create — barrel |
| `libs/ledger-core/src/account-state.ts` | Create — AccountState, PositionState, INITIAL_ACCOUNT_STATE |
| `libs/ledger-core/src/record-fill.ts` | Create |
| `libs/ledger-core/src/record-deposit.ts` | Create |
| `libs/ledger-core/src/record-withdrawal.ts` | Create |
| `libs/ledger-core/src/record-corporate-action.ts` | Create |
| `libs/ledger-core/src/submit-order.ts` | Create |
| `libs/ledger-core/src/cancel-order.ts` | Create |
| `libs/ledger-core/src/account.reducer.ts` | Create — single source of truth (replaces duplicated copies) |
| `libs/ledger-core/test/account-state.test.ts` | Create — moved from command-core |
| `libs/ledger-core/test/record-fill.test.ts` | Create — moved from command-core |
| `libs/ledger-core/test/record-deposit.test.ts` | Create — moved from command-core |
| `libs/ledger-core/test/record-withdrawal.test.ts` | Create — moved from command-core |
| `libs/ledger-core/test/record-corporate-action.test.ts` | Create — moved from command-core |
| `libs/ledger-core/test/submit-order.test.ts` | Create — moved from command-core |
| `libs/ledger-core/test/cancel-order.test.ts` | Create — moved from command-core |
| `libs/ledger-core/test/account.reducer.test.ts` | Create — moved from ledger-ctrl/test |

### Config updates

| File | Action |
|---|---|
| `tsconfig.base.json` | Add `@nestfolio/ledger-core` path alias, remove `@nestfolio/command-core/*` wildcard |
| `services/ledger/ledger-bff/jest.config.js` | Add ledger-core moduleNameMapper, remove `command-core/*` wildcard |
| `services/ledger/ledger-ctrl/jest.config.js` | Add ledger-core moduleNameMapper, remove `command-core/*` wildcard |
| `services/investor/dashboard-bff/jest.config.js` | Replace command-core with ledger-core moduleNameMapper |

### Consumer updates

| File | Action |
|---|---|
| `services/ledger/ledger-bff/src/reducers/account.reducer.ts` | Delete — replaced by ledger-core |
| `services/ledger/ledger-ctrl/src/reducers/account.reducer.ts` | Delete — replaced by ledger-core |
| `services/ledger/ledger-ctrl/test/reducers/account.reducer.test.ts` | Delete — moved to ledger-core |
| `services/ledger/ledger-bff/src/handlers/graphql-resolver.ts` | Update import: `@nestfolio/command-core` → `@nestfolio/ledger-core` |
| `services/ledger/ledger-bff/src/services/time-travel.service.ts` | Update imports: domain from `@nestfolio/ledger-core`, infra from `@nestfolio/command-core` |
| `services/ledger/ledger-bff/test/handlers/graphql-resolver.test.ts` | Split `jest.mock('@nestfolio/command-core')` into command-core + ledger-core mocks |
| `services/ledger/ledger-ctrl/src/handlers/reducer.ts` | Update imports: domain from `@nestfolio/ledger-core`, infra from `@nestfolio/command-core` |
| `services/ledger/ledger-ctrl/test/handlers/event-listener.test.ts` | Add `jest.mock('@nestfolio/ledger-core')` |
| `services/investor/dashboard-bff/src/pipes/simulation-summary.pipe.ts` | Update import: `@nestfolio/command-core` → `@nestfolio/ledger-core` |

---

## Chunk 1: Create ledger-core lib scaffolding (Tasks 1–2)

### Task 1: Create ledger-core project config files

**Files:**
- Create: `libs/ledger-core/project.json`
- Create: `libs/ledger-core/tsconfig.json`
- Create: `libs/ledger-core/tsconfig.lib.json`
- Create: `libs/ledger-core/tsconfig.spec.json`
- Create: `libs/ledger-core/jest.config.js`

- [ ] **Step 1: Create project.json**

```json
{
  "name": "ledger-core",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "libs/ledger-core/src",
  "projectType": "library",
  "targets": {
    "build": {
      "executor": "@nx/js:tsc",
      "outputs": ["{options.outputPath}"],
      "options": {
        "outputPath": "dist/libs/ledger-core",
        "main": "libs/ledger-core/src/index.ts",
        "tsConfig": "libs/ledger-core/tsconfig.lib.json"
      }
    },
    "test": {
      "executor": "@nx/jest:jest",
      "outputs": ["{workspaceRoot}/coverage/libs/ledger-core"],
      "options": {
        "jestConfig": "libs/ledger-core/jest.config.js"
      }
    },
    "lint": {
      "executor": "@nx/eslint:lint"
    }
  },
  "tags": ["scope:ledger", "type:lib"]
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "commonjs"
  },
  "files": [],
  "include": [],
  "references": [
    { "path": "./tsconfig.lib.json" },
    { "path": "./tsconfig.spec.json" }
  ]
}
```

- [ ] **Step 3: Create tsconfig.lib.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "../../dist/out-tsc",
    "declaration": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "src/**/*.spec.ts", "jest.config.ts"]
}
```

- [ ] **Step 4: Create tsconfig.spec.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "../../dist/out-tsc",
    "module": "commonjs",
    "types": [
      "jest",
      "node"
    ]
  },
  "include": [
    "jest.config.ts",
    "src/**/*.test.ts",
    "test/**/*.test.ts",
    "src/**/*.spec.ts",
    "test/**/*.spec.ts",
    "src/**/*.ts"
  ]
}
```

- [ ] **Step 5: Create jest.config.js**

```js
const preset = require('../../jest.preset');

module.exports = {
  ...preset,
  displayName: 'ledger-core',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@nestfolio/command-core$': '<rootDir>/../command-core/src/index.ts',
    '^@nestfolio/command-core/(.*)$': '<rootDir>/../command-core/src/$1',
    '^@nestfolio/event-processor$': '<rootDir>/../event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../event-processor/src/$1',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.spec.json',
      diagnostics: false,
    }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
  coverageThreshold: {
    global: { branches: 90, functions: 90, lines: 90, statements: 90 },
  },
};
```

- [ ] **Step 6: Add tsconfig path alias**

In `tsconfig.base.json`, add after the `@nestfolio/command-core/*` line:

```json
"@nestfolio/ledger-core": ["libs/ledger-core/src/index.ts"],
"@nestfolio/ledger-core/*": ["libs/ledger-core/src/*"],
```

- [ ] **Step 7: Commit**

```bash
git add libs/ledger-core/project.json libs/ledger-core/tsconfig.json libs/ledger-core/tsconfig.lib.json libs/ledger-core/tsconfig.spec.json libs/ledger-core/jest.config.js tsconfig.base.json
git commit -m "chore: scaffold ledger-core lib project config"
```

### Task 2: Create ledger-core source files

**Files:**
- Create: `libs/ledger-core/src/index.ts`
- Create: `libs/ledger-core/src/account-state.ts`
- Create: `libs/ledger-core/src/record-fill.ts`
- Create: `libs/ledger-core/src/record-deposit.ts`
- Create: `libs/ledger-core/src/record-withdrawal.ts`
- Create: `libs/ledger-core/src/record-corporate-action.ts`
- Create: `libs/ledger-core/src/submit-order.ts`
- Create: `libs/ledger-core/src/cancel-order.ts`
- Create: `libs/ledger-core/src/account.reducer.ts`

- [ ] **Step 1: Create account-state.ts**

Copy from `libs/command-core/src/state/account-state.ts` — no changes needed, the file has no imports.

```ts
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
```

- [ ] **Step 2: Create command files**

For each of the 6 command files, copy from `libs/command-core/src/commands/{ledger,order}/<name>.ts` and update imports:
- `../../command` → `@nestfolio/command-core`
- `../../state/account-state` → `./account-state`

**record-fill.ts:**
```ts
import { z } from 'zod';
import { defineCommand } from '@nestfolio/command-core';
import { type AccountState } from './account-state';

export const RecordFillSchema = z.object({
  orderId: z.string().min(1),
  symbol: z.string().min(1),
  side: z.enum(['BUY', 'SELL']),
  quantity: z.number().positive(),
  fillPrice: z.number().positive(),
  filledAt: z.string().min(1),
});

export type RecordFillPayload = z.infer<typeof RecordFillSchema>;

export const RecordFill = defineCommand<RecordFillPayload, AccountState>({
  type: 'RecordFill',
  schema: RecordFillSchema,
  apply: (state, payload) => {
    const existing = state.positions[payload.symbol] ?? {
      symbol: payload.symbol,
      quantity: 0,
      averageCostBasis: 0,
      totalCostBasis: 0,
      lastFillPrice: 0,
    };

    if (payload.side === 'BUY') {
      const newQty = existing.quantity + payload.quantity;
      const newCost = existing.totalCostBasis + payload.quantity * payload.fillPrice;
      return {
        ...state,
        positions: {
          ...state.positions,
          [payload.symbol]: {
            ...existing,
            quantity: newQty,
            totalCostBasis: newCost,
            averageCostBasis: newCost / newQty,
            lastFillPrice: payload.fillPrice,
          },
        },
        cashBalanceCents:
          state.cashBalanceCents - Math.round(payload.quantity * payload.fillPrice * 100),
      };
    } else {
      if (payload.quantity > existing.quantity) {
        throw new Error(
          `Cannot sell ${payload.quantity} of ${payload.symbol}: only ${existing.quantity} held`,
        );
      }
      const newQty = existing.quantity - payload.quantity;
      return {
        ...state,
        positions: {
          ...state.positions,
          [payload.symbol]: {
            ...existing,
            quantity: newQty,
            totalCostBasis: newQty > 0 ? existing.averageCostBasis * newQty : 0,
            averageCostBasis: newQty > 0 ? existing.averageCostBasis : 0,
            lastFillPrice: payload.fillPrice,
          },
        },
        cashBalanceCents:
          state.cashBalanceCents + Math.round(payload.quantity * payload.fillPrice * 100),
      };
    }
  },
});
```

**record-deposit.ts:**
```ts
import { z } from 'zod';
import { defineCommand } from '@nestfolio/command-core';
import { type AccountState } from './account-state';

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

**record-withdrawal.ts:**
```ts
import { z } from 'zod';
import { defineCommand } from '@nestfolio/command-core';
import { type AccountState } from './account-state';

export const RecordWithdrawalSchema = z.object({
  withdrawalId: z.string().min(1),
  amountCents: z.number().int().positive(),
  withdrawnAt: z.string().min(1),
});

export type RecordWithdrawalPayload = z.infer<typeof RecordWithdrawalSchema>;

export const RecordWithdrawal = defineCommand<RecordWithdrawalPayload, AccountState>({
  type: 'RecordWithdrawal',
  schema: RecordWithdrawalSchema,
  apply: (state, payload) => {
    if (payload.amountCents > state.cashBalanceCents) {
      throw new Error(
        `Insufficient cash: requested ${payload.amountCents} cents but only ${state.cashBalanceCents} available`,
      );
    }
    return {
      ...state,
      cashBalanceCents: state.cashBalanceCents - payload.amountCents,
    };
  },
});
```

**record-corporate-action.ts:**
```ts
import { z } from 'zod';
import { defineCommand } from '@nestfolio/command-core';
import { type AccountState } from './account-state';

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

**submit-order.ts:**
```ts
import { z } from 'zod';
import { defineCommand } from '@nestfolio/command-core';
import { type AccountState } from './account-state';

export const SubmitOrderSchema = z.object({
  orderId: z.string().min(1),
  symbol: z.string().min(1),
  side: z.enum(['BUY', 'SELL']),
  quantity: z.number().positive(),
  limitPrice: z.number().positive().optional(),
  submittedAt: z.string().min(1),
});

export type SubmitOrderPayload = z.infer<typeof SubmitOrderSchema>;

export const SubmitOrder = defineCommand<SubmitOrderPayload, AccountState>({
  type: 'SubmitOrder',
  schema: SubmitOrderSchema,
  apply: (state, _payload) => {
    return state;
  },
});
```

**cancel-order.ts:**
```ts
import { z } from 'zod';
import { defineCommand } from '@nestfolio/command-core';
import { type AccountState } from './account-state';

export const CancelOrderSchema = z.object({
  orderId: z.string().min(1),
  symbol: z.string().min(1),
  reason: z.string().optional(),
  cancelledAt: z.string().min(1),
});

export type CancelOrderPayload = z.infer<typeof CancelOrderSchema>;

export const CancelOrder = defineCommand<CancelOrderPayload, AccountState>({
  type: 'CancelOrder',
  schema: CancelOrderSchema,
  apply: (state, _payload) => {
    return state;
  },
});
```

- [ ] **Step 3: Create account.reducer.ts**

This is the key piece — the single source of truth for the event→command mapping, replacing the identical copies in ledger-bff and ledger-ctrl.

```ts
import {
  type EventReducer,
  applyCommand,
} from '@nestfolio/command-core';
import { type AccountState } from './account-state';
import { RecordDeposit } from './record-deposit';
import { RecordWithdrawal } from './record-withdrawal';
import { RecordFill } from './record-fill';
import { RecordCorporateAction } from './record-corporate-action';

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
        fillPrice: p['fillPrice'] as number,
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

- [ ] **Step 4: Create barrel index.ts**

```ts
// Account state
export {
  type PositionState,
  type AccountState,
  INITIAL_ACCOUNT_STATE,
} from './account-state';

// Ledger domain commands
export {
  RecordFill,
  RecordFillSchema,
  type RecordFillPayload,
} from './record-fill';

export {
  RecordDeposit,
  RecordDepositSchema,
  type RecordDepositPayload,
} from './record-deposit';

export {
  RecordWithdrawal,
  RecordWithdrawalSchema,
  type RecordWithdrawalPayload,
} from './record-withdrawal';

export {
  RecordCorporateAction,
  RecordCorporateActionSchema,
  type RecordCorporateActionPayload,
} from './record-corporate-action';

// Order lifecycle commands
export {
  SubmitOrder,
  SubmitOrderSchema,
  type SubmitOrderPayload,
} from './submit-order';

export {
  CancelOrder,
  CancelOrderSchema,
  type CancelOrderPayload,
} from './cancel-order';

// Reducer
export { accountReducer } from './account.reducer';
```

- [ ] **Step 5: Commit**

```bash
git add libs/ledger-core/src/
git commit -m "feat: add ledger-core source files with domain commands and reducer"
```

---

## Chunk 2: Move tests to ledger-core (Task 3)

### Task 3: Create ledger-core test files

**Files:**
- Create: `libs/ledger-core/test/account-state.test.ts`
- Create: `libs/ledger-core/test/record-fill.test.ts`
- Create: `libs/ledger-core/test/record-deposit.test.ts`
- Create: `libs/ledger-core/test/record-withdrawal.test.ts`
- Create: `libs/ledger-core/test/record-corporate-action.test.ts`
- Create: `libs/ledger-core/test/submit-order.test.ts`
- Create: `libs/ledger-core/test/cancel-order.test.ts`
- Create: `libs/ledger-core/test/account.reducer.test.ts`

- [ ] **Step 1: Create command test files**

For each of the 7 test files from command-core, copy and update imports:
- `../../../src/command` → `@nestfolio/command-core`
- `../../../src/state/account-state` → `../../src/account-state`
- `../../../src/commands/ledger/<name>` → `../../src/<name>`
- `../../../src/commands/order/<name>` → `../../src/<name>`
- `../../src/state/account-state` → `../../src/account-state`

**test/account-state.test.ts:**
```ts
import { INITIAL_ACCOUNT_STATE } from '../../src/account-state';

describe('INITIAL_ACCOUNT_STATE', () => {
  it('should have $100k starting balance in cents', () => {
    expect(INITIAL_ACCOUNT_STATE.cashBalanceCents).toBe(10_000_000);
  });

  it('should have empty positions', () => {
    expect(INITIAL_ACCOUNT_STATE.positions).toEqual({});
  });

  it('should start at sequence 0', () => {
    expect(INITIAL_ACCOUNT_STATE.lastEventSequence).toBe(0);
  });
});
```

**test/record-fill.test.ts:**
```ts
import { applyCommand } from '@nestfolio/command-core';
import { INITIAL_ACCOUNT_STATE, type AccountState } from '../../src/account-state';
import { RecordFill } from '../../src/record-fill';

const validBuy = {
  orderId: 'ord-1',
  symbol: 'VTI',
  side: 'BUY' as const,
  quantity: 10,
  fillPrice: 250.5,
  filledAt: '2026-01-15T10:00:00.000Z',
};

const validSell = {
  orderId: 'ord-2',
  symbol: 'VTI',
  side: 'SELL' as const,
  quantity: 5,
  fillPrice: 260.0,
  filledAt: '2026-01-16T10:00:00.000Z',
};

describe('RecordFill', () => {
  it('should have type RecordFill', () => {
    expect(RecordFill.type).toBe('RecordFill');
  });

  describe('BUY', () => {
    it('should add a new position on first buy', () => {
      const result = applyCommand(RecordFill, validBuy, INITIAL_ACCOUNT_STATE);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const pos = result.value.nextState.positions['VTI'];
      expect(pos.quantity).toBe(10);
      expect(pos.averageCostBasis).toBe(250.5);
      expect(pos.totalCostBasis).toBe(2505);
      expect(pos.lastFillPrice).toBe(250.5);
    });

    it('should compute weighted average cost on second buy', () => {
      const firstResult = applyCommand(RecordFill, validBuy, INITIAL_ACCOUNT_STATE);
      expect(firstResult.ok).toBe(true);
      if (!firstResult.ok) return;

      const secondBuy = { ...validBuy, orderId: 'ord-2', quantity: 10, fillPrice: 260.5 };
      const result = applyCommand(RecordFill, secondBuy, firstResult.value.nextState);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const pos = result.value.nextState.positions['VTI'];
      expect(pos.quantity).toBe(20);
      expect(pos.totalCostBasis).toBe(2505 + 2605);
      expect(pos.averageCostBasis).toBeCloseTo(255.5);
    });

    it('should decrease cash balance on buy', () => {
      const result = applyCommand(RecordFill, validBuy, INITIAL_ACCOUNT_STATE);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.nextState.cashBalanceCents).toBe(10_000_000 - 250_500);
    });
  });

  describe('SELL', () => {
    const stateWithPosition: AccountState = {
      ...INITIAL_ACCOUNT_STATE,
      positions: {
        VTI: {
          symbol: 'VTI',
          quantity: 10,
          averageCostBasis: 250.5,
          totalCostBasis: 2505,
          lastFillPrice: 250.5,
        },
      },
    };

    it('should reduce position on sell', () => {
      const result = applyCommand(RecordFill, validSell, stateWithPosition);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const pos = result.value.nextState.positions['VTI'];
      expect(pos.quantity).toBe(5);
      expect(pos.lastFillPrice).toBe(260.0);
    });

    it('should preserve average cost basis on partial sell', () => {
      const result = applyCommand(RecordFill, validSell, stateWithPosition);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const pos = result.value.nextState.positions['VTI'];
      expect(pos.averageCostBasis).toBe(250.5);
      expect(pos.totalCostBasis).toBeCloseTo(250.5 * 5);
    });

    it('should zero out cost basis on full sell', () => {
      const fullSell = { ...validSell, quantity: 10 };
      const result = applyCommand(RecordFill, fullSell, stateWithPosition);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const pos = result.value.nextState.positions['VTI'];
      expect(pos.quantity).toBe(0);
      expect(pos.totalCostBasis).toBe(0);
      expect(pos.averageCostBasis).toBe(0);
    });

    it('should increase cash balance on sell', () => {
      const result = applyCommand(RecordFill, validSell, stateWithPosition);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.nextState.cashBalanceCents).toBe(10_000_000 + 130_000);
    });

    it('should return invariant error when selling more than held', () => {
      const oversell = { ...validSell, quantity: 15 };
      const result = applyCommand(RecordFill, oversell, stateWithPosition);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('invariant');
        expect(result.error.message).toContain('Cannot sell');
      }
    });
  });

  describe('validation', () => {
    it('should reject zero quantity', () => {
      const result = applyCommand(
        RecordFill,
        { ...validBuy, quantity: 0 },
        INITIAL_ACCOUNT_STATE,
      );
      expect(result.ok).toBe(false);
    });

    it('should reject negative fill price', () => {
      const result = applyCommand(
        RecordFill,
        { ...validBuy, fillPrice: -10 },
        INITIAL_ACCOUNT_STATE,
      );
      expect(result.ok).toBe(false);
    });

    it('should reject missing symbol', () => {
      const result = applyCommand(
        RecordFill,
        { ...validBuy, symbol: '' },
        INITIAL_ACCOUNT_STATE,
      );
      expect(result.ok).toBe(false);
    });
  });
});
```

**test/record-deposit.test.ts:**
```ts
import { applyCommand } from '@nestfolio/command-core';
import { INITIAL_ACCOUNT_STATE } from '../../src/account-state';
import { RecordDeposit } from '../../src/record-deposit';

const validDeposit = {
  depositId: 'dep-1',
  amountCents: 500_000,
  depositedAt: '2026-01-15T10:00:00.000Z',
};

describe('RecordDeposit', () => {
  it('should have type RecordDeposit', () => {
    expect(RecordDeposit.type).toBe('RecordDeposit');
  });

  it('should increase cash balance', () => {
    const result = applyCommand(RecordDeposit, validDeposit, INITIAL_ACCOUNT_STATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nextState.cashBalanceCents).toBe(10_000_000 + 500_000);
  });

  it('should not affect positions', () => {
    const result = applyCommand(RecordDeposit, validDeposit, INITIAL_ACCOUNT_STATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nextState.positions).toEqual({});
  });

  it('should reject non-integer amount', () => {
    const result = applyCommand(
      RecordDeposit,
      { ...validDeposit, amountCents: 100.5 },
      INITIAL_ACCOUNT_STATE,
    );
    expect(result.ok).toBe(false);
  });

  it('should reject zero amount', () => {
    const result = applyCommand(
      RecordDeposit,
      { ...validDeposit, amountCents: 0 },
      INITIAL_ACCOUNT_STATE,
    );
    expect(result.ok).toBe(false);
  });
});
```

**test/record-withdrawal.test.ts:**
```ts
import { applyCommand } from '@nestfolio/command-core';
import { INITIAL_ACCOUNT_STATE } from '../../src/account-state';
import { RecordWithdrawal } from '../../src/record-withdrawal';

const validWithdrawal = {
  withdrawalId: 'wth-1',
  amountCents: 200_000,
  withdrawnAt: '2026-01-15T10:00:00.000Z',
};

describe('RecordWithdrawal', () => {
  it('should have type RecordWithdrawal', () => {
    expect(RecordWithdrawal.type).toBe('RecordWithdrawal');
  });

  it('should decrease cash balance', () => {
    const result = applyCommand(RecordWithdrawal, validWithdrawal, INITIAL_ACCOUNT_STATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nextState.cashBalanceCents).toBe(10_000_000 - 200_000);
  });

  it('should not affect positions', () => {
    const result = applyCommand(RecordWithdrawal, validWithdrawal, INITIAL_ACCOUNT_STATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nextState.positions).toEqual({});
  });

  it('should return invariant error when withdrawing more than cash balance', () => {
    const overWithdraw = { ...validWithdrawal, amountCents: 20_000_000 };
    const result = applyCommand(RecordWithdrawal, overWithdraw, INITIAL_ACCOUNT_STATE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('invariant');
      expect(result.error.message).toContain('Insufficient cash');
    }
  });

  it('should reject non-integer amount', () => {
    const result = applyCommand(
      RecordWithdrawal,
      { ...validWithdrawal, amountCents: 100.5 },
      INITIAL_ACCOUNT_STATE,
    );
    expect(result.ok).toBe(false);
  });

  it('should reject negative amount', () => {
    const result = applyCommand(
      RecordWithdrawal,
      { ...validWithdrawal, amountCents: -100 },
      INITIAL_ACCOUNT_STATE,
    );
    expect(result.ok).toBe(false);
  });
});
```

**test/record-corporate-action.test.ts:**
```ts
import { applyCommand } from '@nestfolio/command-core';
import { RecordCorporateAction } from '../../src/record-corporate-action';
import { type AccountState, INITIAL_ACCOUNT_STATE } from '../../src/account-state';

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

**test/submit-order.test.ts:**
```ts
import { applyCommand } from '@nestfolio/command-core';
import { INITIAL_ACCOUNT_STATE } from '../../src/account-state';
import { SubmitOrder } from '../../src/submit-order';

const validSubmission = {
  orderId: 'ord-1',
  symbol: 'VTI',
  side: 'BUY' as const,
  quantity: 10,
  submittedAt: '2026-01-15T10:00:00.000Z',
};

describe('SubmitOrder', () => {
  it('should have type SubmitOrder', () => {
    expect(SubmitOrder.type).toBe('SubmitOrder');
  });

  it('should not change portfolio state (lifecycle marker)', () => {
    const result = applyCommand(SubmitOrder, validSubmission, INITIAL_ACCOUNT_STATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nextState).toEqual(INITIAL_ACCOUNT_STATE);
  });

  it('should accept optional limitPrice', () => {
    const result = applyCommand(
      SubmitOrder,
      { ...validSubmission, limitPrice: 250.0 },
      INITIAL_ACCOUNT_STATE,
    );
    expect(result.ok).toBe(true);
  });

  it('should reject missing orderId', () => {
    const result = applyCommand(
      SubmitOrder,
      { ...validSubmission, orderId: '' },
      INITIAL_ACCOUNT_STATE,
    );
    expect(result.ok).toBe(false);
  });
});
```

**test/cancel-order.test.ts:**
```ts
import { applyCommand } from '@nestfolio/command-core';
import { INITIAL_ACCOUNT_STATE } from '../../src/account-state';
import { CancelOrder } from '../../src/cancel-order';

const validCancel = {
  orderId: 'ord-1',
  symbol: 'VTI',
  cancelledAt: '2026-01-15T10:00:00.000Z',
};

describe('CancelOrder', () => {
  it('should have type CancelOrder', () => {
    expect(CancelOrder.type).toBe('CancelOrder');
  });

  it('should not change portfolio state (no fill occurred)', () => {
    const result = applyCommand(CancelOrder, validCancel, INITIAL_ACCOUNT_STATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nextState).toEqual(INITIAL_ACCOUNT_STATE);
  });

  it('should accept optional reason', () => {
    const result = applyCommand(
      CancelOrder,
      { ...validCancel, reason: 'Market closed' },
      INITIAL_ACCOUNT_STATE,
    );
    expect(result.ok).toBe(true);
  });

  it('should reject missing orderId', () => {
    const result = applyCommand(
      CancelOrder,
      { ...validCancel, orderId: '' },
      INITIAL_ACCOUNT_STATE,
    );
    expect(result.ok).toBe(false);
  });
});
```

**test/account.reducer.test.ts** (moved from `services/ledger/ledger-ctrl/test/reducers/`):
```ts
import { INITIAL_ACCOUNT_STATE } from '../../src/account-state';
import { accountReducer } from '../../src/account.reducer';

describe('accountReducer', () => {
  it('applies DEPOSIT_DETECTED', () => {
    const next = accountReducer(INITIAL_ACCOUNT_STATE, {
      eventId: 'e1', eventType: 'DEPOSIT_DETECTED', sequenceNo: 1,
      timestamp: '2026-03-12T00:00:00Z',
      payload: { depositId: 'd1', amountCents: 500_00, depositedAt: '2026-03-12T00:00:00Z' },
    });
    expect(next.cashBalanceCents).toBe(INITIAL_ACCOUNT_STATE.cashBalanceCents + 500_00);
  });

  it('applies WITHDRAWAL_COMPLETED', () => {
    const next = accountReducer(INITIAL_ACCOUNT_STATE, {
      eventId: 'e2', eventType: 'WITHDRAWAL_COMPLETED', sequenceNo: 1,
      timestamp: '2026-03-12T00:00:00Z',
      payload: { withdrawalId: 'w1', amountCents: 200_00, completedAt: '2026-03-12T00:00:00Z' },
    });
    expect(next.cashBalanceCents).toBe(INITIAL_ACCOUNT_STATE.cashBalanceCents - 200_00);
  });

  it('applies ORDER_FILLED (BUY)', () => {
    const next = accountReducer(INITIAL_ACCOUNT_STATE, {
      eventId: 'e3', eventType: 'ORDER_FILLED', sequenceNo: 1,
      timestamp: '2026-03-12T00:00:00Z',
      payload: { orderId: 'o1', symbol: 'AAPL', side: 'BUY', quantity: 10, fillPrice: 150_00, filledAt: '2026-03-12T00:00:00Z' },
    });
    expect(next.positions['AAPL']).toBeDefined();
    expect(next.positions['AAPL'].quantity).toBe(10);
    expect(next.cashBalanceCents).toBe(INITIAL_ACCOUNT_STATE.cashBalanceCents - 10 * 150_00 * 100);
  });

  it('applies ORDER_FILLED (SELL)', () => {
    const stateWithPosition = {
      ...INITIAL_ACCOUNT_STATE,
      positions: { AAPL: { symbol: 'AAPL', quantity: 10, averageCostBasis: 150_00, totalCostBasis: 1_500_00, lastFillPrice: 150_00 } },
    };
    const next = accountReducer(stateWithPosition, {
      eventId: 'e4', eventType: 'ORDER_FILLED', sequenceNo: 1,
      timestamp: '2026-03-12T00:00:00Z',
      payload: { orderId: 'o2', symbol: 'AAPL', side: 'SELL', quantity: 5, fillPrice: 160_00, filledAt: '2026-03-12T00:00:00Z' },
    });
    expect(next.positions['AAPL'].quantity).toBe(5);
    expect(next.cashBalanceCents).toBe(stateWithPosition.cashBalanceCents + 5 * 160_00 * 100);
  });

  it('applies CORPORATE_ACTION_PROCESSED (stock split)', () => {
    const stateWithPosition = {
      ...INITIAL_ACCOUNT_STATE,
      positions: { AAPL: { symbol: 'AAPL', quantity: 100, averageCostBasis: 150, totalCostBasis: 15000, lastFillPrice: 150 } },
    };
    const next = accountReducer(stateWithPosition, {
      eventId: 'e5', eventType: 'CORPORATE_ACTION_PROCESSED', sequenceNo: 1,
      timestamp: '2026-03-12T00:00:00Z',
      payload: { actionId: 'ca1', symbol: 'AAPL', actionType: 'STOCK_SPLIT', quantityMultiplier: 2, costBasisDivisor: 2, appliedAt: '2026-03-12T00:00:00Z' },
    });
    expect(next.positions['AAPL'].quantity).toBe(200);
    expect(next.positions['AAPL'].averageCostBasis).toBe(75);
  });

  it('passes through ORDER_REJECTED unchanged', () => {
    const next = accountReducer(INITIAL_ACCOUNT_STATE, {
      eventId: 'e6', eventType: 'ORDER_REJECTED', sequenceNo: 1,
      timestamp: '2026-03-12T00:00:00Z',
      payload: { orderId: 'o3', reason: 'insufficient funds' },
    });
    expect(next).toEqual(INITIAL_ACCOUNT_STATE);
  });

  it('passes through ORDER_CANCELLED unchanged', () => {
    const next = accountReducer(INITIAL_ACCOUNT_STATE, {
      eventId: 'e7', eventType: 'ORDER_CANCELLED', sequenceNo: 1,
      timestamp: '2026-03-12T00:00:00Z',
      payload: { orderId: 'o4', symbol: 'AAPL', reason: 'user request', cancelledAt: '2026-03-12T00:00:00Z' },
    });
    expect(next).toEqual(INITIAL_ACCOUNT_STATE);
  });
});
```

- [ ] **Step 2: Run ledger-core tests**

Run: `pnpm nx test ledger-core`
Expected: All 37 tests pass (3 account-state + 15 record-fill + 5 record-deposit + 5 record-withdrawal + 3 record-corporate-action + 4 submit-order + 4 cancel-order + 7 account.reducer = ~46 tests)

- [ ] **Step 3: Commit**

```bash
git add libs/ledger-core/test/
git commit -m "test: add ledger-core tests for commands, state, and reducer"
```

---

## Chunk 3: Update consumers (Tasks 4–6)

### Task 4: Update ledger-bff imports

**Files:**
- Delete: `services/ledger/ledger-bff/src/reducers/account.reducer.ts`
- Modify: `services/ledger/ledger-bff/src/handlers/graphql-resolver.ts`
- Modify: `services/ledger/ledger-bff/src/services/time-travel.service.ts`
- Modify: `services/ledger/ledger-bff/test/handlers/graphql-resolver.test.ts`
- Modify: `services/ledger/ledger-bff/jest.config.js`

- [ ] **Step 1: Delete duplicated reducer**

```bash
rm services/ledger/ledger-bff/src/reducers/account.reducer.ts
rmdir services/ledger/ledger-bff/src/reducers
```

- [ ] **Step 2: Update jest.config.js moduleNameMapper**

In `services/ledger/ledger-bff/jest.config.js`, remove the `command-core/*` wildcard and add ledger-core:

```js
// Remove:
'^@nestfolio/command-core/(.*)$': '<rootDir>/../../../libs/command-core/src/$1',
// Add:
'^@nestfolio/ledger-core$': '<rootDir>/../../../libs/ledger-core/src/index.ts',
'^@nestfolio/ledger-core/(.*)$': '<rootDir>/../../../libs/ledger-core/src/$1',
```

- [ ] **Step 3: Update graphql-resolver.ts import**

Change line 14:
```ts
// Before:
import { INITIAL_ACCOUNT_STATE } from '@nestfolio/command-core';
// After:
import { INITIAL_ACCOUNT_STATE } from '@nestfolio/ledger-core';
```

- [ ] **Step 4: Update time-travel.service.ts imports**

```ts
// Before:
import { type AccountState, INITIAL_ACCOUNT_STATE, replayEvents, type LedgerEntry } from '@nestfolio/command-core';
import { accountReducer } from '../reducers/account.reducer';

// After:
import { replayEvents, type LedgerEntry } from '@nestfolio/command-core';
import { type AccountState, INITIAL_ACCOUNT_STATE, accountReducer } from '@nestfolio/ledger-core';
```

- [ ] **Step 5: Update graphql-resolver.test.ts mock**

The test mocks `@nestfolio/command-core` for `INITIAL_ACCOUNT_STATE` and `replayEvents`. After the split, `INITIAL_ACCOUNT_STATE` comes from `@nestfolio/ledger-core` and `replayEvents` stays in `@nestfolio/command-core`. Split the mock:

```ts
// Before (lines 77-84):
jest.mock('@nestfolio/command-core', () => ({
  INITIAL_ACCOUNT_STATE: {
    positions: {},
    cashBalanceCents: 10_000_000,
    lastEventSequence: 0,
  },
  replayEvents: jest.fn((_init, _entries, _reducer) => _init),
}));

// After:
jest.mock('@nestfolio/command-core', () => ({
  replayEvents: jest.fn((_init, _entries, _reducer) => _init),
}));

jest.mock('@nestfolio/ledger-core', () => ({
  INITIAL_ACCOUNT_STATE: {
    positions: {},
    cashBalanceCents: 10_000_000,
    lastEventSequence: 0,
  },
  accountReducer: jest.fn((state) => state),
}));
```

- [ ] **Step 6: Run ledger-bff tests**

Run: `pnpm nx test ledger-bff`
Expected: All existing tests pass

- [ ] **Step 7: Commit**

```bash
git add services/ledger/ledger-bff/
git commit -m "refactor(ledger-bff): import domain code from ledger-core, delete duplicated reducer"
```

### Task 5: Update ledger-ctrl imports

**Files:**
- Delete: `services/ledger/ledger-ctrl/src/reducers/account.reducer.ts`
- Delete: `services/ledger/ledger-ctrl/test/reducers/account.reducer.test.ts`
- Modify: `services/ledger/ledger-ctrl/src/handlers/reducer.ts`
- Modify: `services/ledger/ledger-ctrl/test/handlers/event-listener.test.ts`
- Modify: `services/ledger/ledger-ctrl/jest.config.js`

- [ ] **Step 1: Delete duplicated reducer and its test**

```bash
rm services/ledger/ledger-ctrl/src/reducers/account.reducer.ts
rmdir services/ledger/ledger-ctrl/src/reducers
rm services/ledger/ledger-ctrl/test/reducers/account.reducer.test.ts
rmdir services/ledger/ledger-ctrl/test/reducers
```

- [ ] **Step 2: Update jest.config.js moduleNameMapper**

In `services/ledger/ledger-ctrl/jest.config.js`, remove the `command-core/*` wildcard and add ledger-core:

```js
// Remove:
'^@nestfolio/command-core/(.*)$': '<rootDir>/../../../libs/command-core/src/$1',
// Add:
'^@nestfolio/ledger-core$': '<rootDir>/../../../libs/ledger-core/src/index.ts',
'^@nestfolio/ledger-core/(.*)$': '<rootDir>/../../../libs/ledger-core/src/$1',
```

- [ ] **Step 3: Update reducer.ts imports**

```ts
// Before:
import {
  replayEvents,
  INITIAL_ACCOUNT_STATE,
  type LedgerEntry,
  type AccountState,
} from '@nestfolio/command-core';
import { accountReducer } from '../reducers/account.reducer';

// After:
import { replayEvents, type LedgerEntry } from '@nestfolio/command-core';
import { INITIAL_ACCOUNT_STATE, type AccountState, accountReducer } from '@nestfolio/ledger-core';
```

- [ ] **Step 4: Update event-listener.test.ts mock**

The test mocks `@nestfolio/command-core` as an empty object (line 83). After the split, `reducer.ts` imports `accountReducer` from `@nestfolio/ledger-core` instead of `../reducers/account.reducer`. Add a mock for ledger-core:

```ts
// Before (line 83):
jest.mock('@nestfolio/command-core', () => ({}));

// After:
jest.mock('@nestfolio/command-core', () => ({}));
jest.mock('@nestfolio/ledger-core', () => ({
  INITIAL_ACCOUNT_STATE: {
    positions: {},
    cashBalanceCents: 10_000_000,
    lastEventSequence: 0,
  },
  accountReducer: jest.fn((state) => state),
}));
```

- [ ] **Step 5: Run ledger-ctrl tests**

Run: `pnpm nx test ledger-ctrl`
Expected: All existing tests pass (minus the moved reducer test)

- [ ] **Step 6: Commit**

```bash
git add services/ledger/ledger-ctrl/
git commit -m "refactor(ledger-ctrl): import domain code from ledger-core, delete duplicated reducer"
```

### Task 6: Update dashboard-bff import

**Files:**
- Modify: `services/investor/dashboard-bff/src/pipes/simulation-summary.pipe.ts`
- Modify: `services/investor/dashboard-bff/jest.config.js`

- [ ] **Step 1: Update jest.config.js moduleNameMapper**

In `services/investor/dashboard-bff/jest.config.js`, replace the command-core entry:

```js
// Before:
'^@nestfolio/command-core$': '<rootDir>/../../../libs/command-core/src/index.ts',
// After:
'^@nestfolio/ledger-core$': '<rootDir>/../../../libs/ledger-core/src/index.ts',
```

- [ ] **Step 2: Update simulation-summary.pipe.ts import**

```ts
// Before:
import { INITIAL_ACCOUNT_STATE } from '@nestfolio/command-core';
// After:
import { INITIAL_ACCOUNT_STATE } from '@nestfolio/ledger-core';
```

- [ ] **Step 3: Run dashboard-bff tests**

Run: `pnpm nx test dashboard-bff`
Expected: All existing tests pass

- [ ] **Step 4: Commit**

```bash
git add services/investor/dashboard-bff/
git commit -m "refactor(dashboard-bff): import INITIAL_ACCOUNT_STATE from ledger-core"
```

---

## Chunk 4: Slim down command-core (Task 7)

### Task 7: Remove domain code from command-core

**Files:**
- Modify: `libs/command-core/src/index.ts`
- Modify: `tsconfig.base.json` (remove `@nestfolio/command-core/*` wildcard alias)
- Delete: `libs/command-core/src/state/account-state.ts`
- Delete: `libs/command-core/src/commands/ledger/record-fill.ts`
- Delete: `libs/command-core/src/commands/ledger/record-deposit.ts`
- Delete: `libs/command-core/src/commands/ledger/record-withdrawal.ts`
- Delete: `libs/command-core/src/commands/ledger/record-corporate-action.ts`
- Delete: `libs/command-core/src/commands/order/submit-order.ts`
- Delete: `libs/command-core/src/commands/order/cancel-order.ts`
- Delete: `libs/command-core/test/state/account-state.test.ts`
- Delete: `libs/command-core/test/commands/ledger/*.test.ts` (4 files)
- Delete: `libs/command-core/test/commands/order/*.test.ts` (2 files)

- [ ] **Step 1: Update command-core barrel**

Replace `libs/command-core/src/index.ts` with generic-only exports:

```ts
// Command infrastructure
export {
  type CommandDef,
  type CommandError,
  type Patches,
  defineCommand,
  applyCommand,
} from './command';

// Reducer / Event replay
export { type LedgerEntry, type EventReducer, replayEvents } from './reducer';
```

- [ ] **Step 2: Delete domain source files**

```bash
rm libs/command-core/src/state/account-state.ts
rmdir libs/command-core/src/state
rm libs/command-core/src/commands/ledger/record-fill.ts
rm libs/command-core/src/commands/ledger/record-deposit.ts
rm libs/command-core/src/commands/ledger/record-withdrawal.ts
rm libs/command-core/src/commands/ledger/record-corporate-action.ts
rmdir libs/command-core/src/commands/ledger
rm libs/command-core/src/commands/order/submit-order.ts
rm libs/command-core/src/commands/order/cancel-order.ts
rmdir libs/command-core/src/commands/order
rmdir libs/command-core/src/commands
```

- [ ] **Step 3: Delete domain test files**

```bash
rm libs/command-core/test/state/account-state.test.ts
rmdir libs/command-core/test/state
rm libs/command-core/test/commands/ledger/record-fill.test.ts
rm libs/command-core/test/commands/ledger/record-deposit.test.ts
rm libs/command-core/test/commands/ledger/record-withdrawal.test.ts
rm libs/command-core/test/commands/ledger/record-corporate-action.test.ts
rmdir libs/command-core/test/commands/ledger
rm libs/command-core/test/commands/order/submit-order.test.ts
rm libs/command-core/test/commands/order/cancel-order.test.ts
rmdir libs/command-core/test/commands/order
rmdir libs/command-core/test/commands
```

- [ ] **Step 4: Remove `@nestfolio/command-core/*` wildcard alias from tsconfig.base.json**

After the split, command-core only has `command.ts` and `reducer.ts` — sub-path imports would resolve to deleted files. Remove the wildcard alias:

```json
// Remove this line:
"@nestfolio/command-core/*": ["libs/command-core/src/*"],
```

- [ ] **Step 5: Run command-core tests**

Run: `pnpm nx test command-core`
Expected: 15 tests pass (8 applyCommand + 6 replayEvents + 1 defineCommand — only `test/command.test.ts` and `test/reducer.test.ts` remain)

- [ ] **Step 6: Commit**

```bash
git add -A libs/command-core/ tsconfig.base.json
git commit -m "refactor: remove ledger domain code from command-core, keep generic infra only"
```

---

## Chunk 5: Verify all (Task 8)

### Task 8: Run full test suite for affected projects

- [ ] **Step 1: Run all affected tests**

Run: `pnpm nx run-many -t test -p command-core ledger-core ledger-bff ledger-ctrl dashboard-bff`
Expected: All projects pass, no regressions

- [ ] **Step 2: Run lint on affected projects**

Run: `pnpm nx run-many -t lint -p command-core ledger-core ledger-bff ledger-ctrl dashboard-bff`
Expected: No lint errors

- [ ] **Step 3: Run build on affected projects**

Run: `pnpm nx run-many -t build -p command-core ledger-core`
Expected: Both libs build successfully

- [ ] **Step 4: Final commit (if any lint fixes needed)**

```bash
git add -A
git commit -m "chore: lint fixes after command-core/ledger-core split"
```
