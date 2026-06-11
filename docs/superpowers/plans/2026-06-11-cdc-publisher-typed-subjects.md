# CDC Publisher Typed Row → DRY Subject (WS-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every CDC event-publisher (`changeDataCapture` on each `*-egress`) validates each DynamoDB stream row against its producer's WS-1 zod contract keyed by `__typename` and emits the **DRY parsed subject** — no `as Record` on rows or emitted subjects; a producer schema change breaks the publisher build.

**Architecture:** One change to the shared `changeDataCapture` pipeline (`libs/event-processor`) adds a `schemas` registry + `exemptTypenames` set; `buildEntry` emits `schema.parse(record)` (covered → DRY) or the fat row (exempt). A cold-start completeness guard enforces every emitted `__typename` is covered-or-exempt. Each of the 21 publishers passes a typed `schemas` map importing its producer contracts. ~14 advisory-core agent-internal `__typename`s with no WS-1 contract are exempted (Decision 5) and tracked in `advisory-agent-event-contract-coverage`.

**Tech Stack:** TypeScript, zod v3, Nx, Jest (ts-jest transpile-only), AWS Lambda (DynamoDB Streams → EventBridge), `@nestfolio/event-processor`.

**Spec:** `docs/superpowers/specs/2026-06-11-cdc-publisher-typed-subjects-design.md`

---

## Mapping Table (authoritative per-service data)

Each publisher's `subjectSchemas` literal, `exemptTypenames` literal, import line(s), and the
`EMITTED` `__typename` set (= the keys of the CDK `Egress` `eventTypes` map in that service's
`service.stack.ts`). Tasks 3–7 apply the Task-2 template using these rows verbatim.

### Ledger
| Service | `subjectSchemas` | `exemptTypenames` | Import(s) | `EMITTED` |
|---|---|---|---|---|
| ledger-ctrl | `{ BalanceEvent: BalanceUpdatedSchema, PortfolioEvent: PortfolioUpdatedSchema, LedgerEntryEvent: LedgerEntryRecordedSchema }` | `[]` | `import { BalanceUpdatedSchema, PortfolioUpdatedSchema, LedgerEntryRecordedSchema } from '@nestfolio/ledger-ctrl/contracts';` | `['BalanceEvent','PortfolioEvent','LedgerEntryEvent']` |
| reconciliation-ctrl | `{ ReconciliationResult: ReconciliationResultSchema, DriftRecord: DriftRecordSchema }` | `[]` | `import { ReconciliationResultSchema, DriftRecordSchema } from '@nestfolio/reconciliation-ctrl/contracts';` | `['ReconciliationResult','DriftRecord']` |

### Investor
| Service | `subjectSchemas` | `exemptTypenames` | Import(s) | `EMITTED` |
|---|---|---|---|---|
| investor-ctrl | `{ Notification: NotificationCreatedSchema, MonthlyReport: MonthlyReportSchema }` | `[]` | `import { NotificationCreatedSchema, MonthlyReportSchema } from '@nestfolio/investor-ctrl/contracts';` | `['Notification','MonthlyReport']` |
| investor-bff | `{ InvestorProfile: InvestorProfileUpdatedSchema, Notification: NotificationReadSchema, Mandate: MandateSchema, DepositIntent: DepositInitiatedSchema, WithdrawalIntent: WithdrawalInitiatedSchema, ExecutionModeChange: ExecutionModeChangedSchema }` | `[]` | `import { InvestorProfileUpdatedSchema, NotificationReadSchema } from '@nestfolio/investor-bff/contracts';`<br>`import { MandateSchema, DepositInitiatedSchema, WithdrawalInitiatedSchema, ExecutionModeChangedSchema } from '@nestfolio/investor-adpt/contracts';` | `['InvestorProfile','Notification','Mandate','DepositIntent','WithdrawalIntent','ExecutionModeChange']` |
| onboarding-bff | `{ OnboardingCompleted: OnboardingCompletedRecordSchema, GoLiveConfirmed: GoLiveConfirmedRecordSchema }` | `[]` | `import { OnboardingCompletedRecordSchema, GoLiveConfirmedRecordSchema } from '@nestfolio/onboarding-bff/contracts';` | `['OnboardingCompleted','GoLiveConfirmed']` |

### Execution
| Service | `subjectSchemas` | `exemptTypenames` | Import(s) | `EMITTED` |
|---|---|---|---|---|
| execution-ctrl | `{ Order: OrderSchema, StagedOrder: StagedOrderSchema }` | `[]` | `import { OrderSchema, StagedOrderSchema } from '@nestfolio/execution-ctrl/contracts';` | `['Order','StagedOrder']` |
| broker-ctrl | `{ NormalizedEvent: NormalizedOrderEventSchema, FundingEvent: FundingSnapshotSchema }` | `[]` | `import { NormalizedOrderEventSchema } from '@nestfolio/broker-ctrl/contracts';`<br>`import { FundingSnapshotSchema } from '@nestfolio/execution-adpt/domain';` | `['NormalizedEvent','FundingEvent']` |
| broker-alpaca-adpt | `{ AlpacaOrderResult: AlpacaOrderResultSchema, AlpacaTransferResult: AlpacaTransferResultSchema, AlpacaAccountSnapshot: AlpacaAccountSnapshotSchema, NormalizedEvent: BrokerCircuitEventSchema }` | `[]` | `import { AlpacaOrderResultSchema, AlpacaTransferResultSchema, AlpacaAccountSnapshotSchema, BrokerCircuitEventSchema } from '@nestfolio/broker-alpaca-adpt/contracts';` | `['AlpacaOrderResult','AlpacaTransferResult','AlpacaAccountSnapshot','NormalizedEvent']` |
| broker-sim-adpt | `{ VirtualTrade: VirtualTradeSchema, DepositDetected: SimDepositCompletedSchema, WithdrawalCompleted: SimWithdrawalCompletedSchema }` | `[]` | `import { VirtualTradeSchema, SimDepositCompletedSchema, SimWithdrawalCompletedSchema } from '@nestfolio/broker-sim-adpt/contracts';` | `['VirtualTrade','DepositDetected','WithdrawalCompleted']` |

### Advisory — feed adapters (all global/SYSTEM context)
| Service | `subjectSchemas` | `exemptTypenames` | Import(s) | `EMITTED` |
|---|---|---|---|---|
| alpha-vantage-adpt | `{ AlphaVantageArticle: AlphaVantageArticleSchema, EconomicIndicator: EconomicIndicatorSchema }` | `[]` | `import { AlphaVantageArticleSchema, EconomicIndicatorSchema } from '@nestfolio/alpha-vantage-adpt/contracts';` | `['AlphaVantageArticle','EconomicIndicator']` |
| fred-adpt | `{ FredIndicator: FredIndicatorSchema }` | `[]` | `import { FredIndicatorSchema } from '@nestfolio/fred-adpt/contracts';` | `['FredIndicator']` |
| marketwatch-adpt | `{ MarketWatchArticle: MarketWatchArticleSchema }` | `[]` | `import { MarketWatchArticleSchema } from '@nestfolio/marketwatch-adpt/contracts';` | `['MarketWatchArticle']` |
| sec-edgar-adpt | `{ SecFiling: SecFilingSchema }` | `[]` | `import { SecFilingSchema } from '@nestfolio/sec-edgar-adpt/contracts';` | `['SecFiling']` |
| yahoo-finance-adpt | `{ YahooFinanceArticle: YahooFinanceArticleSchema }` | `[]` | `import { YahooFinanceArticleSchema } from '@nestfolio/yahoo-finance-adpt/contracts';` | `['YahooFinanceArticle']` |

### Advisory — core services (with exemptions, Decision 5)
The covered set is exactly the **WS-1 e2e-validated row-level schemas**; everything else is
exempt. Each covered schema is parse-verified against a real row in the closing e2e gate
(Task 10); if any "covered" schema turns out to be field-level (not row-level), move it to
`exemptTypenames` and add it to `advisory-agent-event-contract-coverage`.

| Service | `subjectSchemas` | `exemptTypenames` | Import(s) | `EMITTED` |
|---|---|---|---|---|
| investor-profile-ctrl | `{ InvestorProfileSnapshot: InvestorProfileSnapshotSchema }` | `['AgentInvocation','ReasoningOutput']` | `import { InvestorProfileSnapshotSchema } from '@nestfolio/investor-profile-ctrl/contracts';` | `['AgentInvocation','ReasoningOutput','InvestorProfileSnapshot']` |
| market-intelligence-ctrl | `{ MarketSnapshot: MarketSnapshotSchema }` | `['AgentInvocation']` | `import { MarketSnapshotSchema } from '@nestfolio/market-intelligence-ctrl/contracts';` | `['AgentInvocation','MarketSnapshot']` |
| portfolio-engine-ctrl | `{}` | `['AgentInvocation','ReasoningOutput','AgentCompletion','AgentFailure']` | _(none — all exempt)_ | `['AgentInvocation','ReasoningOutput','AgentCompletion','AgentFailure']` |
| advisory-narrative-ctrl | `{}` | `['ReasoningOutput','AgentCompletion','AgentFailure']` | _(none — all exempt)_ | `['ReasoningOutput','AgentCompletion','AgentFailure']` |
| decision-workflow-ctrl | `{ DecisionPacket: DecisionPacketSchema, MandateSnapshot: MandateSnapshotSchema }` | `['AgentOutput']` | `import { DecisionPacketSchema, MandateSnapshotSchema } from '@nestfolio/decision-workflow-ctrl/contracts';` | `['DecisionPacket','AgentOutput','MandateSnapshot']` |
| compliance-ctrl | `{ ComplianceCheck: ComplianceCheckSchema }` | `['AuditArtifact']` | `import { ComplianceCheckSchema } from '@nestfolio/compliance-ctrl/contracts';` | `['ComplianceCheck','AuditArtifact']` |
| advisory-bff | `{ DecisionReadModel: DecisionReadModelSchema, UserConfirmation: UserConfirmationSchema, UserRejection: UserRejectionSchema }` | `['AdvisoryStatus','UserInteraction']` | `import { DecisionReadModelSchema, UserConfirmationSchema, UserRejectionSchema } from '@nestfolio/advisory-bff/contracts';` | `['DecisionReadModel','AdvisoryStatus','UserInteraction','UserConfirmation','UserRejection']` |

> Before editing each service, **re-confirm `EMITTED` against the live `service.stack.ts` `eventTypes` keys** — the per-service unit test asserts `schemas ∪ exempt === EMITTED`, so a drifted `EMITTED` fails loudly.

---

## Task 1: Shared-lib — `schemas` registry, DRY emission, exemptions, completeness guard, NotRetryableError

**Files:**
- Modify: `libs/event-processor/src/pipelines/change-data-capture.ts`
- Test: `libs/event-processor/test/pipelines/change-data-capture.test.ts`

- [ ] **Step 1: Make the ErrorEventPublisher mock assertable + add failing typed-mode tests**

In `change-data-capture.test.ts`, replace the `ErrorEventPublisher` mock (lines 11–15) so its `publishErrors` is a stable ref, then add a new `describe` block. Add `import { z } from 'zod';` at the top.

```ts
const mockPublishErrors = jest.fn().mockResolvedValue(undefined);
jest.mock('../../src/engine/error-event-publisher', () => ({
  ErrorEventPublisher: jest.fn().mockImplementation(() => ({
    publishErrors: mockPublishErrors,
  })),
}));
```

```ts
describe('typed-subject mode (schemas / exemptTypenames)', () => {
  const BalanceSchema = z.object({
    cashBalanceCents: z.number(),
    snapshot: z.object({ lastEventSequence: z.number() }),
  });

  it('emits the DRY parsed subject (drops envelope + identity) for a covered __typename', async () => {
    process.env.EVENT_TYPE_MAP = JSON.stringify({ 'BalanceEvent:INSERT': 'BALANCE_UPDATED' });
    const handler = changeDataCapture({ schemas: { BalanceEvent: BalanceSchema }, exemptTypenames: [] });
    await handler({ Records: [ fakeDdbStreamRecord('INSERT', {
      pk: 'Account#t1', sk: 'BalanceEvent#1', __typename: 'BalanceEvent',
      tenantId: 't1', userId: 'u1', region: 'us-east-1', createdAt: 'x',
      cashBalanceCents: 1000, snapshot: { lastEventSequence: 5 },
    }) ] });
    const detail = JSON.parse(mockPublish.mock.calls[0][0][0].Detail);
    expect(detail.subject).toEqual({ cashBalanceCents: 1000, snapshot: { lastEventSequence: 5 } });
    expect(detail.subject.pk).toBeUndefined();
    expect(detail.subject.__typename).toBeUndefined();
    expect(detail.subject.tenantId).toBeUndefined();
    expect(detail.context.tenantId).toBe('t1');
  });

  it('emits the fat row unchanged for an exempt __typename', async () => {
    process.env.EVENT_TYPE_MAP = JSON.stringify({ 'AgentInvocation:INSERT': 'GOAL_INTERPRETATION_PRODUCED' });
    const handler = changeDataCapture({ schemas: {}, exemptTypenames: ['AgentInvocation'] });
    await handler({ Records: [ fakeDdbStreamRecord('INSERT', {
      pk: 'D#1', sk: 'AgentInvocation#x', __typename: 'AgentInvocation', tenantId: 't1', decisionId: 'd1',
    }) ] });
    const detail = JSON.parse(mockPublish.mock.calls[0][0][0].Detail);
    expect(detail.subject.__typename).toBe('AgentInvocation');
    expect(detail.subject.decisionId).toBe('d1');
  });

  it('routes a covered row that drifts from its schema to the error publisher (NotRetryable, not retried)', async () => {
    process.env.EVENT_TYPE_MAP = JSON.stringify({ 'BalanceEvent:INSERT': 'BALANCE_UPDATED' });
    const handler = changeDataCapture({ schemas: { BalanceEvent: BalanceSchema }, exemptTypenames: [] });
    // missing cashBalanceCents + snapshot → ZodError → NotRetryableError
    await handler({ Records: [ fakeDdbStreamRecord('INSERT', {
      pk: 'Account#t1', sk: 'BalanceEvent#1', __typename: 'BalanceEvent', tenantId: 't1',
    }) ] });
    expect(mockPublish).not.toHaveBeenCalled();        // no bad subject emitted
    expect(mockPublishErrors).toHaveBeenCalled();      // non-retryable → error event
  });

  it('throws at init when a mapped __typename is neither covered nor exempt', () => {
    process.env.EVENT_TYPE_MAP = JSON.stringify({
      'BalanceEvent:INSERT': 'BALANCE_UPDATED',
      'Forgot:INSERT': 'FORGOTTEN',
    });
    expect(() => changeDataCapture({ schemas: { BalanceEvent: BalanceSchema } })).toThrow(/Forgot/);
  });

  it('does NOT run the completeness guard in legacy mode (no schemas, no exempt)', async () => {
    process.env.EVENT_TYPE_MAP = JSON.stringify({ 'Anything:INSERT': 'X' });
    const handler = changeDataCapture();             // legacy: emits fat row, no guard
    await handler({ Records: [ fakeDdbStreamRecord('INSERT', {
      pk: 'p', sk: 's', __typename: 'Anything', tenantId: 't1', foo: 'bar',
    }) ] });
    const detail = JSON.parse(mockPublish.mock.calls[0][0][0].Detail);
    expect(detail.subject.__typename).toBe('Anything');
    expect(detail.subject.foo).toBe('bar');
  });
});
```

Also **delete** the existing `'applies transform when provided'` test (lines ~340–354) — the `transform` seam is removed.

- [ ] **Step 2: Run the new tests — verify they fail**

Run: `pnpm nx test event-processor -- --testPathPatterns change-data-capture`
Expected: FAIL — `schemas`/`exemptTypenames` not yet on `ChangeDataCaptureConfig`; covered case still emits the fat row; guard not implemented.

- [ ] **Step 3: Implement the pipeline change**

In `libs/event-processor/src/pipelines/change-data-capture.ts`:

Add the import (extend the existing `from '../internal'` line):
```ts
import { getUUID, NotRetryableError } from '../internal';
import type { ZodTypeAny } from 'zod';
```

Replace `transform?` in the config with the two new fields:
```ts
export interface ChangeDataCaptureConfig {
  groupBy?: {
    key: (record: StreamRecord) => string;
    pick?: 'first' | 'last';
  };
  bus?: string;
  concurrency?: number;
  schemas?: Record<string, ZodTypeAny>;   // keyed by __typename → producer WS-1 contract
  exemptTypenames?: string[];             // emitted __typenames knowingly without a contract
}
```

Add the subject builder (above `buildEntry`):
```ts
function buildSubject(record: StreamRecord, schemas?: Record<string, ZodTypeAny>): unknown {
  const schema = schemas?.[record.__typename];
  if (!schema) return record;                       // legacy / exempt → fat row
  try {
    return schema.parse(record);                    // DRY: subject IS the contract
  } catch (err) {
    throw new NotRetryableError(
      `publisher subject contract violation: ${record.__typename}`,
      { typename: record.__typename, issues: err instanceof Error ? err.message : String(err) },
    );
  }
}
```

Change `buildEntry` — drop the `transform` param, add `schemas`, and route subject + previousSubject through `buildSubject`:
```ts
function buildEntry(
  record: StreamRecord,
  ctx: StreamContext,
  emission: Emission,
  busName: string,
  serviceName: string,
  schemas?: Record<string, ZodTypeAny>,
): PutEventsRequestEntry {
  const detail: Record<string, unknown> = {
    id: ctx.record.eventID ?? getUUID(),
    type: emission.eventType,
    timestamp: new Date().toISOString(),
    subject: buildSubject(record, schemas),
    context: {
      tenantId: record.tenantId,
      userId: record.userId,
      region: record.region,
    },
  };
  if (emission.previousSubject) {
    detail.previousSubject = buildSubject(emission.previousSubject as StreamRecord, schemas);
  }
  // ... unchanged: isTestTenant source tagging + return PutEventsRequestEntry
```

In `changeDataCapture()`, after `runtimeConfig`/`serviceName` are read and before building the engine, add the completeness guard (typed mode only) and thread `config.schemas` into the two `buildEntry` call sites (replace `config.transform` with `config.schemas`):
```ts
  if (config.schemas || config.exemptTypenames) {
    const covered = new Set(Object.keys(config.schemas ?? {}));
    const exempt = new Set(config.exemptTypenames ?? []);
    const emitted = new Set(Object.keys(runtimeConfig).map((k) => k.split(':')[0]));
    const missing = [...emitted].filter((t) => !covered.has(t) && !exempt.has(t));
    if (missing.length > 0) {
      throw new Error(
        `changeDataCapture: emitted __typename(s) without a schema or exemption: ` +
        `${missing.join(', ')} (service ${serviceName})`,
      );
    }
  }
```
Call sites become `buildEntry(record, ctx, em, busName, serviceName, config.schemas)` in both `processRecord` and `processGroup`.

- [ ] **Step 4: Run the tests — verify they pass**

Run: `pnpm nx test event-processor -- --testPathPatterns change-data-capture`
Expected: PASS (all groups, including the untouched legacy routing/onFieldChange tests).

- [ ] **Step 5: Verify the lib still type-checks**

Run: `pnpm tsc --noEmit -p libs/event-processor/tsconfig.lib.json`
Expected: no errors (the removed `transform` is referenced nowhere in `src/`).

- [ ] **Step 6: Commit**

```bash
git add libs/event-processor/src/pipelines/change-data-capture.ts libs/event-processor/test/pipelines/change-data-capture.test.ts
git commit --no-verify -m "feat(event-processor): typed-subject CDC publisher (schemas registry + DRY emission)"
```

---

## Task 2: Per-publisher template (worked example — ledger-ctrl)

This task establishes the exact file shape that Tasks 3–7 repeat with each service's Mapping-Table row.

**Why a separate `publisher-schemas.ts`:** the handler module runs `changeDataCapture({...})` at
import (it reads `process.env.EVENT_TYPE_MAP`), so importing it from a unit test throws. The
registry lives in its own pure-data module (no env coupling) — importable by both the handler and
the test, and a cleaner declarative artifact.

**Files:**
- Create: `services/ledger/ledger-ctrl/src/handlers/publisher-schemas.ts`
- Modify: `services/ledger/ledger-ctrl/src/handlers/event-publisher.ts`
- Test: `services/ledger/ledger-ctrl/test/unit/publisher-schemas.test.ts`

- [ ] **Step 1: Write the failing registry test**

`services/ledger/ledger-ctrl/test/unit/publisher-schemas.test.ts`:
```ts
import { subjectSchemas, exemptTypenames } from '../../src/handlers/publisher-schemas';

// EMITTED = keys of the Egress `eventTypes` map in service.stack.ts
const EMITTED = ['BalanceEvent', 'PortfolioEvent', 'LedgerEntryEvent'];

describe('ledger-ctrl CDC publisher registry', () => {
  it('covers every emitted __typename (schemas ∪ exempt === emitted)', () => {
    const registered = new Set([...Object.keys(subjectSchemas), ...exemptTypenames]);
    expect([...registered].sort()).toEqual([...EMITTED].sort());
  });

  it('every registered schema is a zod schema', () => {
    for (const s of Object.values(subjectSchemas)) {
      expect(typeof (s as { parse?: unknown }).parse).toBe('function');
    }
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm nx test ledger-ctrl -- --testPathPatterns publisher-schemas`
Expected: FAIL — `publisher-schemas.ts` does not exist yet.

- [ ] **Step 3: Create the registry + wire the handler**

`services/ledger/ledger-ctrl/src/handlers/publisher-schemas.ts`:
```ts
import { BalanceUpdatedSchema, PortfolioUpdatedSchema, LedgerEntryRecordedSchema } from '@nestfolio/ledger-ctrl/contracts';

export const subjectSchemas = {
  BalanceEvent: BalanceUpdatedSchema,
  PortfolioEvent: PortfolioUpdatedSchema,
  LedgerEntryEvent: LedgerEntryRecordedSchema,
};
export const exemptTypenames: string[] = [];
```

`services/ledger/ledger-ctrl/src/handlers/event-publisher.ts`:
```ts
import { changeDataCapture } from '@nestfolio/event-processor';
import { subjectSchemas, exemptTypenames } from './publisher-schemas';

export const handler = changeDataCapture({ schemas: subjectSchemas, exemptTypenames });
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm nx test ledger-ctrl -- --testPathPatterns publisher-schemas`
Expected: PASS.

- [ ] **Step 5: Type-check the service**

Run: `pnpm tsc --noEmit -p services/ledger/ledger-ctrl/tsconfig.spec.json`
Expected: no errors (the contract imports resolve; `subjectSchemas` keys match the contracts).

- [ ] **Step 6: Commit**

```bash
git add services/ledger/ledger-ctrl/src/handlers/publisher-schemas.ts services/ledger/ledger-ctrl/src/handlers/event-publisher.ts services/ledger/ledger-ctrl/test/unit/publisher-schemas.test.ts
git commit --no-verify -m "feat(ledger-ctrl): typed CDC publisher subjects"
```

---

## Tasks 3–7: Apply the template to the remaining 20 publishers (per domain)

For **each** service below, repeat the **Task-2 procedure** (steps 1–6) using that service's
Mapping-Table row: write `test/unit/publisher-schemas.test.ts` with the row's `EMITTED`, create
`src/handlers/publisher-schemas.ts` exporting `subjectSchemas` + `exemptTypenames` (with the row's
literals + import(s)), rewrite `src/handlers/event-publisher.ts` to
`import { subjectSchemas, exemptTypenames } from './publisher-schemas'; export const handler = changeDataCapture({ schemas: subjectSchemas, exemptTypenames });`,
run `pnpm nx test <svc> -- --testPathPatterns publisher-schemas` (fail → pass), type-check with
`pnpm tsc --noEmit -p services/<domain>/<svc>/tsconfig.spec.json`, and **commit per service**
(`feat(<svc>): typed CDC publisher subjects`).

- [ ] **Task 3 — Ledger (1 remaining):** `reconciliation-ctrl`.
- [ ] **Task 4 — Investor (3):** `investor-ctrl`, `investor-bff` (two imports — own `/contracts` + `investor-adpt/contracts`), `onboarding-bff`.
- [ ] **Task 5 — Execution (4):** `execution-ctrl`, `broker-ctrl` (`FundingSnapshotSchema` from `execution-adpt/domain`), `broker-alpaca-adpt`, `broker-sim-adpt`.
- [ ] **Task 6 — Advisory feeds (5):** `alpha-vantage-adpt`, `fred-adpt`, `marketwatch-adpt`, `sec-edgar-adpt`, `yahoo-finance-adpt`.
- [ ] **Task 7 — Advisory core (7):** `investor-profile-ctrl`, `market-intelligence-ctrl`, `portfolio-engine-ctrl` (all-exempt — `subjectSchemas = {}`, no contract import), `advisory-narrative-ctrl` (all-exempt), `decision-workflow-ctrl`, `compliance-ctrl`, `advisory-bff`. For the two all-exempt services `publisher-schemas.ts` is `export const subjectSchemas = {}; export const exemptTypenames = [...];` (no contract import).

> After Task 7, run `pnpm nx affected -t test,lint --base=origin/main` and fix any fallout before the e2e tasks.

---

## Task 8: Update the e2e contract-emission gate semantics (now DRY-by-construction)

The 4 `*-contract-emission.e2e.test.ts` gates + `helpers/contract-assert.ts` document the
**old** "publisher emits the whole row" reasoning. Under WS-2 the emission is `schema.parse(row)`,
so the row-parse assertion still proves emission validity but for a *different* reason. Update
the prose only — assertions are unchanged (a row that parses ⟹ the DRY subject is well-formed).

**Files:**
- Modify: `apps/e2e-feature-tests/src/helpers/contract-assert.ts`
- Modify: `apps/e2e-feature-tests/src/{ledger,investor,execution,advisory}/*-contract-emission.e2e.test.ts` (header comments)

- [ ] **Step 1: Update `contract-assert.ts` doc comment**

Replace the JSDoc sentence "The CDC publisher emits the whole row as the event subject, so a row that parses IS proof the emitted subject satisfies the contract." with:
```ts
/**
 * Validate a REAL persisted producer row against its producer contract.
 * Under WS-2 the CDC publisher emits `schema.parse(row)` (the DRY subject), so a row that parses
 * here is proof the emitted subject is a well-formed instance of the contract. Returns the parsed
 * aggregate for further field assertions.
 */
```

- [ ] **Step 2: Update each gate's header comment**

In each of the 4 gates, replace the "emits the whole DDB row as the event subject" line in the file header with: "Under WS-2 the publisher emits `schema.parse(row)`; a row that parses proves the emitted DRY subject is well-formed (the strict DRY-wire assertion is added in `<domain>-dry-wire.e2e` / the representative capture)."

- [ ] **Step 3: Type-check the e2e app**

Run: `pnpm tsc --noEmit -p apps/e2e-feature-tests/tsconfig.json`
Expected: no errors (comment-only changes).

- [ ] **Step 4: Commit**

```bash
git add apps/e2e-feature-tests/src/helpers/contract-assert.ts apps/e2e-feature-tests/src/*/{ledger,investor,execution,advisory}-contract-emission.e2e.test.ts
git commit --no-verify -m "docs(e2e): contract-emission gates reflect WS-2 DRY emission semantics"
```

---

## Task 9: Representative DRY-wire capture (prove the emitted EVENT is DRY end-to-end)

Add one assertion per domain that captures the **real emitted EventBridge event** and
strict-asserts its `subject` matches the contract (no envelope keys), proving the wire is DRY
end-to-end (not only by construction). Reuse the existing e2e trap pattern.

**Files:**
- Read first: `apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts` (the existing EB-capture trap) + `apps/e2e-feature-tests/src/profile/revoke-mandate.e2e.test.ts` (a caller) to learn the trap API.
- Create: `apps/e2e-feature-tests/src/helpers/event-subject-trap.ts` (generalized capture: arm a temporary EB rule → SQS, return captured `detail.subject` by `detailType`).
- Modify: each of the 4 `*-contract-emission.e2e.test.ts` to add one `it('emits a DRY <EVENT> subject (no envelope keys)')` using the trap for one representative covered event per domain:
  - ledger: `BALANCE_UPDATED` → strict-assert subject equals `BalanceUpdatedSchema` shape, and `subject.pk`/`subject.__typename`/`subject.tenantId` are `undefined`.
  - investor: `INVESTOR_PROFILE_UPDATED`.
  - execution: `ORDER_*` (an emitted `Order` event from the real fill path).
  - advisory: `DECISION_READ_MODEL_UPDATED`.

- [ ] **Step 1: Read the trap pattern**

Run: `sed -n '1,80p' apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts`
Note its setup/teardown + how it filters by detailType; mirror it.

- [ ] **Step 2: Write `event-subject-trap.ts`**

Implement `armEventSubjectTrap(ctx, { bus, detailType }) → { waitForSubject(timeoutMs): Promise<Record<string, unknown>>, dispose() }` modeled on `agent-trace-trap.ts` (temporary rule → SQS queue → poll → parse `detail.subject`). Tear down the rule + queue in `dispose()`.

- [ ] **Step 3: Add the DRY-wire `it` to each gate (failing until deployed)**

Example (ledger gate):
```ts
it('emits a DRY BALANCE_UPDATED subject (no envelope keys)', async () => {
  const trap = await armEventSubjectTrap(ctx, { bus: 'ledger', detailType: 'BALANCE_UPDATED' });
  try {
    await applyFixtures(ctx, tenant, [onboarded(), withHoldings([{ symbol: 'VTI', quantity: 1, fillPrice: 100 }])]);
    const subject = await trap.waitForSubject(180_000);
    expect(() => BalanceUpdatedSchema.parse(subject)).not.toThrow();
    expect(subject.pk).toBeUndefined();
    expect(subject.sk).toBeUndefined();
    expect(subject.__typename).toBeUndefined();
    expect(subject.tenantId).toBeUndefined();   // identity travels in context, not subject
  } finally {
    await trap.dispose();
  }
}, 420_000);
```

- [ ] **Step 4: Type-check**

Run: `pnpm tsc --noEmit -p apps/e2e-feature-tests/tsconfig.json`
Expected: no errors. (Execution against deployed dev happens in Task 10.)

- [ ] **Step 5: Commit**

```bash
git add apps/e2e-feature-tests/src/helpers/event-subject-trap.ts apps/e2e-feature-tests/src/*/*-contract-emission.e2e.test.ts
git commit --no-verify -m "test(e2e): representative DRY-wire emission capture per domain"
```

---

## Task 10: Closing — deploy + scoped e2e + §6 hard-break fixes

- [ ] **Step 1: Full affected gate**

Run: `pnpm nx affected -t test,lint --base=origin/main`
Expected: PASS. Fix any failures before deploying.

- [ ] **Step 2: Deploy all 21 publishers to dev**

The publishers are pure Lambda code (no infra change), so a code deploy suffices:
```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=ledger-ctrl,reconciliation-ctrl,investor-ctrl,investor-bff,onboarding-bff,execution-ctrl,broker-ctrl,broker-alpaca-adpt,broker-sim-adpt,alpha-vantage-adpt,fred-adpt,marketwatch-adpt,sec-edgar-adpt,yahoo-finance-adpt,investor-profile-ctrl,market-intelligence-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl,decision-workflow-ctrl,compliance-ctrl,advisory-bff 2>&1 | tee /tmp/ws2-deploy.log
```
Expected: all 21 update cleanly. Grep the log for `CREATE_FAILED|UPDATE_FAILED` — none.

- [ ] **Step 3: Run the 4 contract-emission gates + DRY-wire captures against deployed dev**

Run:
```bash
NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features -- --testPathPatterns 'contract-emission'
```
Expected: all 4 gates green, including the new DRY-wire `it`s. **A drifted producer row would surface as a `<SERVICE>_STREAM_FAILED` error event + a missing expected event** → the gate times out. If a gate fails because a "covered" advisory-core schema is actually field-level (e.g. an `AgentCompletion`-style mismatch slipped through), move that `__typename` to `exemptTypenames`, add it to `advisory-agent-event-contract-coverage`, redeploy that service, re-run.

- [ ] **Step 4: §6 smoke — one representative full flow per domain**

Run the involved full-flow scenarios (NOT the whole suite) to surface any not-yet-migrated consumer that hard-breaks on the DRY wire:
```bash
NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features -- --testPathPatterns 'first-decision|withdrawal|funded|notifications'
```
Expected: green. If a **critical trigger-chain** consumer hard-breaks on a now-absent envelope field (per Decision 4), apply the **minimal surgical read-fix** (e.g. `subject.tenantId` → `context.tenantId`) in that consumer, commit it as a blocker-fix with a `[WS-2 §6 blocker]` note, and re-run. Do **not** broaden into a full `parseSubject` conversion (that stays in WS-3). If a scenario flakes (fail→pass), pull CloudWatch evidence from the failing window and re-run a confirmation pass before continuing ([[feedback-flake-means-broken]]).

- [ ] **Step 5: Commit any §6 blocker-fixes** (only if Step 4 required them)

```bash
git add -A && git commit --no-verify -m "fix(<svc>): WS-2 §6 blocker — read identity from context not subject"
```

---

## Task 11: Doc derivation + ship

- [ ] **Step 1: Regenerate touched service cards**

The Egress `eventTypes` (event names) are unchanged, so the cards' "Emits" sections hold, but the
publisher now declares typed subjects. Run the doc-derivation detector and regenerate any flagged
card:
```bash
node .claude/skills/backlog-next/detect-doc-derivation.mjs
```
Run the `audit-service <svc>` skill for any service it flags; commit regenerated cards in this workstream.

- [ ] **Step 2: Self-review — every emitted `__typename` is covered-or-exempt**

Run:
```bash
for f in $(find services -name 'event-publisher.ts' -path '*/handlers/*'); do grep -q 'changeDataCapture({' "$f" || echo "NOT TYPED: $f"; done
```
Expected: no output (all 21 publishers are in typed mode).

- [ ] **Step 3: Ship the backlog file**

Edit `docs/backlog/cdc-publisher-typed-subjects.md` → `status: shipped`, fill `validation_gate:`
with the deploy log line + the contract-emission/DRY-wire e2e command output + the affected-test
SHA. Commit.

- [ ] **Step 4: Regenerate the index**

```bash
node .claude/skills/backlog-lint/lint.mjs --fix
git add docs/ && git commit --no-verify -m "docs(backlog): ship cdc-publisher-typed-subjects (WS-2)"
```

- [ ] **Step 5: Route to `superpowers:finishing-a-development-branch`** for merge / PR / cleanup (do not merge manually). After local-merge, `git push origin main`.

---

## Out of scope (mirrors the spec)

- WS-3 consumer `parseSubject` conversions (except the Decision-4 minimal surgical read-fix).
- Authoring the ~14 advisory-core agent-internal contracts (→ `advisory-agent-event-contract-coverage`, rank 7).
- The enforcement-capstone lint rule banning bare `changeDataCapture()` (→ `typing-convention-enforcement-skills-docs`).
- Fixing latent producer drift bugs (`broker-funding-completed-normalization-drift`, etc.).
