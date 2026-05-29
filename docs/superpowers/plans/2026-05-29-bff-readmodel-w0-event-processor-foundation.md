# BFF Read-Model w0 — event-processor foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `projectVersioned` versioned-snapshot WriteIntent, the reserved `__version` convention, and compile-time row-ownership type tags to `event-processor`, plus the canonical ownership doc + `test-support` helper + skill update — with zero consumer behavior change (no BFF migrated yet).

**Architecture:** A new `projectVersioned` intent does a full-row conditional `PutItem` guarded by `attribute_not_exists(pk) OR attribute_not_exists(#__version) OR #__version < :version` (the middle clause lets the first versioned write self-heal a legacy row previously written by plain `project()`); on condition-fail it is **dropped as stale/deduplicated** (NOT redriven — distinct from `updateOrRetry`). Row ownership is encoded as a **declaration-merging open registry** (`interface ReadModelOwnership {}`) augmented per-service via `declare module`; all intent factories become generic over the merged registry and **reject known-bad typenames via conditional types**, degrading to plain `string` for unregistered typenames so existing call sites keep compiling. The registry is empty at w0 (no breakage); enforcement bites incrementally as each BFF registers its rows in w1–5.

**Tech Stack:** TypeScript (conditional/mapped types), `@aws-sdk/lib-dynamodb` (`PutCommand`), Nx, Jest + `aws-sdk-client-mock`, `tsc --noEmit` for type-level assertions.

---

## Design decisions (settled)

- **Enforcement mechanism:** declaration-merging registry (chosen 2026-05-29 via AskUserQuestion).
- **Reserved attribute:** `__version` (double-underscore, mirrors `__typename`), stamped on the owned row and (in w1–5) carried top-level in emitted events. ledger's `lastEventSequence` is the existing reference sequence; the convention is documented in `READ-MODEL-OWNERSHIP.md`.
- **`projectVersioned` write op:** conditional **`PutItem`** (full-row replace) — closes structural-zeros by writing the entire snapshot, no stale leftover fields. Guard: `attribute_not_exists(pk) OR attribute_not_exists(#__version) OR #__version < :version`. The middle clause is a **legacy-row self-heal**: the first versioned write to a row that pre-dates versioning (no `__version`, e.g. written by plain `project()`) is accepted rather than silently dropped, so the w1–5 migration path converges.
- **Stale handling:** `ConditionalCheckFailedException` (equal/older version on an already-versioned row) → `{ success: true, deduplicated: true }` (terminal/dropped). The `updateOrRetry` precondition-wait path (`RetryablePreconditionError`) is untouched.
- **Per-factory ownership constraints:**
  | factory | rejects (when registered) | rationale |
  |---|---|---|
  | `projectVersioned` | CommandOwned, P2, P3 | only the blessed P1 writer |
  | `project` (footgun) | any Projection (P1/P2/P3) | unconditional overwrite is seed/command-only |
  | `accumulate` | any Projection | "never accumulate a cross-event projection" |
  | `update` / `updateOrRetry` | any Projection | command writes go to owned rows |
  | `record` | P1, P3 | P2 append-log is the legitimate `record()` target |
  - Empty registry ⇒ every reject-type resolves to `never` ⇒ nothing rejected ⇒ all current call sites compile unchanged.

## File structure

- Create `libs/event-processor/src/types/ownership.ts` — tags, open registry, reject-constraint helper types.
- Modify `libs/event-processor/src/types/write-intent.ts` — add `ProjectVersionedIntent` + union member.
- Create `libs/event-processor/src/intents/project-versioned.ts` — the factory.
- Modify `libs/event-processor/src/intents/{record,project,accumulate,update,update-or-retry}.ts` — generic + ownership constraint on `typename`.
- Modify `libs/event-processor/src/engine/intent-executor.ts` — `executeProjectVersioned` + switch case.
- Modify `libs/event-processor/src/intents/index.ts` and `src/index.ts` — exports.
- Create `libs/event-processor/tsconfig.type-test.json` + add `typecheck` target to `project.json`.
- Create `libs/event-processor/test/types/ownership.type-test.ts` — `@ts-expect-error` assertions.
- Create `libs/event-processor/test/intents/project-versioned.test.ts` and extend `test/engine/intent-executor.test.ts`.
- Create `libs/test-support/src/fixtures/version-guard.ts` + `libs/test-support/test/version-guard.test.ts`; export from `libs/test-support/src/index.ts`.
- Create `docs/architecture/READ-MODEL-OWNERSHIP.md`.
- Modify `.claude/skills/event-processor-patterns/SKILL.md`.

---

## Task 1: Ownership tags + open registry + reject-constraint types

**Files:**
- Create: `libs/event-processor/src/types/ownership.ts`
- Modify: `libs/event-processor/src/index.ts` (export the new types)
- Create: `libs/event-processor/tsconfig.type-test.json`
- Modify: `libs/event-processor/project.json` (add `typecheck` target)
- Test: `libs/event-processor/test/types/ownership.type-test.ts`

- [ ] **Step 1: Write the ownership types**

Create `libs/event-processor/src/types/ownership.ts`:

```typescript
/**
 * Row-ownership type tags + the declaration-merging registry that steers each
 * write intent to its allowed typenames at compile time. See
 * docs/architecture/READ-MODEL-OWNERSHIP.md for the model.
 *
 * The registry is EMPTY by default: every reject-helper below resolves to
 * `never`, so an empty registry rejects nothing and all `typename: string`
 * call sites compile unchanged. A service opts a typename into enforcement by
 * augmenting `ReadModelOwnership` via `declare module '@nestfolio/event-processor'`.
 */
export type ProjectionVariant = 'P1' | 'P2' | 'P3';

/** Aggregate this context owns: read-your-own-writes, field-level command writes. */
export interface CommandOwned {
  readonly __ownership: 'command';
}

/** Pure copy fed by an owner's versioned announcements. */
export interface Projection<V extends ProjectionVariant = ProjectionVariant> {
  readonly __ownership: 'projection';
  readonly __variant: V;
}

export type OwnershipTag = CommandOwned | Projection;

/**
 * Open registry — augmented per service:
 *   declare module '@nestfolio/event-processor' {
 *     interface ReadModelOwnership { PortfolioSummary: Projection<'P1'> }
 *   }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface, @typescript-eslint/no-empty-object-type
export interface ReadModelOwnership {}

type OwnedKeys = keyof ReadModelOwnership;

type ProjectionKeysOf<V extends ProjectionVariant> = {
  [K in OwnedKeys]: ReadModelOwnership[K] extends Projection<V> ? K : never;
}[OwnedKeys];

/** Typenames registered as ANY projection variant. */
export type AnyProjectionKey = {
  [K in OwnedKeys]: ReadModelOwnership[K] extends Projection ? K : never;
}[OwnedKeys];

/** Typenames registered as command-owned. */
export type CommandOwnedKey = {
  [K in OwnedKeys]: ReadModelOwnership[K] extends CommandOwned ? K : never;
}[OwnedKeys];

export type P1Key = ProjectionKeysOf<'P1'>;
export type P2Key = ProjectionKeysOf<'P2'>;
export type P3Key = ProjectionKeysOf<'P3'>;

// --- factory constraints: reject known-bad, allow unregistered + ok ---

/** projectVersioned: only P1 (or unregistered). Reject command-owned / P2 / P3. */
export type RejectNonP1<K extends string> = K extends CommandOwnedKey | P2Key | P3Key ? never : K;

/** project / accumulate / update / updateOrRetry: reject ANY projection. */
export type RejectProjection<K extends string> = K extends AnyProjectionKey ? never : K;

/** record: reject P1 + P3 (P2 append-log is the legitimate record() target). */
export type RejectNonAppend<K extends string> = K extends P1Key | P3Key ? never : K;
```

- [ ] **Step 2: Export the types**

In `libs/event-processor/src/index.ts`, add near the other `export type` blocks (after line 5):

```typescript
export type {
  ProjectionVariant, CommandOwned, Projection, OwnershipTag, ReadModelOwnership,
  AnyProjectionKey, CommandOwnedKey, P1Key, P2Key, P3Key,
  RejectNonP1, RejectProjection, RejectNonAppend,
} from './types/ownership';
```

- [ ] **Step 3: Add the typecheck target**

Create `libs/event-processor/tsconfig.type-test.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/types/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "src/**/*.spec.ts"]
}
```

In `libs/event-processor/project.json`, add to `targets` (after `lint`):

```json
    "typecheck": {
      "executor": "nx:run-commands",
      "options": {
        "command": "tsc --noEmit -p libs/event-processor/tsconfig.type-test.json"
      }
    }
```

- [ ] **Step 4: Write the type-level test (failing assertions live here)**

Create `libs/event-processor/test/types/ownership.type-test.ts`:

```typescript
/**
 * Type-level tests. Validated by `pnpm nx run event-processor:typecheck`
 * (tsc --noEmit). No runtime assertions — a `@ts-expect-error` that does NOT
 * error is a compile failure, which is the test failing.
 */
import { accumulate, project, record, update, updateOrRetry, projectVersioned } from '../../src';
import type { Projection, CommandOwned } from '../../src';

// --- empty-registry baseline: everything compiles as plain string ---
accumulate('AnyUnregistered', { field: 'count', increment: 1 });
project('AnyUnregistered', { a: 1 });
record('AnyUnregistered', { a: 1 });
update('AnyUnregistered', { a: 1 });
projectVersioned('AnyUnregistered', { a: 1 }, { version: 1 });

// --- local augmentation turns on enforcement for these typenames ---
declare module '../../src' {
  interface ReadModelOwnership {
    TestP1: Projection<'P1'>;
    TestP2: Projection<'P2'>;
    TestCmd: CommandOwned;
  }
}

// P1 projection: projectVersioned ok; the footguns are rejected.
projectVersioned('TestP1', { a: 1 }, { version: 1 });
// @ts-expect-error — accumulate on a projection must not typecheck
accumulate('TestP1', { field: 'count', increment: 1 });
// @ts-expect-error — unconditional project on a P1 projection must not typecheck
project('TestP1', { a: 1 });
// @ts-expect-error — command update on a projection must not typecheck
update('TestP1', { a: 1 });
// @ts-expect-error — record (append) on a P1 projection must not typecheck
record('TestP1', { a: 1 });

// P2 append log: record ok; projectVersioned rejected.
record('TestP2', { a: 1 });
// @ts-expect-error — projectVersioned on a P2 projection must not typecheck
projectVersioned('TestP2', { a: 1 }, { version: 1 });

// Command-owned: update ok; projectVersioned rejected.
update('TestCmd', { a: 1 });
// @ts-expect-error — projectVersioned on a command-owned row must not typecheck
projectVersioned('TestCmd', { a: 1 }, { version: 1 });
```

- [ ] **Step 5: Run typecheck to verify it fails**

Run: `pnpm nx run event-processor:typecheck`
Expected: FAIL — `projectVersioned` / `RejectNonP1` etc. are not yet exported and the imports resolve to nothing (Tasks 2–4 add the factory). The `@ts-expect-error` lines will also error on unresolved `projectVersioned`. (This is the failing-test state; it goes green after Task 4.)

- [ ] **Step 6: Run the existing typecheck baseline on src only (no regressions)**

Run: `pnpm nx run event-processor:build`
Expected: PASS — `ownership.ts` compiles cleanly. If pre-existing unrelated type errors surface in event-processor `src`, STOP, file them via `backlog-add`, and do NOT fix them in this workstream.

- [ ] **Step 7: Commit**

```bash
git add libs/event-processor/src/types/ownership.ts libs/event-processor/src/index.ts libs/event-processor/tsconfig.type-test.json libs/event-processor/project.json libs/event-processor/test/types/ownership.type-test.ts
git commit -m "feat(event-processor): add read-model ownership tags + open registry + typecheck target"
```

---

## Task 2: `ProjectVersionedIntent` type + union + factory

**Files:**
- Modify: `libs/event-processor/src/types/write-intent.ts`
- Create: `libs/event-processor/src/intents/project-versioned.ts`
- Modify: `libs/event-processor/src/intents/index.ts`, `libs/event-processor/src/index.ts`
- Test: `libs/event-processor/test/intents/project-versioned.test.ts`

- [ ] **Step 1: Write the failing factory unit test**

Create `libs/event-processor/test/intents/project-versioned.test.ts`:

```typescript
import { projectVersioned } from '../../src/intents/project-versioned';

describe('projectVersioned()', () => {
  it('creates a ProjectVersionedIntent (inline fields + static version)', () => {
    const intent = projectVersioned('PortfolioSummary', { totalValueCents: 100 }, { version: 7 });
    expect(intent).toEqual({
      _tag: 'projectVersioned',
      typename: 'PortfolioSummary',
      fields: { totalValueCents: 100 },
      version: 7,
    });
  });

  it('passes overrides through', () => {
    const intent = projectVersioned('PortfolioSummary', { a: 1 }, {
      version: 2,
      overrides: { pk: 'P#1', sk: 'S#1' },
    });
    expect(intent).toMatchObject({ overrides: { pk: 'P#1', sk: 'S#1' }, version: 2 });
  });

  it('mapper mode returns a HandlerFn that derives fields + version from payload', () => {
    const fn = projectVersioned(
      'PortfolioSummary',
      (payload) => ({ totalValueCents: (payload as { v: number }).v }),
      { version: (payload) => (payload as { seq: number }).seq },
    );
    const intent = (fn as (p: unknown, c: unknown) => unknown)({ v: 50, seq: 9 }, {});
    expect(intent).toEqual({
      _tag: 'projectVersioned',
      typename: 'PortfolioSummary',
      fields: { totalValueCents: 50 },
      version: 9,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test event-processor --testFile=test/intents/project-versioned.test.ts`
Expected: FAIL — `Cannot find module '../../src/intents/project-versioned'`.

- [ ] **Step 3: Add the intent type to the union**

In `libs/event-processor/src/types/write-intent.ts`, add the interface after `ProjectIntent` (after line ~21):

```typescript
export interface ProjectVersionedIntent {
  readonly _tag: 'projectVersioned';
  readonly typename: string;
  readonly fields: Record<string, unknown>;
  /** Monotonic version stamped on the owned row (reserved `__version` attribute). */
  readonly version: number;
  readonly overrides?: KeyOverrides;
}
```

Update the union (line 63) to:

```typescript
export type WriteIntent = RecordIntent | ProjectIntent | ProjectVersionedIntent | AccumulateIntent | UpdateIntent | StoreIntent | SkipIntent;
```

- [ ] **Step 4: Write the factory**

Create `libs/event-processor/src/intents/project-versioned.ts`:

```typescript
import type { ProjectVersionedIntent, KeyOverrides } from '../types/write-intent';
import type { HandlerFn, EventPayload } from '../types/handler-config';
import type { EventContext } from '../types/event-context';
import type { RejectNonP1 } from '../types/ownership';

type VersionResolver = number | ((payload: EventPayload, ctx: EventContext) => number);

/**
 * P1 versioned-snapshot projection. Writes the FULL row guarded by
 * `attribute_not_exists(pk) OR #__version < :version`; a stale/duplicate
 * version is dropped (deduplicated), NOT redriven. `version` is required.
 */
export function projectVersioned<K extends string>(
  typename: RejectNonP1<K>,
  fields: Record<string, unknown>,
  opts: { version: number; overrides?: KeyOverrides },
): ProjectVersionedIntent;
export function projectVersioned<K extends string>(
  typename: RejectNonP1<K>,
  fieldsMapper: (payload: EventPayload, ctx: EventContext) => Record<string, unknown>,
  opts: { version: VersionResolver; overrides?: KeyOverrides },
): HandlerFn;
export function projectVersioned<K extends string>(
  typename: RejectNonP1<K>,
  fieldsOrMapper:
    | Record<string, unknown>
    | ((payload: EventPayload, ctx: EventContext) => Record<string, unknown>),
  opts: { version: VersionResolver; overrides?: KeyOverrides },
): ProjectVersionedIntent | HandlerFn {
  const name = typename as string;
  if (typeof fieldsOrMapper === 'function') {
    return (payload: EventPayload, ctx: EventContext) => ({
      _tag: 'projectVersioned' as const,
      typename: name,
      fields: fieldsOrMapper(payload, ctx),
      version: typeof opts.version === 'function' ? opts.version(payload, ctx) : opts.version,
      ...(opts.overrides ? { overrides: opts.overrides } : {}),
    });
  }
  return {
    _tag: 'projectVersioned',
    typename: name,
    fields: fieldsOrMapper,
    version: opts.version as number,
    ...(opts.overrides ? { overrides: opts.overrides } : {}),
  };
}
```

- [ ] **Step 5: Export the factory + type**

In `libs/event-processor/src/intents/index.ts`, add after the `project` line:

```typescript
export { projectVersioned } from './project-versioned';
```

In `libs/event-processor/src/index.ts`: add `projectVersioned` to the intent factory exports (after the `project` export, line ~15):

```typescript
export { projectVersioned } from './intents/project-versioned';
```

and add `ProjectVersionedIntent` to the `export type { WriteIntent, ... }` list (line ~4).

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm nx test event-processor --testFile=test/intents/project-versioned.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add libs/event-processor/src/types/write-intent.ts libs/event-processor/src/intents/project-versioned.ts libs/event-processor/src/intents/index.ts libs/event-processor/src/index.ts libs/event-processor/test/intents/project-versioned.test.ts
git commit -m "feat(event-processor): add projectVersioned WriteIntent factory"
```

---

## Task 3: `executeProjectVersioned` in IntentExecutor

**Files:**
- Modify: `libs/event-processor/src/engine/intent-executor.ts:50-60` (switch) + new method
- Test: `libs/event-processor/test/engine/intent-executor.test.ts`

- [ ] **Step 1: Write the failing executor tests**

Append to `libs/event-processor/test/engine/intent-executor.test.ts` (inside the top-level `describe('IntentExecutor', ...)`), mirroring the existing `ddbMock`/`fakeCtx` setup:

```typescript
  describe('projectVersioned intent (versioned full-row upsert)', () => {
    const intent = {
      _tag: 'projectVersioned' as const,
      typename: 'PortfolioSummary',
      fields: { totalValueCents: 100 },
      version: 7,
    };

    it('sends a full-row PutCommand guarded by the version condition', async () => {
      const result = await executor.execute(intent, fakeCtx);
      expect(result).toEqual({ _tag: 'projectVersioned', success: true });

      const cmd = ddbMock.commandCalls(PutCommand)[0].args[0].input;
      expect(cmd.Item!.pk).toBe('T#tenant-1');
      expect(cmd.Item!.sk).toBe('PortfolioSummary');
      expect(cmd.Item!.__typename).toBe('PortfolioSummary');
      expect(cmd.Item!.__version).toBe(7);
      expect(cmd.Item!.totalValueCents).toBe(100);
      expect(cmd.ConditionExpression).toBe('attribute_not_exists(pk) OR attribute_not_exists(#v) OR #v < :version');
      expect(cmd.ExpressionAttributeNames).toEqual({ '#v': '__version' });
      expect(cmd.ExpressionAttributeValues).toEqual({ ':version': 7 });
    });

    it('drops (deduplicated) a stale/duplicate version on ConditionalCheckFailedException', async () => {
      const err = new Error('stale');
      err.name = 'ConditionalCheckFailedException';
      ddbMock.on(PutCommand).rejectsOnce(err);

      const result = await executor.execute(intent, fakeCtx);
      expect(result).toEqual({ _tag: 'projectVersioned', success: true, deduplicated: true });
    });

    it('re-throws non-condition errors (no silent drop)', async () => {
      const err = new Error('throughput');
      err.name = 'ProvisionedThroughputExceededException';
      ddbMock.on(PutCommand).rejectsOnce(err);

      await expect(executor.execute(intent, fakeCtx)).rejects.toThrow('throughput');
    });

    it('honors key overrides', async () => {
      const overridden = { ...intent, overrides: { pk: 'P#1', sk: 'S#1' } };
      await executor.execute(overridden, fakeCtx);
      const cmd = ddbMock.commandCalls(PutCommand)[0].args[0].input;
      expect(cmd.Item!.pk).toBe('P#1');
      expect(cmd.Item!.sk).toBe('S#1');
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx test event-processor --testFile=test/engine/intent-executor.test.ts`
Expected: FAIL — executor returns `{ _tag: 'unknown', success: false }` for the unhandled `projectVersioned` tag.

- [ ] **Step 3: Add the executor case + method**

In `libs/event-processor/src/engine/intent-executor.ts`, add to the `switch` in `execute()` (after the `case 'project':` line):

```typescript
    case 'projectVersioned': return this.executeProjectVersioned(intent, ctx);
```

Add `ProjectVersionedIntent` to the existing `write-intent` type import at the top of the file. Then add the method after `executeProject` (after line ~92):

```typescript
  private async executeProjectVersioned(intent: ProjectVersionedIntent, ctx: EventContext): Promise<IntentResult> {
    const pk = intent.overrides?.pk ?? `T#${ctx.tenantId}`;
    const sk = intent.overrides?.sk ?? intent.typename;

    const item = stripUndefinedDeep({
      pk, sk, __typename: intent.typename,
      ...pickRequestContext(ctx),
      ...intent.fields,
      __version: intent.version,
      updatedAt: ctx.timestamp,
    });

    try {
      await this.deps.docClient.send(new PutCommand({
        TableName: this.deps.tableName,
        Item: item,
        // Full-row write accepted when: the row is brand-new (no pk) OR it is a
        // legacy row with no __version yet (first versioned write self-heals a row
        // previously written by plain project()) OR the incoming version is
        // strictly newer than stored. Equal/older versions on an already-versioned
        // row => ConditionalCheckFailedException => dropped below.
        ConditionExpression: 'attribute_not_exists(pk) OR attribute_not_exists(#v) OR #v < :version',
        ExpressionAttributeNames: { '#v': '__version' },
        ExpressionAttributeValues: { ':version': intent.version },
      }));
      return { _tag: 'projectVersioned', success: true };
    } catch (error: unknown) {
      // Stale/duplicate version: DROP (terminal), NOT redrive. Deliberately
      // distinct from updateOrRetry's RetryablePreconditionError precondition-wait.
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        return { _tag: 'projectVersioned', success: true, deduplicated: true };
      }
      throw error;
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm nx test event-processor --testFile=test/engine/intent-executor.test.ts`
Expected: PASS (existing executor tests + 4 new projectVersioned tests).

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/src/engine/intent-executor.ts libs/event-processor/test/engine/intent-executor.test.ts
git commit -m "feat(event-processor): execute projectVersioned as version-guarded full-row PutItem"
```

---

## Task 4: Retrofit existing factories with ownership constraints

**Files:**
- Modify: `libs/event-processor/src/intents/record.ts`, `project.ts`, `accumulate.ts`, `update.ts`, `update-or-retry.ts`
- Test: `libs/event-processor/test/types/ownership.type-test.ts` (already authored in Task 1), `test/intents/intents.test.ts` (runtime — must stay green)

> Each change is **type-only**: add `<K extends string>` and wrap the `typename` param type; the runtime body is unchanged (cast `typename as string` where it flows into the returned object). This is what makes the `@ts-expect-error` assertions in Task 1's type-test go green without altering behavior.

- [ ] **Step 1: Constrain `record` (reject P1 + P3)**

In `libs/event-processor/src/intents/record.ts`: import `RejectNonAppend`, make all three signatures generic, replace `typename: string` with `typename: RejectNonAppend<K>`, and inside the body use `typename as string`:

```typescript
import type { RejectNonAppend } from '../types/ownership';
// ...
export function record<K extends string>(typename: RejectNonAppend<K>, fieldsOrMapper: Record<string, unknown>, overrides?: KeyOverrides): RecordIntent;
export function record<K extends string>(typename: RejectNonAppend<K>, fieldsOrMapper: (payload: EventPayload, ctx: EventContext) => Record<string, unknown>, overrides?: KeyOverrides): HandlerFn;
export function record<K extends string>(
  typename: RejectNonAppend<K>,
  fieldsOrMapper: Record<string, unknown> | ((payload: EventPayload, ctx: EventContext) => Record<string, unknown>),
  overrides?: KeyOverrides,
): RecordIntent | HandlerFn {
  const name = typename as string;
  if (typeof fieldsOrMapper === 'function') {
    return (payload: EventPayload, ctx: EventContext) => ({ _tag: 'record' as const, typename: name, fields: fieldsOrMapper(payload, ctx), overrides });
  }
  return { _tag: 'record', typename: name, fields: fieldsOrMapper, overrides };
}
```

- [ ] **Step 2: Constrain `project` (reject any Projection)**

In `project.ts`: same pattern, `import type { RejectProjection }`, `typename: RejectProjection<K>` on both overloads + impl, `const name = typename as string;` in the body (replace the two `typename` usages in the returned objects with `name`).

- [ ] **Step 3: Constrain `accumulate` (reject any Projection)**

In `accumulate.ts`:

```typescript
import type { RejectProjection } from '../types/ownership';
export function accumulate<K extends string>(typename: RejectProjection<K>, config: AccumulateConfig): AccumulateIntent {
  return { _tag: 'accumulate', typename: typename as string, field: config.field, increment: config.increment, ttl: config.ttl, overrides: config.overrides };
}
```

- [ ] **Step 4: Constrain `update` and `updateOrRetry` (reject any Projection)**

In `update.ts`: `import type { RejectProjection }`, `export function update<K extends string>(typename: RejectProjection<K>, updates, options?)`, set `typename: typename as string` in the returned object.
In `update-or-retry.ts`: same — `export function updateOrRetry<K extends string>(typename: RejectProjection<K>, updates, options)`, `typename: typename as string` in the returned object.

- [ ] **Step 5: Run the type-level test**

Run: `pnpm nx run event-processor:typecheck`
Expected: PASS — all `@ts-expect-error` lines in `ownership.type-test.ts` now correctly error (so tsc is happy), and the empty-registry baseline lines compile. If any `@ts-expect-error` reports "Unused '@ts-expect-error' directive", the constraint for that factory is wrong — fix the reject-helper or the signature.

- [ ] **Step 6: Run the runtime intent tests (no behavior change)**

Run: `pnpm nx test event-processor --testFile=test/intents/intents.test.ts`
Expected: PASS — all existing factory tests unchanged (constraints are type-only).

- [ ] **Step 7: Commit**

```bash
git add libs/event-processor/src/intents/record.ts libs/event-processor/src/intents/project.ts libs/event-processor/src/intents/accumulate.ts libs/event-processor/src/intents/update.ts libs/event-processor/src/intents/update-or-retry.ts
git commit -m "feat(event-processor): steer intent factories by read-model ownership tags"
```

---

## Task 5: test-support stale-drop / version-guard helper

**Files:**
- Create: `libs/test-support/src/fixtures/version-guard.ts`
- Modify: `libs/test-support/src/index.ts`
- Test: `libs/test-support/test/version-guard.test.ts`

> Kept structural (no `@nestfolio/event-processor` import) to avoid a cross-lib boundary edge; it asserts on the intent-result shape that w1–5 integration tests will observe.

- [ ] **Step 1: Write the failing helper test**

Create `libs/test-support/test/version-guard.test.ts`:

```typescript
import { expectStaleDrop, expectVersionedWrite } from '../src/fixtures/version-guard';

describe('version-guard test helpers', () => {
  it('expectStaleDrop accepts a deduplicated result', () => {
    expect(() => expectStaleDrop({ _tag: 'projectVersioned', success: true, deduplicated: true })).not.toThrow();
  });
  it('expectStaleDrop rejects a fresh write', () => {
    expect(() => expectStaleDrop({ _tag: 'projectVersioned', success: true })).toThrow(/expected a stale drop/i);
  });
  it('expectVersionedWrite accepts a fresh write', () => {
    expect(() => expectVersionedWrite({ _tag: 'projectVersioned', success: true })).not.toThrow();
  });
  it('expectVersionedWrite rejects a dropped write', () => {
    expect(() => expectVersionedWrite({ _tag: 'projectVersioned', success: true, deduplicated: true })).toThrow(/expected a versioned write/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm nx test test-support --testFile=test/version-guard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helper**

Create `libs/test-support/src/fixtures/version-guard.ts`:

```typescript
/** Minimal structural view of an event-processor IntentResult (no cross-lib import). */
export interface VersionedResult {
  readonly _tag: string;
  readonly success: boolean;
  readonly deduplicated?: boolean;
}

/** Assert a projectVersioned write was dropped because the event was stale/duplicate. */
export function expectStaleDrop(result: VersionedResult): void {
  if (!(result.success && result.deduplicated === true)) {
    throw new Error(`expected a stale drop (success + deduplicated), got ${JSON.stringify(result)}`);
  }
}

/** Assert a projectVersioned write was applied (fresh, not dropped). */
export function expectVersionedWrite(result: VersionedResult): void {
  if (!(result.success && !result.deduplicated)) {
    throw new Error(`expected a versioned write (success, not deduplicated), got ${JSON.stringify(result)}`);
  }
}
```

- [ ] **Step 4: Export from the barrel**

In `libs/test-support/src/index.ts` add:

```typescript
export { expectStaleDrop, expectVersionedWrite, type VersionedResult } from './fixtures/version-guard';
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm nx test test-support --testFile=test/version-guard.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add libs/test-support/src/fixtures/version-guard.ts libs/test-support/src/index.ts libs/test-support/test/version-guard.test.ts
git commit -m "feat(test-support): add version-guard stale-drop assertions"
```

---

## Task 6: Canonical doc `READ-MODEL-OWNERSHIP.md`

**Files:**
- Create: `docs/architecture/READ-MODEL-OWNERSHIP.md`

- [ ] **Step 1: Write the doc**

Create `docs/architecture/READ-MODEL-OWNERSHIP.md` capturing, verbatim from the spec, the single source of truth:
- **The rule:** every aggregate has exactly one owner; everyone else keeps a pure projection fed by the owner's versioned events; intent to change non-owned data is a request-event, never a local write.
- **The discriminator:** *after creation, who drives ongoing state?* local → command-owned; external → projection.
- **The `__version` convention:** reserved `__version` attribute on the owned row, stamped by the owning producer and carried top-level in emitted events; ledger's `lastEventSequence` is the reference sequence.
- **Variants:** P1 versioned snapshot (`projectVersioned`), P2 append-only log (`record`), P3 derived aggregate (computed over owned rows / projected from an authoritative aggregate — never `accumulate` over disparate event types).
- **Command-side rules:** field-level `update` writes, condition-expression invariants, CDC-as-outbox, seed-by-one-idempotent-event.
- **The type mechanism:** `ReadModelOwnership` declaration-merging registry + per-factory constraints (table from this plan's "Design decisions"); how a service augments it via `declare module '@nestfolio/event-processor'`.
- A back-reference to the program spec `docs/superpowers/specs/2026-05-29-bff-read-model-materialization-redesign-design.md` and a note that enforcement layers 3+4 (skills/audits/CLAUDE.md router) land in governance workstream 6.

- [ ] **Step 2: Commit**

```bash
git add docs/architecture/READ-MODEL-OWNERSHIP.md
git commit -m "docs(architecture): add canonical READ-MODEL-OWNERSHIP reference"
```

---

## Task 7: Update `event-processor-patterns` skill

**Files:**
- Modify: `.claude/skills/event-processor-patterns/SKILL.md`

- [ ] **Step 1: Read the current skill**

Run: `cat .claude/skills/event-processor-patterns/SKILL.md` — locate the WriteIntent section that documents `record`/`project`/`accumulate`/`update`/`updateOrRetry`.

- [ ] **Step 2: Add `projectVersioned` + ownership guidance**

Add, alongside the existing intents:
- `projectVersioned(typename, fullState, { version })` — the blessed P1 writer; full-row version-guarded PutItem; stale → dropped (NOT redriven, unlike `updateOrRetry`).
- A short "read-model ownership" subsection: the P1/P2/P3 variants, "**never `accumulate` a cross-event projection**", the `ReadModelOwnership` registry + `declare module` augmentation snippet, and a pointer to `docs/architecture/READ-MODEL-OWNERSHIP.md` as the source of truth.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/event-processor-patterns/SKILL.md
git commit -m "docs(skill): document projectVersioned + read-model ownership in event-processor-patterns"
```

---

## Task 8: Full validation gate

**Files:** none (verification only)

- [ ] **Step 1: Type-level enforcement**

Run: `pnpm nx run event-processor:typecheck`
Expected: PASS (0 errors; all `@ts-expect-error` directives used).

- [ ] **Step 2: Affected tests + lint (the standard gate)**

Run: `pnpm nx affected -t test,lint --base=origin/main`
Expected: PASS. Note: this gate does NOT include `typecheck` (Step 1 covers it) — both must be recorded in the workstream `validation_gate`.

- [ ] **Step 3: Build (real tsc over src)**

Run: `pnpm nx run event-processor:build`
Expected: PASS.

- [ ] **Step 4: Import-boundary / pre-commit sanity**

Confirm no new cross-lib boundary violation (test-support helper is structural, no event-processor import). The repo pre-commit hook validates import boundaries on commit.

---

## Self-Review

**Spec coverage** (deliverables 1–6 + freeze layers 1–2):
1. `projectVersioned` WriteIntent (required `version`, drop-not-redrive) → Tasks 2–3. ✓
2. Reserved `__version` convention + carriage → executor writes `__version` (Task 3); convention documented (Task 6). ✓
3. Type-level ownership tags (`CommandOwned | Projection<'P1'|'P2'|'P3'>`) → Tasks 1 + 4. ✓
4. Canonical `READ-MODEL-OWNERSHIP.md` → Task 6. ✓
5. `event-processor-patterns` skill update → Task 7. ✓
6. `test-support` version-guard / stale-drop helpers → Task 5. ✓
- Restrict `project` (footgun) to seed/command → Task 4 (`RejectProjection`). ✓
- "no consumer behavior change" → registry empty; all constraints type-only; runtime tests unchanged. ✓
- Freeze layers 3+4 (create-*/audit-*/router) → explicitly **out of scope** (governance w6). ✓

**Placeholder scan:** all code steps contain full code; no TBD/TODO. ✓

**Type consistency:** `_tag: 'projectVersioned'` used in the interface, factory, executor case, executor result, and tests. `RejectNonP1` / `RejectProjection` / `RejectNonAppend` names match between `ownership.ts`, the factories, and the type-test. `__version` attribute + `#v`/`:version` placeholders consistent between executor and its test. ✓

---

## Execution Handoff

Two execution options:
1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks.
2. **Inline Execution** — execute in this session via executing-plans with checkpoints.
