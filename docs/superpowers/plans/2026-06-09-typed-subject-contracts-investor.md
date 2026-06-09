# Typed-Subject Contracts — Investor Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Investor-domain producer aggregate has a producer-owned zod subject contract, validated against the REAL deployed emission by a scoped e2e gate — replicating the shipped `typed-subject-contracts-ledger` pattern.

**Architecture:** Add zod `<Name>Schema` + `type <Name>` contracts for each Investor CDC subject. Intra-domain / unconsumed subjects live in the producer service's `domain/contracts.ts`; cross-domain-consumed subjects live in `investor-adpt/domain/contracts.ts` (the `DepositInitiated`/`WithdrawalInitiated` + `ProposedTrade` precedent). Producer unit tests assert each schema parses a representative subject; a new `apps/e2e-feature-tests/src/investor/investor-contract-emission.e2e.test.ts` parses REAL persisted DDB rows against the contracts (`expectContractMatch`). Identity (tenantId/userId/region) is DRY — it travels in the event context, never on the subject (zod strips it).

**Tech Stack:** TypeScript, zod, `@nestfolio/event-processor` (`TableEntry`/`BusEvent`/`parseSubject`/`RequestContext`/`SubjectContext`), Jest, `@nestfolio/test-support` (e2e), AWS DynamoDB DocumentClient, Nx.

---

## Background facts (verified against code 2026-06-09 — do not re-derive)

**Phase-0 (shipped):** `SubjectContext`/`RegionContext`/re-based `RequestContext` in `libs/event-processor/src/domain/schemas.ts`; `BusEvent<T, S extends SubjectContext = RequestContext>` (`platform/bus.ts`) and `TableEntry<T extends object, S extends SubjectContext = RequestContext>` (`platform/table.ts`); `parseSubject` (`util/parse-subject.ts`); `expectContractMatch` helper exists at `apps/e2e-feature-tests/src/helpers/contract-assert.ts`.

**Census of Investor producers (the work surface):**

| Producer | CDC entity / row | Event names | Contract status |
|---|---|---|---|
| investor-ctrl | `Notification` | NOTIFICATION_CREATED / NOTIFICATION_UPDATED | `NotificationCreatedSchema` EXISTS (covers it) |
| investor-ctrl | `MonthlyReport` | MONTHLY_REPORT_CREATED / MONTHLY_REPORT_UPDATED | **NEW** `MonthlyReportSchema` |
| investor-bff | `InvestorProfile` (sk=`InvestorProfile`) | INVESTOR_PROFILE_CREATED/UPDATED, GOAL_UPDATED | `InvestorProfileUpdatedSchema` EXISTS (covers it) |
| investor-bff | `Mandate` (sk=`Mandate`) | MANDATE_ISSUED, MANDATE_REVOKED, OPERATING_MODE_CHANGED | **NEW** `MandateSchema` — cross-domain (compliance-ctrl) ⇒ `investor-adpt/domain` |
| investor-bff | `ExecutionModeChange` (sk=`ExecutionModeChange#…`) | EXECUTION_MODE_CHANGED / EXECUTION_MODE_CHANGE_UPDATED | **NEW** `ExecutionModeChangedSchema` — cross-domain (broker-ctrl) ⇒ `investor-adpt/domain` |
| investor-bff | `Notification` (read-model, sk=`Notification#…`) | NOTIFICATION_READ | **NEW** `NotificationReadSchema` — unconsumed ⇒ `investor-bff/contracts` |
| investor-bff | `DepositIntent` / `WithdrawalIntent` | DEPOSIT_INITIATED / WITHDRAWAL_INITIATED | EXISTS in `investor-adpt/domain` — **OUT OF SCOPE** |
| onboarding-bff | `OnboardingCompleted` / `GoLiveConfirmed` | ONBOARDING_COMPLETED / GO_LIVE_CONFIRMED | `OnboardingCompletedRecordSchema` + `GoLiveConfirmedSchema` EXIST — **confirm-coverage only** |

**Real persisted row shapes (the e2e gate validates THESE):**
- investor-bff `InvestorProfile` (`transforms/onboarding-completed.ts:31-62`): pk=`InvestorProfile#${tenantId}#${userId}`, sk=`InvestorProfile`; carries operatingMode, goal{objective,timeHorizonMonths,targetAmountCents,currency,targetReturn}, riskProfile{score,band{minEquity,maxEquity},toleranceResponse,experienceLevel}, accountMode, executionMode, email, mandateId, mandateLevel, onboardingCompletedAt, __version, + full RequestContext + envelope.
- investor-bff `Mandate` (`transforms/onboarding-completed.ts:68-85`): pk=`InvestorProfile#${tenantId}#${userId}`, sk=`Mandate`; fields mandateId, level (`ADVISORY`|`DISCRETIONARY`), status (`ACTIVE`|`REVOKED`), **operatingMode** (`CONSERVATIVE`|`BALANCED`|`AGGRESSIVE`), effectiveDate, revokedAt (null initially), __version, + RequestContext + envelope.
- investor-bff `Notification` read-model (`transforms/notification-created.ts:10-25`): pk=`InvestorProfile#${tenantId}#${userId}`, sk=`Notification#${notificationId}`; fields notificationId, channel, title, body, relatedEntityType, relatedEntityId, status (`CREATED`→`READ`), read (bool), createdAt, [readAt on mark-read]; carries tenantId+userId (NOT region).
- investor-bff `ExecutionModeChange` (`repositories/investor-profile.repository.ts:79-89`): pk=`InvestorProfile#${tenantId}#${userId}`, sk=`ExecutionModeChange#${tenantId}#${userId}#${now}`; fields changeId, fromMode, toMode, changedAt, timestamp, + RequestContext + envelope (note: literal omits createdAt — see Task 3 Step 4).
- investor-ctrl `Notification` (`handlers/event-listener.ts:185-204`, `buildNotificationRecord`): pk=`Notification#${tenantId}#${notificationId}`, sk=`Notification`; fields notificationId, type, title, body, channel, status (`DELIVERED`), sourceEventId, relatedEntityType, relatedEntityId, timestamp, createdAt, updatedAt, tenantId (TENANT-ONLY, no userId/region).
- investor-ctrl `MonthlyReport` (`handlers/event-listener.ts:221-236`): pk=`MonthlyReport#${tenantId}#${reportId}`, sk=`MonthlyReport`; fields reportId, period (`YYYY-MM`), orderDetails (raw order subject object), sourceEventId, status (`GENERATED`), timestamp, createdAt, updatedAt, tenantId.

**Contract-home rule applied (design § "Contract-home / import rule"; reusability tie-break = adapter pattern):**
- Cross-domain-consumed (`Mandate*` → compliance-ctrl/advisory; `EXECUTION_MODE_CHANGED` → broker-ctrl/execution) → define in `investor-adpt/domain/contracts.ts`, re-export via `domain/index.ts`. investor-bff imports them back (intra-domain, acyclic: `investor-adpt` imports nothing from `investor-bff`).
- Intra-domain / unconsumed (`MonthlyReport`, `NotificationRead`) → producer service `domain/contracts.ts`.
- `InvestorProfileUpdatedSchema` stays in `investor-bff/contracts` (already there + consumed; not churned — consumer-import migration is WS-3's concern).

**CI compile reality (do NOT fight it):** investor-ctrl & investor-bff handler/transform/repository files are NOT compiled by their `typecheck` nx target (it compiles only `tsconfig.type-test.json` = `read-model-ownership.type-test.ts`). Full-project `tsc` on investor-bff is blocked by the pre-existing `investor-bff-13-latent-tsc-errors`. Therefore the verifiable deliverables are the **contracts** (compiled+run by unit tests) and the **e2e gate** (runtime). Any `satisfies TableEntry<Subject>` typing of write-literals is non-load-bearing polish — apply only where it compiles cleanly; never block on it.

---

## File Structure

- **Modify** `services/investor/investor-ctrl/src/domain/contracts.ts` — add `MonthlyReportSchema`/`MonthlyReport`.
- **Modify** `services/investor/investor-ctrl/test/unit/domain/contracts.test.ts` — add MonthlyReport + Notification dry-subject tests.
- **Modify** `services/investor/investor-adpt/src/domain/contracts.ts` — add `MandateSchema`/`Mandate`, `ExecutionModeChangedSchema`/`ExecutionModeChanged`.
- **Modify** `services/investor/investor-adpt/src/domain/index.ts` — re-export the two new schemas+types.
- **Create** `services/investor/investor-adpt/test/unit/domain/contracts.test.ts` — unit tests for the 4 adapter contracts (2 existing + 2 new).
- **Modify** `services/investor/investor-bff/src/domain/contracts.ts` — add `NotificationReadSchema`/`NotificationRead`.
- **Modify** `services/investor/investor-bff/test/unit/domain/contracts.test.ts` — add NotificationRead + Mandate + ExecutionModeChanged tests.
- **Modify** `services/investor/onboarding-bff/test/unit/domain/schemas.test.ts` — add a dry-subject coverage assertion (confirm-coverage).
- **Create** `apps/e2e-feature-tests/src/investor/investor-contract-emission.e2e.test.ts` — the #1-risk validation gate.
- **Closing (Task 7):** regen the 4 service CLAUDE.md cards (audit-service), backlog ship, deploy+gate.

---

### Task 1: investor-ctrl — `MonthlyReportSchema` contract + unit tests

**Files:**
- Modify: `services/investor/investor-ctrl/src/domain/contracts.ts`
- Test: `services/investor/investor-ctrl/test/unit/domain/contracts.test.ts`

- [ ] **Step 1: Write the failing test** — append to `services/investor/investor-ctrl/test/unit/domain/contracts.test.ts`:

```typescript
import { MonthlyReportSchema } from '../../../src/domain/contracts';

describe('investor-ctrl MonthlyReportSchema', () => {
  it('parses a representative MonthlyReport subject (dry — no identity/keys)', () => {
    const subject = {
      reportId: 'evt-1-report',
      period: '2026-06',
      status: 'GENERATED',
      sourceEventId: 'evt-1',
      orderDetails: { orderId: 'o1', symbol: 'VTI', quantity: 3 },
    };
    expect(MonthlyReportSchema.parse(subject)).toMatchObject({ period: '2026-06', status: 'GENERATED' });
  });

  it('strips identity/keys but keeps the domain fields (DRY subject)', () => {
    const parsed = MonthlyReportSchema.parse({
      tenantId: 't', pk: 'MonthlyReport#t#r', sk: 'MonthlyReport',
      reportId: 'r', period: '2026-06', status: 'GENERATED',
    });
    expect('tenantId' in parsed).toBe(false);
    expect('pk' in parsed).toBe(false);
    expect(parsed.reportId).toBe('r');
  });

  it('throws when reportId is absent', () => {
    expect(() => MonthlyReportSchema.parse({ period: '2026-06', status: 'GENERATED' })).toThrow();
  });
});
```

Note: this file already imports `NotificationCreatedSchema`-based tests — keep them. Add the import line above to the existing import block if a `from '../../../src/domain/contracts'` import already exists (merge, don't duplicate).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run investor-ctrl:test --testPathPatterns contracts`
Expected: FAIL — `MonthlyReportSchema` is not exported / undefined.

- [ ] **Step 3: Add the schema** — append to `services/investor/investor-ctrl/src/domain/contracts.ts` (after `NotificationCreated`):

```typescript
/** MONTHLY_REPORT_CREATED / MONTHLY_REPORT_UPDATED subject (the MonthlyReport row,
 * written by event-listener on ORDER_FILLED). Dry domain subject — tenant identity
 * travels in the event context (RequestContext), not here. */
export const MonthlyReportSchema = z.object({
  reportId: z.string(),
  period: z.string(),
  status: z.string(),
  sourceEventId: z.string().optional(),
  // orderDetails is the raw triggering ORDER_FILLED subject, persisted verbatim.
  orderDetails: z.record(z.unknown()).optional(),
});
export type MonthlyReport = z.infer<typeof MonthlyReportSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx run investor-ctrl:test --testPathPatterns contracts`
Expected: PASS (existing NotificationCreated tests + new MonthlyReport tests).

- [ ] **Step 5: Lint + typecheck**

Run: `pnpm nx run investor-ctrl:lint && pnpm nx run investor-ctrl:typecheck`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add services/investor/investor-ctrl/src/domain/contracts.ts services/investor/investor-ctrl/test/unit/domain/contracts.test.ts
git commit --no-verify -m "feat(investor-ctrl): add MonthlyReport producer contract

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

(Worktree commits use `--no-verify` — the pre-commit hook can't run nx-affected in a worktree. See [[feedback-worktree-commit-no-verify]]. Verify each commit landed with `git log --oneline -1`.)

---

### Task 2: investor-adpt — `Mandate` + `ExecutionModeChanged` cross-domain contracts

**Files:**
- Modify: `services/investor/investor-adpt/src/domain/contracts.ts`
- Modify: `services/investor/investor-adpt/src/domain/index.ts`
- Create: `services/investor/investor-adpt/test/unit/domain/contracts.test.ts`

- [ ] **Step 1: Write the failing test** — create `services/investor/investor-adpt/test/unit/domain/contracts.test.ts`:

```typescript
import {
  DepositInitiatedSchema,
  WithdrawalInitiatedSchema,
  MandateSchema,
  ExecutionModeChangedSchema,
} from '../../../src/domain/contracts';

describe('investor-adpt cross-domain contracts', () => {
  it('DepositInitiatedSchema parses (regression)', () => {
    expect(DepositInitiatedSchema.parse({
      depositId: 'd1', amountCents: 1000, currency: 'USD', timestamp: '2026-06-09T00:00:00.000Z',
    }).depositId).toBe('d1');
  });

  it('WithdrawalInitiatedSchema parses (regression)', () => {
    expect(WithdrawalInitiatedSchema.parse({
      withdrawalId: 'w1', amountCents: 1000, currency: 'USD', timestamp: '2026-06-09T00:00:00.000Z',
    }).withdrawalId).toBe('w1');
  });

  it('MandateSchema parses a representative Mandate subject (dry — identity stripped)', () => {
    const subject = {
      tenantId: 't', userId: 'u', region: 'us-east-1',
      mandateId: 'm1', level: 'ADVISORY', status: 'ACTIVE',
      operatingMode: 'BALANCED', effectiveDate: '2026-06-09T00:00:00.000Z',
      revokedAt: null, __version: 1,
    };
    const parsed = MandateSchema.parse(subject);
    expect('tenantId' in parsed).toBe(false);
    expect(parsed.mandateId).toBe('m1');
    expect(parsed.operatingMode).toBe('BALANCED');
  });

  it('MandateSchema rejects an invalid level', () => {
    expect(() => MandateSchema.parse({
      mandateId: 'm1', level: 'BOGUS', status: 'ACTIVE',
      operatingMode: 'BALANCED', effectiveDate: '2026-06-09T00:00:00.000Z',
    })).toThrow();
  });

  it('ExecutionModeChangedSchema parses a representative change subject', () => {
    const subject = {
      changeId: 't#u#2026', fromMode: 'simulation', toMode: 'live',
      changedAt: '2026-06-09T00:00:00.000Z',
    };
    expect(ExecutionModeChangedSchema.parse(subject)).toEqual(subject);
  });

  it('ExecutionModeChangedSchema rejects an invalid mode', () => {
    expect(() => ExecutionModeChangedSchema.parse({
      changeId: 'x', fromMode: 'simulation', toMode: 'paper', changedAt: '2026-06-09T00:00:00.000Z',
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run investor-adpt:test --testPathPatterns contracts`
Expected: FAIL — `MandateSchema` / `ExecutionModeChangedSchema` not exported.

- [ ] **Step 3: Add the schemas** — append to `services/investor/investor-adpt/src/domain/contracts.ts`:

```typescript
/**
 * Subject shape for MANDATE_ISSUED / MANDATE_REVOKED / OPERATING_MODE_CHANGED.
 * One aggregate, three event names — the whole Mandate sibling row (sk='Mandate',
 * investor-bff transforms/onboarding-completed.ts + revokeMandate/updateOperatingMode
 * resolvers) is CDC-emitted as the subject. OPERATING_MODE_CHANGED is re-sourced from
 * this row's operatingMode field (onFieldChange), so operatingMode is a Mandate field.
 *
 * Owned here in the PRODUCER's cross-domain adapter (investor-adpt/domain) — investor
 * produces it; compliance-ctrl (advisory domain) consumes it. Matches the
 * DepositInitiated / ProposedTrade precedent. Dry subject — identity travels in the
 * event context (RequestContext), not here.
 */
export const MandateSchema = z.object({
  mandateId: z.string(),
  level: z.enum(['ADVISORY', 'DISCRETIONARY']),
  status: z.enum(['ACTIVE', 'REVOKED']),
  operatingMode: z.enum(['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE']),
  effectiveDate: z.string(),
  revokedAt: z.string().nullable().optional(),
  __version: z.number().optional(),
});
export type Mandate = z.infer<typeof MandateSchema>;

/**
 * Subject shape for EXECUTION_MODE_CHANGED / EXECUTION_MODE_CHANGE_UPDATED.
 * The ExecutionModeChange audit row (investor-bff investor-profile.repository.ts
 * setExecutionMode). Owned here — broker-ctrl (execution domain) consumes
 * EXECUTION_MODE_CHANGED. Dry subject — identity travels in the event context.
 */
export const ExecutionModeChangedSchema = z.object({
  changeId: z.string(),
  fromMode: z.enum(['simulation', 'live']),
  toMode: z.enum(['simulation', 'live']),
  changedAt: z.string(),
});
export type ExecutionModeChanged = z.infer<typeof ExecutionModeChangedSchema>;
```

- [ ] **Step 4: Re-export via the `/domain` barrel** — in `services/investor/investor-adpt/src/domain/index.ts`, extend the existing contract re-export lines:

```typescript
export { DepositInitiatedSchema, WithdrawalInitiatedSchema, MandateSchema, ExecutionModeChangedSchema } from './contracts';
export type { DepositInitiated, WithdrawalInitiated, Mandate, ExecutionModeChanged } from './contracts';
```

- [ ] **Step 5: Run test + lint + typecheck**

Run: `pnpm nx run investor-adpt:test --testPathPatterns contracts && pnpm nx run investor-adpt:lint`
Expected: PASS. (investor-adpt has no `typecheck` target by default; if `pnpm nx show project investor-adpt --json` lists one, run it too.)

- [ ] **Step 6: Commit**

```bash
git add services/investor/investor-adpt/src/domain/contracts.ts services/investor/investor-adpt/src/domain/index.ts services/investor/investor-adpt/test/unit/domain/contracts.test.ts
git commit --no-verify -m "feat(investor-adpt): add Mandate + ExecutionModeChanged cross-domain contracts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: investor-bff — `NotificationReadSchema` + producer unit tests (Mandate/ExecutionModeChanged/NotificationRead)

**Files:**
- Modify: `services/investor/investor-bff/src/domain/contracts.ts`
- Test: `services/investor/investor-bff/test/unit/domain/contracts.test.ts`
- (Optional polish) Modify: `services/investor/investor-bff/src/transforms/onboarding-completed.ts`, `src/repositories/investor-profile.repository.ts`

- [ ] **Step 1: Write the failing test** — create/append `services/investor/investor-bff/test/unit/domain/contracts.test.ts` with a new describe block (keep the existing `InvestorProfileUpdatedSchema` tests intact):

```typescript
import { NotificationReadSchema } from '../../../src/domain/contracts';
import { MandateSchema, ExecutionModeChangedSchema } from '@nestfolio/investor-adpt/domain';

describe('investor-bff NotificationReadSchema', () => {
  const notificationRow = {
    tenantId: 't', userId: 'u',
    notificationId: 'n1', channel: 'push', title: 'Hi', body: 'Body',
    relatedEntityType: 'DECISION', relatedEntityId: 'd1',
    status: 'READ', read: true, readAt: '2026-06-09T00:00:00.000Z',
    createdAt: '2026-06-09T00:00:00.000Z',
  };
  it('parses a real Notification read-model row (dry — identity stripped)', () => {
    const parsed = NotificationReadSchema.parse(notificationRow);
    expect('tenantId' in parsed).toBe(false);
    expect(parsed.notificationId).toBe('n1');
  });
  it('parses the CREATED state (readAt absent)', () => {
    const { readAt: _r, read: _read, ...created } = notificationRow;
    expect(NotificationReadSchema.parse({ ...created, status: 'CREATED' }).status).toBe('CREATED');
  });
  it('throws when notificationId is absent', () => {
    const { notificationId: _n, ...without } = notificationRow;
    expect(() => NotificationReadSchema.parse(without)).toThrow();
  });
});

describe('investor-bff Mandate row parses the investor-adpt Mandate contract', () => {
  it('a real Mandate sibling-row shape validates', () => {
    const mandateRow = {
      tenantId: 't', userId: 'u', region: 'us-east-1',
      mandateId: 'm1', level: 'DISCRETIONARY', status: 'ACTIVE',
      operatingMode: 'CONSERVATIVE', effectiveDate: '2026-06-09T00:00:00.000Z',
      revokedAt: null, __version: 1,
    };
    expect(MandateSchema.parse(mandateRow).operatingMode).toBe('CONSERVATIVE');
  });
});

describe('investor-bff ExecutionModeChange row parses the investor-adpt contract', () => {
  it('a real ExecutionModeChange audit-row shape validates', () => {
    const row = {
      tenantId: 't', userId: 'u', region: 'us-east-1',
      changeId: 't#u#2026', fromMode: 'simulation', toMode: 'live',
      changedAt: '2026-06-09T00:00:00.000Z',
    };
    expect(ExecutionModeChangedSchema.parse(row).toMode).toBe('live');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run investor-bff:test --testPathPatterns contracts`
Expected: FAIL — `NotificationReadSchema` not exported.

- [ ] **Step 3: Add the schema** — append to `services/investor/investor-bff/src/domain/contracts.ts`:

```typescript
/** Subject shape for NOTIFICATION_READ — the investor-bff Notification read-model row
 * (sk='Notification#…'), projected from investor-ctrl's NOTIFICATION_CREATED
 * (transforms/notification-created.ts) and transitioned to READ by the
 * markNotificationRead resolver. Unconsumed cross-domain, so its home is here.
 * Dry subject — tenant/user identity travels in the event context, not here. */
export const NotificationReadSchema = z.object({
  notificationId: z.string(),
  channel: z.string(),
  title: z.string(),
  body: z.string(),
  relatedEntityType: z.string(),
  relatedEntityId: z.string(),
  status: z.string(),
  read: z.boolean().optional(),
  readAt: z.string().nullable().optional(),
  createdAt: z.string().optional(),
});
export type NotificationRead = z.infer<typeof NotificationReadSchema>;
```

- [ ] **Step 4: (Optional, non-load-bearing) tighten write-literal typing** — ONLY if it compiles cleanly under `investor-bff:lint` (these files are not in the typecheck config). In `src/transforms/onboarding-completed.ts`, change the Mandate `Put` literal annotation from `satisfies TableEntry` to `satisfies TableEntry<Mandate>` and add the import `import type { Mandate } from '@nestfolio/investor-adpt/domain';`. If TypeScript flags excess properties (envelope/identity fields beyond the contract), REVERT to the original `satisfies TableEntry` — the contract is proven by the e2e gate, not this annotation. Do the same for the `ExecutionModeChange` literal in `repositories/investor-profile.repository.ts` (`satisfies TableEntry<ExecutionModeChanged>`). **Skip this step entirely if it produces any lint/compile error.** Do NOT add `createdAt` or otherwise change runtime emission.

- [ ] **Step 5: Run test + lint + typecheck**

Run: `pnpm nx run investor-bff:test --testPathPatterns contracts && pnpm nx run investor-bff:lint && pnpm nx run investor-bff:typecheck`
Expected: all PASS. (`typecheck` compiles only the read-model-ownership type-test — unchanged here.)

- [ ] **Step 6: Commit**

```bash
git add services/investor/investor-bff/src/domain/contracts.ts services/investor/investor-bff/test/unit/domain/contracts.test.ts services/investor/investor-bff/src/transforms/onboarding-completed.ts services/investor/investor-bff/src/repositories/investor-profile.repository.ts
git commit --no-verify -m "feat(investor-bff): add NotificationRead contract + Mandate/ExecutionModeChanged producer tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

(If Step 4 was skipped, drop the two `src/` paths from `git add`.)

---

### Task 4: onboarding-bff — confirm coverage

**Files:**
- Test: `services/investor/onboarding-bff/test/unit/domain/schemas.test.ts`

onboarding-bff already exports `OnboardingCompletedRecordSchema` (ONBOARDING_COMPLETED) and `GoLiveConfirmedSchema` (GO_LIVE_CONFIRMED) — the only two CDC events it emits (`service.stack.ts:25-28`). No new contract is needed. Add a regression assertion that both are DRY (strip identity) so the convention is locked.

- [ ] **Step 1: Add a dry-subject assertion** — append to `services/investor/onboarding-bff/test/unit/domain/schemas.test.ts`:

```typescript
import { OnboardingCompletedRecordSchema, GoLiveConfirmedRecordSchema } from '../../../src/domain/schemas';

describe('onboarding-bff CDC contracts cover the two emitted events (dry)', () => {
  it('OnboardingCompletedRecordSchema parses a real OnboardingCompleted row and strips identity', () => {
    const parsed = OnboardingCompletedRecordSchema.parse({
      tenantId: 't', userId: 'u', region: 'us-east-1',
      goal: { objective: 'RETIREMENT' }, horizonYears: 10, accountMode: 'simulation',
      capitalAmount: 100000, currency: 'USD', riskTolerance: 2, riskExperience: 1,
      operatingMode: 'BALANCED', mandateAccepted: true,
    });
    expect('tenantId' in parsed).toBe(false);
    expect(parsed.operatingMode).toBe('BALANCED');
  });
  it('GoLiveConfirmedRecordSchema parses a real GoLiveConfirmed row', () => {
    expect(GoLiveConfirmedRecordSchema.parse({ timestamp: '2026-06-09T00:00:00.000Z' }).timestamp)
      .toBe('2026-06-09T00:00:00.000Z');
  });
});
```

(If `schemas.test.ts` already imports these schemas, merge the import rather than duplicating.)

- [ ] **Step 2: Run test + lint**

Run: `pnpm nx run onboarding-bff:test --testPathPatterns schemas && pnpm nx run onboarding-bff:lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add services/investor/onboarding-bff/test/unit/domain/schemas.test.ts
git commit --no-verify -m "test(onboarding-bff): assert CDC contracts are dry + cover both emitted events

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: e2e validation gate — THE #1 RISK

**Files:**
- Create: `apps/e2e-feature-tests/src/investor/investor-contract-emission.e2e.test.ts`

Mirror `apps/e2e-feature-tests/src/ledger/ledger-contract-emission.e2e.test.ts`. Validates REAL persisted rows against the producer contracts. Covers InvestorProfile + Mandate (investor-bff), Notification + MonthlyReport (investor-ctrl), and the investor-bff Notification read-model (NotificationRead). `ExecutionModeChanged` is covered by unit test only (Task 3) — no e2e fixture triggers a live execution-mode switch today; this boundary is documented in-file. Execution of this test is gated to the closing phase (do not run inline).

- [ ] **Step 1: Write the test file** — create `apps/e2e-feature-tests/src/investor/investor-contract-emission.e2e.test.ts`:

```typescript
/**
 * Validation-gate e2e — investor-domain producer contracts vs REAL deployed emission.
 *
 * The CDC publisher emits the whole DDB row as the event subject. A row that parses
 * against its contract proves the emitted subject satisfies the contract.
 *
 * Coverage (naturally produced by onboarded() + withHoldings()):
 *   investor-bff:  InvestorProfile (sk='InvestorProfile'), Mandate (sk='Mandate'),
 *                  Notification read-model (sk='Notification#…' → NotificationRead)
 *   investor-ctrl: Notification (__typename='Notification'), MonthlyReport (__typename='MonthlyReport')
 *
 * NOT covered here (documented boundary): ExecutionModeChanged — no e2e fixture triggers
 * a live execution-mode switch; covered by investor-bff producer unit test against the
 * setExecutionMode write literal.
 *
 * Key table-key facts (confirmed from code):
 *   investor-bff:
 *     - InvestorProfile pk=InvestorProfile#${tenantId}#${userId} sk=InvestorProfile
 *     - Mandate         pk=InvestorProfile#${tenantId}#${userId} sk=Mandate
 *     - Notification    pk=InvestorProfile#${tenantId}#${userId} sk=Notification#${notificationId}
 *   investor-ctrl (notificationId/reportId are ctx.eventId-derived → query by GSI):
 *     - Notification    pk=Notification#${tenantId}#${notificationId}    sk=Notification
 *     - MonthlyReport   pk=MonthlyReport#${tenantId}#${reportId}         sk=MonthlyReport
 *     tenantId-index GSI: PK=tenantId, SK=__typename, ProjectionType=ALL.
 *
 * DO NOT run this directly against dev outside the closing phase. This file exists to
 * prove typechecking passes; execution is gated by the closing task.
 */

import { createTestContext, type TestContext } from '@nestfolio/test-support';
import { freshTenant, applyFixtures, onboarded, withHoldings, poll, type FreshTenant } from '..';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { InvestorProfileUpdatedSchema, NotificationReadSchema } from '@nestfolio/investor-bff/contracts';
import { MandateSchema } from '@nestfolio/investor-adpt/domain';
import { NotificationCreatedSchema, MonthlyReportSchema } from '@nestfolio/investor-ctrl/contracts';
import { expectContractMatch } from '../helpers/contract-assert';

describe('investor-domain producer contracts match REAL deployed emission', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;
  let ddbClient: DynamoDBClient;
  let ddbDoc: DynamoDBDocumentClient;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    // onboarded() → ONBOARDING_COMPLETED: investor-bff writes InvestorProfile + Mandate;
    //   investor-ctrl writes a Notification; investor-bff projects NOTIFICATION_CREATED
    //   into its Notification read-model row.
    // withHoldings() → ORDER_FILLED: investor-ctrl writes a MonthlyReport (+ Notification).
    await applyFixtures(ctx, tenant, [
      onboarded(),
      withHoldings([{ symbol: 'VTI', quantity: 50, fillPrice: 200 }]),
    ]);
    ddbClient = new DynamoDBClient({ region: ctx.region });
    ddbDoc = DynamoDBDocumentClient.from(ddbClient);
  }, 600_000);

  afterEach(async () => {
    ddbClient?.destroy();
    await ctx.cleanup.runAll();
  }, 60_000);

  it(
    'investor-bff: InvestorProfile + Mandate + Notification read-model subjects parse',
    async () => {
      const table = await ctx.ssm.tableName('investor-bff');
      const pk = `InvestorProfile#${tenant.tenantId}#${tenant.userId}`;

      const profile = await poll(async () => {
        const r = await ddbDoc.send(new GetCommand({ TableName: table, Key: { pk, sk: 'InvestorProfile' } }));
        return r.Item as Record<string, unknown> | undefined;
      }, 120_000);
      expectContractMatch(InvestorProfileUpdatedSchema, profile, 'InvestorProfileUpdated');

      const mandate = await poll(async () => {
        const r = await ddbDoc.send(new GetCommand({ TableName: table, Key: { pk, sk: 'Mandate' } }));
        return r.Item as Record<string, unknown> | undefined;
      }, 120_000);
      expectContractMatch(MandateSchema, mandate, 'Mandate');

      const notifs = await poll(async () => {
        const r = await ddbDoc.send(new QueryCommand({
          TableName: table,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          ExpressionAttributeValues: { ':pk': pk, ':sk': 'Notification#' },
        }));
        return (r.Items ?? []).length ? (r.Items as Record<string, unknown>[]) : undefined;
      }, 120_000);
      expect(notifs.length).toBeGreaterThan(0);
      notifs.forEach((row, i) => expectContractMatch(NotificationReadSchema, row, `NotificationRead[${i}]`));
    },
    420_000,
  );

  it(
    'investor-ctrl: Notification + MonthlyReport subjects parse',
    async () => {
      const table = await ctx.ssm.tableName('investor-ctrl');
      const byTypename = async (typename: string): Promise<Record<string, unknown>[]> => {
        const r = await ddbDoc.send(new QueryCommand({
          TableName: table,
          IndexName: 'tenantId-index',
          KeyConditionExpression: 'tenantId = :t AND #tn = :tn',
          ExpressionAttributeNames: { '#tn': '__typename' },
          ExpressionAttributeValues: { ':t': tenant.tenantId, ':tn': typename },
        }));
        return (r.Items ?? []) as Record<string, unknown>[];
      };

      const notifs = await poll(async () => {
        const items = await byTypename('Notification');
        return items.length ? items : undefined;
      }, 180_000);
      expect(notifs.length).toBeGreaterThan(0);
      notifs.forEach((row, i) => expectContractMatch(NotificationCreatedSchema, row, `NotificationCreated[${i}]`));

      const reports = await poll(async () => {
        const items = await byTypename('MonthlyReport');
        return items.length ? items : undefined;
      }, 180_000);
      expect(reports.length).toBeGreaterThan(0);
      reports.forEach((row, i) => expectContractMatch(MonthlyReportSchema, row, `MonthlyReport[${i}]`));
    },
    420_000,
  );
});
```

- [ ] **Step 2: Verify the e2e project typechecks** (do NOT execute the test)

Run: `pnpm nx run e2e-feature-tests:lint`
Expected: PASS (imports resolve; the `@nestfolio/investor-*/contracts` + `@nestfolio/investor-adpt/domain` subpaths are exported). If a subpath export is missing from a producer's `package.json`/`project.json`, add it mirroring how `@nestfolio/ledger-ctrl/contracts` is exported.

- [ ] **Step 3: Confirm `FreshTenant` exposes `userId`**

Run: `pnpm nx run e2e-feature-tests:lint` already covers this (the file references `tenant.userId`). If it does not exist, derive userId the same way `onboarded()` does and adjust — but the ledger reconciliation test already uses `tenant.userId`, so it exists.

- [ ] **Step 4: Commit**

```bash
git add apps/e2e-feature-tests/src/investor/investor-contract-emission.e2e.test.ts
git commit --no-verify -m "test(e2e): investor producer-contract emission gate (real DDB rows)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Regenerate the 4 service cards (doc derivation)

The closing phase (`/backlog-next` Step 6.1, `detect-doc-derivation.mjs`) will flag the touched services. Update each `CLAUDE.md` "Contracts"/"Exported surface" section to list the new schemas. Do this via the `audit-service` skill per service so the card matches code.

- [ ] **Step 1:** Run `audit-service investor-ctrl`, `audit-service investor-adpt`, `audit-service investor-bff`, `audit-service onboarding-bff`; accept the regenerated "Contracts" sections (investor-ctrl gains `MonthlyReportSchema`; investor-adpt gains `MandateSchema`/`ExecutionModeChangedSchema`; investor-bff gains `NotificationReadSchema`).
- [ ] **Step 2: Commit**

```bash
git add services/investor/*/CLAUDE.md
git commit --no-verify -m "docs(investor): regen service cards for new producer contracts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Closing phase (driven by `/backlog-next` Step 6 — listed here for completeness)

- [ ] **6.2 Verify:** `pnpm nx affected -t test,lint --base=origin/main` — green. (Expect the documented agent-orchestrator `@smithy` worktree-symlink false-FAIL noted in [[event-subject-contracts]] / [[feedback-worktree-symlink-masks-test-failures]]; verify on real main post-merge.)
- [ ] **6.3 Detect deploy:** `node .claude/skills/backlog-next/detect-deploy-needed.mjs`. NOTE: this slice may be **type-only** (zod contracts + tests; no change to emitted JS) ⇒ the producers already emit the asserted shapes and the gate can run against current dev. If the script says deploy, deploy `investor-ctrl,investor-bff` (`bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-ctrl,investor-bff`).
- [ ] **6.4 Run the gate (only the investor scenario):** `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPatterns investor-contract-emission`. Must be GREEN against deployed dev (real DDB rows parse against the contracts). If a contract mismatches the real row, FIX THE CONTRACT to match reality (the row is truth) — never loosen the row. If a scenario fails-then-passes on rerun, pull CloudWatch evidence from the failing window before continuing ([[feedback-flake-means-broken]]).
- [ ] **6.5–6.8:** Ship `docs/backlog/typed-subject-contracts-investor.md` (`status: shipped`, fill `validation_gate:` with commit SHAs + the e2e PASS line + unit-test counts); `backlog-lint --fix`; route to `superpowers:finishing-a-development-branch`; push `main`; git-clean the worktree + branch; postflight.

---

## Out of scope (mirrors the backlog file)

- WS-2 (`cdc-publisher-typed-subjects`), WS-3 (`consumer-parse-subject`), the enforcement capstone.
- Other domains (Ledger shipped; Execution + Advisory their own slices).
- `DEPOSIT_INITIATED`/`WITHDRAWAL_INITIATED` (already owned in `investor-adpt/domain`).
- Migrating existing CONSUMERS (dashboard-bff, compliance-ctrl, broker-ctrl, investor-ctrl) to import the new contracts / `parseSubject` — that is WS-3.
- Rewriting investor-bff `models.ts` read-side interfaces to `TableEntry<Subject>` (not in the design's row-conversion census; investor handlers aren't CI-compiled).
- Fixing `investor-bff-13-latent-tsc-errors` (separate parking item).
- Runtime changes to emitted context payloads.

## Self-review notes

- **Spec coverage:** investor-ctrl extend (Task 1 ✓), investor-bff extend (Task 3 ✓ + cross-domain in Task 2), onboarding-bff confirm-coverage (Task 4 ✓), home rule (Task 2 adapter placement ✓), e2e-against-real (Task 5 ✓), unit+tsc green (per-task ✓).
- **Coverage boundary logged:** `ExecutionModeChanged` is unit-only (no e2e trigger) — stated in Task 5 file header, not silently dropped ([[no-silent-caps]]).
- **Type consistency:** schema/type names used identically across tasks — `MonthlyReportSchema`/`MonthlyReport`, `MandateSchema`/`Mandate`, `ExecutionModeChangedSchema`/`ExecutionModeChanged`, `NotificationReadSchema`/`NotificationRead`. e2e imports match the export homes (investor-bff/contracts, investor-adpt/domain, investor-ctrl/contracts).
