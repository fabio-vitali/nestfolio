# Absorb command-core into event-processor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the standalone `command-core` lib (2 source files, 11 tests) by absorbing it into `event-processor` as a new `sourcing/` submodule, and clean up the stale `@nestfolio/agent-core` ESLint allowlist entry.

**Architecture:** Move `command.ts` + `reducer.ts` into `libs/event-processor/src/sourcing/`, expose via `@nestfolio/event-processor/sourcing` subpath barrel. Update all 14 consumer imports in `ledger-ctrl` (8 source + 6 test files). Delete the `libs/command-core/` directory and all its config references.

**Tech Stack:** TypeScript, Nx, Jest, Zod

**Scope note — items deferred:**
- `cdk-constructs` internal grouping: borderline at 19 files, not worth the churn right now. Revisit if it grows past ~25 files.
- `event-processor` scope tag change (`scope:platform` → `scope:shared`): semantically more accurate but functionally irrelevant since all consumers can already depend on `scope:platform`. No breakage either way, pure cosmetics — skip.

---

## File Structure

### Files to create
| File | Responsibility |
|------|---------------|
| `libs/event-processor/src/sourcing/command.ts` | `defineCommand`, `applyCommand` (moved from command-core, internal import of `../platform` for Result) |
| `libs/event-processor/src/sourcing/reducer.ts` | `replayEvents`, `LedgerEntry`, `EventReducer` (moved verbatim) |
| `libs/event-processor/src/sourcing/index.ts` | Subpath barrel re-exporting command + reducer |
| `libs/event-processor/test/sourcing/command.test.ts` | Moved tests (import path updated) |
| `libs/event-processor/test/sourcing/reducer.test.ts` | Moved tests (import path updated) |

### Files to modify
| File | Change |
|------|--------|
| `libs/event-processor/src/index.ts` | Add `// Sourcing (command + event replay)` re-export block |
| `tsconfig.base.json` | Remove `@nestfolio/command-core` path, add `@nestfolio/event-processor/sourcing` if not covered by wildcard |
| `eslint.config.js` | Remove `@nestfolio/agent-core` from allowlist (stale — lib was renamed to agent-orchestrator) |
| `services/ledger/ledger-ctrl/jest.config.js` | Remove `@nestfolio/command-core` moduleNameMapper entry |
| `services/ledger/ledger-ctrl/src/domain/submit-order.ts` | `@nestfolio/command-core` → `@nestfolio/event-processor/sourcing` |
| `services/ledger/ledger-ctrl/src/domain/record-deposit.ts` | Same import update |
| `services/ledger/ledger-ctrl/src/domain/record-withdrawal.ts` | Same import update |
| `services/ledger/ledger-ctrl/src/domain/record-fill.ts` | Same import update |
| `services/ledger/ledger-ctrl/src/domain/record-corporate-action.ts` | Same import update |
| `services/ledger/ledger-ctrl/src/domain/cancel-order.ts` | Same import update |
| `services/ledger/ledger-ctrl/src/domain/account.reducer.ts` | Same import update |
| `services/ledger/ledger-ctrl/src/handlers/reducer.ts` | Same import update |
| `services/ledger/ledger-ctrl/test/domain/submit-order.test.ts` | Same import update |
| `services/ledger/ledger-ctrl/test/domain/record-deposit.test.ts` | Same import update |
| `services/ledger/ledger-ctrl/test/domain/record-withdrawal.test.ts` | Same import update |
| `services/ledger/ledger-ctrl/test/domain/record-fill.test.ts` | Same import update |
| `services/ledger/ledger-ctrl/test/domain/record-corporate-action.test.ts` | Same import update |
| `services/ledger/ledger-ctrl/test/domain/cancel-order.test.ts` | Same import update |

### Files to delete
| File | Reason |
|------|--------|
| `libs/command-core/` (entire directory) | Absorbed into event-processor |

---

### Task 1: Move source files into event-processor/sourcing

**Files:**
- Create: `libs/event-processor/src/sourcing/command.ts`
- Create: `libs/event-processor/src/sourcing/reducer.ts`
- Create: `libs/event-processor/src/sourcing/index.ts`
- Modify: `libs/event-processor/src/index.ts`

- [ ] **Step 1: Create `libs/event-processor/src/sourcing/command.ts`**

Copy from `libs/command-core/src/command.ts` but fix the internal import — it no longer needs to reach across libs:

```ts
import { type ZodType } from 'zod';
import { type Result, ok, err } from '../platform';

export type Patches = ReadonlyArray<{
  readonly op: 'add' | 'replace' | 'remove';
  readonly path: string;
  readonly value?: unknown;
}>;

export interface CommandDef<P, S> {
  readonly type: string;
  readonly schema: ZodType<P>;
  readonly apply: (state: S, payload: P) => S;
}

export function defineCommand<P, S>(def: CommandDef<P, S>): CommandDef<P, S> {
  return Object.freeze(def);
}

export type CommandError =
  | { readonly type: 'validation'; readonly message: string; readonly issues: unknown[] }
  | { readonly type: 'invariant'; readonly message: string };

export function applyCommand<P, S>(
  command: CommandDef<P, S>,
  payload: unknown,
  state: S,
): Result<{ nextState: S; payload: P }, CommandError> {
  const parsed = command.schema.safeParse(payload);
  if (!parsed.success) {
    return err({
      type: 'validation',
      message: parsed.error.message,
      issues: parsed.error.issues,
    });
  }
  try {
    const nextState = command.apply(state, parsed.data);
    return ok({ nextState, payload: parsed.data });
  } catch (e) {
    return err({
      type: 'invariant',
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
```

- [ ] **Step 2: Create `libs/event-processor/src/sourcing/reducer.ts`**

Copy verbatim from `libs/command-core/src/reducer.ts` (no external imports to fix):

```ts
export interface LedgerEntry<T = unknown> {
  readonly eventId: string;
  readonly eventType: string;
  readonly payload: T;
  readonly timestamp: string;
  readonly sequenceNo: number;
}

export type EventReducer<S, T = unknown> = (state: S, entry: LedgerEntry<T>) => S;

export function replayEvents<S>(
  initialState: S,
  events: readonly LedgerEntry[],
  reducer: EventReducer<S>,
): S {
  return [...events]
    .sort((a, b) => a.sequenceNo - b.sequenceNo)
    .reduce((state, entry) => reducer(state, entry), initialState);
}
```

- [ ] **Step 3: Create `libs/event-processor/src/sourcing/index.ts`**

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

- [ ] **Step 4: Add sourcing re-exports to `libs/event-processor/src/index.ts`**

Append at the end of the file:

```ts
// Sourcing (command + event replay)
export {
  type CommandDef, type CommandError, type Patches,
  defineCommand, applyCommand,
  type LedgerEntry, type EventReducer, replayEvents,
} from './sourcing';
```

- [ ] **Step 5: Verify event-processor builds**

Run: `pnpm nx build event-processor`
Expected: BUILD SUCCESS

- [ ] **Step 6: Commit**

```bash
git add libs/event-processor/src/sourcing/
git add libs/event-processor/src/index.ts
git commit -m "feat(event-processor): add sourcing submodule (command + reducer from command-core)"
```

---

### Task 2: Move test files

**Files:**
- Create: `libs/event-processor/test/sourcing/command.test.ts`
- Create: `libs/event-processor/test/sourcing/reducer.test.ts`

- [ ] **Step 1: Create `libs/event-processor/test/sourcing/command.test.ts`**

Copy from `libs/command-core/test/command.test.ts`, update the import path:

```ts
import { z } from 'zod';
import { defineCommand, applyCommand } from '../../src/sourcing/command';
```

Rest of file is identical (lines 4–112 of the original).

- [ ] **Step 2: Create `libs/event-processor/test/sourcing/reducer.test.ts`**

Copy from `libs/command-core/test/reducer.test.ts`, update the import path:

```ts
import { replayEvents, type LedgerEntry, type EventReducer } from '../../src/sourcing/reducer';
```

Rest of file is identical (lines 3–82 of the original).

- [ ] **Step 3: Run event-processor tests**

Run: `pnpm nx test event-processor`
Expected: 13 tests pass (2 existing + 11 from sourcing)

- [ ] **Step 4: Commit**

```bash
git add libs/event-processor/test/sourcing/
git commit -m "test(event-processor): move command-core tests into sourcing submodule"
```

---

### Task 3: Update ledger-ctrl imports

**Files:**
- Modify: 8 source files in `services/ledger/ledger-ctrl/src/`
- Modify: 6 test files in `services/ledger/ledger-ctrl/test/domain/`
- Modify: `services/ledger/ledger-ctrl/jest.config.js`

- [ ] **Step 1: Update all source imports in ledger-ctrl**

In each of these 8 files, replace:
```ts
import { ... } from '@nestfolio/command-core';
```
with:
```ts
import { ... } from '@nestfolio/event-processor/sourcing';
```

Files (all under `services/ledger/ledger-ctrl/src/`):
1. `domain/submit-order.ts` — `defineCommand`
2. `domain/record-deposit.ts` — `defineCommand`
3. `domain/record-withdrawal.ts` — `defineCommand`
4. `domain/record-fill.ts` — `defineCommand`
5. `domain/record-corporate-action.ts` — `defineCommand`
6. `domain/cancel-order.ts` — `defineCommand`
7. `domain/account.reducer.ts` — `applyCommand, type EventReducer`
8. `handlers/reducer.ts` — `replayEvents, type LedgerEntry`

- [ ] **Step 2: Update all test imports in ledger-ctrl**

In each of these 6 files, replace:
```ts
import { applyCommand } from '@nestfolio/command-core';
```
with:
```ts
import { applyCommand } from '@nestfolio/event-processor/sourcing';
```

Files (all under `services/ledger/ledger-ctrl/test/domain/`):
1. `submit-order.test.ts`
2. `record-deposit.test.ts`
3. `record-withdrawal.test.ts`
4. `record-fill.test.ts`
5. `record-corporate-action.test.ts`
6. `cancel-order.test.ts`

- [ ] **Step 3: Remove command-core moduleNameMapper from ledger-ctrl jest.config.js**

In `services/ledger/ledger-ctrl/jest.config.js`, delete this line:
```js
    '^@nestfolio/command-core$': '<rootDir>/../../../libs/command-core/src/index.ts',
```

- [ ] **Step 4: Run ledger-ctrl tests**

Run: `pnpm nx test ledger-ctrl`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add services/ledger/ledger-ctrl/
git commit -m "refactor(ledger-ctrl): migrate imports from command-core to event-processor/sourcing"
```

---

### Task 4: Remove command-core and clean up config

**Files:**
- Delete: `libs/command-core/` (entire directory)
- Modify: `tsconfig.base.json`
- Modify: `eslint.config.js`

- [ ] **Step 1: Remove `@nestfolio/command-core` path from tsconfig.base.json**

Delete this line from `compilerOptions.paths`:
```json
      "@nestfolio/command-core": ["libs/command-core/src/index.ts"],
```

- [ ] **Step 2: Verify `@nestfolio/event-processor/sourcing` resolves via the existing wildcard**

The existing wildcard in tsconfig.base.json already covers subpath imports:
```json
      "@nestfolio/event-processor/*": ["libs/event-processor/src/*"],
```
This maps `@nestfolio/event-processor/sourcing` → `libs/event-processor/src/sourcing/index.ts`. No new path alias needed.

- [ ] **Step 3: Remove stale `@nestfolio/agent-core` from eslint allowlist**

In `eslint.config.js`, remove `'@nestfolio/agent-core'` from the `allow` array (around line 29). The lib was renamed to `agent-orchestrator` — this entry is dead.

- [ ] **Step 4: Delete the entire `libs/command-core/` directory**

```bash
rm -rf libs/command-core
```

This removes: `project.json`, `package.json`, `jest.config.js`, `tsconfig.json`, `tsconfig.lib.json`, `tsconfig.spec.json`, `src/` (3 files), `test/` (2 files).

- [ ] **Step 5: Verify no remaining references to command-core in source code**

```bash
grep -r "@nestfolio/command-core" --include="*.ts" --include="*.js" --include="*.json" . | grep -v node_modules | grep -v dist | grep -v docs/
```
Expected: no matches

- [ ] **Step 6: Run full workspace validation**

Run: `pnpm nx run-many -t build,test,lint -p event-processor,ledger-ctrl`
Expected: all targets pass

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: delete command-core lib (absorbed into event-processor/sourcing)"
```

---

## Summary

| Metric | Value |
|--------|-------|
| Tasks | 4 |
| Files created | 5 |
| Files modified | 16 |
| Files deleted | ~10 (entire command-core dir) |
| Import rewrites | 14 (8 source + 6 tests) |
| Net lib count | 6 → 5 |
| Risk | Low — single consumer (ledger-ctrl), no circular deps, existing wildcard covers new subpath |
