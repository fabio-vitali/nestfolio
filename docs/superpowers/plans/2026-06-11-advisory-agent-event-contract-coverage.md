# Advisory agent-internal event contract coverage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Type every emitted advisory-core CDC `__typename` — author producer row-level zod contracts for the 6 consumer-having agent events and stop-emitting the 8 consumer-less telemetry events — so every advisory-core publisher's `exemptTypenames` drains to `[]`.

**Architecture:** A reusable `AgentCompletionRowSchema`/`AgentFailureRowSchema` generator in `@nestfolio/agent-orchestrator` produces the 4 `AgentCompletion`/`AgentFailure` row contracts from the existing per-service `agentOutput` schemas; 2 bespoke contracts (`ExplanationGenerated`, `AdvisoryStatus`) are authored in their producers' own `/contracts`; the 8 telemetry `__typename`s are removed from each service's CDK Egress `eventTypes` map and `exemptTypenames` (rows still persist; only the CDC emission stops). Validated by per-service publisher unit tests + the extended advisory `contract-emission` e2e gate against real emissions.

**Tech Stack:** TypeScript, zod, Nx, Jest, AWS CDK, DynamoDB Streams CDC (`@nestfolio/event-processor` `changeDataCapture`), EventBridge.

**Spec:** `docs/superpowers/specs/2026-06-11-advisory-agent-event-contract-coverage-design.md`

**Contract-home rule (load-bearing — Decision 3, corrected):** every producer defines its event-subject contract in its **own** `@nestfolio/<svc>/contracts` and the publisher imports from there (intra-service). The `advisory-adpt/domain` cross-domain re-export is **WS-3**, out of scope here.

---

## File Structure

**New code:**
- `libs/agent-orchestrator/src/agent-completion-row.ts` — **modify**: add `AgentCompletionRowSchema` + `AgentFailureRowSchema` (zod generators) alongside the existing TS generics.
- `libs/agent-orchestrator/src/index.ts` — **modify**: export the two generators.
- `services/advisory/portfolio-engine-ctrl/src/domain/contracts.ts` — **modify**: add `PortfolioAgentCompletionSchema` + `PortfolioAgentFailureSchema`.
- `services/advisory/advisory-narrative-ctrl/src/domain/contracts.ts` — **modify**: add `NarrativeAgentCompletionSchema` + `NarrativeAgentFailureSchema` + `ExplanationGeneratedSchema`.
- `services/advisory/advisory-bff/src/domain/contracts.ts` — **modify**: add `AdvisoryStatusSchema`.

**Publisher wiring + stop-emit (per service):**
- `services/advisory/{portfolio-engine-ctrl,advisory-narrative-ctrl,advisory-bff,investor-profile-ctrl,market-intelligence-ctrl,decision-workflow-ctrl,compliance-ctrl}/src/handlers/publisher-schemas.ts` — **modify**.
- `…/test/unit/publisher-schemas.test.ts` — **modify** (the `EMITTED` array).
- `…/src/service.stack.ts` — **modify** Egress `eventTypes` (the 6 stop-emit services only; AN is unchanged).

**Tests:**
- `libs/agent-orchestrator/test/agent-completion-row.test.ts` — **modify** (generator tests).
- `services/advisory/{portfolio-engine-ctrl,advisory-narrative-ctrl,advisory-bff}/test/unit/contracts.test.ts` — **create** (schema fidelity / parse tests).
- `apps/e2e-feature-tests/src/advisory/advisory-contract-emission.e2e.test.ts` — **modify** (4 new real-row assertions).

**No `service.stack.test.ts` edits needed** — verified the 6 advisory `service.stack.test.ts` use `Match.objectLike({ 'detail-type': Match.anyValue() })` and do NOT assert specific event names or `toMatchSnapshot`; removing Egress entries does not break them. (compliance-ctrl has no `service.stack.test.ts`.)

---

## Task 1: The reusable zod-schema generators (`@nestfolio/agent-orchestrator`)

**Files:**
- Modify: `libs/agent-orchestrator/src/agent-completion-row.ts`
- Modify: `libs/agent-orchestrator/src/index.ts:72-75`
- Test: `libs/agent-orchestrator/test/agent-completion-row.test.ts`

- [ ] **Step 1: Confirm `zod` resolves in agent-orchestrator**

Run: `cd /Users/fabiovitali/WebstormProjects/nestfolio/.claude/worktrees/advisory-agent-event-contract-coverage && node -e "require.resolve('zod', {paths:['libs/agent-orchestrator']}); console.log('zod OK')"`
Expected: `zod OK` (zod is already a transitive workspace dep used by structured-output validation). If it errors, add `zod` to `libs/agent-orchestrator/package.json` deps before proceeding.

- [ ] **Step 2: Write the failing generator tests**

Append to `libs/agent-orchestrator/test/agent-completion-row.test.ts`:

```ts
import { z } from 'zod';
import { AgentCompletionRowSchema, AgentFailureRowSchema } from '../src/agent-completion-row';

describe('AgentCompletionRowSchema / AgentFailureRowSchema generators', () => {
  const OutputSchema = z.object({ score: z.number() });
  const PortfolioCompletion = AgentCompletionRowSchema('portfolio-engine', OutputSchema);
  const PortfolioFailure = AgentFailureRowSchema('portfolio-engine');

  const fullRow = {
    pk: 'AgentCompletion#d1', sk: 'AgentCompletion#portfolio-engine', __typename: 'AgentCompletion',
    decisionId: 'd1', tenantId: 't1', agentName: 'portfolio-engine', taskToken: 'tok',
    agentOutput: { score: 0.9 }, completedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z',
  };

  it('parses a full AgentCompletion row into the DRY subject (envelope + tenantId stripped)', () => {
    const subject = PortfolioCompletion.parse(fullRow);
    expect(subject).toEqual({
      decisionId: 'd1', agentName: 'portfolio-engine', taskToken: 'tok',
      agentOutput: { score: 0.9 }, completedAt: '2026-01-01T00:00:00Z',
    });
    const s = subject as Record<string, unknown>;
    expect(s.pk).toBeUndefined();
    expect(s.sk).toBeUndefined();
    expect(s.__typename).toBeUndefined();
    expect(s.tenantId).toBeUndefined();
    expect(s.createdAt).toBeUndefined();
  });

  it('rejects a mismatched agentName (z.literal tripwire)', () => {
    expect(() => PortfolioCompletion.parse({ ...fullRow, agentName: 'wrong-agent' })).toThrow();
  });

  it('rejects a drifted agentOutput', () => {
    expect(() => PortfolioCompletion.parse({ ...fullRow, agentOutput: { score: 'NaN' } })).toThrow();
  });

  it('AgentFailureRowSchema parses the failure row into the DRY subject', () => {
    const subject = PortfolioFailure.parse({
      pk: 'AgentFailure#d1', sk: 'AgentFailure#portfolio-engine', __typename: 'AgentFailure',
      decisionId: 'd1', tenantId: 't1', agentName: 'portfolio-engine', taskToken: 'tok',
      errorType: 'SomeError', errorMessage: 'oops', failedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z',
    });
    expect(subject).toEqual({
      decisionId: 'd1', agentName: 'portfolio-engine', taskToken: 'tok',
      errorType: 'SomeError', errorMessage: 'oops', failedAt: '2026-01-01T00:00:00Z',
    });
  });

  it('type: inferred subject equals the AgentCompletionRow domain-field portion', () => {
    type Inferred = z.infer<typeof PortfolioCompletion>;
    type RowDomain = Pick<
      import('../src/agent-completion-row').AgentCompletionRow<'portfolio-engine', { score: number }>,
      'decisionId' | 'agentName' | 'taskToken' | 'agentOutput' | 'completedAt'
    >;
    const a = {} as Inferred;
    const b: RowDomain = a; // compile error if shapes diverge
    const c: Inferred = b;  // compile error in the other direction
    void c;
    expect(typeof b).toBe('object');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm nx test agent-orchestrator --testPathPatterns agent-completion-row`
Expected: FAIL — `AgentCompletionRowSchema is not a function` (export does not exist yet).

- [ ] **Step 4: Implement the generators**

In `libs/agent-orchestrator/src/agent-completion-row.ts`, change the top import line and append the generators:

```ts
import { z } from 'zod';
import type { TableEntry } from '@nestfolio/event-processor';
```

(append after the existing `AgentFailureRow` type, at end of file:)

```ts
/**
 * Row-level zod contract for a task-token agent's SUCCESS callback row (the `AgentCompletion`
 * row CDC-emitted as `<AGENT>_COMPLETED`). Wraps the per-service `agentOutput` schema into the
 * full DRY subject: `Schema.parse(row)` strips the TableEntry envelope (pk/sk/__typename/
 * createdAt/…) and `tenantId` (→ event context), leaving `{ decisionId, agentName, taskToken,
 * agentOutput, completedAt }`. `taskToken` stays — the DWC consumer needs it for SendTaskSuccess.
 * `agentName` is `z.literal(agentName)` so a mis-keyed row fails the parse (a useful tripwire).
 */
export const AgentCompletionRowSchema = <A extends string, S extends z.ZodTypeAny>(
  agentName: A,
  agentOutput: S,
) =>
  z.object({
    decisionId: z.string(),
    agentName: z.literal(agentName),
    taskToken: z.string(),
    agentOutput,
    completedAt: z.string(),
  });

/** Row-level zod contract for a task-token agent's FAILURE callback row (`AgentFailure` row,
 *  CDC-emitted as `<AGENT>_FAILED`). DRY subject — envelope + tenantId stripped on parse. */
export const AgentFailureRowSchema = <A extends string>(agentName: A) =>
  z.object({
    decisionId: z.string(),
    agentName: z.literal(agentName),
    taskToken: z.string(),
    errorType: z.string(),
    errorMessage: z.string(),
    failedAt: z.string(),
  });
```

- [ ] **Step 5: Export the generators from the barrel**

In `libs/agent-orchestrator/src/index.ts`, replace the block at lines 72-75:

```ts
export {
  agentCompletionPk, agentCompletionSk, agentFailurePk, agentFailureSk,
  AgentCompletionRowSchema, AgentFailureRowSchema,
} from './agent-completion-row';
export type { AgentCompletionRow, AgentFailureRow } from './agent-completion-row';
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm nx test agent-orchestrator --testPathPatterns agent-completion-row`
Expected: PASS (all generator + helper tests green).

- [ ] **Step 7: Commit**

```bash
git add libs/agent-orchestrator/src/agent-completion-row.ts libs/agent-orchestrator/src/index.ts libs/agent-orchestrator/test/agent-completion-row.test.ts
git commit --no-verify -m "feat(agent-orchestrator): AgentCompletionRowSchema/AgentFailureRowSchema generators"
```

(Verify it landed: `git log --oneline -1`.)

---

## Task 2: portfolio-engine-ctrl — completion/failure contracts + drain exempt

**Files:**
- Modify: `services/advisory/portfolio-engine-ctrl/src/domain/contracts.ts`
- Create: `services/advisory/portfolio-engine-ctrl/test/unit/contracts.test.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/src/handlers/publisher-schemas.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/test/unit/publisher-schemas.test.ts:3`
- Modify: `services/advisory/portfolio-engine-ctrl/src/service.stack.ts:62-67`

- [ ] **Step 1: Write the failing contract type-fidelity test**

Create `services/advisory/portfolio-engine-ctrl/test/unit/contracts.test.ts`:

```ts
import { PortfolioAgentCompletionSchema, PortfolioAgentFailureSchema } from '../../src/domain/contracts';
import type { PortfolioAgentCompletionRow, PortfolioAgentFailureRow } from '../../src/domain/models';
import type { z } from 'zod';

describe('portfolio-engine-ctrl AgentCompletion/AgentFailure contracts', () => {
  it('rejects a mismatched agentName literal', () => {
    expect(() => PortfolioAgentCompletionSchema.parse({
      decisionId: 'd', agentName: 'advisory-narrative', taskToken: 't',
      agentOutput: {}, completedAt: 'x',
    })).toThrow();
  });

  it('type: PortfolioAgentCompletion equals the AgentCompletion row domain fields', () => {
    type Inferred = z.infer<typeof PortfolioAgentCompletionSchema>;
    type RowDomain = Pick<PortfolioAgentCompletionRow, 'decisionId' | 'agentName' | 'taskToken' | 'agentOutput' | 'completedAt'>;
    const a = {} as Inferred; const b: RowDomain = a; const c: Inferred = b; void c;
    expect(typeof b).toBe('object');
  });

  it('type: PortfolioAgentFailure equals the AgentFailure row domain fields', () => {
    type Inferred = z.infer<typeof PortfolioAgentFailureSchema>;
    type RowDomain = Pick<PortfolioAgentFailureRow, 'decisionId' | 'agentName' | 'taskToken' | 'errorType' | 'errorMessage' | 'failedAt'>;
    const a = {} as Inferred; const b: RowDomain = a; const c: Inferred = b; void c;
    expect(typeof b).toBe('object');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm nx test portfolio-engine-ctrl --testPathPatterns contracts`
Expected: FAIL — `PortfolioAgentCompletionSchema` is not exported.

- [ ] **Step 3: Add the contracts**

Append to `services/advisory/portfolio-engine-ctrl/src/domain/contracts.ts`:

```ts
import { AgentCompletionRowSchema, AgentFailureRowSchema } from '@nestfolio/agent-orchestrator';

/** PORTFOLIO_COMPLETED — the AgentCompletion row subject (agentOutput = PortfolioAgentOutput). */
export const PortfolioAgentCompletionSchema = AgentCompletionRowSchema('portfolio-engine', PortfolioAgentOutputSchema);
export type PortfolioAgentCompletion = z.infer<typeof PortfolioAgentCompletionSchema>;

/** PORTFOLIO_FAILED — the AgentFailure row subject. */
export const PortfolioAgentFailureSchema = AgentFailureRowSchema('portfolio-engine');
export type PortfolioAgentFailure = z.infer<typeof PortfolioAgentFailureSchema>;
```

- [ ] **Step 4: Run to verify the contract test passes**

Run: `pnpm nx test portfolio-engine-ctrl --testPathPatterns contracts`
Expected: PASS.

- [ ] **Step 5: Wire the publisher registry + drain exempt**

Replace `services/advisory/portfolio-engine-ctrl/src/handlers/publisher-schemas.ts` entirely with:

```ts
import { PortfolioAgentCompletionSchema, PortfolioAgentFailureSchema } from '../domain/contracts';

export const subjectSchemas = {
  AgentCompletion: PortfolioAgentCompletionSchema,
  AgentFailure: PortfolioAgentFailureSchema,
};

export const exemptTypenames: string[] = [];
```

- [ ] **Step 6: Update the publisher-schemas completeness test**

In `services/advisory/portfolio-engine-ctrl/test/unit/publisher-schemas.test.ts`, replace line 3:

```ts
const EMITTED = ['AgentCompletion', 'AgentFailure'];
```

- [ ] **Step 7: Stop-emit AgentInvocation + ReasoningOutput in the CDK Egress**

In `services/advisory/portfolio-engine-ctrl/src/service.stack.ts`, the Egress `eventTypes` map (lines 62-67) becomes:

```ts
      eventTypes: {
        'AgentCompletion': { insert: PortfolioEngineEventTypes.PORTFOLIO_COMPLETED },
        'AgentFailure':    { insert: PortfolioEngineEventTypes.PORTFOLIO_FAILED },
      },
```

(Remove the `'AgentInvocation'` and `'ReasoningOutput'` lines. The `AgentInvocation`/`ReasoningOutput` rows are still written to DDB by the handler — only their CDC emission stops.)

- [ ] **Step 8: Run the service's unit suite**

Run: `pnpm nx test portfolio-engine-ctrl`
Expected: PASS (contracts test, publisher-schemas registry test with `EMITTED=['AgentCompletion','AgentFailure']`, service.stack test unaffected).

- [ ] **Step 8b: Fix integration tests that assert the now-stopped emission** (added during execution — surfaced by Task 2 code review)

Two integration tests assert/await `PORTFOLIO_CONSTRUCTION_PROPOSED`, which no longer emits:
- `test/integration/portfolio-engine-ctrl.integration.test.ts` — **hard assertion** (`trap.deploy` detailType array line 73 + the `waitForEvent({detailType:'PORTFOLIO_CONSTRUCTION_PROPOSED'})` + `expect(...).toBe('PORTFOLIO_CONSTRUCTION_PROPOSED')` at lines 115-119). Remove the `'PORTFOLIO_CONSTRUCTION_PROPOSED'` entry from the line-73 array, and delete the lines-115-119 CDC-verification block (keep the preceding AgentInvocation row-status assertion — the `AgentInvocation` ROW is still written; only its CDC emission stopped).
- `test/integration/portfolio-engine-ctrl.resilience.integration.test.ts` — best-effort `waitForEvent` in try/catch (lines ~156/180/213/250). Switch every `PORTFOLIO_CONSTRUCTION_PROPOSED` reference there to `PORTFOLIO_COMPLETED` (still emitted, the meaningful completion signal) so the best-effort CDC check stays live instead of waiting for an event that can never fire.

(These run on the `test-integration` target against deployed dev, not in the `test` unit suite — they will not surface until Task 11, but fix them here with the change that caused them.) Do not run the integration suite locally (needs deployed dev); a `tsc`/lint check is enough.

- [ ] **Step 9: Commit**

```bash
git add services/advisory/portfolio-engine-ctrl
git commit --no-verify -m "feat(portfolio-engine-ctrl): type AgentCompletion/AgentFailure, stop-emit telemetry"
```

---

## Task 3: advisory-narrative-ctrl — completion/failure + ExplanationGenerated contracts

**Files:**
- Modify: `services/advisory/advisory-narrative-ctrl/src/domain/contracts.ts`
- Create: `services/advisory/advisory-narrative-ctrl/test/unit/contracts.test.ts`
- Modify: `services/advisory/advisory-narrative-ctrl/src/handlers/publisher-schemas.ts`
- Modify: `services/advisory/advisory-narrative-ctrl/test/unit/publisher-schemas.test.ts:3` (exempt only — `EMITTED` already correct)

> AN is **not** a stop-emit service: all 3 of its `__typename`s (`ReasoningOutput`→`EXPLANATION_GENERATED`, `AgentCompletion`→`NARRATIVE_COMPLETED`, `AgentFailure`→`NARRATIVE_FAILED`) are consumer-having and get typed. No `service.stack.ts` change.

- [ ] **Step 1: Write the failing contract tests**

Create `services/advisory/advisory-narrative-ctrl/test/unit/contracts.test.ts`:

```ts
import {
  NarrativeAgentCompletionSchema, NarrativeAgentFailureSchema, ExplanationGeneratedSchema,
} from '../../src/domain/contracts';
import type { NarrativeAgentCompletionRow, NarrativeAgentFailureRow } from '../../src/domain/models';
import type { z } from 'zod';

describe('advisory-narrative-ctrl contracts', () => {
  it('rejects a mismatched agentName literal on the completion schema', () => {
    expect(() => NarrativeAgentCompletionSchema.parse({
      decisionId: 'd', agentName: 'portfolio-engine', taskToken: 't', agentOutput: {}, completedAt: 'x',
    })).toThrow();
  });

  it('type: NarrativeAgentCompletion equals the AgentCompletion row domain fields', () => {
    type Inferred = z.infer<typeof NarrativeAgentCompletionSchema>;
    type RowDomain = Pick<NarrativeAgentCompletionRow, 'decisionId' | 'agentName' | 'taskToken' | 'agentOutput' | 'completedAt'>;
    const a = {} as Inferred; const b: RowDomain = a; const c: Inferred = b; void c;
    expect(typeof b).toBe('object');
  });

  it('type: NarrativeAgentFailure equals the AgentFailure row domain fields', () => {
    type Inferred = z.infer<typeof NarrativeAgentFailureSchema>;
    type RowDomain = Pick<NarrativeAgentFailureRow, 'decisionId' | 'agentName' | 'taskToken' | 'errorType' | 'errorMessage' | 'failedAt'>;
    const a = {} as Inferred; const b: RowDomain = a; const c: Inferred = b; void c;
    expect(typeof b).toBe('object');
  });

  it('ExplanationGenerated parses the real ReasoningOutput row shape (envelope stripped)', () => {
    // Real row: buildCdcItem('ReasoningOutput', {pk,sk}, ctx,
    //   { invocationId, decisionId, ...explainability, createdAt }) — see agent-service.ts:127-131.
    const subject = ExplanationGeneratedSchema.parse({
      pk: 'DECISION#d1', sk: 'REASONING#e1', __typename: 'ReasoningOutput', tenantId: 't1',
      invocationId: 'e1', decisionId: 'd1',
      summary: 'A clear summary.', rationale: 'Because diversification.',
      keyFactors: ['risk', 'horizon'], tone: 'reassuring', wordCount: 42, confidence: 0.8,
      createdAt: '2026-01-01T00:00:00Z',
    });
    const s = subject as Record<string, unknown>;
    expect(s.pk).toBeUndefined();
    expect(s.__typename).toBeUndefined();
    expect(s.tenantId).toBeUndefined();
    expect(s.decisionId).toBe('d1');
    expect(s.invocationId).toBe('e1');
  });
});
```

> **Note:** the `keyFactors`/`tone`/`wordCount`/`confidence` fields above mirror the `ExplainabilitySchema` shape documented on the advisory-narrative-ctrl card. If `ExplainabilitySchema` (`src/agents/schemas.ts`) differs, adjust the fixture to a value that `ExplainabilitySchema` accepts — the schema is `ExplainabilitySchema.extend({ invocationId, decisionId })`, so the explainability fields must satisfy the real `ExplainabilitySchema`. The closing e2e validates against the REAL emitted row.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm nx test advisory-narrative-ctrl --testPathPatterns contracts`
Expected: FAIL — the three schemas are not exported.

- [ ] **Step 3: Add the contracts**

Append to `services/advisory/advisory-narrative-ctrl/src/domain/contracts.ts`:

```ts
import { AgentCompletionRowSchema, AgentFailureRowSchema } from '@nestfolio/agent-orchestrator';

/** NARRATIVE_COMPLETED — the AgentCompletion row subject (agentOutput = NarrativeAgentOutput). */
export const NarrativeAgentCompletionSchema = AgentCompletionRowSchema('advisory-narrative', NarrativeAgentOutputSchema);
export type NarrativeAgentCompletion = z.infer<typeof NarrativeAgentCompletionSchema>;

/** NARRATIVE_FAILED — the AgentFailure row subject. */
export const NarrativeAgentFailureSchema = AgentFailureRowSchema('advisory-narrative');
export type NarrativeAgentFailure = z.infer<typeof NarrativeAgentFailureSchema>;

/**
 * EXPLANATION_GENERATED — the ReasoningOutput row subject (DRY). The row is
 * `{ invocationId, decisionId, ...explainability }` (+ envelope); identity travels in context.
 * (Built by agent-service.ts:127 via buildCdcItem('ReasoningOutput', …).)
 */
export const ExplanationGeneratedSchema = ExplainabilitySchema.extend({
  invocationId: z.string(),
  decisionId: z.string(),
});
export type ExplanationGenerated = z.infer<typeof ExplanationGeneratedSchema>;
```

(`ExplainabilitySchema` is already imported at line 6.)

- [ ] **Step 4: Run to verify the contract test passes**

Run: `pnpm nx test advisory-narrative-ctrl --testPathPatterns contracts`
Expected: PASS. If the `ExplanationGenerated` parse fails, reconcile the fixture with the real `ExplainabilitySchema` (Step 1 note).

- [ ] **Step 5: Wire the publisher registry + drain exempt**

Replace `services/advisory/advisory-narrative-ctrl/src/handlers/publisher-schemas.ts` entirely with:

```ts
import {
  ExplanationGeneratedSchema, NarrativeAgentCompletionSchema, NarrativeAgentFailureSchema,
} from '../domain/contracts';

export const subjectSchemas = {
  ReasoningOutput: ExplanationGeneratedSchema,
  AgentCompletion: NarrativeAgentCompletionSchema,
  AgentFailure: NarrativeAgentFailureSchema,
};

export const exemptTypenames: string[] = [];
```

- [ ] **Step 6: Update the publisher-schemas completeness test**

In `services/advisory/advisory-narrative-ctrl/test/unit/publisher-schemas.test.ts`, line 3 already reads `['ReasoningOutput', 'AgentCompletion', 'AgentFailure']` — **leave it**. The test now passes because `subjectSchemas` covers all three and `exemptTypenames` is empty (the registry-equality assertion still holds).

- [ ] **Step 7: Run the service's unit suite**

Run: `pnpm nx test advisory-narrative-ctrl`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add services/advisory/advisory-narrative-ctrl
git commit --no-verify -m "feat(advisory-narrative-ctrl): type ReasoningOutput/AgentCompletion/AgentFailure rows"
```

---

## Task 4: advisory-bff — AdvisoryStatus contract + stop-emit UserInteraction

**Files:**
- Modify: `services/advisory/advisory-bff/src/domain/contracts.ts`
- Create: `services/advisory/advisory-bff/test/unit/contracts.test.ts`
- Modify: `services/advisory/advisory-bff/src/handlers/publisher-schemas.ts`
- Modify: `services/advisory/advisory-bff/test/unit/publisher-schemas.test.ts:3`
- Modify: `services/advisory/advisory-bff/src/service.stack.ts:48-51`

- [ ] **Step 1: Write the failing AdvisoryStatus parse test**

Create `services/advisory/advisory-bff/test/unit/contracts.test.ts`:

```ts
import { AdvisoryStatusSchema } from '../../src/domain/contracts';

describe('advisory-bff AdvisoryStatus contract', () => {
  it('parses the real AdvisoryStatus row (DRY — tenantId + envelope stripped, __version retained)', () => {
    // Real row: update('AdvisoryStatus', { tenantId, inFlightCount, generatingCount, failedCount,
    //   oldestGeneratingAt }, { add: { __version: 1 }, overrides: { pk:`T#${tenantId}`, sk:'AdvisoryStatus' }})
    // — see handlers/advisory-status-projector.ts:63-67.
    const subject = AdvisoryStatusSchema.parse({
      pk: 'T#tenant-1', sk: 'AdvisoryStatus', __typename: 'AdvisoryStatus', tenantId: 'tenant-1',
      inFlightCount: 2, generatingCount: 1, failedCount: 0, oldestGeneratingAt: '2026-01-01T00:00:00Z',
      __version: 5, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:01Z',
    });
    expect(subject).toEqual({
      inFlightCount: 2, generatingCount: 1, failedCount: 0,
      oldestGeneratingAt: '2026-01-01T00:00:00Z', __version: 5,
    });
    expect((subject as Record<string, unknown>).tenantId).toBeUndefined();
    expect((subject as Record<string, unknown>).pk).toBeUndefined();
  });

  it('accepts a null oldestGeneratingAt (no GENERATING decisions)', () => {
    const subject = AdvisoryStatusSchema.parse({
      inFlightCount: 0, generatingCount: 0, failedCount: 0, oldestGeneratingAt: null, __version: 1,
    });
    expect(subject.oldestGeneratingAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm nx test advisory-bff --testPathPatterns contracts`
Expected: FAIL — `AdvisoryStatusSchema` is not exported.

- [ ] **Step 3: Add the contract**

Append to `services/advisory/advisory-bff/src/domain/contracts.ts` (the file already imports `z`):

```ts
/**
 * ADVISORY_STATUS_UPDATED — advisory-bff's command-owned AdvisoryStatus aggregate (DRY subject).
 * `__version` is RETAINED in the subject: dashboard-bff projects this row P3 keyed on the carried
 * `__version` (see advisory-status-projector.ts). `oldestGeneratingAt` is the min GENERATING
 * createdAt, or null. Identity (tenantId) + envelope travel in context, not the subject.
 */
export const AdvisoryStatusSchema = z.object({
  inFlightCount: z.number(),
  generatingCount: z.number(),
  failedCount: z.number(),
  oldestGeneratingAt: z.string().nullable(),
  __version: z.number(),
});
export type AdvisoryStatus = z.infer<typeof AdvisoryStatusSchema>;
```

- [ ] **Step 4: Run to verify the contract test passes**

Run: `pnpm nx test advisory-bff --testPathPatterns contracts`
Expected: PASS.

- [ ] **Step 5: Wire the publisher registry + drain exempt**

Replace `services/advisory/advisory-bff/src/handlers/publisher-schemas.ts` entirely with:

```ts
import {
  DecisionReadModelSchema, UserConfirmationSchema, UserRejectionSchema, AdvisoryStatusSchema,
} from '../domain/contracts';

export const subjectSchemas = {
  DecisionReadModel: DecisionReadModelSchema,
  UserConfirmation: UserConfirmationSchema,
  UserRejection: UserRejectionSchema,
  AdvisoryStatus: AdvisoryStatusSchema,
};

export const exemptTypenames: string[] = [];
```

- [ ] **Step 6: Update the publisher-schemas completeness test**

In `services/advisory/advisory-bff/test/unit/publisher-schemas.test.ts`, replace line 3:

```ts
const EMITTED = ['DecisionReadModel', 'AdvisoryStatus', 'UserConfirmation', 'UserRejection'];
```

- [ ] **Step 7: Stop-emit UserInteraction in the CDK Egress**

In `services/advisory/advisory-bff/src/service.stack.ts`, remove the `'UserInteraction'` block (lines 48-51). The `eventTypes` map keeps `DecisionReadModel`, `AdvisoryStatus`, `UserConfirmation`, `UserRejection`:

```ts
      eventTypes: {
        'DecisionReadModel': {
          insert: AdvisoryBffEventTypes.DECISION_READ_MODEL_CREATED,
          modify: AdvisoryBffEventTypes.DECISION_READ_MODEL_UPDATED,
        },
        'AdvisoryStatus': {
          insert: AdvisoryBffEventTypes.ADVISORY_STATUS_UPDATED,
          modify: AdvisoryBffEventTypes.ADVISORY_STATUS_UPDATED,
        },
        'UserConfirmation': { insert: AdvisoryBffEventTypes.USER_CONFIRMED },
        'UserRejection': { insert: AdvisoryBffEventTypes.USER_REJECTED },
      },
```

(The `UserInteraction` row — if ever written — still persists; `USER_INTERACTION_CREATED`/`USER_INTERACTION_UPDATED` simply stop emitting.)

- [ ] **Step 8: Run the service's unit suite**

Run: `pnpm nx test advisory-bff`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add services/advisory/advisory-bff
git commit --no-verify -m "feat(advisory-bff): type AdvisoryStatus, stop-emit UserInteraction"
```

---

## Task 5: investor-profile-ctrl — stop-emit AgentInvocation + ReasoningOutput

**Files:**
- Modify: `services/advisory/investor-profile-ctrl/src/handlers/publisher-schemas.ts:7`
- Modify: `services/advisory/investor-profile-ctrl/test/unit/publisher-schemas.test.ts:3`
- Modify: `services/advisory/investor-profile-ctrl/src/service.stack.ts:58-59`

- [ ] **Step 1: Re-confirm zero consumers (the spec's per-event gate)**

Run: `cd /Users/fabiovitali/WebstormProjects/nestfolio/.claude/worktrees/advisory-agent-event-contract-coverage && grep -rn "GOAL_INTERPRETATION_PRODUCED\|RISK_EVALUATION_PRODUCED" services/ flows/ | grep -v "investor-profile-ctrl/src\|/test/"`
Expected: no consumer hits (only the producer's own declaration). If any consumer or flow-spec hit appears, STOP — do not stop-emit that event; file a finding.

- [ ] **Step 2: Drain the exempt registry**

In `services/advisory/investor-profile-ctrl/src/handlers/publisher-schemas.ts`, replace line 7:

```ts
export const exemptTypenames: string[] = [];
```

- [ ] **Step 3: Update the completeness test**

In `services/advisory/investor-profile-ctrl/test/unit/publisher-schemas.test.ts`, replace line 3:

```ts
const EMITTED = ['InvestorProfileSnapshot'];
```

- [ ] **Step 4: Stop-emit in the CDK Egress**

In `services/advisory/investor-profile-ctrl/src/service.stack.ts`, remove lines 58-59 (`'AgentInvocation'` → `GOAL_INTERPRETATION_PRODUCED` and `'ReasoningOutput'` → `RISK_EVALUATION_PRODUCED`), leaving only the `InvestorProfileSnapshot` mapping.

- [ ] **Step 5: Run + commit**

Run: `pnpm nx test investor-profile-ctrl`
Expected: PASS.

```bash
git add services/advisory/investor-profile-ctrl
git commit --no-verify -m "feat(investor-profile-ctrl): stop-emit GOAL_INTERPRETATION_PRODUCED + RISK_EVALUATION_PRODUCED"
```

---

## Task 6: market-intelligence-ctrl — stop-emit AgentInvocation

**Files:**
- Modify: `services/advisory/market-intelligence-ctrl/src/handlers/publisher-schemas.ts:7`
- Modify: `services/advisory/market-intelligence-ctrl/test/unit/publisher-schemas.test.ts:3`
- Modify: `services/advisory/market-intelligence-ctrl/src/service.stack.ts:64`

- [ ] **Step 1: Re-confirm zero consumers**

Run: `cd /Users/fabiovitali/WebstormProjects/nestfolio/.claude/worktrees/advisory-agent-event-contract-coverage && grep -rn "MARKET_SIGNAL_DETECTED" services/ flows/ | grep -v "market-intelligence-ctrl/src\|/test/"`
Expected: no consumer hits. If any appear, STOP and file a finding.

- [ ] **Step 2: Drain exempt** — replace `services/advisory/market-intelligence-ctrl/src/handlers/publisher-schemas.ts:7`:

```ts
export const exemptTypenames: string[] = [];
```

- [ ] **Step 3: Update the test** — replace `services/advisory/market-intelligence-ctrl/test/unit/publisher-schemas.test.ts:3`:

```ts
const EMITTED = ['MarketSnapshot'];
```

- [ ] **Step 4: Stop-emit in CDK** — in `services/advisory/market-intelligence-ctrl/src/service.stack.ts`, remove line 64 (`'AgentInvocation'` → `MARKET_SIGNAL_DETECTED`), leaving only `MarketSnapshot`.

- [ ] **Step 5: Run + commit**

Run: `pnpm nx test market-intelligence-ctrl`
Expected: PASS.

```bash
git add services/advisory/market-intelligence-ctrl
git commit --no-verify -m "feat(market-intelligence-ctrl): stop-emit MARKET_SIGNAL_DETECTED"
```

---

## Task 7: decision-workflow-ctrl — stop-emit AgentOutput

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/handlers/publisher-schemas.ts:8`
- Modify: `services/advisory/decision-workflow-ctrl/test/unit/publisher-schemas.test.ts:3`
- Modify: `services/advisory/decision-workflow-ctrl/src/service.stack.ts:227-230`

- [ ] **Step 1: Re-confirm zero consumers**

Run: `cd /Users/fabiovitali/WebstormProjects/nestfolio/.claude/worktrees/advisory-agent-event-contract-coverage && grep -rn "AGENT_OUTPUT_CREATED\|AGENT_OUTPUT_UPDATED" services/ flows/ | grep -v "decision-workflow-ctrl/src\|/test/"`
Expected: no consumer hits. If any appear, STOP and file a finding. (The `AgentOutput` row itself stays written by `sfn-callback.ts`; only its CDC emission stops.)

- [ ] **Step 2: Drain exempt** — replace the `exemptTypenames` line in `services/advisory/decision-workflow-ctrl/src/handlers/publisher-schemas.ts`:

```ts
export const exemptTypenames: string[] = [];
```

- [ ] **Step 3: Update the test** — replace `services/advisory/decision-workflow-ctrl/test/unit/publisher-schemas.test.ts:3`:

```ts
const EMITTED = ['DecisionPacket', 'MandateSnapshot'];
```

- [ ] **Step 4: Stop-emit in CDK** — in `services/advisory/decision-workflow-ctrl/src/service.stack.ts`, remove the `'AgentOutput'` block (lines 227-230). The `eventTypes` map keeps `DecisionPacket` and `MandateSnapshot`.

- [ ] **Step 4b: Fix the integration test referencing AGENT_OUTPUT_CREATED** (added during execution — same gap class as Task 2)

`test/integration/decision-workflow-ctrl.integration.test.ts` lists `'AGENT_OUTPUT_CREATED'` in a `trap.deploy({ detailType: [...] })` array (around line 109). Read the file and check whether any `waitForEvent`/`expect` HARD-asserts `AGENT_OUTPUT_CREATED`:
- If a hard assertion exists, delete it (the `AgentOutput` row is still written by `sfn-callback.ts`; only its CDC emission stopped).
- Remove `'AGENT_OUTPUT_CREATED'` from the `trap.deploy` detailType array regardless (no longer emitted).
- Keep `DECISION_PACKET_CREATED`/`DECISION_PACKET_UPDATED` (still emitted).
Do not run the integration suite locally; a `tsc`/lint check suffices.

- [ ] **Step 5: Run + commit**

Run: `pnpm nx test decision-workflow-ctrl`
Expected: PASS.

```bash
git add services/advisory/decision-workflow-ctrl
git commit --no-verify -m "feat(decision-workflow-ctrl): stop-emit AGENT_OUTPUT_CREATED/UPDATED"
```

---

## Task 8: compliance-ctrl — stop-emit AuditArtifact

**Files:**
- Modify: `services/advisory/compliance-ctrl/src/handlers/publisher-schemas.ts:7`
- Modify: `services/advisory/compliance-ctrl/test/unit/publisher-schemas.test.ts:3`
- Modify: `services/advisory/compliance-ctrl/src/service.stack.ts:32-35`

- [ ] **Step 1: Re-confirm zero consumers**

Run: `cd /Users/fabiovitali/WebstormProjects/nestfolio/.claude/worktrees/advisory-agent-event-contract-coverage && grep -rn "AUDIT_ARTIFACT_CREATED\|AUDIT_ARTIFACT_UPDATED" services/ flows/ | grep -v "compliance-ctrl/src\|/test/"`
Expected: no consumer hits. If any appear, STOP and file a finding. (The `AuditArtifact` audit-log row stays written by `event-listener.ts`; only its CDC emission stops.)

- [ ] **Step 2: Drain exempt** — replace `services/advisory/compliance-ctrl/src/handlers/publisher-schemas.ts:7`:

```ts
export const exemptTypenames: string[] = [];
```

- [ ] **Step 3: Update the test** — replace `services/advisory/compliance-ctrl/test/unit/publisher-schemas.test.ts:3`:

```ts
const EMITTED = ['ComplianceCheck'];
```

- [ ] **Step 4: Stop-emit in CDK** — in `services/advisory/compliance-ctrl/src/service.stack.ts`, remove the `'AuditArtifact'` block (lines 32-35). The `eventTypes` map keeps only the `ComplianceCheck` field-dispatch.

- [ ] **Step 5: Run + commit**

Run: `pnpm nx test compliance-ctrl`
Expected: PASS.

```bash
git add services/advisory/compliance-ctrl
git commit --no-verify -m "feat(compliance-ctrl): stop-emit AUDIT_ARTIFACT_CREATED/UPDATED"
```

---

## Task 9: Extend the advisory contract-emission e2e gate (real-row assertions)

**Files:**
- Modify: `apps/e2e-feature-tests/src/advisory/advisory-contract-emission.e2e.test.ts`

> Typecheck/lint only here — execution is the closing-phase task (Task 11). The 4 new assertions ride the existing `Block A` real-decision-cycle `beforeAll` (no new fixtures). The 2 `*_FAILED` contracts are NOT e2e-asserted (the happy-path cycle produces no `AgentFailure` rows) — they are covered by Task 1's generator test + Tasks 2/3 type tests + tsc.

- [ ] **Step 1: Add imports**

After line 109 (the last adapter-contract import), add:

```ts
import { PortfolioAgentCompletionSchema } from '@nestfolio/portfolio-engine-ctrl/contracts';
import { NarrativeAgentCompletionSchema, ExplanationGeneratedSchema } from '@nestfolio/advisory-narrative-ctrl/contracts';
import { AdvisoryStatusSchema } from '@nestfolio/advisory-bff/contracts';
```

(No jest `moduleNameMapper` edit needed — these three `/contracts` subpaths are already mapped, the file already imports other exports from each.)

- [ ] **Step 2: Assert the WHOLE PE/AN AgentCompletion rows + the AN ReasoningOutput row**

In `it 2` (the `portfolio-engine-ctrl + advisory-narrative-ctrl AgentCompletion …` test), after the existing PE `agentOutput` assertion (line 313), add:

```ts
      // WS — whole-row AgentCompletion contract (PORTFOLIO_COMPLETED subject).
      expectContractMatch(PortfolioAgentCompletionSchema, peRow, 'PortfolioAgentCompletion (row)');
```

After the existing AN `agentOutput` assertion (line 330), add:

```ts
      // WS — whole-row AgentCompletion contract (NARRATIVE_COMPLETED subject).
      expectContractMatch(NarrativeAgentCompletionSchema, anRow, 'NarrativeAgentCompletion (row)');

      // WS — AN ReasoningOutput row (EXPLANATION_GENERATED subject). pk=DECISION#${decisionId},
      // sk begins_with 'REASONING#' (sk carries the agent eventId, not observable at e2e level).
      const anReasoning = await pollFor('AN ReasoningOutput', async () => {
        const r = await ddbDoc.send(new QueryCommand({
          TableName: anTable,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          ExpressionAttributeValues: { ':pk': `DECISION#${decisionId}`, ':sk': 'REASONING#' },
        }));
        const items = (r.Items ?? []) as Record<string, unknown>[];
        return items.length ? items : undefined;
      }, 60_000);
      anReasoning.forEach((row, i) =>
        expectContractMatch(ExplanationGeneratedSchema, row, `ExplanationGenerated[${i}]`));
```

(`QueryCommand` is already imported at line 97; `anTable` is already resolved earlier in the test.)

- [ ] **Step 3: Assert the AdvisoryStatus row**

In `it 1` (the `compliance-ctrl + decision-workflow-ctrl + advisory-bff …` test), after the `DecisionReadModel` assertion (line 283), add:

```ts
      // WS — advisory-bff AdvisoryStatus aggregate (ADVISORY_STATUS_UPDATED subject).
      // pk=T#${tenantId}, sk='AdvisoryStatus'. Recomputed by AdvisoryStatusProjector when the
      // DecisionReadModel row commits — so it exists once the decision has surfaced.
      const advisoryStatusRow = await pollFor('AdvisoryStatus', async () => {
        const r = await ddbDoc.send(new GetCommand({
          TableName: bffTable,
          Key: { pk: `T#${tenant.tenantId}`, sk: 'AdvisoryStatus' },
        }));
        return r.Item as Record<string, unknown> | undefined;
      }, 60_000);
      expectContractMatch(AdvisoryStatusSchema, advisoryStatusRow, 'AdvisoryStatus');
```

(`bffTable` is already resolved earlier in `it 1`. Adding two 60s polls keeps `it 1`'s poll-deadline sum within its 420s `it` timeout.)

- [ ] **Step 4: Typecheck + lint (no execution)**

Run: `pnpm nx run e2e-feature-tests:lint && pnpm nx run e2e-feature-tests:typecheck`
Expected: PASS. (If `typecheck` is not a target, run `pnpm tsc --noEmit -p apps/e2e-feature-tests/tsconfig.json`.)

- [ ] **Step 5: Commit**

```bash
git add apps/e2e-feature-tests/src/advisory/advisory-contract-emission.e2e.test.ts
git commit --no-verify -m "test(e2e): assert new advisory row contracts (completion rows, ExplanationGenerated, AdvisoryStatus)"
```

---

## Task 10: Workspace verification — build, lint, unit (no deploy)

- [ ] **Step 1: Affected build + lint + unit**

Run: `pnpm nx affected -t build,lint,test --base=origin/main`
Expected: PASS across agent-orchestrator + the 7 advisory-core services + any dependents. This is the pre-deploy gate (mirrors `/backlog-next` 6.2).

- [ ] **Step 2: If anything fails, fix forward**

Type errors most likely surface at the `z.infer`/`z.literal` boundary or a stale `agentName` literal. Re-run the failing project's `test`/`typecheck` until green. Do not proceed to deploy with a red affected run.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit --no-verify -m "fix: resolve affected build/lint/test for advisory contract coverage"
```

(Skip if Step 1 was already green.)

---

## Task 11: Closing — deploy, scoped e2e, drain-verify, ship

- [ ] **Step 1: Deploy the affected advisory-core services to dev**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-profile-ctrl,market-intelligence-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl,decision-workflow-ctrl,compliance-ctrl,advisory-bff 2>&1 | tee /tmp/advisory-coverage-deploy.log`
Expected: all 7 stacks deploy clean. The WS-2 cold-start completeness guard now asserts each publisher boots with `exemptTypenames: []` and every emitted `__typename` covered — a mis-wired registry fails cold-start here.

- [ ] **Step 2: Run the scoped advisory contract-emission e2e gate**

Run: `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPatterns advisory-contract-emission`
Expected: Block A green — the 6 covered events (incl. the new whole-row completion asserts, `ExplanationGenerated`, `AdvisoryStatus`) parse against the REAL emitted rows.

- [ ] **Step 3: Flake discipline**

If Block A fails-then-passes on rerun: it is the documented sandbox-maxVms flake ([[feedback-flake-means-broken]]). Pull CloudWatch evidence from the failing window (the IP-ctrl agent ingress / SQS redrive) BEFORE continuing, then run one confirmation pass. If the 4-agent cycle cannot complete under the sandbox quota at all, fall back to the unit layer (Tasks 1-8 green) + a captured-real-row check for the 2 bespoke contracts, and record that in the validation gate — mirroring how WS-1 shipped (see spec § "Known e2e risk").

- [ ] **Step 4: Verify the registries are fully drained**

Run: `cd /Users/fabiovitali/WebstormProjects/nestfolio/.claude/worktrees/advisory-agent-event-contract-coverage && grep -rH "exemptTypenames" services/advisory/{investor-profile-ctrl,market-intelligence-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl,decision-workflow-ctrl,compliance-ctrl,advisory-bff}/src/handlers/publisher-schemas.ts`
Expected: every line reads `export const exemptTypenames: string[] = [];` — the WS-2 advisory-core exemption set is empty.

- [ ] **Step 5: Ship the backlog file**

Set `docs/backlog/advisory-agent-event-contract-coverage.md` → `status: shipped`; fill `validation_gate:` with concrete evidence (the deploy log line, the e2e command + pass output, the drain-verify output, key commit SHAs). Commit.

- [ ] **Step 6: Regenerate the backlog index**

Run: `node .claude/skills/backlog-lint/lint.mjs --fix` then commit `docs/BACKLOG.md`.

- [ ] **Step 7: Regenerate the affected service cards**

The 7 advisory-core service cards reference the exempt set + Egress emissions in their `## Egress` / `publisher-schemas.ts` lines. Run `audit-service` for each changed service (or hand-update the `Exempt:` notes + Egress `Emits:` lists) so the cards match code, and commit. (Per `/backlog-next` 6.1 doc-derivation: source + derived ship together.)

- [ ] **Step 8: Hand off to `finishing-a-development-branch`** (Complex lane) for merge/PR + worktree cleanup.

---

## Self-Review

**Spec coverage:**
- §1 generator → Task 1. ✓
- §2 Part A 6 contracts → PE completion/failure (Task 2), AN completion/failure + ExplanationGenerated (Task 3), AdvisoryStatus (Task 4); the 2 `*_FAILED` are unit/type-covered (Task 1+2+3), noted in Task 9. ✓
- §3 Part B stop-emit 8 → PE+AN(none)+IP+MI+DWC+compliance+advisory-bff (Tasks 2,4,5,6,7,8). The 8 (producer×__typename): IP AgentInvocation+ReasoningOutput, MI AgentInvocation, PE AgentInvocation+ReasoningOutput, DWC AgentOutput, compliance AuditArtifact, advisory-bff UserInteraction. ✓
- §4 drain to `[]` → verified in each task + Task 11 Step 4. ✓
- §5 validation (unit + e2e real emission + maxVms flake discipline) → Tasks 1-8 unit, Task 9+11 e2e. ✓
- Contract-home rule (producer-own /contracts) → Tasks 2/3/4 all author in the producer's `domain/contracts.ts`. ✓

**Placeholder scan:** the one soft spot is the `ExplanationGenerated` test fixture's explainability fields (Task 3 Step 1) — flagged inline with the source to reconcile against (`ExplainabilitySchema`) and the closing e2e as the real-row backstop. No "TBD"/"implement later".

**Type consistency:** generator names `AgentCompletionRowSchema`/`AgentFailureRowSchema` are used identically in Tasks 1-3; per-service schema names (`PortfolioAgentCompletionSchema`, `NarrativeAgentCompletionSchema`, `ExplanationGeneratedSchema`, `AdvisoryStatusSchema`) are consistent between their authoring task, the publisher-schemas wiring, and the e2e imports (Task 9). `EMITTED` arrays match each service's post-edit `subjectSchemas ∪ exemptTypenames`.
