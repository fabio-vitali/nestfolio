# Operating Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire operating mode (CONSERVATIVE/BALANCED/AGGRESSIVE) into actual system behavior so that mode-specific guardrail thresholds drive L1/L2 authority resolution.

**Architecture:** A pure lookup table in investor-bff maps each operating mode to its guardrail parameters. The mandate record (created at onboarding, updated on mode change) carries these resolved parameters. compliance-ctrl reads them from its materialized MandateSnapshot and uses them in the authority resolver instead of a static $50k threshold.

**Tech Stack:** TypeScript, DynamoDB, event-processor, Jest, E2E feature tests

**Spec:** `docs/superpowers/specs/2026-04-14-operating-mode-implementation-design.md`

---

### Task 1: Add guardrail lookup table and types to investor-bff

**Files:**
- Create: `services/investor/investor-bff/src/domain/guardrail-params.ts`
- Modify: `services/investor/investor-bff/src/domain/models.ts`

- [ ] **Step 1: Write failing test for the lookup table**

Create `services/investor/investor-bff/test/unit/domain/guardrail-params.test.ts`:

```typescript
import { resolveGuardrailParams } from '../../../src/domain/guardrail-params';

describe('resolveGuardrailParams', () => {
  it('returns conservative parameters', () => {
    const p = resolveGuardrailParams('CONSERVATIVE');
    expect(p.maxSingleTradePercent).toBe(5);
    expect(p.monthlyTurnoverCapPercent).toBe(10);
    expect(p.coolDownDays).toBe(10);
    expect(p.rebalanceCadence).toBe('QUARTERLY');
    expect(p.equityRiskBandPercent).toBe(3);
    expect(p.driftTriggerPercent).toBe(2);
    expect(p.singleEtfConcentrationPercent).toBe(20);
    expect(p.drawdownCircuitBreakerPercent).toBe(8);
  });

  it('returns balanced parameters', () => {
    const p = resolveGuardrailParams('BALANCED');
    expect(p.maxSingleTradePercent).toBe(10);
    expect(p.monthlyTurnoverCapPercent).toBe(25);
    expect(p.coolDownDays).toBe(5);
    expect(p.rebalanceCadence).toBe('MONTHLY');
    expect(p.equityRiskBandPercent).toBe(6);
    expect(p.driftTriggerPercent).toBe(4);
    expect(p.singleEtfConcentrationPercent).toBe(30);
    expect(p.drawdownCircuitBreakerPercent).toBe(12);
  });

  it('returns aggressive parameters', () => {
    const p = resolveGuardrailParams('AGGRESSIVE');
    expect(p.maxSingleTradePercent).toBe(20);
    expect(p.monthlyTurnoverCapPercent).toBe(50);
    expect(p.coolDownDays).toBe(2);
    expect(p.rebalanceCadence).toBe('BI_WEEKLY');
    expect(p.equityRiskBandPercent).toBe(10);
    expect(p.driftTriggerPercent).toBe(7);
    expect(p.singleEtfConcentrationPercent).toBe(40);
    expect(p.drawdownCircuitBreakerPercent).toBe(18);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test investor-bff -- --testPathPattern guardrail-params`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the lookup table**

Create `services/investor/investor-bff/src/domain/guardrail-params.ts`:

```typescript
import type { OperatingMode, RebalanceCadence } from './models';

export interface GuardrailParams {
  readonly maxSingleTradePercent: number;
  readonly monthlyTurnoverCapPercent: number;
  readonly coolDownDays: number;
  readonly rebalanceCadence: RebalanceCadence | 'BI_WEEKLY';
  readonly equityRiskBandPercent: number;
  readonly driftTriggerPercent: number;
  readonly singleEtfConcentrationPercent: number;
  readonly drawdownCircuitBreakerPercent: number;
}

const GUARDRAIL_TABLE: Record<OperatingMode, GuardrailParams> = {
  CONSERVATIVE: {
    maxSingleTradePercent: 5,
    monthlyTurnoverCapPercent: 10,
    coolDownDays: 10,
    rebalanceCadence: 'QUARTERLY',
    equityRiskBandPercent: 3,
    driftTriggerPercent: 2,
    singleEtfConcentrationPercent: 20,
    drawdownCircuitBreakerPercent: 8,
  },
  BALANCED: {
    maxSingleTradePercent: 10,
    monthlyTurnoverCapPercent: 25,
    coolDownDays: 5,
    rebalanceCadence: 'MONTHLY',
    equityRiskBandPercent: 6,
    driftTriggerPercent: 4,
    singleEtfConcentrationPercent: 30,
    drawdownCircuitBreakerPercent: 12,
  },
  AGGRESSIVE: {
    maxSingleTradePercent: 20,
    monthlyTurnoverCapPercent: 50,
    coolDownDays: 2,
    rebalanceCadence: 'BI_WEEKLY',
    equityRiskBandPercent: 10,
    driftTriggerPercent: 7,
    singleEtfConcentrationPercent: 40,
    drawdownCircuitBreakerPercent: 18,
  },
};

export function resolveGuardrailParams(mode: OperatingMode): GuardrailParams {
  return GUARDRAIL_TABLE[mode];
}
```

- [ ] **Step 4: Add `BI_WEEKLY` to RebalanceCadence type**

In `services/investor/investor-bff/src/domain/models.ts`, change:

```typescript
export type RebalanceCadence = 'WEEKLY' | 'BI_WEEKLY' | 'MONTHLY' | 'QUARTERLY';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm nx test investor-bff -- --testPathPattern guardrail-params`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```
git add services/investor/investor-bff/src/domain/guardrail-params.ts \
       services/investor/investor-bff/src/domain/models.ts \
       services/investor/investor-bff/test/unit/domain/guardrail-params.test.ts
git commit -m "feat(investor-bff): add operating mode guardrail lookup table"
```

---

### Task 2: Wire mandate creation to operating mode at onboarding

**Files:**
- Modify: `services/investor/investor-bff/src/transforms/onboarding-completed.ts`
- Modify: `services/investor/investor-bff/test/unit/transforms/onboarding-completed.test.ts`

- [ ] **Step 1: Write failing test for mode-derived mandate**

Add to `services/investor/investor-bff/test/unit/transforms/onboarding-completed.test.ts`:

```typescript
import { resolveGuardrailParams } from '../../../src/domain/guardrail-params';

describe('resolveGuardrailParams in mandate context', () => {
  it('CONSERVATIVE maps to maxSingleTradePercent=5 and DISCRETIONARY level', () => {
    const params = resolveGuardrailParams('CONSERVATIVE');
    expect(params.maxSingleTradePercent).toBe(5);
    expect(params.monthlyTurnoverCapPercent).toBe(10);
    expect(params.coolDownDays).toBe(10);
    expect(params.rebalanceCadence).toBe('QUARTERLY');
  });

  it('AGGRESSIVE maps to maxSingleTradePercent=20', () => {
    const params = resolveGuardrailParams('AGGRESSIVE');
    expect(params.maxSingleTradePercent).toBe(20);
    expect(params.monthlyTurnoverCapPercent).toBe(50);
    expect(params.coolDownDays).toBe(2);
    expect(params.rebalanceCadence).toBe('BI_WEEKLY');
  });
});
```

- [ ] **Step 2: Run test to verify it passes** (table already exists from Task 1)

Run: `pnpm nx test investor-bff -- --testPathPattern onboarding-completed`
Expected: PASS

- [ ] **Step 3: Update onboarding-completed.ts to use mode-derived params**

In `services/investor/investor-bff/src/transforms/onboarding-completed.ts`:

Add import at top:

```typescript
import { resolveGuardrailParams } from '../domain/guardrail-params';
```

Replace the Mandate Put item (lines 100-115) with:

```typescript
      // 6. Put Mandate — derive parameters from operating mode
      {
        Put: {
          TableName: tableName,
          Item: {
            pk, sk: 'Mandate', __typename: 'Mandate',
            tenantId: s.tenantId, userId: s.userId, region: ctx.region, createdAt: now, mandateId,
            level: 'DISCRETIONARY',
            ...resolveGuardrailParams(s.operatingMode),
            effectiveDate: now, revokedAt: null, version: 1,
          } satisfies TableEntry,
        },
      },
```

This changes two things:
1. `level` from `'ADVISORY'` to `'DISCRETIONARY'`
2. All guardrail parameters from hardcoded values to `resolveGuardrailParams(s.operatingMode)`

- [ ] **Step 4: Run all investor-bff tests**

Run: `pnpm nx test investor-bff`
Expected: PASS

- [ ] **Step 5: Commit**

```
git add services/investor/investor-bff/src/transforms/onboarding-completed.ts \
       services/investor/investor-bff/test/unit/transforms/onboarding-completed.test.ts
git commit -m "feat(investor-bff): derive mandate params from operating mode at onboarding"
```

---

### Task 2b: Handle operating mode change → mandate update

**Files:**
- Modify: `services/investor/investor-bff/src/handlers/event-listener.ts`

When the user changes their operating mode (via Settings → L2 confirmation), the OperatingModeRecord is updated in DDB and CDC emits `OPERATING_MODE_CHANGED`. The investor-bff event-listener currently does not re-derive mandate parameters. We need to add a handler.

- [ ] **Step 1: Check how OPERATING_MODE_CHANGED flows**

The CDC on OperatingModeRecord emits `OPERATING_MODE_CHANGED` on modify. However, investor-bff's own Ingress does NOT subscribe to this event (it subscribes to `ONBOARDING_COMPLETED`, `USER_REGISTERED`, `NOTIFICATION_CREATED`, `BALANCE_UPDATED`, `GO_LIVE_CONFIRMED`). The mode change write happens in a JS resolver mutation (update-mandate or a dedicated operating mode mutation), which writes to DDB directly.

**Option A — JS resolver handles it**: If the operating mode change is a GraphQL mutation that writes both the OperatingModeRecord AND updates the Mandate row in the same transaction, no event handler is needed. The Mandate CDC will emit `MANDATE_UPDATED` automatically.

**Option B — Event handler**: If the mode change is done via a mutation that only writes OperatingModeRecord, we need a handler on `OPERATING_MODE_CHANGED` that updates the Mandate row.

Check the current `update-mandate` or `update-operating-mode` JS resolver. If it writes both rows, skip this task. If not, add a handler:

- [ ] **Step 2: Add operating mode change transform**

Create `services/investor/investor-bff/src/transforms/operating-mode-changed.ts`:

```typescript
import { record, type WriteIntent, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { resolveGuardrailParams } from '../domain/guardrail-params';

export function operatingModeChanged(
  payload: EventPayload,
  ctx: EventContext,
): WriteIntent {
  const s = payload.subject;
  const tenantId = s.tenantId as string;
  const userId = s.userId as string;
  const mode = s.mode as 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
  const params = resolveGuardrailParams(mode);

  return record('Mandate', {
    tenantId,
    userId,
    ...params,
    updatedAt: new Date().toISOString(),
  }, {
    pk: `InvestorProfile#${tenantId}#${userId}`,
    sk: 'Mandate',
    merge: true,
  });
}
```

- [ ] **Step 3: Register handler and add Ingress subscription**

In `event-listener.ts`, register `OPERATING_MODE_CHANGED` handler. In `service.stack.ts`, add `OPERATING_MODE_CHANGED` to the Ingress subscription list if the event comes from the bus (not just from own CDC).

**Note:** This depends on how the mutation is structured. If the JS resolver can atomically write both OperatingModeRecord and Mandate in one TransactWriteItems (like onboarding does), that's simpler and preferred. The CDC on Mandate will emit `MANDATE_UPDATED` automatically. Verify this path first.

- [ ] **Step 4: Commit**

```
git add services/investor/investor-bff/src/transforms/operating-mode-changed.ts \
       services/investor/investor-bff/src/handlers/event-listener.ts
git commit -m "feat(investor-bff): re-derive mandate params on operating mode change"
```

---

### Task 3: Extend MandateSnapshot and authority resolver in compliance-ctrl

**Files:**
- Modify: `services/advisory/compliance-ctrl/src/rules/rule-engine.ts`
- Modify: `services/advisory/compliance-ctrl/src/rules/authority-resolver.ts`
- Modify: `services/advisory/compliance-ctrl/src/rules/guardrail-evaluator.ts`
- Modify: `services/advisory/compliance-ctrl/src/handlers/event-listener.ts`
- Modify: `services/advisory/compliance-ctrl/test/authority-resolver.test.ts`
- Modify: `services/advisory/compliance-ctrl/test/guardrail-evaluator.test.ts`

- [ ] **Step 1: Write failing tests for mode-aware authority resolution**

Replace `services/advisory/compliance-ctrl/test/authority-resolver.test.ts` with:

```typescript
import { AuthorityResolver } from '../src/rules/authority-resolver';
import type { ComplianceInput, Violation } from '../src/rules/rule-engine';

function buildInput(overrides: Partial<ComplianceInput> = {}): ComplianceInput {
  return {
    decisionPacketId: 'dp-1',
    tenantId: 't-1',
    userId: 'u-1',
    mandate: {
      mandateId: 'm-1',
      level: 'DISCRETIONARY',
      monthlyTurnoverCapPercent: 25,
      maxSingleTradePercent: 10,
      equityRiskBandPercent: 6,
      driftTriggerPercent: 4,
      singleEtfConcentrationPercent: 30,
      drawdownCircuitBreakerPercent: 12,
      effectiveDate: '2024-01-01T00:00:00.000Z',
      revokedAt: null,
    },
    proposedTrades: [
      {
        symbol: 'VTI',
        assetClass: 'EQUITY',
        side: 'BUY',
        quantityOrAmountCents: 5_000_00,
        targetWeightPercent: 5,
        rationale: 'Small buy',
      },
    ],
    portfolioValue: 100_000_00,
    riskScore: 5,
    currentPositions: [],
    ...overrides,
  };
}

describe('AuthorityResolver', () => {
  const resolver = new AuthorityResolver();

  it('resolves L1 for DISCRETIONARY + small trade within thresholds', () => {
    expect(resolver.resolve(buildInput(), [])).toBe('L1');
  });

  it('resolves L2 for ADVISORY mandate regardless of trade size', () => {
    const input = buildInput({
      mandate: {
        ...buildInput().mandate,
        level: 'ADVISORY',
      },
    });
    expect(resolver.resolve(input, [])).toBe('L2');
  });

  it('resolves L2 when violations exist', () => {
    const violations: Violation[] = [
      { rule: 'TEST', description: 'test', severity: 'WARNING' },
    ];
    expect(resolver.resolve(buildInput(), violations)).toBe('L2');
  });

  it('resolves L2 when trade exceeds maxSingleTradePercent (Balanced = 10%)', () => {
    const input = buildInput({
      proposedTrades: [{
        symbol: 'VTI', assetClass: 'EQUITY', side: 'BUY',
        quantityOrAmountCents: 11_000_00, // 11% of 100k portfolio
        targetWeightPercent: 11, rationale: 'Large buy',
      }],
    });
    expect(resolver.resolve(input, [])).toBe('L2');
  });

  it('resolves L1 when trade is within maxSingleTradePercent (Balanced = 10%)', () => {
    const input = buildInput({
      proposedTrades: [{
        symbol: 'VTI', assetClass: 'EQUITY', side: 'BUY',
        quantityOrAmountCents: 9_000_00, // 9% of 100k portfolio
        targetWeightPercent: 9, rationale: 'Within limit',
      }],
    });
    expect(resolver.resolve(input, [])).toBe('L1');
  });

  it('resolves L2 when trade exceeds Conservative maxSingleTradePercent (5%)', () => {
    const input = buildInput({
      mandate: {
        ...buildInput().mandate,
        maxSingleTradePercent: 5,
        equityRiskBandPercent: 3,
        drawdownCircuitBreakerPercent: 8,
      },
      proposedTrades: [{
        symbol: 'VTI', assetClass: 'EQUITY', side: 'BUY',
        quantityOrAmountCents: 6_000_00, // 6% > 5% Conservative limit
        targetWeightPercent: 6, rationale: 'Above conservative limit',
      }],
    });
    expect(resolver.resolve(input, [])).toBe('L2');
  });

  it('resolves L1 for same trade under Aggressive maxSingleTradePercent (20%)', () => {
    const input = buildInput({
      mandate: {
        ...buildInput().mandate,
        maxSingleTradePercent: 20,
        equityRiskBandPercent: 10,
        drawdownCircuitBreakerPercent: 18,
      },
      proposedTrades: [{
        symbol: 'VTI', assetClass: 'EQUITY', side: 'BUY',
        quantityOrAmountCents: 6_000_00, // 6% < 20% Aggressive limit
        targetWeightPercent: 6, rationale: 'Within aggressive limit',
      }],
    });
    expect(resolver.resolve(input, [])).toBe('L1');
  });

  it('resolves L2 when monthly turnover would exceed cap', () => {
    const input = buildInput({
      proposedTrades: [{
        symbol: 'VTI', assetClass: 'EQUITY', side: 'BUY',
        quantityOrAmountCents: 9_000_00, // within single trade limit
        targetWeightPercent: 9, rationale: 'test',
      }, {
        symbol: 'VXUS', assetClass: 'EQUITY', side: 'BUY',
        quantityOrAmountCents: 9_000_00,
        targetWeightPercent: 9, rationale: 'test',
      }, {
        symbol: 'BND', assetClass: 'BONDS', side: 'BUY',
        quantityOrAmountCents: 9_000_00,
        targetWeightPercent: 9, rationale: 'test',
      }],
      // Total = 27_000_00 = 27% > 25% monthlyTurnoverCapPercent
    });
    expect(resolver.resolve(input, [])).toBe('L2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test compliance-ctrl -- --testPathPattern authority-resolver`
Expected: FAIL — MandateSnapshot missing new fields

- [ ] **Step 3: Extend MandateSnapshot interface**

In `services/advisory/compliance-ctrl/src/rules/rule-engine.ts`, update the `MandateSnapshot` interface:

```typescript
export interface MandateSnapshot {
  mandateId: string;
  level: MandateLevel;
  monthlyTurnoverCapPercent: number;
  maxSingleTradePercent: number;
  equityRiskBandPercent: number;
  driftTriggerPercent: number;
  singleEtfConcentrationPercent: number;
  drawdownCircuitBreakerPercent: number;
  effectiveDate: string;
  revokedAt: string | null;
}
```

- [ ] **Step 4: Rewrite authority-resolver.ts**

Replace `services/advisory/compliance-ctrl/src/rules/authority-resolver.ts`:

```typescript
import type { ComplianceInput, Violation } from './rule-engine';

/**
 * Determines the authority level for a compliance decision.
 * - L1 (autonomous): DISCRETIONARY mandate, all mode-specific thresholds pass
 * - L2 (requires user confirmation): ADVISORY mandate, or any threshold exceeded, or violations
 */
export class AuthorityResolver {
  resolve(input: ComplianceInput, violations: Violation[]): 'L1' | 'L2' {
    const { mandate, proposedTrades, portfolioValue } = input;

    // ADVISORY mandate always requires confirmation
    if (mandate.level === 'ADVISORY') {
      return 'L2';
    }

    // Any violations require L2 review
    if (violations.length > 0) {
      return 'L2';
    }

    // Check each trade against mode-derived maxSingleTradePercent
    const maxTradeAmountCents = (portfolioValue * mandate.maxSingleTradePercent) / 100;
    const hasOversizedTrade = proposedTrades.some(
      (trade) => trade.quantityOrAmountCents > maxTradeAmountCents,
    );
    if (hasOversizedTrade) {
      return 'L2';
    }

    // Check total turnover against mode-derived monthlyTurnoverCapPercent
    const maxTurnoverCents = (portfolioValue * mandate.monthlyTurnoverCapPercent) / 100;
    const totalTurnoverCents = proposedTrades.reduce(
      (sum, trade) => sum + trade.quantityOrAmountCents, 0,
    );
    if (totalTurnoverCents > maxTurnoverCents) {
      return 'L2';
    }

    // DISCRETIONARY, no violations, all thresholds pass -> autonomous
    return 'L1';
  }
}
```

- [ ] **Step 5: Update guardrail-evaluator to use mode-derived concentration limit**

In `services/advisory/compliance-ctrl/src/rules/guardrail-evaluator.ts`, replace the hardcoded `DEFAULT_MAX_CONCENTRATION_PERCENT = 25` with the mandate's value.

Change `checkConcentrationLimit`:

```typescript
  private checkConcentrationLimit(input: ComplianceInput): CheckResult {
    const { proposedTrades, currentPositions, mandate } = input;
    const maxConcentration = mandate.singleEtfConcentrationPercent ?? 25;
```

- [ ] **Step 6: Update mandate snapshot projection in event-listener.ts**

In `services/advisory/compliance-ctrl/src/handlers/event-listener.ts`, update the `processMandateEvent` function's `project()` call (around line 150) to include new fields:

```typescript
      return project('MandateSnapshot', {
        tenantId,
        userId,
        mandateId: subject.mandateId,
        level: subject.level,
        monthlyTurnoverCapPercent: subject.monthlyTurnoverCapPercent ?? 25,
        maxSingleTradePercent: subject.maxSingleTradePercent ?? 10,
        equityRiskBandPercent: subject.equityRiskBandPercent ?? 6,
        driftTriggerPercent: subject.driftTriggerPercent ?? 4,
        singleEtfConcentrationPercent: subject.singleEtfConcentrationPercent ?? 30,
        drawdownCircuitBreakerPercent: subject.drawdownCircuitBreakerPercent ?? 12,
        effectiveDate: subject.effectiveDate,
        revokedAt: (subject.revokedAt as string) ?? null,
      }, { pk: guardrailPolicyPk(tenantId, userId), sk: 'MandateSnapshot' });
```

Also update the mandate snapshot construction in `processDecisionPacket` (around line 72):

```typescript
  const mandate: MandateSnapshot = {
    mandateId: mandateRecord.mandateId as string,
    level: mandateRecord.level as 'ADVISORY' | 'DISCRETIONARY',
    monthlyTurnoverCapPercent: (mandateRecord.monthlyTurnoverCapPercent as number) ?? 25,
    maxSingleTradePercent: (mandateRecord.maxSingleTradePercent as number) ?? 10,
    equityRiskBandPercent: (mandateRecord.equityRiskBandPercent as number) ?? 6,
    driftTriggerPercent: (mandateRecord.driftTriggerPercent as number) ?? 4,
    singleEtfConcentrationPercent: (mandateRecord.singleEtfConcentrationPercent as number) ?? 30,
    drawdownCircuitBreakerPercent: (mandateRecord.drawdownCircuitBreakerPercent as number) ?? 12,
    effectiveDate: mandateRecord.effectiveDate as string,
    revokedAt: mandateRecord.revokedAt as string | null,
  };
```

- [ ] **Step 7: Run all compliance-ctrl tests**

Run: `pnpm nx test compliance-ctrl`
Expected: PASS — update any other test files that construct MandateSnapshot objects (rule-engine.test.ts, guardrail-evaluator.test.ts) by adding the new fields with Balanced defaults.

- [ ] **Step 8: Commit**

```
git add services/advisory/compliance-ctrl/src/rules/ \
       services/advisory/compliance-ctrl/src/handlers/event-listener.ts \
       services/advisory/compliance-ctrl/test/
git commit -m "feat(compliance-ctrl): mode-aware authority resolver and extended mandate snapshot"
```

---

### Task 4: Add E2E parametrized operating mode tests

**Files:**
- Create: `apps/e2e-feature-tests/src/advisory/operating-mode-authority.e2e.test.ts`

- [ ] **Step 1: Write the parametrized E2E test**

Create `apps/e2e-feature-tests/src/advisory/operating-mode-authority.e2e.test.ts`:

```typescript
import {
  createTestContext,
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  funded,
  withDecision,
  bffClient,
  waitForGraphQL,
  type FreshTenant,
} from '..';

/**
 * Verifies that operating mode affects L1/L2 authority resolution.
 * A 6% trade should be:
 *   - L2 in CONSERVATIVE (max 5%)
 *   - L1 in BALANCED (max 10%)
 *   - L1 in AGGRESSIVE (max 20%)
 */
describe.each([
  { mode: 'CONSERVATIVE' as const, tradePercent: 6, expectedNeedsConfirmation: true },
  { mode: 'BALANCED' as const, tradePercent: 6, expectedNeedsConfirmation: false },
  { mode: 'AGGRESSIVE' as const, tradePercent: 6, expectedNeedsConfirmation: false },
])('operating mode $mode — $tradePercent% trade', ({ mode, tradePercent, expectedNeedsConfirmation }) => {
  let ctx: TestContext;
  let tenant: FreshTenant;
  let decisionId: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    // Portfolio value = 100_000 cents ($1,000); trade = tradePercent% = 6_000 cents ($60)
    const capitalAmount = 100_000;
    const tradeAmount = Math.round((capitalAmount * tradePercent) / 100);
    const result = await applyFixtures(ctx, tenant, [
      onboarded({ operatingMode: mode, capitalAmount }),
      funded({ cashBalanceCents: capitalAmount }),
      withDecision({
        trigger: 'REBALANCE',
        proposedTrades: [{ symbol: 'VTI', side: 'BUY', quantityOrAmountCents: tradeAmount }],
      }),
    ]);
    decisionId = result.decisionId as string;
  }, 120_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it(`decision is ${expectedNeedsConfirmation ? 'L2 (confirmation required)' : 'L1 (autonomous)'}`, async () => {
    const bff = bffClient(ctx, tenant);

    // Wait for decision to materialise in advisory-bff
    const decision = await waitForGraphQL<{
      getDecision: { decisionId: string; status: string; confirmationRequired: boolean } | null;
    }>(
      bff.advisory,
      `query GetDecision($decisionId: ID!) {
        getDecision(decisionId: $decisionId) { decisionId status confirmationRequired }
      }`,
      { decisionId },
      (r) => r.getDecision != null,
      { timeoutMs: 120_000 },
    );

    expect(decision.getDecision?.confirmationRequired).toBe(expectedNeedsConfirmation);
  });
});
```

- [ ] **Step 2: Verify test compiles**

Run: `pnpm nx build e2e-feature-tests` (or typecheck)
Expected: No type errors

- [ ] **Step 3: Commit**

```
git add apps/e2e-feature-tests/src/advisory/operating-mode-authority.e2e.test.ts
git commit -m "test(e2e): add parametrized operating mode authority level tests"
```

**Note:** E2E tests run against deployed infrastructure. They will only pass after deploying the investor-bff and compliance-ctrl changes from Tasks 1-3.

---

### Task 5: Deploy and run E2E tests

- [ ] **Step 1: Deploy investor-bff and compliance-ctrl**

Run:
```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-bff,compliance-ctrl
```

- [ ] **Step 2: Run E2E operating mode tests**

Run:
```bash
NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features -- --testPathPattern operating-mode-authority
```

Expected: 3 tests pass (CONSERVATIVE=L2, BALANCED=L1, AGGRESSIVE=L1)

- [ ] **Step 3: Run full E2E suite to check no regressions**

Run:
```bash
NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features
```

Expected: All existing scenarios + 3 new tests pass. If existing tests fail because they expected ADVISORY mandate behavior, update the `withDecision` fixture's `confirmationRequired` expectations.

- [ ] **Step 4: Commit any fixture updates**

```
git add apps/e2e-feature-tests/
git commit -m "fix(e2e): update fixtures for DISCRETIONARY mandate default"
```

---

### Task 6: Update service cards and flow specs

- [ ] **Step 1: Regenerate investor-bff service card**

Invoke: `audit-service` skill for investor-bff

- [ ] **Step 2: Regenerate compliance-ctrl service card**

Invoke: `audit-service` skill for compliance-ctrl

- [ ] **Step 3: Update advisory-cycle flow spec**

In `flows/advisory-cycle.flow.yaml`, update the compliance check step to note that authority resolution uses mode-derived thresholds from the mandate snapshot, not a static $50k threshold.

- [ ] **Step 4: Commit**

```
git add services/investor/investor-bff/CLAUDE.md \
       services/advisory/compliance-ctrl/CLAUDE.md \
       flows/advisory-cycle.flow.yaml
git commit -m "docs: update service cards and flow spec for operating mode implementation"
```
