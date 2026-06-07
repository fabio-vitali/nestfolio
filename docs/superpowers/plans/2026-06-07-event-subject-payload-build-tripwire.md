# Event Subject payload build-tripwire — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a producer's event *payload-shape* change break the build of every consumer that reads a changed field (compile-time) and throw to the DLQ at runtime (JSON-boundary validation), by giving each cross-consumed event a producer-owned zod contract and routing every consumer read through a single `parseSubject` seam — eliminating all `as Record<string,unknown>` casts and locally re-declared payload types.

**Architecture:** Each producer adds a zod-only `src/domain/contracts.ts` exposed via a new `@nestfolio/<svc>/contracts` tsconfig path alias (producer owns the shape it emits). A new `parseSubject(carrier, schema)` helper in `libs/event-processor` runs `schema.parse(subject)` at the consumer's seam, returning the inferred type and throwing `ZodError` on a contract violation (→ existing poison-pill/DLQ path). Consumers import the schema and call `parseSubject` instead of casting. Producers annotate their subject-construction sites `satisfies <Type>` (where there is a clean construction object) and/or carry a schema-conformance unit test (for CDC full-row subjects), giving two-sided coverage. Schemas are non-strict, so additive producer fields stay compatible; only removing/retyping a *consumed* field trips the wire.

**Tech Stack:** TypeScript, zod `^3.24.0` (root dep), `@nestfolio/event-processor`, Nx, Jest. Path aliases resolve via `tsconfig.base.json` (no package.json `exports`); pnpm workspace symlinks handle linking.

**Reference spec:** `docs/superpowers/specs/2026-06-07-event-subject-payload-build-tripwire-design.md`

---

## Conventions used by every task

- **Worktree:** all paths are relative to the active worktree
  `/Users/fabiovitali/WebstormProjects/nestfolio/.claude/worktrees/event-subject-payload-build-tripwire`.
- **Commits in a worktree need `--no-verify`** (the pre-commit hook can't run nx-affected here) and must be verified with `git log --oneline -1` afterwards. Use the project's co-author trailer.
- **Lib unit tests** run with `pnpm nx test event-processor` (Jest via `@nx/jest:jest`; full lib suite is fast). **Service unit tests** run with `pnpm nx test <service>` (e.g. `pnpm nx test dashboard-bff`).
- **Typecheck** a project with `pnpm nx typecheck <project>` (or `pnpm nx run <project>:typecheck`) — this is the compile-tripwire proof.
- **Test dirs:** libs use flat `test/**` mirroring `src/**`; services use `test/unit/**`.
- **Non-strict schemas:** use plain `z.object({...})` (default zod strips unknown keys on parse). NEVER `.strict()` — additive producer fields must stay backward-compatible.
- **Optional vs required:** model a field `z.optional()` only when the producer legitimately omits it sometimes. Fields the producer always emits are required, so their absence is a genuine contract violation that throws.
- **Drift gate (applies to every consumer retype):** after importing a schema, if a consumer reads a field that is NOT in the producer's schema, **STOP**. Either (a) the field IS genuinely emitted — add it to the producer schema; or (b) the read is dead/wrong — fix the consumer and file the finding via `backlog-add`. Do not paper over it by widening the schema to `Record<string,unknown>`.

### Cross-cutting steps learned from the reference pair (apply to EVERY consumer task 4-9)

1. **jest `moduleNameMapper` per imported contract.** Consumer `jest.config.js` files do NOT auto-derive aliases from `tsconfig.base.json` — each cross-service alias is listed manually. For every new `@nestfolio/<svc>/contracts` import a consumer gains, ADD a matching entry to that consumer's `services/<domain>/<consumer>/jest.config.js` `moduleNameMapper`, e.g.:
   `'^@nestfolio/ledger-ctrl/contracts$': '<rootDir>/../../ledger/ledger-ctrl/src/domain/contracts.ts',`
   (mirror the sibling cross-service entries already in that file; path is `<rootDir>/../../<domain>/<producer>/src/domain/contracts.ts`). Omitting this makes the unit tests fail to resolve the import.

2. **Multi-event transforms MUST discriminate on `event.type`.** Before retyping, read the consumer's `handlers/event-listener.ts` to see which event types are routed to the transform. If a transform is routed MORE THAN ONE event type and they have DIFFERENT subject shapes (e.g. `portfolio-summary` is routed BALANCE_UPDATED, PORTFOLIO_UPDATED, AND RECONCILIATION_COMPLETED — the last carries no `snapshot`), gate with an event-type allowlist and no-op the others, so a legitimately-different event is NOT parsed against the wrong contract and DLQ'd:
   ```ts
   const SNAPSHOT_EVENT_TYPES = new Set(['BALANCE_UPDATED', 'PORTFOLIO_UPDATED']);
   if (!SNAPSHOT_EVENT_TYPES.has(uow.event.type)) return undefined; // documented no-op
   const { snapshot } = parseSubject(uow, …);
   ```
   A genuinely malformed instance of an event the transform DOES own still throws. Preserve any existing documented no-op behavior (check the integration tests). If events routed together share the SAME shape (e.g. DEPOSIT_DETECTED/SETTLED/FAILED all carry FundingSnapshot), no gate is needed.

3. **Producers lack an `nx typecheck` target** (only the 12 consumer-ish services have one). For a PRODUCER's own `satisfies`/contract typecheck, use `npx tsc --noEmit -p services/<domain>/<producer>/tsconfig.json` instead of `pnpm nx typecheck <producer>`. (Task 10 direct-`tsc`s every touched producer; a follow-up may add typecheck targets to producers.)

---

## Task 1: `parseSubject` seam helper in `event-processor`

The single reusable primitive. Accepts a `UnitOfWork<BusEvent<…>>` (reads `uow.event.subject`) or an `EventPayload` (reads `payload.subject`), parses with a zod schema, returns `z.infer`, throws `ZodError` on violation.

**Files:**
- Create: `libs/event-processor/src/util/parse-subject.ts`
- Modify: `libs/event-processor/src/index.ts` (export beside `toUow`, line ~35)
- Test: `libs/event-processor/test/util/parse-subject.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// libs/event-processor/test/util/parse-subject.test.ts
import { z } from 'zod';
import { parseSubject } from '../../src/util/parse-subject';

const Schema = z.object({
  cashBalanceCents: z.number(),
  note: z.string().optional(),
});

describe('parseSubject', () => {
  it('parses the subject from a UnitOfWork (uow.event.subject)', () => {
    const uow = {
      event: { id: '1', type: 'X', timestamp: 't', subject: { cashBalanceCents: 100 }, context: {} },
      payload: {},
      record: {},
    };
    expect(parseSubject(uow as never, Schema)).toEqual({ cashBalanceCents: 100 });
  });

  it('parses the subject from an EventPayload (payload.subject)', () => {
    const payload = { subject: { cashBalanceCents: 200 } };
    expect(parseSubject(payload, Schema)).toEqual({ cashBalanceCents: 200 });
  });

  it('strips unknown keys (non-strict) so additive producer fields stay compatible', () => {
    const payload = { subject: { cashBalanceCents: 1, extraNewField: 'ok' } };
    expect(parseSubject(payload, Schema)).toEqual({ cashBalanceCents: 1 });
  });

  it('throws ZodError on a contract violation (wrong type)', () => {
    const payload = { subject: { cashBalanceCents: 'not-a-number' } };
    expect(() => parseSubject(payload, Schema)).toThrow(z.ZodError);
  });

  it('throws when a required field is absent', () => {
    const payload = { subject: { note: 'hi' } };
    expect(() => parseSubject(payload, Schema)).toThrow(z.ZodError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx test event-processor`
Expected: FAIL — `Cannot find module '../../src/util/parse-subject'` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

```ts
// libs/event-processor/src/util/parse-subject.ts
import { z, type ZodTypeAny } from 'zod';
import type { EventPayload } from '../types';
import type { UnitOfWork, BusEvent } from '../platform';

/**
 * Validate and type an event's subject at the consumer's deserialization seam.
 *
 * Accepts either a UnitOfWork (reads `uow.event.subject`) or an EventPayload
 * (reads `payload.subject`), runs `schema.parse`, and returns the inferred type.
 * Throws `ZodError` on a contract violation — the producer emitted a shape that
 * does not match its own declared contract — which the event-processor poison-pill
 * / DLQ path then catches.
 *
 * This is the only place a consumer should read `event.subject`. Importing the
 * producer's schema makes a payload-shape change a compile error (z.infer field
 * reads) and a runtime error (this parse).
 */
export function parseSubject<S extends ZodTypeAny>(
  carrier: UnitOfWork<BusEvent<unknown>> | EventPayload,
  schema: S,
): z.infer<S> {
  const subject = 'event' in carrier ? carrier.event.subject : carrier.subject;
  return schema.parse(subject) as z.infer<S>;
}
```

- [ ] **Step 4: Export it from the public API**

In `libs/event-processor/src/index.ts`, find the `// Utilities` block (around line 29-35) and add the export beside `toUow`:

```ts
export { toUow } from './util/to-uow';
export { parseSubject } from './util/parse-subject';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm nx test event-processor`
Expected: PASS — all 5 `parseSubject` cases green; rest of the lib suite still green.

- [ ] **Step 6: Typecheck the lib**

Run: `pnpm nx typecheck event-processor`
Expected: PASS (no `noUnusedLocals`/type errors).

- [ ] **Step 7: Commit**

```bash
git add libs/event-processor/src/util/parse-subject.ts libs/event-processor/src/index.ts libs/event-processor/test/util/parse-subject.test.ts
git commit --no-verify -m "feat(event-processor): add parseSubject seam helper

Single primitive that validates+types an event subject at the consumer seam
(UnitOfWork or EventPayload carrier), returning z.infer and throwing ZodError
on a contract violation. Foundation for the payload build-tripwire.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log --oneline -1
```

---

## Task 2: ledger-ctrl producer contract (reference producer)

ledger-ctrl is the highest fan-in producer (5 consumers). Its BALANCE_UPDATED / PORTFOLIO_UPDATED / LEDGER_ENTRY_RECORDED subjects are the `BalanceEvent` / `PortfolioEvent` / ledger-entry DDB records that **wrap** a canonical `snapshot` (`{ positions, cashBalanceCents, lastEventSequence }`, built at `services/ledger/ledger-ctrl/src/transforms/snapshot-to-events.ts:28`). The canonical shapes already exist as `AccountState` / `PositionState` in `services/ledger/ledger-ctrl/src/domain/account-state.ts`.

**Subject field facts (verified 2026-06-07):**
- `PositionState`: `{ symbol: string; quantity: number; averageCostBasis: number; totalCostBasis: number; lastFillPrice: number }`
- snapshot (built at snapshot-to-events.ts:28): `{ positions: Record<string,PositionState>; cashBalanceCents: number; lastEventSequence: number }`
- `BalanceEvent` subject (`record('BalanceEvent', …)`): `{ tenantId, streamType, cashBalanceCents, totalValueCents, snapshot }`
- `PortfolioEvent` subject: `{ tenantId, streamType, positions, positionCount, totalValueCents, snapshot }`
- ledger-entry subject also carries `lastEventSequence`, `snapshotAt`, and `snapshot` (read by time-travel-availability).

**Files:**
- Create: `services/ledger/ledger-ctrl/src/domain/contracts.ts`
- Modify: `tsconfig.base.json` (add alias)
- Modify: `services/ledger/ledger-ctrl/src/transforms/snapshot-to-events.ts:28` (add `satisfies`)
- Test: `services/ledger/ledger-ctrl/test/unit/domain/contracts.test.ts`

- [ ] **Step 1: Write the producer conformance test (failing)**

```ts
// services/ledger/ledger-ctrl/test/unit/domain/contracts.test.ts
import {
  LedgerSnapshotSchema,
  BalanceUpdatedSubjectSchema,
  PortfolioUpdatedSubjectSchema,
} from '../../../src/domain/contracts';

const snapshot = {
  positions: {
    AAPL: { symbol: 'AAPL', quantity: 10, averageCostBasis: 150, totalCostBasis: 1500, lastFillPrice: 155 },
  },
  cashBalanceCents: 100_00,
  lastEventSequence: 7,
};

describe('ledger-ctrl contracts', () => {
  it('LedgerSnapshotSchema parses a real snapshot', () => {
    expect(LedgerSnapshotSchema.parse(snapshot)).toMatchObject({ cashBalanceCents: 100_00 });
  });

  it('BalanceUpdatedSubjectSchema parses a real BalanceEvent subject', () => {
    const subject = { tenantId: 't', streamType: 'live', cashBalanceCents: 100_00, totalValueCents: 250_00, snapshot };
    expect(() => BalanceUpdatedSubjectSchema.parse(subject)).not.toThrow();
  });

  it('PortfolioUpdatedSubjectSchema parses a real PortfolioEvent subject', () => {
    const subject = { tenantId: 't', streamType: 'live', positions: snapshot.positions, positionCount: 1, totalValueCents: 250_00, snapshot };
    expect(() => PortfolioUpdatedSubjectSchema.parse(subject)).not.toThrow();
  });
});
```

Run: `pnpm nx test ledger-ctrl` → Expected: FAIL (`Cannot find module '../../../src/domain/contracts'`).

- [ ] **Step 2: Create the contract module**

```ts
// services/ledger/ledger-ctrl/src/domain/contracts.ts
// Producer-owned event payload contracts for ledger-ctrl. Imports ONLY zod.
import { z } from 'zod';

export const LedgerPositionSchema = z.object({
  symbol: z.string(),
  quantity: z.number(),
  averageCostBasis: z.number(),
  totalCostBasis: z.number(),
  lastFillPrice: z.number(),
});
export type LedgerPosition = z.infer<typeof LedgerPositionSchema>;

/** The canonical account snapshot wrapped on every ledger event. */
export const LedgerSnapshotSchema = z.object({
  positions: z.record(LedgerPositionSchema),
  cashBalanceCents: z.number(),
  lastEventSequence: z.number(),
});
export type LedgerSnapshot = z.infer<typeof LedgerSnapshotSchema>;

/** BALANCE_UPDATED subject (the BalanceEvent record). */
export const BalanceUpdatedSubjectSchema = z.object({
  tenantId: z.string(),
  streamType: z.string().optional(),
  cashBalanceCents: z.number(),
  totalValueCents: z.number().optional(),
  snapshot: LedgerSnapshotSchema,
});
export type BalanceUpdatedSubject = z.infer<typeof BalanceUpdatedSubjectSchema>;

/** PORTFOLIO_UPDATED subject (the PortfolioEvent record). */
export const PortfolioUpdatedSubjectSchema = z.object({
  tenantId: z.string(),
  streamType: z.string().optional(),
  positions: z.record(LedgerPositionSchema),
  positionCount: z.number().optional(),
  totalValueCents: z.number().optional(),
  snapshot: LedgerSnapshotSchema,
});
export type PortfolioUpdatedSubject = z.infer<typeof PortfolioUpdatedSubjectSchema>;

/** LEDGER_ENTRY_RECORDED subject. */
export const LedgerEntrySubjectSchema = z.object({
  streamType: z.string().optional(),
  lastEventSequence: z.number().optional(),
  snapshotAt: z.string().optional(),
  snapshot: LedgerSnapshotSchema.optional(),
});
export type LedgerEntrySubject = z.infer<typeof LedgerEntrySubjectSchema>;
```

- [ ] **Step 3: Add the tsconfig path alias**

In `tsconfig.base.json`, in the `paths` block next to the existing `@nestfolio/ledger-ctrl/events` entry (line ~80), add:

```json
      "@nestfolio/ledger-ctrl/contracts": ["services/ledger/ledger-ctrl/src/domain/contracts.ts"],
```

- [ ] **Step 4: Add producer self-validation (`satisfies`) at the construction site**

In `services/ledger/ledger-ctrl/src/transforms/snapshot-to-events.ts`, import the type and annotate the snapshot object (currently lines ~28-32):

```ts
import type { LedgerSnapshot } from '../domain/contracts';
// …
const snapshot = {
  positions: current.positions,
  cashBalanceCents: current.cashBalanceCents,
  lastEventSequence,
} satisfies LedgerSnapshot;
```

If `tsc` reports that `current.positions` (a `Readonly<Record<…>>`) is not assignable, the fix is to make the schema's positions readonly-tolerant by leaving it as-is (readonly→mutable index signatures are assignable for `satisfies`); only if it genuinely errors, change the annotation target to `satisfies Pick<LedgerSnapshot, 'cashBalanceCents' | 'lastEventSequence'> & { positions: typeof current.positions }`. Verify with Step 5.

- [ ] **Step 5: Run the conformance test + producer typecheck**

Run: `pnpm nx test ledger-ctrl` → Expected: PASS (3 contract cases green; existing ledger-ctrl tests unaffected).
Run: `pnpm nx typecheck ledger-ctrl` → Expected: PASS (the `satisfies` compiles — producer matches its own contract).

- [ ] **Step 6: Commit**

```bash
git add services/ledger/ledger-ctrl/src/domain/contracts.ts services/ledger/ledger-ctrl/src/transforms/snapshot-to-events.ts services/ledger/ledger-ctrl/test/unit/domain/contracts.test.ts tsconfig.base.json
git commit --no-verify -m "feat(ledger-ctrl): publish event payload contracts (zod)

LedgerSnapshot/Balance/Portfolio/LedgerEntry subject schemas exposed via
@nestfolio/ledger-ctrl/contracts; satisfies annotation at the snapshot
construction site for two-sided drift coverage.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log --oneline -1
```

---

## Task 3: Retype dashboard-bff `portfolio-summary` (reference consumer)

The headline cast site. Proves the consumer half of the pattern end-to-end, including the wrapped-snapshot envelope and the guard-removal behaviour change (malformed → throw → DLQ instead of silent skip).

**Files:**
- Modify: `services/investor/dashboard-bff/src/transforms/portfolio-summary.ts`
- Test: `services/investor/dashboard-bff/test/unit/transforms/portfolio-summary.test.ts` (locate with `find services/investor/dashboard-bff/test -name 'portfolio-summary*'`)

- [ ] **Step 1: Add a regression test that a contract violation throws**

Append to the existing portfolio-summary test file (adjust the import of the transform to match the existing test's import path):

```ts
import { z } from 'zod';
// …existing imports of `portfolioSummary` and any uow factory…

it('throws ZodError when the snapshot violates the ledger contract', () => {
  const uow = {
    event: {
      id: 'e1', type: 'BALANCE_UPDATED', timestamp: 't',
      // cashBalanceCents is a string -> contract violation
      subject: { tenantId: 't', cashBalanceCents: 100, snapshot: { positions: {}, cashBalanceCents: 'NaN', lastEventSequence: 1 } },
      context: { tenantId: 't', userId: 'u', region: 'us-east-1' },
    },
    payload: {}, record: {},
  };
  expect(() => portfolioSummary(uow as never)).toThrow(z.ZodError);
});
```

Run: `pnpm nx test dashboard-bff` → Expected: FAIL (the current code casts and returns `undefined` instead of throwing).

- [ ] **Step 2: Retype the transform**

Replace the local type declarations and cast in `services/investor/dashboard-bff/src/transforms/portfolio-summary.ts`. Current head (lines 1-25):

```ts
import { projectVersioned, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

type LedgerPosition = { quantity?: number; lastFillPrice?: number };
type LedgerSnapshot = { cashBalanceCents?: number; positions?: Record<string, LedgerPosition>; lastEventSequence?: number };
// …
  const subject = event.subject as Record<string, unknown>;
  const snapshot = (subject?.snapshot ?? subject) as LedgerSnapshot | undefined;
  if (!snapshot || snapshot.cashBalanceCents === undefined) return undefined;
  const version = snapshot.lastEventSequence;
  if (typeof version !== 'number') return undefined;
```

becomes:

```ts
import { projectVersioned, parseSubject, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { BalanceUpdatedSubjectSchema } from '@nestfolio/ledger-ctrl/contracts';

// (delete the local LedgerPosition / LedgerSnapshot type declarations)
// …
  const { snapshot } = parseSubject(uow, BalanceUpdatedSubjectSchema);
  const version = snapshot.lastEventSequence; // number, guaranteed by contract
```

Notes:
- `snapshot.cashBalanceCents`, `snapshot.positions`, `snapshot.lastEventSequence` are now required `number` / `Record` — the old `=== undefined` / `typeof !== 'number'` guards are dead (the contract proves presence) and are removed. Malformed payloads now throw to the DLQ (the decided failure mode), which the Step 1 regression locks in.
- The `held` filter (`p.quantity ?? 0`) still works — `LedgerPosition.quantity` is a required `number`, so `p.quantity` typechecks; drop the `?? 0` only if `tsc` flags it as unnecessary, otherwise leave it.
- This transform handles BALANCE_UPDATED and PORTFOLIO_UPDATED; both carry `snapshot`, so `BalanceUpdatedSubjectSchema` (which requires `snapshot` + `cashBalanceCents`) is the correct carrier. If a PORTFOLIO_UPDATED-only test fails because `cashBalanceCents` is top-level-absent on PortfolioEvent, switch the parse to a snapshot-only carrier: `parseSubject(uow, z.object({ snapshot: LedgerSnapshotSchema }))` importing `LedgerSnapshotSchema`. Confirm against the existing tests in Step 3.

- [ ] **Step 3: Run the dashboard-bff suite + typecheck**

Run: `pnpm nx test dashboard-bff` → Expected: PASS (existing portfolio-summary cases green + the new throw regression green).
Run: `pnpm nx typecheck dashboard-bff` → Expected: PASS, and confirm the consumer→producer edge resolves (`@nestfolio/ledger-ctrl/contracts` imports cleanly).

- [ ] **Step 4: Prove the compile tripwire (manual, revertible)**

Temporarily rename `cashBalanceCents` → `cashBalanceCentsX` in `LedgerSnapshotSchema` (ledger-ctrl/contracts.ts), then:
Run: `pnpm nx typecheck dashboard-bff` → Expected: FAIL (`Property 'cashBalanceCents' does not exist on type 'LedgerSnapshot'`).
Revert the rename. This is the proof that a producer payload change now breaks the consumer build.

- [ ] **Step 5: Commit**

```bash
git add services/investor/dashboard-bff/src/transforms/portfolio-summary.ts services/investor/dashboard-bff/test/unit/transforms/portfolio-summary.test.ts
git commit --no-verify -m "refactor(dashboard-bff): type portfolio-summary against ledger contract

Replace local LedgerSnapshot re-declaration + as-cast with parseSubject against
@nestfolio/ledger-ctrl/contracts. Malformed snapshot now throws to DLQ. Adds a
contract-violation regression test.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log --oneline -1
```

---

## Task 4: Fan out the remaining ledger-snapshot consumers

Apply the Task 3 pattern to the other readers of ledger-ctrl events. Each file: add the `parseSubject` import + the relevant `@nestfolio/ledger-ctrl/contracts` schema import, delete the local payload type, replace the cast with `parseSubject`, run the drift gate.

**Per-site recipe (do each, then run that service's suite + typecheck + commit per service):**

- [ ] **Step 1 — `services/ledger/ledger-bff/src/transforms/balance-updated.ts`** (uow-style)
  - Delete local `type BalancePayload` (lines 4-13).
  - `import { BalanceUpdatedSubjectSchema } from '@nestfolio/ledger-ctrl/contracts';` + add `parseSubject` to the event-processor import.
  - Replace `const payload = event.subject as BalancePayload & Record<string, unknown>;` (line 24) with `const payload = parseSubject(uow, BalanceUpdatedSubjectSchema);`.
  - Reads: `payload.cashBalanceCents` (req, ok), `payload.snapshot.lastEventSequence` (drop the `?.` — `snapshot` is required), `payload.streamType` (optional, ok), `payload.snapshot.cashBalanceCents`, `payload.snapshot.positions`. **Drift gate:** `deltaCents` is read (line 26) but NOT in the BalanceEvent emit — verify whether ledger-ctrl emits `deltaCents`; if not, the read is dead → remove it and file a `backlog-add` note; if it is, add `deltaCents: z.number().optional()` to `BalanceUpdatedSubjectSchema`.

- [ ] **Step 2 — `services/ledger/ledger-bff/src/transforms/portfolio-updated.ts`** (uow-style)
  - Delete local `type PositionRecord` + `type PortfolioPayload` (lines 4-20).
  - Import `PortfolioUpdatedSubjectSchema` + `parseSubject`.
  - Replace cast (line 31) with `const payload = parseSubject(uow, PortfolioUpdatedSubjectSchema);`.
  - Reads: `payload.positions`, `payload.snapshot.lastEventSequence`, per-position `quantity/averageCostBasis/totalCostBasis/lastFillPrice` (all required on `LedgerPositionSchema`, ok), `payload.streamType`, `payload.snapshot.cashBalanceCents`, `payload.snapshot.positions`. No drift expected.

- [ ] **Step 3 — `services/ledger/ledger-bff/src/transforms/ledger-entry-recorded.ts`** (uow-style)
  - Delete local `type PositionRecord` + `type LedgerEntryPayload` (lines 4-20).
  - Import `LedgerEntrySubjectSchema` + `parseSubject`.
  - Replace cast (line 35) with `const payload = parseSubject(uow, LedgerEntrySubjectSchema);`.
  - Reads: `payload.snapshot?` (optional in schema, keep `?.`), `payload.streamType`, `payload.lastEventSequence`, `snapshot?.cashBalanceCents`, `snapshot?.positions`. No drift expected (schema already optional-models these).

- [ ] **Step 4 — `services/investor/dashboard-bff/src/transforms/position-snapshot.ts`** (uow-style)
  - Delete local `type LedgerPosition` + `type LedgerSnapshot` (lines 4-11).
  - Import `LedgerSnapshotSchema` + `parseSubject`. Because this transform reads `subject.snapshot ?? subject`, parse the envelope: `const { snapshot } = parseSubject(uow, z.object({ snapshot: LedgerSnapshotSchema }));` (import `z` from 'zod'). Drop the `?? subject` fallback (the producer always wraps).
  - Reads: `snapshot.lastEventSequence`, `snapshot.positions`, per-position `quantity/lastFillPrice/symbol/averageCostBasis/totalCostBasis` (all required on `LedgerPositionSchema`, ok).

- [ ] **Step 5 — `services/investor/dashboard-bff/src/transforms/time-travel-availability.ts`** (uow-style)
  - No local type (uses inline Record). Import `LedgerEntrySubjectSchema` + `parseSubject`.
  - Replace `const payload = event.subject as Record<string, unknown>;` (line 15) with `const payload = parseSubject(uow, LedgerEntrySubjectSchema);`.
  - Reads: `payload.lastEventSequence` (optional, ok), `payload.snapshotAt` (optional string, ok — already in schema). **Drift gate:** confirm `snapshotAt` is emitted on the ledger-entry subject (the saveSnapshot row carries it); if it is on a different event, adjust the schema.

- [ ] **Step 6 — `services/investor/investor-bff/src/transforms/balance-updated.ts`** (uow-style)
  - Delete local `interface BalanceUpdatedPayload` (lines 4-12).
  - This consumer reads `s.tenantId`, `s.userId`, `s.cashBalanceCents`, `s.snapshot?.lastEventSequence`. These come from the BALANCE_UPDATED re-broadcast (the CashBalance row OR the ledger BalanceEvent). **Verify which producer** investor-bff subscribes to for BALANCE_UPDATED: if it is ledger-ctrl's BalanceEvent, import `BalanceUpdatedSubjectSchema` from `@nestfolio/ledger-ctrl/contracts` (it has tenantId, cashBalanceCents, snapshot; add `userId: z.string().optional()` if the consumer needs it and it is emitted). If it is investor-bff's own CashBalance re-broadcast, this belongs in Task 6 (investor-bff self-contract) instead. Resolve the producer, then `const s = parseSubject(uow, <Schema>);`.

- [ ] **Step 7 — `services/advisory/decision-workflow-ctrl/src/handlers/snapshot-projector.ts` (ledger part only)** (HandlerFn-style)
  - In `projectLedgerSnapshot` (lines ~75-94): replace `const subject = payload.subject ?? {};` + `const snapshot = subject.snapshot as {...}` with `const subject = parseSubject(payload, BalanceUpdatedSubjectSchema);` and `const snapshot = subject.snapshot;` (import `BalanceUpdatedSubjectSchema`). The IP/Market parts are Task 9.
  - Reads: `snapshot.lastEventSequence`, `snapshot.cashBalanceCents`, `snapshot.positions`, plus `subject.tenantId`/`subject.sourceEventId` (add `sourceEventId: z.string().optional()` to the schema if read and emitted; `tenantId` is already present).

- [ ] **Step 8 — Verify + commit (per service)**

```bash
pnpm nx test ledger-bff && pnpm nx typecheck ledger-bff
pnpm nx test dashboard-bff && pnpm nx typecheck dashboard-bff
pnpm nx test investor-bff && pnpm nx typecheck investor-bff
pnpm nx test decision-workflow-ctrl && pnpm nx typecheck decision-workflow-ctrl
```

Commit per service, e.g.:
```bash
git add services/ledger/ledger-bff
git commit --no-verify -m "refactor(ledger-bff): type transforms against ledger-ctrl contracts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log --oneline -1
```

---

## Task 5: Broker funding vertical (broker-ctrl contract + sim/alpaca schemas + funding consumers)

broker-ctrl explicitly constructs the funding subject via `fundingCarrier()` (`services/execution/broker-ctrl/src/domain/funding.ts:40-68`), so `satisfies` is clean. broker-sim-adpt / broker-alpaca-adpt already have zod schemas — expose them via `/contracts` aliases instead of authoring new ones.

**Funding subject (from funding.ts):** `{ eventName, direction: 'DEPOSIT'|'WITHDRAWAL', status: 'requested'|'detected'|'settled'|'failed', transferId, tenantId, userId, region, amountCents, currency, executionMode, initiatedAt, detectedAt?, settledAt?, failedAt?, reason?, timestamp }`.

- [ ] **Step 1: Create `services/execution/broker-ctrl/src/domain/contracts.ts`**

```ts
// services/execution/broker-ctrl/src/domain/contracts.ts
import { z } from 'zod';

export const FundingSnapshotSchema = z.object({
  eventName: z.string(),
  direction: z.enum(['DEPOSIT', 'WITHDRAWAL']),
  status: z.enum(['requested', 'detected', 'settled', 'failed']),
  transferId: z.string(),
  tenantId: z.string(),
  userId: z.string(),
  region: z.string(),
  amountCents: z.number(),
  currency: z.string(),
  executionMode: z.enum(['simulation', 'live']),
  initiatedAt: z.string(),
  detectedAt: z.string().optional(),
  settledAt: z.string().optional(),
  failedAt: z.string().optional(),
  reason: z.string().optional(),
  timestamp: z.string(),
  // investor-bff projectVersioned guards on __version; CDC adds it to the row:
  __version: z.number().optional(),
});
export type FundingSnapshot = z.infer<typeof FundingSnapshotSchema>;
```

- [ ] **Step 2: Add `satisfies` at the construction site**

In `services/execution/broker-ctrl/src/domain/funding.ts`, annotate the object returned by `fundingCarrier` (lines ~40-68) `satisfies Omit<FundingSnapshot, '__version'>` (the carrier builds everything except the CDC-added `__version`). Import `type { FundingSnapshot } from './contracts'`. If `tsc` complains about excess/missing, adjust the `Omit`/`Pick` to match exactly what `fundingCarrier` returns.

- [ ] **Step 3: Add the tsconfig aliases** (broker-ctrl + expose sim/alpaca existing schemas)

In `tsconfig.base.json` `paths`:
```json
      "@nestfolio/broker-ctrl/contracts": ["services/execution/broker-ctrl/src/domain/contracts.ts"],
      "@nestfolio/broker-sim-adpt/contracts": ["services/execution/broker-sim-adpt/src/domain/schemas.ts"],
      "@nestfolio/broker-alpaca-adpt/contracts": ["services/execution/broker-alpaca-adpt/src/domain/schemas.ts"],
```
(broker-sim-adpt / broker-alpaca-adpt already export their zod schemas from `src/domain/schemas.ts`; the alias just makes them importable. If those schemas are `BusEventSchema.extend({subject:…})` shapes, expose/derive a subject-only schema — e.g. add `export const DepositDetectedSubjectSchema = DepositDetectedSchema.shape.subject;` — so consumers parse the subject, not the whole envelope.)

- [ ] **Step 4: Producer conformance test** — `services/execution/broker-ctrl/test/unit/domain/contracts.test.ts`: build a representative `fundingCarrier(...)` result and assert `FundingSnapshotSchema.parse(result)` does not throw, for both DEPOSIT and WITHDRAWAL and each status. Run `pnpm nx test broker-ctrl` (fails → create → passes).

- [ ] **Step 5: Retype the funding consumers**
  - `services/investor/investor-bff/src/transforms/deposit-lifecycle.ts`: delete local `interface FundingSnapshot` (lines 16-30); `import { FundingSnapshotSchema } from '@nestfolio/broker-ctrl/contracts';` + `parseSubject`; replace `const s = uow.event.subject as FundingSnapshot;` (line 35) with `const s = parseSubject(uow, FundingSnapshotSchema);`. Reads (tenantId,userId,region,transferId,amountCents,currency,status,initiatedAt,detectedAt,settledAt,failedAt,reason,__version) all map to the schema.
  - `services/investor/investor-bff/src/transforms/withdrawal-lifecycle.ts`: same recipe, delete local `interface FundingSnapshot` (lines 17-30), replace cast (line 35).
  - `services/execution/broker-ctrl/src/handlers/deposit-withdrawal-normalizer.ts` (HandlerFn-style): the 4 handlers read incoming SIM_*/ALPACA_TRANSFER_* subjects. Replace each `const s = payload.subject as Record<string, unknown>;` (lines 26, 58, 88, 96) with `parseSubject(payload, <SimOrAlpacaSubjectSchema>)` using the schema imported from `@nestfolio/broker-sim-adpt/contracts` (deposit/withdrawal completion) or `@nestfolio/broker-alpaca-adpt/contracts` (`AlpacaTransferResultSchema`, transfer completed/failed). **Drift gate:** the sim deposit/withdrawal completion schemas must include the fields read (`depositId`/`withdrawalId`/`amountCents`/`currency`/`userId`/`transferId`/`direction`/`failureReason`); add missing optionals to the adapter schema (the adapter owns it) where genuinely emitted.
  - `services/execution/broker-ctrl/src/handlers/deposit-withdrawal-router.ts` (HandlerFn-style): replace `const subject = payload.subject as Record<string, unknown>;` (lines 23, 52) with `parseSubject(payload, <DepositInitiated/WithdrawalInitiated subject schema>)`. These read `depositId`/`withdrawalId`/`userId`/`amountCents`/`currency`. The DEPOSIT_INITIATED / WITHDRAWAL_INITIATED producer is investor-bff — import its subject schema from `@nestfolio/investor-bff/contracts` (created in Task 6) OR, if the router runs before Task 6, define the minimal subject schema in broker-ctrl's own incoming-events contract. Resolve ordering: do the router retype AFTER Task 6, or add a small `DepositInitiatedSubjectSchema` to broker-ctrl `contracts.ts` keyed to what investor-bff emits. The `{ ...subject, direction }` spread keeps working on the parsed (typed) object.

- [ ] **Step 6: Verify + commit**

```bash
pnpm nx test broker-ctrl && pnpm nx typecheck broker-ctrl
pnpm nx test investor-bff && pnpm nx typecheck investor-bff
git add services/execution/broker-ctrl services/investor/investor-bff tsconfig.base.json
git commit --no-verify -m "refactor(broker-ctrl,investor-bff): type funding lifecycle against contracts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log --oneline -1
```

---

## Task 6: investor-bff profile/mandate contracts + dashboard investor-snapshot

investor-bff emits INVESTOR_PROFILE_CREATED/UPDATED (the InvestorProfile row) and MANDATE_ISSUED/REVOKED (the Mandate row) via CDC; the InvestorProfile row is constructed at `services/investor/investor-bff/src/transforms/onboarding-completed.ts:37-73`.

- [ ] **Step 1: Create `services/investor/investor-bff/src/domain/contracts.ts`** — model the fields consumers read (dashboard investor-snapshot reads `__version`, `goal.objective`, `riskProfile.score`, `operatingMode`, `onboardingCompletedAt`):

```ts
// services/investor/investor-bff/src/domain/contracts.ts
import { z } from 'zod';

export const InvestorProfileGoalSchema = z.object({
  objective: z.string(),
  timeHorizonMonths: z.number().optional(),
  targetAmountCents: z.number().optional(),
  currency: z.string().optional(),
  targetReturn: z.number().optional(),
});

export const InvestorProfileRiskSchema = z.object({
  score: z.number(),
  band: z.string().optional(),
  experienceLevel: z.string().optional(),
});

export const InvestorProfileSubjectSchema = z.object({
  tenantId: z.string(),
  userId: z.string(),
  operatingMode: z.enum(['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE']),
  goal: InvestorProfileGoalSchema,
  riskProfile: InvestorProfileRiskSchema,
  onboardingCompletedAt: z.string().optional(),
  __version: z.number().optional(),
});
export type InvestorProfileSubject = z.infer<typeof InvestorProfileSubjectSchema>;
```

Add the alias `"@nestfolio/investor-bff/contracts": ["services/investor/investor-bff/src/domain/contracts.ts"]` to `tsconfig.base.json`. Add `satisfies` (or a `Pick<>` thereof) at the InvestorProfile Put in onboarding-completed.ts:37-73, plus a conformance test.

- [ ] **Step 2: Retype `services/investor/dashboard-bff/src/transforms/investor-snapshot.ts`** — replace `const payload = event.subject as Record<string, unknown>;` (line 23) with `const payload = parseSubject(uow, InvestorProfileSubjectSchema);`. The nested `payload.goal as Record<string,unknown>` (line 28) and `payload.riskProfile as Record<string,unknown>` (line 29) casts are deleted — `payload.goal.objective` and `payload.riskProfile.score` are now typed. **Drift gate:** confirm `__version`, `operatingMode`, `onboardingCompletedAt` are emitted (they are, per the InvestorProfile row).

- [ ] **Step 3: Verify + commit**
```bash
pnpm nx test investor-bff && pnpm nx typecheck investor-bff
pnpm nx test dashboard-bff && pnpm nx typecheck dashboard-bff
git add services/investor/investor-bff services/investor/dashboard-bff tsconfig.base.json
git commit --no-verify -m "refactor(investor-bff,dashboard-bff): type investor profile against contract

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log --oneline -1
```

---

## Task 7: investor-ctrl NotificationCreated contract + investor-bff consumer

investor-ctrl builds the Notification subject at `services/investor/investor-ctrl/src/handlers/event-listener.ts:138-160` (`buildNotificationRecord`).

- [ ] **Step 1: Create `services/investor/investor-ctrl/src/domain/contracts.ts`** modelling what investor-bff notification-created reads (`tenantId, userId, notificationId, channel, title, body, relatedEntityType, relatedEntityId`):

```ts
// services/investor/investor-ctrl/src/domain/contracts.ts
import { z } from 'zod';

export const NotificationCreatedSubjectSchema = z.object({
  tenantId: z.string(),
  userId: z.string(),
  notificationId: z.string(),
  channel: z.string(),
  title: z.string(),
  body: z.string(),
  relatedEntityType: z.string().optional(),
  relatedEntityId: z.string().optional(),
});
export type NotificationCreatedSubject = z.infer<typeof NotificationCreatedSubjectSchema>;
```

**Drift gate:** the agent's emit dump showed the Notification subject has `type`/`status`/`sourceEventId` but NOT `userId`/`relatedEntityType`/`relatedEntityId`, while the investor-bff consumer reads `userId`/`relatedEntityType`/`relatedEntityId`. This is a real mismatch — resolve it: either investor-ctrl must emit those fields (add them at buildNotificationRecord + schema required), or the consumer reads are wrong (fix consumer + `backlog-add`). Make the schema match the RESOLVED producer emit; mark genuinely-absent-but-optional fields `z.optional()`.

Add alias `"@nestfolio/investor-ctrl/contracts": [...]`, `satisfies` at buildNotificationRecord, conformance test.

- [ ] **Step 2: Retype `services/investor/investor-bff/src/transforms/notification-created.ts`** — delete local `interface NotificationCreatedPayload` (lines 4-13); replace `const s = uow.event.subject as NotificationCreatedPayload;` (line 18) with `const s = parseSubject(uow, NotificationCreatedSubjectSchema);`.

- [ ] **Step 3: Verify + commit**
```bash
pnpm nx test investor-ctrl && pnpm nx typecheck investor-ctrl
pnpm nx test investor-bff && pnpm nx typecheck investor-bff
git add services/investor/investor-ctrl services/investor/investor-bff tsconfig.base.json
git commit --no-verify -m "refactor(investor-ctrl,investor-bff): type NotificationCreated against contract

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log --oneline -1
```

---

## Task 8: onboarding-bff OnboardingCompleted contract + investor-bff consumer + remaining dashboard/handler casts

onboarding-bff already has `OnboardingCompletedRecordSchema` (`services/investor/onboarding-bff/src/domain/schemas.ts`) — expose it; do not author a new one.

- [ ] **Step 1: Expose the existing schema** — add alias `"@nestfolio/onboarding-bff/contracts": ["services/investor/onboarding-bff/src/domain/schemas.ts"]` to `tsconfig.base.json`. If `schemas.ts` imports more than zod (pulls in heavy deps), split `OnboardingCompletedRecordSchema` into a new zod-only `services/investor/onboarding-bff/src/domain/contracts.ts` and re-export from `schemas.ts` to avoid changing existing imports; alias the new file.

- [ ] **Step 2: Retype `services/investor/investor-bff/src/transforms/onboarding-completed.ts`** (HandlerFn-style) — delete local `interface OnboardingCompletedSubject` (lines 6-20); `import { OnboardingCompletedRecordSchema, type OnboardingCompletedRecord } from '@nestfolio/onboarding-bff/contracts';` + `parseSubject`; replace `const s = payload.subject as unknown as OnboardingCompletedSubject;` (line 26) with `const s = parseSubject(payload, OnboardingCompletedRecordSchema);`. **Drift gate:** the consumer reads `s.mandateLevel` (optional in the schema — fine). All other reads (`tenantId, userId, email, goal.objective, horizonYears, accountMode, capitalAmount, currency, riskTolerance, riskExperience, operatingMode, mandateAccepted`) are in the schema.

- [ ] **Step 3: investor-bff handler GO_LIVE_CONFIRMED cast** — `services/investor/investor-bff/src/handlers/event-listener.ts:44`: replace `const subject = payload.subject as Record<string, unknown>;` (reads only `subject.userId`) with `parseSubject(payload, z.object({ userId: z.string() }))` (import `z`). This is a thin handler-local read of a single field; the minimal inline schema is acceptable here (the GO_LIVE_CONFIRMED producer is onboarding-bff — prefer importing a `GoLiveConfirmedSubjectSchema` from `@nestfolio/onboarding-bff/contracts` if one is worth adding; otherwise the inline `{ userId }` schema removes the raw cast).

- [ ] **Step 4: dashboard recent-activity** — `services/investor/dashboard-bff/src/transforms/recent-activity.ts:18`: this is a polymorphic activity feed reading all-optional display fields (`symbol, orderId, decisionId, reason, amountCents, currency`) across 8 event types — no single producer owns it. This is the **documented producer-ownership exception** from the spec. Define a consumer-owned `RecentActivitySubjectSchema = z.object({ symbol: z.string().optional(), orderId: z.string().optional(), decisionId: z.string().optional(), reason: z.string().optional(), amountCents: z.number().optional(), currency: z.string().optional() })` at the top of the file and replace `event.subject as Record<string, unknown>` with `parseSubject(uow, RecentActivitySubjectSchema)`. This removes the raw cast (keeping "0 remaining `as Record<string,unknown>`") while honestly marking it a view-model schema, not a producer contract. Note the exception in the commit message.

- [ ] **Step 5: Verify + commit**
```bash
pnpm nx test onboarding-bff && pnpm nx typecheck onboarding-bff
pnpm nx test investor-bff && pnpm nx typecheck investor-bff
pnpm nx test dashboard-bff && pnpm nx typecheck dashboard-bff
git add services/investor/onboarding-bff services/investor/investor-bff services/investor/dashboard-bff tsconfig.base.json
git commit --no-verify -m "refactor: type onboarding/go-live/activity reads against contracts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log --oneline -1
```

---

## Task 9: IP-ctrl + MI-ctrl snapshot contracts + finish snapshot-projector

The advisory snapshot subjects are CDC full rows carrying an `agentOutput` object. Reuse the existing agent-output schemas where present.

- [ ] **Step 1: investor-profile-ctrl contract** — create `services/advisory/investor-profile-ctrl/src/domain/contracts.ts`. snapshot-projector reads `subject.tenantId`, `subject.userId`, `subject.agentOutput`, `subject.__version`, `subject.sourceEventId`:

```ts
import { z } from 'zod';
export const InvestorProfileSnapshotSubjectSchema = z.object({
  tenantId: z.string(),
  userId: z.string(),
  agentOutput: z.object({
    goals: z.array(z.string()),
    timeHorizon: z.string(),
    riskWillingness: z.string(),
    riskScore: z.number(),
    riskCategory: z.enum(['CONSERVATIVE', 'MODERATE', 'AGGRESSIVE']),
    regulatoryFlags: z.array(z.string()),
    suitabilityAssessment: z.string(),
    confidence: z.number(),
  }),
  sourceEventId: z.string().optional(),
  __version: z.number().optional(),
});
export type InvestorProfileSnapshotSubject = z.infer<typeof InvestorProfileSnapshotSubjectSchema>;
```
Add the `/contracts` alias, a conformance test, and (best-effort) `satisfies` at the update intent in `investor-profile-ctrl/src/handlers/event-listener.ts:88-106` (CDC-row subject — the conformance test is the primary producer-side guard here).

- [ ] **Step 2: market-intelligence-ctrl contract** — create `services/advisory/market-intelligence-ctrl/src/domain/contracts.ts`. Reuse the existing `MarketAnalysisOutputSchema` (`src/agents/schemas.ts`) for `agentOutput`:

```ts
import { z } from 'zod';
import { MarketAnalysisOutputSchema } from '../agents/schemas';
export const MarketSnapshotSubjectSchema = z.object({
  region: z.string(),
  agentOutput: MarketAnalysisOutputSchema,
  __version: z.number().optional(),
});
export type MarketSnapshotSubject = z.infer<typeof MarketSnapshotSubjectSchema>;
```
(If `agents/schemas.ts` imports non-zod deps, copy the relevant schema into the zod-only `contracts.ts` instead of importing.) Add the alias + conformance test.

- [ ] **Step 3: Finish `snapshot-projector.ts`** — retype `projectIpSnapshot` (lines 25-40) with `parseSubject(payload, InvestorProfileSnapshotSubjectSchema)` and `projectMarketSnapshot` (lines 50-58) with `parseSubject(payload, MarketSnapshotSubjectSchema)`. Delete the inline `as Record<string,unknown>` / `?? {}` casts. The ledger part was done in Task 4 Step 7.

- [ ] **Step 4: Verify + commit**
```bash
pnpm nx test investor-profile-ctrl && pnpm nx typecheck investor-profile-ctrl
pnpm nx test market-intelligence-ctrl && pnpm nx typecheck market-intelligence-ctrl
pnpm nx test decision-workflow-ctrl && pnpm nx typecheck decision-workflow-ctrl
git add services/advisory/investor-profile-ctrl services/advisory/market-intelligence-ctrl services/advisory/decision-workflow-ctrl tsconfig.base.json
git commit --no-verify -m "refactor(advisory): type snapshot-projector against IP/Market contracts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log --oneline -1
```

---

## Task 10: Sweep — prove zero remaining casts + green affected build

- [ ] **Step 1: Assert no remaining `as Record<string, unknown>` subject casts in consumers**

```bash
grep -rn "subject as Record<string, unknown>" services/*/src \
  --include='*.ts' | grep -v '/test/'
```
Expected: **no output** (recent-activity now uses `RecentActivitySubjectSchema`). If any line remains, it was missed — retype it per the recipe.

- [ ] **Step 2: Assert no remaining locally re-declared payload types**

```bash
grep -rEn "type (Ledger|Balance|Portfolio|Funding|Notification|OnboardingCompleted)[A-Za-z]*Payload|interface (Funding|Notification|BalanceUpdated|OnboardingCompleted)" services/*/src --include='*.ts' | grep -v '/test/' | grep -v '/contracts.ts'
```
Expected: **no output** (all moved to producer `contracts.ts`).

- [ ] **Step 3: Full affected test + lint + typecheck**

```bash
pnpm nx affected -t test,lint,typecheck --base=origin/main
```
Expected: PASS across all affected projects. If the affected set is surprisingly large (event-processor's full closure), that is the known `nx affected` over-approximation tracked in `nx-affected-true-affected-resolver` — not a problem with this change. The new consumer→producer `/contracts` edges are intentional.

- [ ] **Step 4: Commit any lint autofix**
```bash
git add -A && git commit --no-verify -m "chore: lint/format sweep for payload contracts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" || echo "nothing to commit"
git log --oneline -1
```

---

## Task 11: Validation gate (`requires_deploy: true`)

Retyping consumer transforms with runtime `parseSubject` changes behaviour (malformed payloads now throw → DLQ), so deploy + runtime validation is required before the workstream is shipped. Dev-account ops need no confirmation ([[feedback-sole-dev-no-shared-caution]]).

- [ ] **Step 1: Detect + deploy affected services**
```bash
node .claude/skills/backlog-next/detect-deploy-needed.mjs
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=<affected from detect output>
```
The affected consumers: ledger-bff, dashboard-bff, investor-bff, broker-ctrl, decision-workflow-ctrl, investor-ctrl, investor-profile-ctrl, market-intelligence-ctrl (plus producers whose `contracts.ts`/`satisfies` changed but those are type-only — no Lambda behaviour change, so deploy only the consumers whose handler code changed).

- [ ] **Step 2: Scoped integration tests**
```bash
pnpm nx affected -t test-integration --base=origin/main
```
Expected: green. These use mocked agents — auto-run ([[feedback-integration-tests-auto-run]]).

- [ ] **Step 3: Involved e2e scenarios only** (never the full suite, never Playwright unless an involved scenario lives there). Run the ledger/balance, deposit/withdrawal funding, and advisory decision-path scenarios in `apps/e2e-feature-tests` via the env-scoped launcher (per [[feedback-e2e-nx-wrapper-strips-quotes]]):
```bash
NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev \
  JEST_NAME='deposit|withdrawal|balance|portfolio|decision' \
  pnpm nx run e2e-feature-tests:test-e2e-features
```
A failing-then-passing scenario is a real failure: pull CloudWatch DLQ/error evidence from the failing window before continuing and run a confirmation pass ([[feedback-flake-means-broken]]). A genuine `ZodError` on the DLQ during e2e means a contract does not match a real emitted payload — fix the contract, do not loosen it to `Record<string,unknown>`.

- [ ] **Step 4: Record the validation gate** in the backlog file's `validation_gate:` (commit SHA, deploy log line, integ + e2e command output) during the `/backlog-next` closing phase.

---

## Self-review (run before declaring the plan done)

1. **Spec coverage:** every spec §6 producer↔consumer row maps to a task — ledger (Tasks 2-4, 9-ledger), broker funding + sim/alpaca (Task 5), investor-bff profile/mandate (Task 6), investor-ctrl notification (Task 7), onboarding (Task 8), IP/MI snapshots (Task 9). The `parseSubject` seam (spec §2) = Task 1. Producer `satisfies` (spec §3) = each producer task. Failure mode (spec §4) = Task 3 regression + Task 11 e2e DLQ check. Non-strict (spec §1) = Conventions. Validation gate (spec §validation) = Task 11. Out-of-scope recent-activity exception is explicitly handled (Task 8 Step 4).
2. **Placeholder scan:** no TBD/TODO; every retype names the exact file, the local type to delete, the cast line to replace, and the schema to import. The drift-gate steps are deliberate STOP-and-verify points, not placeholders.
3. **Type consistency:** schema names are stable across tasks (`LedgerSnapshotSchema`, `BalanceUpdatedSubjectSchema`, `FundingSnapshotSchema`, `InvestorProfileSubjectSchema`, `NotificationCreatedSubjectSchema`, `OnboardingCompletedRecordSchema`, `InvestorProfileSnapshotSubjectSchema`, `MarketSnapshotSubjectSchema`); `parseSubject(carrier, schema)` signature is identical everywhere.
