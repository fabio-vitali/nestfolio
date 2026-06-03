# Mandate Projection Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `OPERATING_MODE_CHANGED` carry full Mandate state on the same monotonic `__version` line as `MANDATE_ISSUED`/`MANDATE_REVOKED`, so compliance-ctrl and decision-workflow-ctrl can project `MandateSnapshot` as a clean full-row `Projection<'P1'>`.

**Architecture:** Approach A (dual-write + re-source). `updateOperatingMode` atomically writes BOTH the `InvestorProfile` row (keeps `INVESTOR_PROFILE_UPDATED` feeding dashboard-bff) and the `Mandate` sibling row (bumps the Mandate `__version`) via `TransactWriteItems`; `OPERATING_MODE_CHANGED` is re-sourced from the Mandate row's `onFieldChange`. Two backward-compatible library changes let a `modify` emit `onFieldChange`-only events with no carrier. Consumers convert `update()`/`record()` → `projectVersioned` keyed on `subject.__version`.

**Tech Stack:** TypeScript, AWS CDK, AppSync JS resolvers (`@aws-appsync/utils`), DynamoDB Streams CDC, `@nestfolio/event-processor`, `@nestfolio/cdk-constructs`, Jest, Nx.

**Spec:** `docs/superpowers/specs/2026-06-03-read-model-ownership-mandate-projection-fix-design.md`

---

## File Structure

**Library enablement (must land first — backward-compatible):**
- Modify `libs/cdk-constructs/src/core/event-types.ts` — `ModifyEmission.always` + `RuntimeModifyEmission.always` optional; widen the discriminator in `buildRuntimeConfig` + `collectAllEventTypes`.
- Modify `libs/cdk-constructs/test/core/event-types.test.ts` — add no-`always` ModifyEmission cases.
- Modify `libs/event-processor/src/pipelines/change-data-capture.ts` — local `RuntimeModifyEmission.always` optional; `resolveEmissions` handles `onFieldChange`-only.
- Modify `libs/event-processor/test/pipelines/change-data-capture.test.ts` — add `onFieldChange`-only + emit-nothing cases.

**Producer (investor-bff):**
- Modify `services/investor/investor-bff/src/graphql/js-function/update-operating-mode.fn.js` — `UpdateItem` → `TransactWriteItems` dual-write.
- Modify `services/investor/investor-bff/src/service.stack.ts` — Egress map (`InvestorProfile.modify.onFieldChange` drops `operatingMode`; `Mandate.modify` → `onFieldChange`); add `extraSteps` readback for `updateOperatingMode`.
- Modify `services/investor/investor-bff/test/unit/graphql/update-operating-mode.test.ts` — assert the dual-write shape.

**Consumers:**
- Modify `services/advisory/compliance-ctrl/src/handlers/event-listener.ts` — three processors → one `projectVersioned`.
- Modify `services/advisory/compliance-ctrl/src/read-model-ownership.ts` — register `MandateSnapshot: Projection<'P1'>`.
- Modify `services/advisory/compliance-ctrl/test/types/read-model-ownership.type-test.ts` + `test/unit/event-listener.test.ts` + `test/integration/compliance-ctrl.integration.test.ts`.
- Modify `services/advisory/decision-workflow-ctrl/src/handlers/mandate-projector.ts` — `record()`/`update()` → `projectVersioned`.
- Modify `services/advisory/decision-workflow-ctrl/src/read-model-ownership.ts` — register `MandateSnapshot: Projection<'P1'>`; flip the deferral comment.
- Modify `services/advisory/decision-workflow-ctrl/test/types/read-model-ownership.type-test.ts` + `test/unit/mandate-projector.test.ts` + `test/integration/decision-workflow-ctrl.integration.test.ts`.

**Docs:**
- Modify `docs/architecture/READ-MODEL-OWNERSHIP.md` — §9.1 gap resolution.
- Regen `services/investor/investor-bff/CLAUDE.md`, `services/advisory/compliance-ctrl/CLAUDE.md`, `services/advisory/decision-workflow-ctrl/CLAUDE.md` (via `audit-service`).

**Worktree:** `/Users/fabiovitali/WebstormProjects/nestfolio/.claude/worktrees/read-model-ownership-mandate-projection-fix` (branch `worktree-read-model-ownership-mandate-projection-fix`). All paths below are relative to it. All `git`/`nx` commands run from the worktree root.

---

## Task 1: Library enablement — cdk-constructs `onFieldChange`-only modify

**Files:**
- Modify: `libs/cdk-constructs/src/core/event-types.ts:23-26,51-54,77-82,107-111`
- Test: `libs/cdk-constructs/test/core/event-types.test.ts`

- [ ] **Step 1: Write the failing tests** — append a new `describe` block to `libs/cdk-constructs/test/core/event-types.test.ts` (it already imports `buildRuntimeConfig`, `collectAllEventTypes`, `extractFilters`, `eventName`, and `EventTypesMap`; reuse those imports):

```typescript
describe('onFieldChange-only ModifyEmission (no carrier)', () => {
  const map: EventTypesMap = {
    Mandate: {
      insert: eventName('MANDATE_ISSUED'),
      modify: {
        onFieldChange: {
          status: eventName('MANDATE_REVOKED'),
          operatingMode: eventName('OPERATING_MODE_CHANGED'),
        },
      },
    },
  };

  it('serializes a modify with onFieldChange and no `always`', () => {
    const config = buildRuntimeConfig(map);
    expect(config['Mandate:MODIFY']).toEqual({
      onFieldChange: {
        status: 'MANDATE_REVOKED',
        operatingMode: 'OPERATING_MODE_CHANGED',
      },
    });
    expect(config['Mandate:INSERT']).toBe('MANDATE_ISSUED');
  });

  it('collectAllEventTypes returns the insert + every onFieldChange event (no carrier)', () => {
    const types = collectAllEventTypes(map);
    expect(types).toEqual(expect.arrayContaining([
      'MANDATE_ISSUED', 'MANDATE_REVOKED', 'OPERATING_MODE_CHANGED',
    ]));
    expect(types).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm nx run cdk-constructs:test -- event-types`
Expected: FAIL — TypeScript error that `always` is required on the `modify` literal, or `buildRuntimeConfig`/`collectAllEventTypes` mis-serialize the no-`always` mapping (lands in the FieldDispatch `else` branch).

- [ ] **Step 3: Make `always` optional in both type definitions**

In `libs/cdk-constructs/src/core/event-types.ts`, change `ModifyEmission` (lines 23-26):

```typescript
export type ModifyEmission = {
  always?: EventName;
  onFieldChange?: Record<string, EventName>;
};
```

and `RuntimeModifyEmission` (lines 51-54):

```typescript
export type RuntimeModifyEmission = {
  always?: string;
  onFieldChange?: Record<string, string>;
};
```

- [ ] **Step 4: Widen the discriminator in `buildRuntimeConfig`**

Replace the `else if ('always' in mapping)` branch (lines 77-82) with:

```typescript
      } else if ('always' in mapping || 'onFieldChange' in mapping) {
        const entry: RuntimeModifyEmission = {};
        if (mapping.always) entry.always = mapping.always;
        if (mapping.onFieldChange) entry.onFieldChange = mapping.onFieldChange;
        config[`${recordType}:${ddbAction}`] = entry;
```

- [ ] **Step 5: Widen the discriminator in `collectAllEventTypes`**

Replace the `else if ('always' in mapping)` branch (lines 107-111) with:

```typescript
      } else if ('always' in mapping || 'onFieldChange' in mapping) {
        if (mapping.always) types.push(mapping.always);
        if (mapping.onFieldChange) {
          types.push(...Object.values(mapping.onFieldChange));
        }
```

> Note: `FieldDispatch` (the final `else`) is reached only for `{ field, map }` mappings — it has neither `always` nor `onFieldChange`, so widening the prior branch does not capture it. `Passthrough` is still caught earlier by `'passthrough' in mapping`.

- [ ] **Step 6: Run the tests to verify they pass (new + existing)**

Run: `pnpm nx run cdk-constructs:test -- event-types`
Expected: PASS — the new `describe` block passes AND every pre-existing `always`-present test (e.g. "onFieldChange ModifyEmission") still passes unchanged.

- [ ] **Step 7: Commit**

```bash
git add libs/cdk-constructs/src/core/event-types.ts libs/cdk-constructs/test/core/event-types.test.ts
git commit -m "feat(cdk-constructs): allow onFieldChange-only modify (optional always)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Library enablement — event-processor CDC `onFieldChange`-only emission

**Files:**
- Modify: `libs/event-processor/src/pipelines/change-data-capture.ts:29-32,95-107`
- Test: `libs/event-processor/test/pipelines/change-data-capture.test.ts`

- [ ] **Step 1: Write the failing tests** — append to the existing `onFieldChange diff-emit (ModifyEmission)` describe (or a new sibling describe) in `libs/event-processor/test/pipelines/change-data-capture.test.ts`, reusing the existing `fakeDdbStreamRecord` helper and `mockPublish`:

```typescript
describe('onFieldChange-only emission (no carrier)', () => {
  it('emits only the matched semantic event when a watched field changes', async () => {
    process.env.EVENT_TYPE_MAP = JSON.stringify({
      'Mandate:MODIFY': {
        onFieldChange: { status: 'MANDATE_REVOKED', operatingMode: 'OPERATING_MODE_CHANGED' },
      },
    });
    const handler = changeDataCapture();
    await handler({
      Records: [
        fakeDdbStreamRecord('MODIFY',
          { pk: 'InvestorProfile#t#u', sk: 'Mandate', __typename: 'Mandate', tenantId: 't', userId: 'u', region: 'r', status: 'ACTIVE', operatingMode: 'AGGRESSIVE', __version: 2 },
          { oldImage: { pk: 'InvestorProfile#t#u', sk: 'Mandate', __typename: 'Mandate', tenantId: 't', userId: 'u', region: 'r', status: 'ACTIVE', operatingMode: 'BALANCED', __version: 1 } },
        ),
      ],
    });
    const entries: Array<{ DetailType: string; Detail: string }> = mockPublish.mock.calls[0][0];
    const types = entries.map(e => e.DetailType);
    expect(types).toEqual(['OPERATING_MODE_CHANGED']);
    const detail = JSON.parse(entries[0].Detail);
    expect(detail.subject.operatingMode).toBe('AGGRESSIVE');
    expect(detail.subject.status).toBe('ACTIVE');
    expect(detail.subject.__version).toBe(2);
  });

  it('emits MANDATE_REVOKED (only) when status changes but operatingMode does not', async () => {
    process.env.EVENT_TYPE_MAP = JSON.stringify({
      'Mandate:MODIFY': {
        onFieldChange: { status: 'MANDATE_REVOKED', operatingMode: 'OPERATING_MODE_CHANGED' },
      },
    });
    const handler = changeDataCapture();
    await handler({
      Records: [
        fakeDdbStreamRecord('MODIFY',
          { pk: 'InvestorProfile#t#u', sk: 'Mandate', __typename: 'Mandate', tenantId: 't', userId: 'u', region: 'r', status: 'REVOKED', operatingMode: 'BALANCED', __version: 3 },
          { oldImage: { pk: 'InvestorProfile#t#u', sk: 'Mandate', __typename: 'Mandate', tenantId: 't', userId: 'u', region: 'r', status: 'ACTIVE', operatingMode: 'BALANCED', __version: 2 } },
        ),
      ],
    });
    const entries: Array<{ DetailType: string }> = mockPublish.mock.calls[0][0];
    expect(entries.map(e => e.DetailType)).toEqual(['MANDATE_REVOKED']);
  });

  it('publishes nothing when no watched field changed (no carrier to fall back to)', async () => {
    process.env.EVENT_TYPE_MAP = JSON.stringify({
      'Mandate:MODIFY': {
        onFieldChange: { status: 'MANDATE_REVOKED', operatingMode: 'OPERATING_MODE_CHANGED' },
      },
    });
    const handler = changeDataCapture();
    await handler({
      Records: [
        fakeDdbStreamRecord('MODIFY',
          { pk: 'InvestorProfile#t#u', sk: 'Mandate', __typename: 'Mandate', tenantId: 't', userId: 'u', region: 'r', status: 'ACTIVE', operatingMode: 'BALANCED', updatedAt: 'new', __version: 5 },
          { oldImage: { pk: 'InvestorProfile#t#u', sk: 'Mandate', __typename: 'Mandate', tenantId: 't', userId: 'u', region: 'r', status: 'ACTIVE', operatingMode: 'BALANCED', updatedAt: 'old', __version: 4 } },
        ),
      ],
    });
    // No emissions → publisher not called (or called with zero entries, depending on batching).
    const calls = mockPublish.mock.calls;
    const totalEntries = calls.reduce((n, c) => n + (c[0] as unknown[]).length, 0);
    expect(totalEntries).toBe(0);
  });
});
```

> Note on the third test: confirm whether the existing CDC pipeline calls the publisher with an empty array or skips the call entirely when a record yields zero emissions. The assertion above (`totalEntries === 0`) holds either way. If the existing code path throws on an empty emission list, that is a pre-existing latent issue surfaced here — handle it by guarding the publish on `entries.length > 0` in the pipeline's batch step and note it in the commit.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm nx run event-processor:test -- change-data-capture`
Expected: FAIL — `resolveEmissions` does not match `'always' in mapping` for an `onFieldChange`-only mapping, so it falls through to the FieldDispatch branch and throws/mis-resolves; the `Mandate:MODIFY` events are not emitted.

- [ ] **Step 3: Make the local `RuntimeModifyEmission.always` optional**

In `libs/event-processor/src/pipelines/change-data-capture.ts`, change the local type (lines 29-32):

```typescript
type RuntimeModifyEmission = {
  always?: string;
  onFieldChange?: Record<string, string>;
};
```

- [ ] **Step 4: Handle the `onFieldChange`-only mapping in `resolveEmissions`**

Replace the `if ('always' in mapping)` block (lines 95-107) with:

```typescript
  if ('always' in mapping || 'onFieldChange' in mapping) {
    const emissions: Emission[] = [];
    if ('always' in mapping && mapping.always) {
      emissions.push({ eventType: mapping.always });
    }
    if (mapping.onFieldChange && ctx.oldImage && ctx.newImage) {
      for (const [field, semanticType] of Object.entries(mapping.onFieldChange)) {
        const oldVal = ctx.oldImage[field];
        const newVal = ctx.newImage[field];
        if (!deepEqual(oldVal, newVal)) {
          emissions.push({ eventType: semanticType, previousSubject: ctx.oldImage });
        }
      }
    }
    return emissions;
  }
```

> The FieldDispatch branch below is unchanged and is still reached only for `{ field, map }` mappings. An empty `emissions` array is already valid (FieldDispatch can return `[]`).

- [ ] **Step 5: Run the tests to verify they pass (new + existing)**

Run: `pnpm nx run event-processor:test -- change-data-capture`
Expected: PASS — new cases pass AND every pre-existing `onFieldChange diff-emit (ModifyEmission)` test (carrier + semantic, carrier-only-when-no-change, deep-equal, OldImage-missing fallback) still passes unchanged.

- [ ] **Step 6: Commit**

```bash
git add libs/event-processor/src/pipelines/change-data-capture.ts libs/event-processor/test/pipelines/change-data-capture.test.ts
git commit -m "feat(event-processor): CDC emits onFieldChange-only modify (no carrier)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Producer — investor-bff `updateOperatingMode` dual-write

**Files:**
- Modify: `services/investor/investor-bff/src/graphql/js-function/update-operating-mode.fn.js` (full rewrite)
- Test: `services/investor/investor-bff/test/unit/graphql/update-operating-mode.test.ts` (full rewrite)

- [ ] **Step 1: Rewrite the unit test to assert the dual-write shape** — replace the entire body of `services/investor/investor-bff/test/unit/graphql/update-operating-mode.test.ts`:

```typescript
import { request, response } from '../../../src/graphql/js-function/update-operating-mode.fn.js';

const baseCtx = {
  stash: { tenantId: 't1', userId: 'u1', tableName: 'investor-bff-table' },
  arguments: { mode: 'AGGRESSIVE' },
  result: {},
};

describe('updateOperatingMode resolver (dual-write)', () => {
  it('produces a TransactWriteItems over the InvestorProfile and Mandate rows', () => {
    const req = request(baseCtx as any);
    expect(req.operation).toBe('TransactWriteItems');
    expect(req.transactItems).toHaveLength(2);

    const [profileWrite, mandateWrite] = req.transactItems;

    expect(profileWrite.table).toBe('investor-bff-table');
    expect(profileWrite.operation).toBe('UpdateItem');
    expect(profileWrite.key.pk.S).toBe('InvestorProfile#t1#u1');
    expect(profileWrite.key.sk.S).toBe('InvestorProfile');
    expect(profileWrite.update.expression).toBe(
      'SET operatingMode = :mode, updatedAt = :now, #ts = :now, #v = if_not_exists(#v, :zero) + :one',
    );
    expect(profileWrite.update.expressionNames['#v']).toBe('__version');
    expect(profileWrite.condition.expression).toBe('attribute_exists(pk)');

    expect(mandateWrite.table).toBe('investor-bff-table');
    expect(mandateWrite.operation).toBe('UpdateItem');
    expect(mandateWrite.key.pk.S).toBe('InvestorProfile#t1#u1');
    expect(mandateWrite.key.sk.S).toBe('Mandate');
    expect(mandateWrite.update.expression).toBe(
      'SET operatingMode = :mode, updatedAt = :now, #ts = :now, #v = if_not_exists(#v, :zero) + :one',
    );
    expect(mandateWrite.update.expressionNames['#v']).toBe('__version');
    expect(mandateWrite.condition.expression).toBe('attribute_exists(pk) AND #status = :active');
    expect(mandateWrite.condition.expressionNames['#status']).toBe('status');
  });

  it('rejects an invalid mode', () => {
    expect(() => request({ ...baseCtx, arguments: { mode: 'YOLO' } } as any)).toThrow();
  });

  it('maps a cancelled transaction to a clean InvalidState error', () => {
    expect(() => response({
      ...baseCtx,
      error: { message: 'cancelled', type: 'DynamoDB:TransactionCanceledException' },
    } as any)).toThrow(/operating mode/i);
  });

  it('passes ctx.result through on success', () => {
    expect(response(baseCtx as any)).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx run investor-bff:test -- update-operating-mode`
Expected: FAIL — the current resolver returns `operation: 'UpdateItem'`, not `'TransactWriteItems'`; `req.transactItems` is undefined.

- [ ] **Step 3: Rewrite the resolver** — replace the entire body of `services/investor/investor-bff/src/graphql/js-function/update-operating-mode.fn.js`:

```javascript
import { util } from '@aws-appsync/utils';

const VALID_MODES = ['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'];

export function request(ctx) {
  const { tenantId, userId, tableName } = ctx.stash;
  const mode = ctx.arguments.mode;
  if (!VALID_MODES.includes(mode)) {
    util.error(`Invalid operatingMode: ${mode}`, 'ValidationError');
  }
  const now = util.time.nowISO8601();
  const pk = `InvestorProfile#${tenantId}#${userId}`;
  const update = {
    expression: 'SET operatingMode = :mode, updatedAt = :now, #ts = :now, #v = if_not_exists(#v, :zero) + :one',
    expressionNames: { '#ts': 'timestamp', '#v': '__version' },
    expressionValues: util.dynamodb.toMapValues({ ':mode': mode, ':now': now, ':zero': 0, ':one': 1 }),
  };
  return {
    operation: 'TransactWriteItems',
    transactItems: [
      // InvestorProfile composite row — bumps its own __version so dashboard-bff's
      // InvestorSnapshot keeps its version line and INVESTOR_PROFILE_UPDATED keeps firing.
      {
        table: tableName,
        operation: 'UpdateItem',
        key: util.dynamodb.toMapValues({ pk, sk: 'InvestorProfile' }),
        update,
        condition: { expression: 'attribute_exists(pk)' },
      },
      // Mandate sibling row — bumps the Mandate __version so OPERATING_MODE_CHANGED
      // (re-sourced from this row's CDC) carries the full Mandate image on one
      // monotonic line. Guarded to an ACTIVE mandate.
      {
        table: tableName,
        operation: 'UpdateItem',
        key: util.dynamodb.toMapValues({ pk, sk: 'Mandate' }),
        update,
        condition: {
          expression: 'attribute_exists(pk) AND #status = :active',
          expressionNames: { '#status': 'status' },
          expressionValues: util.dynamodb.toMapValues({ ':active': 'ACTIVE' }),
        },
      },
    ],
  };
}

export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:TransactionCanceledException') {
      util.error('Cannot change operating mode (mandate inactive or profile missing)', 'InvalidState');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  // TransactWriteItems returns no attributes; the InvestorProfile is read back by
  // the get-profile.fn.js readback step appended via extraSteps (Task 4).
  return ctx.result;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx run investor-bff:test -- update-operating-mode`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/investor/investor-bff/src/graphql/js-function/update-operating-mode.fn.js services/investor/investor-bff/test/unit/graphql/update-operating-mode.test.ts
git commit -m "feat(investor-bff): updateOperatingMode dual-writes InvestorProfile + Mandate rows

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Producer — investor-bff Egress map + readback wiring

**Files:**
- Modify: `services/investor/investor-bff/src/service.stack.ts:20-33` (Facade `extraSteps`), `:75-105` (Egress `eventTypes`)

- [ ] **Step 1: Re-source `OPERATING_MODE_CHANGED` and add the readback** — in `services/investor/investor-bff/src/service.stack.ts`, change the `InvestorProfile` and `Mandate` entries of the Egress `eventTypes` map (lines 76-89) to:

```typescript
        'InvestorProfile': {
          insert: InvestorBffEventTypes.INVESTOR_PROFILE_CREATED,
          modify: {
            always: InvestorBffEventTypes.INVESTOR_PROFILE_UPDATED,
            onFieldChange: {
              goal: InvestorBffEventTypes.GOAL_UPDATED,
            },
          },
        },
        'Mandate': {
          insert: InvestorBffEventTypes.MANDATE_ISSUED,
          modify: {
            onFieldChange: {
              status: InvestorBffEventTypes.MANDATE_REVOKED,
              operatingMode: InvestorBffEventTypes.OPERATING_MODE_CHANGED,
            },
          },
        },
```

And add a readback so the `InvestorProfile!`-typed mutation still returns the profile after the (attribute-less) `TransactWriteItems`. In the `discoverJsResolvers(__dirname, { ... })` options (the `extraSteps` block at lines ~28-32), add the `updateOperatingMode` entry:

```typescript
    extraSteps: {
      getProfile: ['get-profile-mandate.fn.js'],
      updateOperatingMode: ['get-profile.fn.js'],
    },
```

> Why: `get-profile.fn.js` does a `GetItem` on `sk='InvestorProfile'` keyed off `ctx.stash.{tenantId,userId}` and returns the row — the same shape today's `ALL_NEW` `UpdateItem` returned. Appending it as the final pipeline step preserves the mutation's return contract with no new file.

- [ ] **Step 2: Verify the stack synthesizes and typechecks**

Run: `pnpm nx run investor-bff:test` then `pnpm nx run investor-bff:typecheck`
Expected: PASS — the no-`always` `Mandate.modify` literal typechecks against the now-optional `ModifyEmission` (Task 1), and any existing `service.stack` unit test still passes. If `investor-bff:typecheck` surfaces ONLY the pre-existing `investor-bff-13-latent-tsc-errors`, that is expected (the narrow `tsconfig.type-test.json` target is the gate per the service card); the Egress-map change must not add new errors.

- [ ] **Step 3: Commit**

```bash
git add services/investor/investor-bff/src/service.stack.ts
git commit -m "feat(investor-bff): re-source OPERATING_MODE_CHANGED from the Mandate row + readback

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Consumer — compliance-ctrl `MandateSnapshot` → P1

**Files:**
- Modify: `services/advisory/compliance-ctrl/src/read-model-ownership.ts`
- Modify: `services/advisory/compliance-ctrl/test/types/read-model-ownership.type-test.ts`
- Modify: `services/advisory/compliance-ctrl/src/handlers/event-listener.ts:160-271`
- Modify: `services/advisory/compliance-ctrl/test/unit/event-listener.test.ts` (mandate blocks)

- [ ] **Step 1: Register the ownership tag** — in `services/advisory/compliance-ctrl/src/read-model-ownership.ts`, add `MandateSnapshot` to the registry and update the docblock:

```typescript
/**
 * compliance-ctrl read-model ownership registration.
 *
 * Compile-time enforcement (see docs/architecture/READ-MODEL-OWNERSHIP.md):
 *   - ComplianceCheck / AuditArtifact : P2 append-logs → record() only.
 *   - MandateSnapshot : P1 mirror of the investor-bff Mandate aggregate →
 *     projectVersioned only, keyed on the Mandate __version carried by CDC.
 */
import type { Projection } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    ComplianceCheck: Projection<'P2'>;
    AuditArtifact: Projection<'P2'>;
    MandateSnapshot: Projection<'P1'>;
  }
}

export {};
```

- [ ] **Step 2: Extend the type-test** — append before `export {};` in `services/advisory/compliance-ctrl/test/types/read-model-ownership.type-test.ts`:

```typescript
// MandateSnapshot is P1 — projectVersioned only.
projectVersioned('MandateSnapshot', { a: 1 }, { version: 1 });
// @ts-expect-error — update (command write) on a P1 projection must not typecheck
update('MandateSnapshot', { a: 1 });
// @ts-expect-error — record on a P1 projection must not typecheck
record('MandateSnapshot', { a: 1 });
// @ts-expect-error — project (unversioned) on a P1 projection must not typecheck
project('MandateSnapshot', { a: 1 });
// @ts-expect-error — accumulate on a P1 projection must not typecheck
accumulate('MandateSnapshot', { field: 'count', increment: 1 });
```

- [ ] **Step 3: Run the typecheck to verify it now requires `projectVersioned`**

Run: `pnpm nx run compliance-ctrl:typecheck`
Expected: FAIL — `src/handlers/event-listener.ts` still calls `update('MandateSnapshot', …)`, which no longer typechecks now that `MandateSnapshot` is registered `Projection<'P1'>` (the intended trip-wire).

- [ ] **Step 4: Rewrite the mandate unit tests** — in `services/advisory/compliance-ctrl/test/unit/event-listener.test.ts`, replace the three mandate `describe` blocks (`MANDATE_ISSUED handler`, `OPERATING_MODE_CHANGED handler`, `mandate revoked events`) with full-row `projectVersioned` expectations. The synthetic subjects now carry the full Mandate image + `__version` (mirroring the post-fix producer):

```typescript
describe('Mandate projection (projectVersioned)', () => {
  const fullMandate = (overrides: Record<string, unknown> = {}) => ({
    tenantId: 't-1', userId: 'u-1', mandateId: 'm-1',
    level: 'DISCRETIONARY', status: 'ACTIVE', operatingMode: 'BALANCED',
    effectiveDate: '2025-01-01T00:00:00.000Z', __version: 1,
    ...overrides,
  });

  it('MANDATE_ISSUED → projectVersioned(MandateSnapshot) full row keyed on __version', async () => {
    const harness = makeHarness();
    const result = await harness.process([
      fakeSqsRecord('MANDATE_ISSUED', fullMandate(), { tenantId: 't-1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]).toMatchObject({
      _tag: 'projectVersioned',
      typename: 'MandateSnapshot',
      version: 1,
      fields: expect.objectContaining({
        tenantId: 't-1', userId: 'u-1', mandateId: 'm-1',
        level: 'DISCRETIONARY', status: 'ACTIVE', operatingMode: 'BALANCED',
        effectiveDate: '2025-01-01T00:00:00.000Z',
      }),
      overrides: { pk: 'GuardrailPolicy#t-1#u-1', sk: 'MandateSnapshot' },
    });
  });

  it('OPERATING_MODE_CHANGED → projectVersioned full row (status/level preserved) at the new __version', async () => {
    const harness = makeHarness();
    const result = await harness.process([
      fakeSqsRecord('OPERATING_MODE_CHANGED', fullMandate({ operatingMode: 'AGGRESSIVE', __version: 2 }), { tenantId: 't-1' }),
    ]);
    expect(result.intents[0]).toMatchObject({
      _tag: 'projectVersioned',
      typename: 'MandateSnapshot',
      version: 2,
      fields: expect.objectContaining({
        operatingMode: 'AGGRESSIVE', status: 'ACTIVE', level: 'DISCRETIONARY', mandateId: 'm-1',
      }),
    });
  });

  it('MANDATE_REVOKED → projectVersioned full row with status=REVOKED at the new __version', async () => {
    const harness = makeHarness();
    const result = await harness.process([
      fakeSqsRecord('MANDATE_REVOKED', fullMandate({ status: 'REVOKED', revokedAt: '2026-05-03T12:00:00.000Z', __version: 3 }), { tenantId: 't-1' }),
    ]);
    expect(result.intents[0]).toMatchObject({
      _tag: 'projectVersioned',
      typename: 'MandateSnapshot',
      version: 3,
      fields: expect.objectContaining({
        status: 'REVOKED', revokedAt: '2026-05-03T12:00:00.000Z',
        mandateId: 'm-1', level: 'DISCRETIONARY',
      }),
    });
  });

  it('Mandate event missing operatingMode → batch item failure (NotRetryableError)', async () => {
    const harness = makeHarness();
    const result = await harness.process([
      fakeSqsRecord('MANDATE_ISSUED', { tenantId: 't-1', userId: 'u-1', mandateId: 'm-1', level: 'DISCRETIONARY', __version: 1 }, { tenantId: 't-1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(1);
  });

  it('Mandate event missing __version → dropped (no intent, no failure)', async () => {
    const harness = makeHarness();
    const result = await harness.process([
      fakeSqsRecord('MANDATE_ISSUED', { tenantId: 't-1', userId: 'u-1', mandateId: 'm-1', level: 'DISCRETIONARY', operatingMode: 'BALANCED' }, { tenantId: 't-1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(result.intents).toHaveLength(0);
  });
});
```

- [ ] **Step 5: Run the unit test to verify it fails for the right reason**

Run: `pnpm nx run compliance-ctrl:test -- event-listener`
Expected: FAIL — the handler still emits `_tag: 'update'`, not `'projectVersioned'`.

- [ ] **Step 6: Convert the handler** — in `services/advisory/compliance-ctrl/src/handlers/event-listener.ts`: change the import on line 2 to include `projectVersioned` and drop `update` if unused elsewhere (it is only used by the three mandate processors):

```typescript
import { materializeToTable, record, projectVersioned, type WriteIntent, type EventPayload, type EventContext } from '@nestfolio/event-processor';
```

Replace the three functions `processMandateIssued` / `processOperatingModeChanged` / `processMandateRevoked` (lines 160-248) with one full-row projector:

```typescript
function projectMandateSnapshot(
  payload: EventPayload,
  ctx: EventContext,
): WriteIntent | undefined {
  const subject = payload.subject ?? {};
  const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
  const userId = (subject.userId as string) ?? tenantId;
  const operatingMode = subject.operatingMode as MandateSnapshot['operatingMode'];

  if (!operatingMode) {
    throw new NotRetryableError(
      `Mandate event ${ctx.eventType} missing operatingMode for tenant=${tenantId} user=${userId}`,
    );
  }

  const version = subject.__version;
  if (typeof version !== 'number') return undefined;

  // Full-row P1 projection on the Mandate version line. Every Mandate event
  // (MANDATE_ISSUED / OPERATING_MODE_CHANGED / MANDATE_REVOKED) now carries the
  // full Mandate image + the Mandate row __version, so a single projector writes
  // the whole row; the version guard subsumes the old REVOKED-skip idempotency.
  return projectVersioned(
    'MandateSnapshot',
    {
      tenantId,
      userId,
      mandateId: subject.mandateId as string,
      level: subject.level as MandateSnapshot['level'],
      status: (subject.status as 'ACTIVE' | 'REVOKED' | undefined) ?? 'ACTIVE',
      operatingMode,
      effectiveDate: subject.effectiveDate as string,
      revokedAt: (subject.revokedAt as string | null) ?? null,
    },
    { version, overrides: { pk: guardrailPolicyPk(tenantId, userId), sk: 'MandateSnapshot' } },
  );
}
```

Then update the handler wiring (lines 263-268) to route all three event types to the single projector:

```typescript
  handlers[InvestorBffEventTypes.MANDATE_ISSUED] = (payload, ctx) =>
    projectMandateSnapshot(payload, ctx);
  handlers[InvestorBffEventTypes.OPERATING_MODE_CHANGED] = (payload, ctx) =>
    projectMandateSnapshot(payload, ctx);
  handlers[InvestorBffEventTypes.MANDATE_REVOKED] = (payload, ctx) =>
    projectMandateSnapshot(payload, ctx);
```

> The handler-map value type is `(payload, ctx) => Promise<WriteIntent | WriteIntent[]> | WriteIntent | WriteIntent[]`. Returning `WriteIntent | undefined` requires widening that type union to include `undefined` (mirror snapshot-projector.ts, whose handlers return `WriteIntent | undefined`). Update the `handlers` declaration on line 251 accordingly: `... => Promise<WriteIntent | WriteIntent[] | undefined> | WriteIntent | WriteIntent[] | undefined`.

- [ ] **Step 7: Run the unit test + typecheck to verify both pass**

Run: `pnpm nx run compliance-ctrl:test -- event-listener` then `pnpm nx run compliance-ctrl:typecheck`
Expected: PASS — handler emits `projectVersioned`; `MandateSnapshot` typechecks as P1; the `@ts-expect-error` lines in the type-test all error as expected.

- [ ] **Step 8: Commit**

```bash
git add services/advisory/compliance-ctrl/src/read-model-ownership.ts services/advisory/compliance-ctrl/test/types/read-model-ownership.type-test.ts services/advisory/compliance-ctrl/src/handlers/event-listener.ts services/advisory/compliance-ctrl/test/unit/event-listener.test.ts
git commit -m "refactor(compliance-ctrl): MandateSnapshot -> projectVersioned P1

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Consumer — decision-workflow-ctrl `MandateSnapshot` → P1

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/read-model-ownership.ts`
- Modify: `services/advisory/decision-workflow-ctrl/test/types/read-model-ownership.type-test.ts`
- Modify: `services/advisory/decision-workflow-ctrl/src/handlers/mandate-projector.ts`
- Modify: `services/advisory/decision-workflow-ctrl/test/unit/mandate-projector.test.ts`

- [ ] **Step 1: Register the ownership tag + flip the deferral comment** — in `services/advisory/decision-workflow-ctrl/src/read-model-ownership.ts`, replace the `MandateSnapshot is NOT registered` paragraph (lines 14-16) with a registered note and add the field:

```typescript
/**
 * decision-workflow-ctrl read-model ownership registration.
 *
 * Compile-time enforcement (see docs/architecture/READ-MODEL-OWNERSHIP.md):
 *   - DecisionPacket : CommandOwned own-aggregate (update() + self-incremented
 *     __version) → projectVersioned fails typecheck.
 *   - LedgerSnapshot / InvestorProfileSnapshot / MarketSnapshot / MandateSnapshot :
 *     DWC-local MIRRORS of rows owned elsewhere. Projection<'P1'> →
 *     projectVersioned only, keyed on the upstream version carried by CDC. The
 *     owners register the same typenames CommandOwned in their own services —
 *     legal because the drift-checker's R4 is per-service scoped. MandateSnapshot
 *     rides the investor-bff Mandate __version line (read-model-ownership-mandate-projection-fix).
 */
import type { CommandOwned, Projection } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    DecisionPacket: CommandOwned;
    LedgerSnapshot: Projection<'P1'>;
    InvestorProfileSnapshot: Projection<'P1'>;
    MarketSnapshot: Projection<'P1'>;
    MandateSnapshot: Projection<'P1'>;
  }
}

export {};
```

- [ ] **Step 2: Extend the type-test** — append before `export {};` in `services/advisory/decision-workflow-ctrl/test/types/read-model-ownership.type-test.ts`:

```typescript
projectVersioned('MandateSnapshot', { a: 1 }, { version: 1 });
// @ts-expect-error MandateSnapshot is P1 in DWC's mirror — update() is forbidden
update('MandateSnapshot', { a: 1 });
```

- [ ] **Step 3: Rewrite the unit test** — replace the body of `services/advisory/decision-workflow-ctrl/test/unit/mandate-projector.test.ts`:

```typescript
import { createHandlers } from '../../src/handlers/mandate-projector';
import { mandateSnapshotPk, MANDATE_SNAPSHOT_SK } from '../../src/repositories/mandate-snapshot.repository';
import type { EventContext, EventPayload } from '@nestfolio/event-processor';

const ctx = (eventType: string, overrides: Partial<EventContext> = {}): EventContext => ({
  eventId: 'evt-1', eventType, tenantId: 'tenant-1', userId: 'user-1', region: 'us-east-1',
  ...overrides,
} as EventContext);

const payload = (subject: Record<string, unknown>): EventPayload => ({
  subject,
  context: { tenantId: 'tenant-1', userId: 'user-1', region: 'us-east-1' },
} as EventPayload);

const fullMandate = (overrides: Record<string, unknown> = {}) => ({
  tenantId: 'tenant-1', userId: 'user-1', operatingMode: 'BALANCED',
  level: 'ADVISORY', mandateId: 'm-1', effectiveDate: '2026-05-10T00:00:00Z',
  status: 'ACTIVE', __version: 1, ...overrides,
});

describe('mandate-projector (projectVersioned)', () => {
  const handlers = createHandlers();

  it('MANDATE_ISSUED → projectVersioned full row keyed on __version', async () => {
    const result = await handlers.MANDATE_ISSUED(payload(fullMandate()), ctx('MANDATE_ISSUED'));
    expect(result).toMatchObject({
      _tag: 'projectVersioned',
      typename: 'MandateSnapshot',
      version: 1,
      fields: expect.objectContaining({ operatingMode: 'BALANCED', level: 'ADVISORY', status: 'ACTIVE', mandateId: 'm-1' }),
      overrides: { pk: mandateSnapshotPk('tenant-1', 'user-1'), sk: MANDATE_SNAPSHOT_SK },
    });
  });

  it('OPERATING_MODE_CHANGED → projectVersioned full row at the new __version', async () => {
    const result = await handlers.OPERATING_MODE_CHANGED(
      payload(fullMandate({ operatingMode: 'AGGRESSIVE', __version: 2 })), ctx('OPERATING_MODE_CHANGED'),
    );
    expect(result).toMatchObject({
      _tag: 'projectVersioned', typename: 'MandateSnapshot', version: 2,
      fields: expect.objectContaining({ operatingMode: 'AGGRESSIVE', level: 'ADVISORY', mandateId: 'm-1' }),
    });
  });

  it('throws NotRetryableError when operatingMode missing', async () => {
    await expect(handlers.MANDATE_ISSUED(
      payload({ tenantId: 'tenant-1', userId: 'user-1', level: 'ADVISORY', mandateId: 'm-1', __version: 1 }),
      ctx('MANDATE_ISSUED'),
    )).rejects.toThrow(/operatingMode/);
  });

  it('drops (undefined) when __version missing', async () => {
    const result = await handlers.OPERATING_MODE_CHANGED(
      payload({ tenantId: 'tenant-1', userId: 'user-1', operatingMode: 'AGGRESSIVE' }), ctx('OPERATING_MODE_CHANGED'),
    );
    expect(result).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run the unit test + typecheck to verify they fail**

Run: `pnpm nx run decision-workflow-ctrl:test -- mandate-projector` then `pnpm nx run decision-workflow-ctrl:typecheck`
Expected: FAIL — handler still emits `record`/`update`; and `record('MandateSnapshot', …)`/`update('MandateSnapshot', …)` no longer typecheck.

- [ ] **Step 5: Convert the projector** — replace the body of `services/advisory/decision-workflow-ctrl/src/handlers/mandate-projector.ts`:

```typescript
import {
  materializeToTable,
  projectVersioned,
  NotRetryableError,
  type EventPayload,
  type EventContext,
  type WriteIntent,
} from '@nestfolio/event-processor';
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/events';
import { mandateSnapshotPk, MANDATE_SNAPSHOT_SK } from '../repositories/mandate-snapshot.repository';

function projectMandateSnapshot(payload: EventPayload, ctx: EventContext): WriteIntent | undefined {
  const subject = payload.subject ?? {};
  const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
  const userId = (subject.userId as string) ?? tenantId;
  const operatingMode = subject.operatingMode as string | undefined;

  if (!operatingMode) {
    throw new NotRetryableError(
      `${ctx.eventType} missing operatingMode for tenant=${tenantId} user=${userId}`,
    );
  }

  const version = subject.__version;
  if (typeof version !== 'number') return undefined;

  // Full-row P1 projection keyed on the Mandate version line. INSERT (first
  // write) still fires MANDATE_SNAPSHOT_CREATED (the SF trigger); subsequent
  // operatingMode changes overwrite the row -> MODIFY -> no re-trigger.
  return projectVersioned('MandateSnapshot', {
    tenantId,
    userId,
    mandateId: subject.mandateId as string | undefined,
    level: subject.level as string | undefined,
    operatingMode,
    effectiveDate: subject.effectiveDate as string | undefined,
    status: (subject.status as string | undefined) ?? 'ACTIVE',
  }, {
    version,
    overrides: { pk: mandateSnapshotPk(tenantId, userId), sk: MANDATE_SNAPSHOT_SK },
  });
}

export const createHandlers = () => ({
  [InvestorBffEventTypes.MANDATE_ISSUED]: async (p: EventPayload, c: EventContext) => projectMandateSnapshot(p, c),
  [InvestorBffEventTypes.OPERATING_MODE_CHANGED]: async (p: EventPayload, c: EventContext) => projectMandateSnapshot(p, c),
});

export const handler = materializeToTable({
  serviceName: 'decision-workflow-ctrl',
  handlers: createHandlers(),
  errorEventType: 'MANDATE_PROJECTION_FAILED',
});
```

- [ ] **Step 6: Run the unit test + typecheck to verify both pass**

Run: `pnpm nx run decision-workflow-ctrl:test -- mandate-projector` then `pnpm nx run decision-workflow-ctrl:typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/read-model-ownership.ts services/advisory/decision-workflow-ctrl/test/types/read-model-ownership.type-test.ts services/advisory/decision-workflow-ctrl/src/handlers/mandate-projector.ts services/advisory/decision-workflow-ctrl/test/unit/mandate-projector.test.ts
git commit -m "refactor(decision-workflow-ctrl): MandateSnapshot -> projectVersioned P1

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Integration tests — carry `__version` + full Mandate image on synthetic events

> These run against deployed dev (Task 10). The decisive change: synthetic `OPERATING_MODE_CHANGED` and `MANDATE_REVOKED` events must now carry the FULL Mandate image + a monotonic `__version`, mirroring the post-fix producer — otherwise full-row `projectVersioned` writes a row missing `mandateId`/`level`, or drops the event on the version guard.

**Files:**
- Modify: `services/advisory/compliance-ctrl/test/integration/compliance-ctrl.integration.test.ts`
- Modify: `services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts`

- [ ] **Step 1: compliance-ctrl — add `__version` + full image to the mandate events.** In each `eb.putEvent({ ... detailType: 'MANDATE_ISSUED' ... })` add `__version: 1` to the `detail`. For the `OPERATING_MODE_CHANGED` event in "should patch MandateSnapshot.operatingMode…", replace the partial detail with the full Mandate image at `__version: 2`:

```typescript
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'OPERATING_MODE_CHANGED',
      detail: {
        tenantId: ctx.tenantId,
        userId,
        mandateId,
        level: 'ADVISORY',
        status: 'ACTIVE',
        operatingMode: 'AGGRESSIVE',
        effectiveDate: '2026-01-15T00:00:00.000Z',
        __version: 2,
      },
    });
```

For "should set MandateSnapshot.status=REVOKED…" replace the `MANDATE_REVOKED` detail with the full image at `__version: 2`:

```typescript
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'MANDATE_REVOKED',
      detail: {
        tenantId: ctx.tenantId,
        userId,
        mandateId,
        level: 'DISCRETIONARY',
        status: 'REVOKED',
        operatingMode: 'BALANCED',
        effectiveDate: '2026-01-15T00:00:00.000Z',
        revokedAt,
        __version: 2,
      },
    });
```

Apply the same full-image + `__version: 2` shape to the `MANDATE_REVOKED` event in the "DECISION_BLOCKED with MANDATE_SCOPE…" test. The existing assertions (`mandateId`, `level`, `operatingMode`, `status`, `revokedAt`) remain valid because the full image now flows through `projectVersioned`.

- [ ] **Step 2: decision-workflow-ctrl — add `__version: 1` to the `MANDATE_ISSUED` details** in both the "projects MandateSnapshot from MANDATE_ISSUED → … → starts SF" and "non-PROFILE trigger (DEPOSIT_DETECTED) …" tests:

```typescript
      detail: {
        tenantId: ctx.tenantId,
        userId,
        mandateId,
        level: 'ADVISORY',
        operatingMode: 'BALANCED',
        effectiveDate: new Date().toISOString(),
        __version: 1,
      },
```

(No assertion changes — both tests assert the row materializes and the SF starts, which the `projectVersioned` INSERT still drives.)

- [ ] **Step 3: Commit (verification deferred to Task 10's deploy)**

```bash
git add services/advisory/compliance-ctrl/test/integration/compliance-ctrl.integration.test.ts services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts
git commit -m "test(integration): carry __version + full Mandate image on synthetic mandate events

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Producer integration test — dual-write + re-sourced OPERATING_MODE_CHANGED

**Files:**
- Modify: `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts`

- [ ] **Step 1: Add an integration test** asserting that an `updateOperatingMode` mutation (a) bumps the Mandate row `__version` and (b) the system emits `OPERATING_MODE_CHANGED` (carrying the full Mandate image + the Mandate `__version`) and NOT `MANDATE_REVOKED`. Mirror the existing suite's setup (it already constructs `EventBridgeClient`/`EventBusTrap`/`TableAssertions`, completes onboarding to seed the InvestorProfile + Mandate rows, and runs AppSync mutations including `revokeMandate`). Reuse the existing onboarding-seed helper, then:

```typescript
  it('updateOperatingMode bumps the Mandate __version and emits OPERATING_MODE_CHANGED (not MANDATE_REVOKED)', async () => {
    const { userId } = await seedOnboardedUser(); // existing helper: completes onboarding → InvestorProfile + Mandate rows at __version 1
    const trap = new EventBusTrap(ctx);
    await trap.deploy({ bus: 'investor', detailType: ['OPERATING_MODE_CHANGED', 'MANDATE_REVOKED'] });

    await appsync.mutate({ /* existing AppSync helper */
      mutation: 'mutation($m: OperatingMode!){ updateOperatingMode(mode:$m){ operatingMode } }',
      variables: { m: 'AGGRESSIVE' },
      asUser: userId,
    });

    // Mandate row __version incremented from 1 → 2, operatingMode updated.
    const mandate = await table.waitForItem({
      table: 'investor-bff',
      pk: `InvestorProfile#${ctx.tenantId}#${userId}`,
      sk: 'Mandate',
      timeoutMs: 30_000,
      match: { operatingMode: 'AGGRESSIVE' },
    });
    expect(mandate['__version']).toBe(2);
    expect(mandate['status']).toBe('ACTIVE');

    // OPERATING_MODE_CHANGED emitted with the FULL Mandate image + Mandate __version.
    const evt = await trap.waitForEvent({
      detailType: 'OPERATING_MODE_CHANGED',
      match: (d) => {
        const s = (d as Record<string, unknown>).subject as Record<string, unknown>;
        return s?.['userId'] === userId;
      },
      timeoutMs: 60_000,
    });
    const subject = (evt.detail as Record<string, unknown>).subject as Record<string, unknown>;
    expect(subject['operatingMode']).toBe('AGGRESSIVE');
    expect(subject['mandateId']).toBeDefined();
    expect(subject['level']).toBeDefined();
    expect(subject['__version']).toBe(2);

    // A mode change must NOT emit MANDATE_REVOKED.
    await expect(trap.waitForEvent({
      detailType: 'MANDATE_REVOKED',
      match: (d) => ((d as Record<string, unknown>).subject as Record<string, unknown>)?.['userId'] === userId,
      timeoutMs: 8_000,
    })).rejects.toThrow();
  }, 180_000);
```

> Adapt `seedOnboardedUser` / `appsync.mutate` / `table.waitForItem` call shapes to the exact helpers already present in `investor-bff.integration.test.ts`. The assertion intent (Mandate `__version` bump, full-image `OPERATING_MODE_CHANGED`, no `MANDATE_REVOKED`) is what matters.

- [ ] **Step 2: Commit (verification deferred to Task 10's deploy)**

```bash
git add services/investor/investor-bff/test/integration/investor-bff.integration.test.ts
git commit -m "test(integration): assert updateOperatingMode dual-write + re-sourced OPERATING_MODE_CHANGED

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Docs — §9.1 gap resolution + service-card regen

**Files:**
- Modify: `docs/architecture/READ-MODEL-OWNERSHIP.md:264-273`
- Regen: 3 service cards via `audit-service`.

- [ ] **Step 1: Resolve the §9.1 gap note** — in `docs/architecture/READ-MODEL-OWNERSHIP.md`, replace the `> **Known gap (2026-06-02):** …` blockquote (lines 264-273) with:

```markdown
`MANDATE_ISSUED`/`MANDATE_REVOKED`/`OPERATING_MODE_CHANGED` are all CDC from the
Mandate row on one monotonic `__version` line, each carrying the full Mandate
image. compliance-ctrl and decision-workflow-ctrl both project `MandateSnapshot`
as `Projection<'P1'>` via `projectVersioned` keyed on that `__version`
(`read-model-ownership-mandate-projection-fix`, 2026-06-03). `updateOperatingMode`
dual-writes the InvestorProfile composite row (keeps `INVESTOR_PROFILE_UPDATED`
feeding dashboard-bff's `InvestorSnapshot`) and the Mandate sibling row in one
`TransactWriteItems`; `OPERATING_MODE_CHANGED` is re-sourced from the Mandate row.
```

Also update the §9 per-row table row for `InvestorProfile`, `Mandate` if it implies the gap (it currently reads "command-owned, seeded" — leave the kind as-is; `MandateSnapshot` is the *projected* mirror, not the owner row, so no table-row change is needed beyond the prose above).

- [ ] **Step 2: Commit the doc**

```bash
git add docs/architecture/READ-MODEL-OWNERSHIP.md
git commit -m "docs(read-model): resolve §9.1 Mandate operatingMode cross-row gap

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 3: Regenerate the 3 service cards** — run the `audit-service` skill for each touched service and commit the regenerated `CLAUDE.md` files:

Run (via the audit-service skill, one per service): `investor-bff`, `compliance-ctrl`, `decision-workflow-ctrl`.
Expected card deltas:
- investor-bff: Egress map (Mandate.modify now `onFieldChange:{status→MANDATE_REVOKED, operatingMode→OPERATING_MODE_CHANGED}`; InvestorProfile.modify.onFieldChange drops operatingMode); updateOperatingMode resolver now `TransactWriteItems` dual-write + readback.
- compliance-ctrl: Read model — `MandateSnapshot: Projection<'P1'>` registered; handler emits `projectVersioned`.
- decision-workflow-ctrl: Read model — `MandateSnapshot: Projection<'P1'>` registered; mandate-projector emits `projectVersioned`.

```bash
git add services/investor/investor-bff/CLAUDE.md services/advisory/compliance-ctrl/CLAUDE.md services/advisory/decision-workflow-ctrl/CLAUDE.md
git commit -m "docs(cards): regen for Mandate projection fix (dual-write + P1 conversions)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Validation gate (cheap set + deploy; real-LLM e2e deferred to WS-D)

- [ ] **Step 1: Cheap gate — affected unit + lint**

Run: `pnpm nx affected -t test,lint --base=origin/main`
Expected: PASS across all affected projects (the two libs, investor-bff, compliance-ctrl, decision-workflow-ctrl, and anything transitively affected).

- [ ] **Step 2: Per-service typecheck**

Run: `pnpm nx run investor-bff:typecheck && pnpm nx run compliance-ctrl:typecheck && pnpm nx run decision-workflow-ctrl:typecheck`
Expected: PASS for compliance-ctrl + decision-workflow-ctrl. For investor-bff, only the pre-existing `investor-bff-13-latent-tsc-errors` may appear; no NEW errors from this change.

- [ ] **Step 3: Read-model drift checker (must be green)**

Run: `pnpm nx run event-processor:read-model-drift`
Expected: PASS — `MandateSnapshot` is now registered `Projection<'P1'>` in both compliance-ctrl and decision-workflow-ctrl (per-service R4), written only via `projectVersioned`. No `MandateSnapshot` INFO/ERROR remains.

- [ ] **Step 4: Deploy to dev**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-bff,compliance-ctrl,decision-workflow-ctrl`
Expected: 3 stacks deploy cleanly.

- [ ] **Step 5: Integration tests (mocked agents) against deployed dev**

Run: `pnpm nx affected -t test-integration --base=origin/main`
Expected: PASS — including the updated compliance-ctrl + DWC mandate tests (Task 7) and the new investor-bff producer test (Task 8). If a pre-existing unrelated failure appears (e.g. `ip-ctrl-integration-snapshot-userid-mismatch`, pulled in only because `tools/` over-broadens `nx affected`), confirm it is NOT caused by this change before proceeding. Treat any flake as a real failure: pull CloudWatch evidence from the failing window and run a confirmation pass.

- [ ] **Step 6: Record the validation gate** in `docs/backlog/read-model-ownership-mandate-projection-fix.md` `validation_gate:` with concrete evidence (commit SHAs, the deploy log line, the integration command output, the drift-checker output). This is handled by the `/backlog-next` closing phase, not a code commit here.

> Real-LLM e2e (advisory decision pipeline) is intentionally deferred to the program-end consolidated pass recorded as WS-D's `validation_gate` (2026-06-02 cadence decision). Do NOT run the full e2e or Playwright suites for this item.

---

## Self-Review

**Spec coverage:**
- §"Library enablement" → Tasks 1 + 2. ✓
- §"Producer — investor-bff" (resolver dual-write + Egress map) → Tasks 3 + 4. ✓
- §"Consumer — compliance-ctrl" → Task 5. ✓
- §"Consumer — decision-workflow-ctrl" → Task 6. ✓
- §"Tests" (lib unit, producer unit+integration, consumer unit+integration, `__version` on synthetic events) → Tasks 1,2,3,5,6 (unit) + 7,8 (integration). ✓
- §"Docs" (§9.1 + card regen) → Task 9. ✓
- §"Validation gate" → Task 10. ✓

**Type consistency:** `projectVersioned(typename, fields, { version, overrides: { pk, sk } })` used identically in Tasks 5 + 6 and matches `libs/event-processor/src/intents/project-versioned.ts`. The projected intent shape asserted in tests (`{ _tag: 'projectVersioned', typename, fields, version, overrides }`) matches the factory output. `mandateSnapshotPk`/`MANDATE_SNAPSHOT_SK` (DWC) and `guardrailPolicyPk`/`sk:'MandateSnapshot'` (compliance) match their source files. Handler return type widened to include `undefined` in both consumers, matching `snapshot-projector.ts`.

**Placeholder scan:** No TBD/TODO. Two adaptation notes (Task 8's helper names, Task 7's apply-to-all-three) are explicit instructions with concrete code, not placeholders — the executing agent reads the existing helpers in those files.

**Decision/INSERT-vs-MODIFY check:** `projectVersioned` uses `PutCommand` (full overwrite) — first write INSERT, overwrite MODIFY — so DWC's insert-only `MANDATE_SNAPSHOT_CREATED` SF trigger fires once and operatingMode changes do not re-trigger. Verified against `intent-executor.ts:95-129`.
