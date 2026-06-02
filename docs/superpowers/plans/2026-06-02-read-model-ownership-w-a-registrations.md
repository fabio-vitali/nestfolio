# Read-model ownership WS-A — producer registrations (type-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register the `CommandOwned`/`P2` ownership tags for every governed producer-surface row in the `ReadModelOwnership` type registry, with full BFF-parity enforcement scaffolding per service (augmentation + handler import + `@ts-expect-error` type-test + `tsconfig.type-test.json` + `typecheck` nx target). Type-only — no runtime change, no deploy.

**Architecture:** Each producer service gets a `src/read-model-ownership.ts` that augments `@nestfolio/event-processor`'s open `ReadModelOwnership` interface via `declare module`. Declaration merging is **per-compilation**, so each service only sees its own registrations; the workspace-wide `tools/check-read-model-drift.mjs` reads all augmentations into one global registry. Enforcement is compile-time: a dedicated `tsconfig.type-test.json` (compiling only the augmentation + `test/types/**`) drives a `typecheck` nx target whose `@ts-expect-error` directives prove the constraint fires. This mirrors the 4 existing BFFs (advisory/dashboard/investor/ledger) exactly.

**Tech Stack:** TypeScript declaration merging, nx `run-commands` targets, `tsc --noEmit`, the `@nestfolio/event-processor` intent factories (`record`/`update`/`project`/`accumulate`/`projectVersioned`).

---

## Verified row inventory (code-confirmed 2026-06-02)

Authoritative factory + file:line, confirmed by `tools/check-read-model-drift.mjs` whole-file scan + direct reads. Per-service compilation isolation + same-tag/distinct-name analysis confirms **no R1/R2/R3/R4 drift** is introduced.

| Service | Typename | Tag | Real factory (call site) | Positive type-test line |
|---|---|---|---|---|
| compliance-ctrl | `ComplianceCheck` | `Projection<'P2'>` | `record` (`src/handlers/event-listener.ts:65`) | `record('ComplianceCheck', …)` |
| compliance-ctrl | `AuditArtifact` | `Projection<'P2'>` | `record` (`src/handlers/event-listener.ts:146`) | `record('AuditArtifact', …)` |
| investor-ctrl | `Notification` | `CommandOwned` | `record` (`src/handlers/event-listener.ts:141`) | `record('Notification', …)` |
| investor-ctrl | `MonthlyReport` | `CommandOwned` | `record` (`src/handlers/event-listener.ts:175`) | `record('MonthlyReport', …)` |
| execution-ctrl | `Order` | `CommandOwned` | `record` ×3 (`src/handlers/event-listener.ts:45/62/78`) | `record('Order', …)` |
| execution-ctrl | `StagedOrder` | `CommandOwned` | `record` (`src/handlers/event-listener.ts:90`) | `record('StagedOrder', …)` |
| market-intelligence-ctrl | `MarketSnapshot` | `CommandOwned` | `update` ×2 (`src/handlers/event-listener.ts:96/117`) | `update('MarketSnapshot', …)` |
| investor-profile-ctrl | `InvestorProfileSnapshot` | `CommandOwned` | `record` (`src/handlers/event-listener.ts:93`) | `record('InvestorProfileSnapshot', …)` |
| decision-workflow-ctrl | `DecisionPacket` | `CommandOwned` | `update` ×2 (`src/handlers/sfn-callback.ts:73/105`) | `update('DecisionPacket', …)` |
| advisory-bff | `UserConfirmation` | `CommandOwned` | AppSync `fn.js` (`confirm-decision.fn.js:32`) — documentary | `record('UserConfirmation', …)` |
| advisory-bff | `UserRejection` | `CommandOwned` | AppSync `fn.js` (`reject-decision.fn.js:36`) — documentary | `record('UserRejection', …)` |
| advisory-bff | `UserInteraction` | `CommandOwned` | AppSync `fn.js` (`record-explanation-view.fn.js:24`) — documentary | `record('UserInteraction', …)` |

### Resolved classification questions

- **Order / StagedOrder → `CommandOwned`** (the design's open question). All `record()` writes hit the same PK `Order#{tenantId}#{orderId}` in mutually-exclusive status branches (REJECTED/SUBMITTED/STAGED), and `execution-ctrl` CLAUDE.md Egress + `staged-order-processor.ts` confirm a **status-update/modify path** (ORDER_SUBMITTED/REJECTED on modify; StagedOrderProcessor mutates then deletes). Mutable command-owned aggregates. The modify path is a raw repository write (not a factory/`fn.js`), so no R3 dual-writer.
- **`Notification` is also `record()`-written by investor-bff** (already registered `CommandOwned`). Same tag in investor-ctrl ⇒ no R4 conflict; the global drift registry already holds it, so registering it in investor-ctrl is locally-meaningful (enforces investor-ctrl's own call site) but does not change the global registered count.
- **`MarketSnapshot` / `InvestorProfileSnapshot`** are each written by their owner (MI-ctrl `update`, IP-ctrl `record`) **and** mirrored in decision-workflow-ctrl (`record`, currently unregistered). WS-A registers only the **owner** copy as `CommandOwned`; the DWC mirror stays unregistered until WS-C registers it `Projection<'P1'>` (which is when the R4-per-service refinement becomes a prerequisite). No R4 in WS-A.
- **`DecisionPacket`** (DWC) vs **`DecisionReadModel`** (advisory-bff/dashboard, P1) — distinct typenames, no collision.

### Constraint-compatibility (why no existing call site breaks)

The `@nestfolio/event-processor` factory constraints (`libs/event-processor/src/types/ownership.ts`):
- `record` rejects only `P1`/`P3` → `P2` and `CommandOwned` both allowed.
- `update`/`project`/`accumulate` reject **any** projection → `CommandOwned` allowed.
- `projectVersioned` rejects `CommandOwned` and `P2` → this is the single rejection a `CommandOwned` type-test asserts; a `P2` type-test asserts `projectVersioned` **and** `project`/`accumulate`.

Every WS-A registration is therefore compatible with its row's existing factory.

## Pre-existing conditions discovered (NOT WS-A scope — file separately)

- **advisory-bff has latent `tsc` errors** unrelated to this work (`src/repositories/advisory.repository.ts` lines 30/179/204/229/247/265: `'timestamp' does not exist in type 'TableEntry'`) — same class as the tracked `investor-bff-13-latent-tsc-errors` / `ledger-ctrl-2-latent-tsc-errors`. This is why advisory-bff gets its own **isolated** `tsconfig.type-test.json` (compiles only `src/read-model-ownership.ts` + `test/types/**`, skipping `advisory.repository.ts`) — so the WS-A type-test validates cleanly. File `advisory-bff-latent-tsc-errors` to the backlog (LATER).

## File structure

Per producer (`compliance-ctrl`, `investor-ctrl`, `execution-ctrl`, `market-intelligence-ctrl`, `investor-profile-ctrl`, `decision-workflow-ctrl`):
- **Create** `<svc>/src/read-model-ownership.ts` — `declare module` augmentation.
- **Modify** the writing handler (`src/handlers/event-listener.ts`, or `src/handlers/sfn-callback.ts` for DWC) — add side-effect `import '../read-model-ownership';`.
- **Create** `<svc>/test/types/read-model-ownership.type-test.ts` — `@ts-expect-error` proof.
- **Create** `<svc>/tsconfig.type-test.json` — isolated typecheck project.
- **Modify** `<svc>/project.json` — add `typecheck` target.
- **Modify** `<svc>/CLAUDE.md` — add `## Read model` section.

For advisory-bff (existing augmentation + type-test):
- **Modify** `src/read-model-ownership.ts` (+`CommandOwned` import, +3 rows), `test/types/read-model-ownership.type-test.ts` (+3 positive +3 `@ts-expect-error` rows).
- **Create** `tsconfig.type-test.json`, **Modify** `project.json` (+`typecheck` target), **Modify** `CLAUDE.md`.

## Per-service rhythm (red → green)

Every producer task follows the same shape. The **RED** proof: with an empty registry the `@ts-expect-error` rejection lines do not error, so `tsc` reports `Unused '@ts-expect-error' directive`. Filling the registry makes the rejection lines error (typename resolves to `never`), satisfying the directives → **GREEN**.

---

### Task 1: compliance-ctrl — `ComplianceCheck` / `AuditArtifact` (P2)

**Files:**
- Create: `services/advisory/compliance-ctrl/tsconfig.type-test.json`
- Modify: `services/advisory/compliance-ctrl/project.json`
- Create: `services/advisory/compliance-ctrl/src/read-model-ownership.ts`
- Modify: `services/advisory/compliance-ctrl/src/handlers/event-listener.ts`
- Create: `services/advisory/compliance-ctrl/test/types/read-model-ownership.type-test.ts`
- Modify: `services/advisory/compliance-ctrl/CLAUDE.md`

- [ ] **Step 1: Create `tsconfig.type-test.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/read-model-ownership.ts", "test/types/**/*.ts"]
}
```

- [ ] **Step 2: Add the `typecheck` target to `project.json`**

Insert into `"targets"` (sibling of the existing `"lint"` target):

```json
"typecheck": {
  "executor": "nx:run-commands",
  "options": {
    "command": "tsc --noEmit -p services/advisory/compliance-ctrl/tsconfig.type-test.json"
  }
}
```

- [ ] **Step 3: Create `src/read-model-ownership.ts` with an EMPTY registry (RED scaffold)**

```typescript
/**
 * compliance-ctrl read-model ownership registration (WS-A).
 *
 * Compile-time enforcement (see docs/architecture/READ-MODEL-OWNERSHIP.md):
 *   - ComplianceCheck / AuditArtifact : P2 append-logs → record() only
 *     (projectVersioned / project / accumulate fail typecheck).
 */
import type { Projection } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ReadModelOwnership {}
}

export {};
```

- [ ] **Step 4: Create `test/types/read-model-ownership.type-test.ts`**

```typescript
/**
 * Compile-time proof that compliance-ctrl's ownership registration rejects the
 * wrong write intents. A `@ts-expect-error` that does NOT error is itself a
 * compile failure. Verified by `nx run compliance-ctrl:typecheck`.
 */
import { project, accumulate, projectVersioned, record } from '@nestfolio/event-processor';
import '../../src/read-model-ownership';

// P2 append-logs: record() is the blessed write.
record('ComplianceCheck', { a: 1 });
record('AuditArtifact', { a: 1 });

// @ts-expect-error — projectVersioned on a P2 append-log must not typecheck
projectVersioned('ComplianceCheck', { a: 1 }, { version: 1 });
// @ts-expect-error — project on a P2 projection must not typecheck
project('ComplianceCheck', { a: 1 });
// @ts-expect-error — accumulate on a P2 projection must not typecheck
accumulate('AuditArtifact', { field: 'count', increment: 1 });
// @ts-expect-error — projectVersioned on a P2 append-log must not typecheck
projectVersioned('AuditArtifact', { a: 1 }, { version: 1 });

export {};
```

- [ ] **Step 5: Run typecheck — expect RED**

Run: `pnpm nx run compliance-ctrl:typecheck`
Expected: FAIL with `Unused '@ts-expect-error' directive` on the four rejection lines (registry empty → constraint inactive).

- [ ] **Step 6: Fill the registry + add the handler import (GREEN)**

In `src/read-model-ownership.ts`, replace the empty interface block with:

```typescript
declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    ComplianceCheck: Projection<'P2'>;
    AuditArtifact: Projection<'P2'>;
  }
}
```

In `src/handlers/event-listener.ts`, add this side-effect import immediately below the existing `@nestfolio/event-processor` import line:

```typescript
import '../read-model-ownership';
```

- [ ] **Step 7: Run typecheck — expect GREEN**

Run: `pnpm nx run compliance-ctrl:typecheck`
Expected: PASS (no output, exit 0).

- [ ] **Step 8: Add the `## Read model` section to `CLAUDE.md`** (insert after the `## Handlers` section)

```markdown
## Read model
- ReadModelOwnership registered in src/read-model-ownership.ts
  - P2 (append-only logs via record, idempotent/order-independent): ComplianceCheck, AuditArtifact
- Enforced by `nx run compliance-ctrl:typecheck` (test/types/read-model-ownership.type-test.ts)
```

- [ ] **Step 9: Commit**

```bash
git add services/advisory/compliance-ctrl
git commit -m "feat(compliance-ctrl): register ComplianceCheck/AuditArtifact P2 ownership (WS-A)"
```

---

### Task 2: investor-ctrl — `Notification` / `MonthlyReport` (CommandOwned)

**Files:**
- Create: `services/investor/investor-ctrl/tsconfig.type-test.json`
- Modify: `services/investor/investor-ctrl/project.json`
- Create: `services/investor/investor-ctrl/src/read-model-ownership.ts`
- Modify: `services/investor/investor-ctrl/src/handlers/event-listener.ts`
- Create: `services/investor/investor-ctrl/test/types/read-model-ownership.type-test.ts`
- Modify: `services/investor/investor-ctrl/CLAUDE.md`

- [ ] **Step 1: Create `tsconfig.type-test.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/read-model-ownership.ts", "test/types/**/*.ts"]
}
```

- [ ] **Step 2: Add the `typecheck` target to `project.json`**

```json
"typecheck": {
  "executor": "nx:run-commands",
  "options": {
    "command": "tsc --noEmit -p services/investor/investor-ctrl/tsconfig.type-test.json"
  }
}
```

- [ ] **Step 3: Create `src/read-model-ownership.ts` with an EMPTY registry (RED scaffold)**

```typescript
/**
 * investor-ctrl read-model ownership registration (WS-A).
 *
 * Compile-time enforcement (see docs/architecture/READ-MODEL-OWNERSHIP.md):
 *   - Notification / MonthlyReport : CommandOwned (seeded by one idempotent
 *     event via record()) → projectVersioned fails typecheck.
 * Notification is also a CommandOwned read-model row in investor-bff; the same
 * tag in both services is correct CQRS (producer copy + read-model copy) and
 * raises no registry conflict.
 */
import type { CommandOwned } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ReadModelOwnership {}
}

export {};
```

- [ ] **Step 4: Create `test/types/read-model-ownership.type-test.ts`**

```typescript
/**
 * Compile-time proof that investor-ctrl's ownership registration rejects the
 * wrong write intents. Verified by `nx run investor-ctrl:typecheck`.
 */
import { record, projectVersioned } from '@nestfolio/event-processor';
import '../../src/read-model-ownership';

// CommandOwned rows seeded by one idempotent event: record() is allowed.
record('Notification', { a: 1 });
record('MonthlyReport', { a: 1 });

// @ts-expect-error — projectVersioned on a command-owned row must not typecheck
projectVersioned('Notification', { a: 1 }, { version: 1 });
// @ts-expect-error — projectVersioned on a command-owned row must not typecheck
projectVersioned('MonthlyReport', { a: 1 }, { version: 1 });

export {};
```

- [ ] **Step 5: Run typecheck — expect RED**

Run: `pnpm nx run investor-ctrl:typecheck`
Expected: FAIL with `Unused '@ts-expect-error' directive` on the two rejection lines.

- [ ] **Step 6: Fill the registry + add the handler import (GREEN)**

In `src/read-model-ownership.ts`:

```typescript
declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    Notification: CommandOwned;
    MonthlyReport: CommandOwned;
  }
}
```

In `src/handlers/event-listener.ts`, add below the `@nestfolio/event-processor` import:

```typescript
import '../read-model-ownership';
```

- [ ] **Step 7: Run typecheck — expect GREEN**

Run: `pnpm nx run investor-ctrl:typecheck`
Expected: PASS.

- [ ] **Step 8: Add the `## Read model` section to `CLAUDE.md`** (after `## Handlers`)

```markdown
## Read model
- ReadModelOwnership registered in src/read-model-ownership.ts
  - CommandOwned (seeded by one idempotent event via record()): Notification, MonthlyReport
- Enforced by `nx run investor-ctrl:typecheck` (test/types/read-model-ownership.type-test.ts)
```

- [ ] **Step 9: Commit**

```bash
git add services/investor/investor-ctrl
git commit -m "feat(investor-ctrl): register Notification/MonthlyReport CommandOwned ownership (WS-A)"
```

---

### Task 3: execution-ctrl — `Order` / `StagedOrder` (CommandOwned)

**Files:**
- Create: `services/execution/execution-ctrl/tsconfig.type-test.json`
- Modify: `services/execution/execution-ctrl/project.json`
- Create: `services/execution/execution-ctrl/src/read-model-ownership.ts`
- Modify: `services/execution/execution-ctrl/src/handlers/event-listener.ts`
- Create: `services/execution/execution-ctrl/test/types/read-model-ownership.type-test.ts`
- Modify: `services/execution/execution-ctrl/CLAUDE.md`

- [ ] **Step 1: Create `tsconfig.type-test.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/read-model-ownership.ts", "test/types/**/*.ts"]
}
```

- [ ] **Step 2: Add the `typecheck` target to `project.json`**

```json
"typecheck": {
  "executor": "nx:run-commands",
  "options": {
    "command": "tsc --noEmit -p services/execution/execution-ctrl/tsconfig.type-test.json"
  }
}
```

- [ ] **Step 3: Create `src/read-model-ownership.ts` with an EMPTY registry (RED scaffold)**

```typescript
/**
 * execution-ctrl read-model ownership registration (WS-A).
 *
 * Compile-time enforcement (see docs/architecture/READ-MODEL-OWNERSHIP.md):
 *   - Order / StagedOrder : CommandOwned mutable aggregates (created via
 *     record(); status mutated/deleted by StagedOrderProcessor) →
 *     projectVersioned fails typecheck.
 */
import type { CommandOwned } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ReadModelOwnership {}
}

export {};
```

- [ ] **Step 4: Create `test/types/read-model-ownership.type-test.ts`**

```typescript
/**
 * Compile-time proof that execution-ctrl's ownership registration rejects the
 * wrong write intents. Verified by `nx run execution-ctrl:typecheck`.
 */
import { record, projectVersioned } from '@nestfolio/event-processor';
import '../../src/read-model-ownership';

// CommandOwned aggregates created via record(): record() is allowed.
record('Order', { a: 1 });
record('StagedOrder', { a: 1 });

// @ts-expect-error — projectVersioned on a command-owned row must not typecheck
projectVersioned('Order', { a: 1 }, { version: 1 });
// @ts-expect-error — projectVersioned on a command-owned row must not typecheck
projectVersioned('StagedOrder', { a: 1 }, { version: 1 });

export {};
```

- [ ] **Step 5: Run typecheck — expect RED**

Run: `pnpm nx run execution-ctrl:typecheck`
Expected: FAIL with `Unused '@ts-expect-error' directive` on the two rejection lines.

- [ ] **Step 6: Fill the registry + add the handler import (GREEN)**

In `src/read-model-ownership.ts`:

```typescript
declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    Order: CommandOwned;
    StagedOrder: CommandOwned;
  }
}
```

In `src/handlers/event-listener.ts`, add below the `@nestfolio/event-processor` import (the multi-clause one on line 4):

```typescript
import '../read-model-ownership';
```

- [ ] **Step 7: Run typecheck — expect GREEN**

Run: `pnpm nx run execution-ctrl:typecheck`
Expected: PASS.

- [ ] **Step 8: Add the `## Read model` section to `CLAUDE.md`** (after `## Handlers`)

```markdown
## Read model
- ReadModelOwnership registered in src/read-model-ownership.ts
  - CommandOwned (mutable aggregates created via record(); mutated/deleted by StagedOrderProcessor): Order, StagedOrder
- Enforced by `nx run execution-ctrl:typecheck` (test/types/read-model-ownership.type-test.ts)
```

- [ ] **Step 9: Commit**

```bash
git add services/execution/execution-ctrl
git commit -m "feat(execution-ctrl): register Order/StagedOrder CommandOwned ownership (WS-A)"
```

---

### Task 4: market-intelligence-ctrl — `MarketSnapshot` (CommandOwned)

**Files:**
- Create: `services/advisory/market-intelligence-ctrl/tsconfig.type-test.json`
- Modify: `services/advisory/market-intelligence-ctrl/project.json`
- Create: `services/advisory/market-intelligence-ctrl/src/read-model-ownership.ts`
- Modify: `services/advisory/market-intelligence-ctrl/src/handlers/event-listener.ts`
- Create: `services/advisory/market-intelligence-ctrl/test/types/read-model-ownership.type-test.ts`
- Modify: `services/advisory/market-intelligence-ctrl/CLAUDE.md`

- [ ] **Step 1: Create `tsconfig.type-test.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/read-model-ownership.ts", "test/types/**/*.ts"]
}
```

- [ ] **Step 2: Add the `typecheck` target to `project.json`**

```json
"typecheck": {
  "executor": "nx:run-commands",
  "options": {
    "command": "tsc --noEmit -p services/advisory/market-intelligence-ctrl/tsconfig.type-test.json"
  }
}
```

- [ ] **Step 3: Create `src/read-model-ownership.ts` with an EMPTY registry (RED scaffold)**

```typescript
/**
 * market-intelligence-ctrl read-model ownership registration (WS-A).
 *
 * Compile-time enforcement (see docs/architecture/READ-MODEL-OWNERSHIP.md):
 *   - MarketSnapshot : CommandOwned own-aggregate (one row per region,
 *     upserted continuously via update()) → projectVersioned fails typecheck.
 * The decision-workflow-ctrl MIRROR of MarketSnapshot is a separate physical
 * copy and is registered Projection<'P1'> in WS-C, not here.
 */
import type { CommandOwned } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ReadModelOwnership {}
}

export {};
```

- [ ] **Step 4: Create `test/types/read-model-ownership.type-test.ts`**

```typescript
/**
 * Compile-time proof that market-intelligence-ctrl's ownership registration
 * rejects the wrong write intents. Verified by `nx run market-intelligence-ctrl:typecheck`.
 */
import { update, projectVersioned } from '@nestfolio/event-processor';
import '../../src/read-model-ownership';

// CommandOwned own-aggregate upserted via update(): update() is allowed.
update('MarketSnapshot', { a: 1 });

// @ts-expect-error — projectVersioned on a command-owned aggregate must not typecheck
projectVersioned('MarketSnapshot', { a: 1 }, { version: 1 });

export {};
```

- [ ] **Step 5: Run typecheck — expect RED**

Run: `pnpm nx run market-intelligence-ctrl:typecheck`
Expected: FAIL with `Unused '@ts-expect-error' directive` on the rejection line.

- [ ] **Step 6: Fill the registry + add the handler import (GREEN)**

In `src/read-model-ownership.ts`:

```typescript
declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    MarketSnapshot: CommandOwned;
  }
}
```

In `src/handlers/event-listener.ts`, add below the `@nestfolio/event-processor` import block (after line 12):

```typescript
import '../read-model-ownership';
```

- [ ] **Step 7: Run typecheck — expect GREEN**

Run: `pnpm nx run market-intelligence-ctrl:typecheck`
Expected: PASS.

- [ ] **Step 8: Add the `## Read model` section to `CLAUDE.md`** (after `## Handlers`)

```markdown
## Read model
- ReadModelOwnership registered in src/read-model-ownership.ts
  - CommandOwned (own-aggregate, one row per region, upserted via update()): MarketSnapshot
  - (DWC mirror of MarketSnapshot is registered Projection<'P1'> in WS-C, not here.)
- Enforced by `nx run market-intelligence-ctrl:typecheck` (test/types/read-model-ownership.type-test.ts)
```

- [ ] **Step 9: Commit**

```bash
git add services/advisory/market-intelligence-ctrl
git commit -m "feat(market-intelligence-ctrl): register MarketSnapshot CommandOwned ownership (WS-A)"
```

---

### Task 5: investor-profile-ctrl — `InvestorProfileSnapshot` (CommandOwned)

**Files:**
- Create: `services/advisory/investor-profile-ctrl/tsconfig.type-test.json`
- Modify: `services/advisory/investor-profile-ctrl/project.json`
- Create: `services/advisory/investor-profile-ctrl/src/read-model-ownership.ts`
- Modify: `services/advisory/investor-profile-ctrl/src/handlers/event-listener.ts`
- Create: `services/advisory/investor-profile-ctrl/test/types/read-model-ownership.type-test.ts`
- Modify: `services/advisory/investor-profile-ctrl/CLAUDE.md`

- [ ] **Step 1: Create `tsconfig.type-test.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/read-model-ownership.ts", "test/types/**/*.ts"]
}
```

- [ ] **Step 2: Add the `typecheck` target to `project.json`**

```json
"typecheck": {
  "executor": "nx:run-commands",
  "options": {
    "command": "tsc --noEmit -p services/advisory/investor-profile-ctrl/tsconfig.type-test.json"
  }
}
```

- [ ] **Step 3: Create `src/read-model-ownership.ts` with an EMPTY registry (RED scaffold)**

```typescript
/**
 * investor-profile-ctrl read-model ownership registration (WS-A).
 *
 * Compile-time enforcement (see docs/architecture/READ-MODEL-OWNERSHIP.md):
 *   - InvestorProfileSnapshot : CommandOwned own-aggregate (written via
 *     record()) → projectVersioned fails typecheck.
 * The decision-workflow-ctrl MIRROR is registered Projection<'P1'> in WS-C.
 */
import type { CommandOwned } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ReadModelOwnership {}
}

export {};
```

- [ ] **Step 4: Create `test/types/read-model-ownership.type-test.ts`**

```typescript
/**
 * Compile-time proof that investor-profile-ctrl's ownership registration rejects
 * the wrong write intents. Verified by `nx run investor-profile-ctrl:typecheck`.
 */
import { record, projectVersioned } from '@nestfolio/event-processor';
import '../../src/read-model-ownership';

// CommandOwned own-aggregate written via record(): record() is allowed.
record('InvestorProfileSnapshot', { a: 1 });

// @ts-expect-error — projectVersioned on a command-owned aggregate must not typecheck
projectVersioned('InvestorProfileSnapshot', { a: 1 }, { version: 1 });

export {};
```

- [ ] **Step 5: Run typecheck — expect RED**

Run: `pnpm nx run investor-profile-ctrl:typecheck`
Expected: FAIL with `Unused '@ts-expect-error' directive` on the rejection line.

- [ ] **Step 6: Fill the registry + add the handler import (GREEN)**

In `src/read-model-ownership.ts`:

```typescript
declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    InvestorProfileSnapshot: CommandOwned;
  }
}
```

In `src/handlers/event-listener.ts`, add below the `@nestfolio/event-processor` import:

```typescript
import '../read-model-ownership';
```

- [ ] **Step 7: Run typecheck — expect GREEN**

Run: `pnpm nx run investor-profile-ctrl:typecheck`
Expected: PASS.

- [ ] **Step 8: Add the `## Read model` section to `CLAUDE.md`** (after `## Handlers`)

```markdown
## Read model
- ReadModelOwnership registered in src/read-model-ownership.ts
  - CommandOwned (own-aggregate written via record()): InvestorProfileSnapshot
  - (DWC mirror of InvestorProfileSnapshot is registered Projection<'P1'> in WS-C, not here.)
- Enforced by `nx run investor-profile-ctrl:typecheck` (test/types/read-model-ownership.type-test.ts)
```

- [ ] **Step 9: Commit**

```bash
git add services/advisory/investor-profile-ctrl
git commit -m "feat(investor-profile-ctrl): register InvestorProfileSnapshot CommandOwned ownership (WS-A)"
```

---

### Task 6: decision-workflow-ctrl — `DecisionPacket` (CommandOwned)

> Note: DWC also writes the mirror rows `MandateSnapshot`/`InvestorProfileSnapshot`/`MarketSnapshot`/`LedgerSnapshot`. Those are **WS-C** (`Projection<'P1'>`) and are deliberately **NOT** registered here — they stay unregistered in DWC's augmentation, so DWC's `record()`/`update()` mirror call sites remain unconstrained. WS-A registers only `DecisionPacket`, and the import goes only in `sfn-callback.ts`.

**Files:**
- Create: `services/advisory/decision-workflow-ctrl/tsconfig.type-test.json`
- Modify: `services/advisory/decision-workflow-ctrl/project.json`
- Create: `services/advisory/decision-workflow-ctrl/src/read-model-ownership.ts`
- Modify: `services/advisory/decision-workflow-ctrl/src/handlers/sfn-callback.ts`
- Create: `services/advisory/decision-workflow-ctrl/test/types/read-model-ownership.type-test.ts`
- Modify: `services/advisory/decision-workflow-ctrl/CLAUDE.md`

- [ ] **Step 1: Create `tsconfig.type-test.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/read-model-ownership.ts", "test/types/**/*.ts"]
}
```

- [ ] **Step 2: Add the `typecheck` target to `project.json`**

```json
"typecheck": {
  "executor": "nx:run-commands",
  "options": {
    "command": "tsc --noEmit -p services/advisory/decision-workflow-ctrl/tsconfig.type-test.json"
  }
}
```

- [ ] **Step 3: Create `src/read-model-ownership.ts` with an EMPTY registry (RED scaffold)**

```typescript
/**
 * decision-workflow-ctrl read-model ownership registration (WS-A).
 *
 * Compile-time enforcement (see docs/architecture/READ-MODEL-OWNERSHIP.md):
 *   - DecisionPacket : CommandOwned own-aggregate (update() + self-incremented
 *     __version) → projectVersioned fails typecheck.
 * DWC's mirror rows (MandateSnapshot/InvestorProfileSnapshot/MarketSnapshot/
 * LedgerSnapshot) are Projection<'P1'> and are registered in WS-C, not here.
 */
import type { CommandOwned } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ReadModelOwnership {}
}

export {};
```

- [ ] **Step 4: Create `test/types/read-model-ownership.type-test.ts`**

```typescript
/**
 * Compile-time proof that decision-workflow-ctrl's ownership registration rejects
 * the wrong write intents. Verified by `nx run decision-workflow-ctrl:typecheck`.
 */
import { update, projectVersioned } from '@nestfolio/event-processor';
import '../../src/read-model-ownership';

// CommandOwned own-aggregate written via update(): update() is allowed.
update('DecisionPacket', { a: 1 });

// @ts-expect-error — projectVersioned on a command-owned aggregate must not typecheck
projectVersioned('DecisionPacket', { a: 1 }, { version: 1 });

export {};
```

- [ ] **Step 5: Run typecheck — expect RED**

Run: `pnpm nx run decision-workflow-ctrl:typecheck`
Expected: FAIL with `Unused '@ts-expect-error' directive` on the rejection line.

- [ ] **Step 6: Fill the registry + add the handler import (GREEN)**

In `src/read-model-ownership.ts`:

```typescript
declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    DecisionPacket: CommandOwned;
  }
}
```

In `src/handlers/sfn-callback.ts`, add below the `@nestfolio/event-processor` import:

```typescript
import '../read-model-ownership';
```

- [ ] **Step 7: Run typecheck — expect GREEN**

Run: `pnpm nx run decision-workflow-ctrl:typecheck`
Expected: PASS.

- [ ] **Step 8: Add the `## Read model` section to `CLAUDE.md`** (after `## Handlers`)

```markdown
## Read model
- ReadModelOwnership registered in src/read-model-ownership.ts
  - CommandOwned (own-aggregate via update() + self-incremented __version): DecisionPacket
  - Mirror rows (MandateSnapshot/InvestorProfileSnapshot/MarketSnapshot/LedgerSnapshot) → Projection<'P1'> in WS-C, not registered here.
- Enforced by `nx run decision-workflow-ctrl:typecheck` (test/types/read-model-ownership.type-test.ts)
```

- [ ] **Step 9: Commit**

```bash
git add services/advisory/decision-workflow-ctrl
git commit -m "feat(decision-workflow-ctrl): register DecisionPacket CommandOwned ownership (WS-A)"
```

---

### Task 7: advisory-bff — add `UserConfirmation` / `UserRejection` / `UserInteraction` (CommandOwned)

> advisory-bff already has `src/read-model-ownership.ts` (DecisionReadModel P1, AdvisoryStatus P3) + a type-test. The User* rows are written by AppSync `fn.js` PutItems (outside event-processor), so the registration is documentary — the type-test still proves the registry rejects the wrong intent. advisory-bff gets an **isolated** `tsconfig.type-test.json` (its `tsconfig.spec.json` has pre-existing latent `tsc` errors unrelated to this work — see "Pre-existing conditions").

**Files:**
- Modify: `services/advisory/advisory-bff/src/read-model-ownership.ts`
- Modify: `services/advisory/advisory-bff/test/types/read-model-ownership.type-test.ts`
- Create: `services/advisory/advisory-bff/tsconfig.type-test.json`
- Modify: `services/advisory/advisory-bff/project.json`
- Modify: `services/advisory/advisory-bff/CLAUDE.md`

- [ ] **Step 1: Create `tsconfig.type-test.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/read-model-ownership.ts", "test/types/**/*.ts"]
}
```

- [ ] **Step 2: Add the `typecheck` target to `project.json`**

```json
"typecheck": {
  "executor": "nx:run-commands",
  "options": {
    "command": "tsc --noEmit -p services/advisory/advisory-bff/tsconfig.type-test.json"
  }
}
```

- [ ] **Step 3: Add the 3 User* rows to the type-test FIRST (RED)**

In `test/types/read-model-ownership.type-test.ts`, append before the final `export {};`:

```typescript
// User command rows (AppSync fn.js writes; CommandOwned). projectVersioned is rejected.
record('UserConfirmation', { a: 1 });
record('UserRejection', { a: 1 });
record('UserInteraction', { a: 1 });
// @ts-expect-error — projectVersioned on a command-owned row must not typecheck
projectVersioned('UserConfirmation', { a: 1 }, { version: 1 });
// @ts-expect-error — projectVersioned on a command-owned row must not typecheck
projectVersioned('UserRejection', { a: 1 }, { version: 1 });
// @ts-expect-error — projectVersioned on a command-owned row must not typecheck
projectVersioned('UserInteraction', { a: 1 }, { version: 1 });
```

- [ ] **Step 4: Run typecheck — expect RED**

Run: `pnpm nx run advisory-bff:typecheck`
Expected: FAIL with `Unused '@ts-expect-error' directive` on the three new rejection lines (User* not yet registered).

- [ ] **Step 5: Register the 3 rows (GREEN)**

In `src/read-model-ownership.ts`, change the import line to add `CommandOwned`:

```typescript
import type { Projection, CommandOwned } from '@nestfolio/event-processor';
```

and add the three rows inside `interface ReadModelOwnership` (below `AdvisoryStatus`):

```typescript
    // CommandOwned — user command rows written by AppSync fn.js PutItems.
    UserConfirmation: CommandOwned;
    UserRejection: CommandOwned;
    UserInteraction: CommandOwned;
```

- [ ] **Step 6: Run typecheck — expect GREEN**

Run: `pnpm nx run advisory-bff:typecheck`
Expected: PASS.

- [ ] **Step 7: Update the `## Read model` note in `CLAUDE.md`**

If advisory-bff's `CLAUDE.md` has a `## Read model` section, append; else add it after `## Handlers`:

```markdown
## Read model
- ReadModelOwnership registered in src/read-model-ownership.ts
  - P1 (projectVersioned): DecisionReadModel
  - P3 (projectVersioned, derived): AdvisoryStatus
  - CommandOwned (AppSync fn.js PutItems): UserConfirmation, UserRejection, UserInteraction
- Enforced by `nx run advisory-bff:typecheck` (test/types/read-model-ownership.type-test.ts)
```

- [ ] **Step 8: Commit**

```bash
git add services/advisory/advisory-bff
git commit -m "feat(advisory-bff): register User* CommandOwned ownership + typecheck target (WS-A)"
```

---

### Task 8: Workspace-wide validation gate

- [ ] **Step 1: Drift checker — registrations parsed, no drift**

Run: `pnpm nx run event-processor:read-model-drift`
Expected: `read-model-drift: OK (... registered typename(s), 0 drift)`. The INFO list shrinks by the newly-registered typenames (ComplianceCheck, AuditArtifact, MonthlyReport, Order, StagedOrder, MarketSnapshot, InvestorProfileSnapshot, DecisionPacket, UserConfirmation, UserRejection, UserInteraction). `Notification` was already registered (investor-bff), so it does not move. **Zero `[R1]`/`[R2]`/`[R3]`/`[R4]` error lines.**

- [ ] **Step 2: All seven typecheck targets green**

Run: `pnpm nx run-many -t typecheck -p compliance-ctrl,investor-ctrl,execution-ctrl,market-intelligence-ctrl,investor-profile-ctrl,decision-workflow-ctrl,advisory-bff`
Expected: 7/7 PASS.

- [ ] **Step 3: Affected test + lint + typecheck (boundary + regression gate)**

Run: `pnpm nx affected -t typecheck,test,lint --base=origin/main`
Expected: PASS. The `lint` run re-proves `@nx/enforce-module-boundaries` (no new cross-service imports introduced). `test` confirms no unit regressions from the side-effect imports.

- [ ] **Step 4: No deploy**

This workstream is type-only. Do NOT deploy. `detect-deploy-needed.mjs` should report no deploy needed (only `*/read-model-ownership.ts`, `test/types/**`, `tsconfig.type-test.json`, `project.json` target additions, `CLAUDE.md`, and one side-effect import per handler changed — none alters bundled runtime behavior).

---

## Out of scope (mirrors backlog `out_of_scope:`)

- Any `projectVersioned` conversion or event-contract `__version` change (WS-B / WS-C).
- The drift-checker mandatory-error upgrade + `tools/read-model-exclusions.json` (WS-D).
- Registering DWC's mirror rows / compliance-ctrl `MandateSnapshot` (WS-C `Projection<'P1'>`).
- broker-ctrl `ExecutionMode` registration (WS-D Tier-4).
- Wiring `typecheck` into `targetDefaults` + the PR workflow, and ledger-bff's missing typecheck target (WS-D folded `bff-readmodel-typecheck-targets-not-in-ci`). WS-A reduces that folded item to *ledger-bff target + CI wiring* by giving advisory-bff its target here.
- Fixing advisory-bff's pre-existing latent `tsc` errors (file `advisory-bff-latent-tsc-errors` to backlog).

## Self-review

- **Spec coverage:** every row in the design § "Corrected classification" WS-A column (ComplianceCheck, AuditArtifact, Notification, MonthlyReport, Order, StagedOrder, MarketSnapshot, InvestorProfileSnapshot, DecisionPacket, User*) has a task. Order/StagedOrder status-update question resolved (CommandOwned). ✓
- **Type consistency:** `Projection<'P2'>` for compliance rows; `CommandOwned` for all others; positive type-test factory matches each row's real factory (`record` except MarketSnapshot/DecisionPacket → `update`); the single asserted rejection for CommandOwned is `projectVersioned`, for P2 it is `projectVersioned`+`project`/`accumulate`. ✓
- **No placeholders:** every code block is complete and copy-pasteable. ✓
