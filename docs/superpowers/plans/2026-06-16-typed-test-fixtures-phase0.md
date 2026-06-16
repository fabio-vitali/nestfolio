# Typed Test Fixtures — Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reusable typed-fixture mechanism (producer event→schema maps + composed registry + typed `putEvent`/`waitForItem` + runtime parse backstop + regression gate) and prove it by retrofitting compliance-ctrl's integration + e2e fixtures, turning the two pre-existing co-wrong fixtures (Bug A, Bug B) into compile-then-corrected errors.

**Architecture:** Each producer exports a typed `event-name → zod-subject-schema` map co-located with its contracts (extends the existing 21 `publisher-schemas` registries to the event-name level). A new `libs/test-contracts` lib composes the producer maps into one `EventSubjects` registry. `test-support`'s `EventBridgeClient.putEvent` gains a **typed overload** (`detailType: K`, `subject: SubjectOf<K>`, `context?: TestEventContext`) alongside the retained **legacy overload** (`detail: Record<string, unknown>`) so the ~280 not-yet-migrated call sites keep compiling; the typed path runs `schema.parse(subject)` as a runtime backstop. A per-domain regression gate (`tools/check-typed-fixtures.mjs`) forbids the legacy `detail:` form in migrated dirs.

**Tech Stack:** TypeScript, Nx, zod, Jest, `aws-sdk-client-mock`, `tsc --noEmit` type-tests, Node `.mjs` lint scanner.

---

## Background facts (verified against worktree `2026-06-16-typed-test-fixtures-phase0`)

- `RequestContext` (`libs/event-processor/src/domain/schemas.ts`): `{ tenantId: TenantId; userId: UserId; region: string }` — `TenantId`/`UserId` are **branded** strings. The test layer uses **plain** strings (`TestContext.tenantId/userId: string`), so the typed `context` param uses a plain-string `TestEventContext`, NOT `Partial<RequestContext>` (avoids forcing every fixture to brand its per-test ids; the constructed envelope is identical). This is a deliberate, documented adaptation of spec §3.3.
- `BusEvent<T,S>` (`libs/event-processor/src/platform/bus.ts`) = `Event & { subject: T; context: S }`; `Event` = `{ id; type; timestamp }`. The envelope built by `putEvent` already matches this exactly.
- `MandateSchema` (`services/investor/investor-adpt/src/domain/contracts.ts`, exported via `@nestfolio/investor-adpt/domain`): `z.object({ mandateId, level: enum, status: enum, operatingMode: enum, effectiveDate: string, revokedAt: string.nullable().optional(), __version: number.optional() })` — **DRY, no tenantId/userId**.
- `RecommendationProposedSchema` (`services/advisory/decision-workflow-ctrl/src/domain/contracts.ts`, exported via `@nestfolio/decision-workflow-ctrl/contracts`): `z.object({ decisionId, taskToken, awaitingCompliance: literal(true), proposedTrades: array(unknown), portfolioValueCents: number, isInitialBuild: boolean, riskCategory: string, currentPositions: array(unknown) })` — **DRY, no tenantId/userId**.
- Real producer of `RECOMMENDATION_PROPOSED` (`decision-state-machine.ts` L226-227) **does** emit `isInitialBuild` + `riskCategory` → Bug B is fixture-only (case (a)); **no latent contract bug to file**.
- `eslint.config.js` `@nx/enforce-module-boundaries.allow` already contains `@nestfolio/.+/contracts` and `@nestfolio/.+-adpt/domain`; so test libs + fixtures may import producer schemas with no boundary violation (spec §5).
- The `detailType` values used by the compliance-ctrl integration fixtures are **bare string literals** (`detailType: 'MANDATE_ISSUED'`); the e2e uses the branded constant `DecisionWorkflowEventTypes.RECOMMENDATION_PROPOSED`.

## File Structure

| File | Responsibility |
|------|----------------|
| `libs/test-contracts/project.json`, `package.json`, `tsconfig.json`, `jest.config.js` | New Nx lib scaffold (`scope:platform`, `type:lib`). |
| `libs/test-contracts/src/index.ts` | Composed `EventSubjects` registry + `RegisteredEventName` + `SubjectOf<K>` types. |
| `services/investor/investor-adpt/src/domain/contracts.ts` (+ `index.ts`) | Add `mandateEventSubjects` (event-name→`MandateSchema` map) + export. |
| `services/advisory/decision-workflow-ctrl/src/domain/contracts.ts` | Add `decisionWorkflowEventSubjects` (event-name→schema map) + path-alias export already exists. |
| `libs/test-support/src/fixtures/event-bridge-client.ts` | Typed `putEvent` overload + `TestEventContext` + runtime backstop. |
| `libs/test-support/src/index.ts` | Re-export `TestEventContext`. |
| `libs/test-support/test/types/put-event.type-test.ts` | `@ts-expect-error` compile-error type-tests. |
| `libs/test-support/test/fixtures/put-event-backstop.test.ts` | Runtime `parse()` throw-path unit test. |
| `libs/test-support/tsconfig.type-test.json` + `project.json` `typecheck` target | Compile-error gate wiring. |
| `libs/integration-testing/src/fixtures/table-assertions.ts` | Generic `waitForItem<T>` (backward-compatible default). |
| `services/advisory/compliance-ctrl/test/integration/*.integration.test.ts` | Migrate to typed `subject:` + `context:` (Bug A fix). |
| `apps/e2e-feature-tests/src/profile/update-operating-mode.e2e.test.ts` | Migrate the `RECOMMENDATION_PROPOSED` call (Bug B fix). |
| `tools/check-typed-fixtures.mjs` + `tools/typed-fixture-migrated.json` | Per-domain regression gate forbidding legacy `detail:` in migrated dirs. |
| `tsconfig.base.json` | Add `@nestfolio/test-contracts` path alias. |

---

## Task 1: Scaffold `libs/test-contracts` lib + path alias

**Files:**
- Create: `libs/test-contracts/project.json`
- Create: `libs/test-contracts/package.json`
- Create: `libs/test-contracts/tsconfig.json`
- Create: `libs/test-contracts/jest.config.js`
- Create: `libs/test-contracts/src/index.ts` (temporary stub)
- Modify: `tsconfig.base.json` (add path alias)

- [ ] **Step 1: Create `libs/test-contracts/project.json`**

```json
{
  "name": "test-contracts",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "libs/test-contracts/src",
  "projectType": "library",
  "targets": {
    "test": {
      "executor": "@nx/jest:jest",
      "options": {
        "jestConfig": "libs/test-contracts/jest.config.js",
        "passWithNoTests": true
      }
    },
    "lint": {
      "executor": "@nx/eslint:lint"
    }
  },
  "tags": ["scope:platform", "type:lib"]
}
```

- [ ] **Step 2: Create `libs/test-contracts/package.json`**

```json
{
  "name": "@nestfolio/test-contracts",
  "version": "0.0.1",
  "private": true
}
```

- [ ] **Step 3: Create `libs/test-contracts/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ES2022",
    "target": "ES2022",
    "declaration": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: Create `libs/test-contracts/jest.config.js`**

```javascript
const preset = require('../../jest.preset');

module.exports = {
  ...preset,
  displayName: 'test-contracts',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', diagnostics: false }],
  },
};
```

- [ ] **Step 5: Create a temporary `libs/test-contracts/src/index.ts` stub** (replaced in Task 3 — exists only so lint/path-resolution pass now)

```typescript
// Composed typed-fixture registry. Populated in Task 3.
export const EventSubjects = {} as const;
```

- [ ] **Step 6: Add the path alias to `tsconfig.base.json`**

Find the `compilerOptions.paths` block (where `@nestfolio/test-support` and `@nestfolio/event-types` are mapped) and add, alphabetically near the other `@nestfolio/test-*` entries:

```json
"@nestfolio/test-contracts": ["libs/test-contracts/src/index.ts"],
"@nestfolio/test-contracts/*": ["libs/test-contracts/src/*"],
```

- [ ] **Step 7: Verify the lib resolves and lints**

Run: `pnpm nx lint test-contracts`
Expected: PASS (no lint errors; project is discovered by Nx).

Run: `pnpm nx run test-contracts:test`
Expected: PASS — "No tests found, passing with `--passWithNoTests`".

- [ ] **Step 8: Commit**

```bash
git add libs/test-contracts tsconfig.base.json
git commit --no-verify -m "feat(test-contracts): scaffold typed-fixture registry lib"
```

---

## Task 2: Producer event→schema maps

Two producers are involved in Phase 0: investor (mandate events, schema in `investor-adpt/domain`) and decision-workflow-ctrl (`RECOMMENDATION_PROPOSED`). Maps use **bare string-literal keys** so `keyof typeof` yields a literal union, and `as const satisfies Record<string, ZodTypeAny>` to pin the value types.

**Files:**
- Modify: `services/investor/investor-adpt/src/domain/contracts.ts`
- Modify: `services/investor/investor-adpt/src/domain/index.ts`
- Modify: `services/advisory/decision-workflow-ctrl/src/domain/contracts.ts`

- [ ] **Step 1: Add `mandateEventSubjects` to `investor-adpt/src/domain/contracts.ts`**

At the end of the file (after `MandateSchema`/`export type Mandate`), add. The four mandate event names are the detailTypes investor-bff emits off the Mandate row (MANDATE_ISSUED / OPERATING_MODE_CHANGED / MANDATE_REVOKED / MANDATE_REAFFIRMED — all carry the full Mandate image):

```typescript
import type { ZodTypeAny } from 'zod';

/**
 * Test-fixture event→subject map for the Mandate aggregate. One aggregate, four
 * event names, all carrying the full Mandate image (MandateSchema). Co-located with
 * the producer-owned contract (single source of truth) and consumed only by the
 * typed-fixture registry (`@nestfolio/test-contracts`). Bare string-literal keys so
 * `keyof typeof` is a literal union.
 */
export const mandateEventSubjects = {
  MANDATE_ISSUED: MandateSchema,
  OPERATING_MODE_CHANGED: MandateSchema,
  MANDATE_REVOKED: MandateSchema,
  MANDATE_REAFFIRMED: MandateSchema,
} as const satisfies Record<string, ZodTypeAny>;
```

- [ ] **Step 2: Export it from `investor-adpt/src/domain/index.ts`**

The current line is:
```typescript
export { DepositInitiatedSchema, WithdrawalInitiatedSchema, MandateSchema, ExecutionModeChangedSchema } from './contracts';
```
Add `mandateEventSubjects`:
```typescript
export { DepositInitiatedSchema, WithdrawalInitiatedSchema, MandateSchema, ExecutionModeChangedSchema, mandateEventSubjects } from './contracts';
```

- [ ] **Step 3: Add `decisionWorkflowEventSubjects` to `decision-workflow-ctrl/src/domain/contracts.ts`**

At the end of the file (after `RecommendationProposedSchema`/`export type RecommendationProposed`), add:

```typescript
import type { ZodTypeAny } from 'zod';

/**
 * Test-fixture event→subject map for decision-workflow-ctrl's SF-direct emissions.
 * RECOMMENDATION_PROPOSED is putEvents'd from the ASL (decision-state-machine.ts),
 * not CDC, so it is not in publisher-schemas; this map carries its subject contract
 * for fixtures. Consumed only by `@nestfolio/test-contracts`.
 */
export const decisionWorkflowEventSubjects = {
  RECOMMENDATION_PROPOSED: RecommendationProposedSchema,
} as const satisfies Record<string, ZodTypeAny>;
```

(`@nestfolio/decision-workflow-ctrl/contracts` already maps to this file in `tsconfig.base.json`, so no export-barrel change is needed.)

- [ ] **Step 4: Typecheck both producers**

Run: `pnpm nx run-many -t lint -p investor-adpt,decision-workflow-ctrl`
Expected: PASS (the `as const satisfies` compiles; `ZodTypeAny` import resolves).

- [ ] **Step 5: Commit**

```bash
git add services/investor/investor-adpt/src/domain services/advisory/decision-workflow-ctrl/src/domain/contracts.ts
git commit --no-verify -m "feat(contracts): add producer event-subject maps for mandate + recommendation events"
```

---

## Task 3: Compose the `EventSubjects` registry

**Files:**
- Modify: `libs/test-contracts/src/index.ts` (replace the Task-1 stub)

- [ ] **Step 1: Replace `libs/test-contracts/src/index.ts` with the composed registry**

```typescript
import type { z, ZodTypeAny } from 'zod';
import { mandateEventSubjects } from '@nestfolio/investor-adpt/domain';
import { decisionWorkflowEventSubjects } from '@nestfolio/decision-workflow-ctrl/contracts';

/**
 * The single typed registry of `event detailType → producer subject schema`, composed
 * from each producer's own event-subject map (the producer remains the source of truth).
 * Each retrofit phase adds its domain's producer maps here. A typed fixture references
 * this registry so a missing/extra/mistyped subject field, an identity field in the
 * subject, or an unknown event name is a COMPILE error; `putEvent` also runs
 * `EventSubjects[detailType].parse(subject)` as a runtime backstop.
 */
export const EventSubjects = {
  ...mandateEventSubjects,
  ...decisionWorkflowEventSubjects,
} as const satisfies Record<string, ZodTypeAny>;

/** Union of all registered event names (detailTypes). */
export type RegisteredEventName = keyof typeof EventSubjects;

/** The DRY producer subject type for a registered event name. */
export type SubjectOf<K extends RegisteredEventName> = z.infer<(typeof EventSubjects)[K]>;
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm nx run test-contracts:test`
Expected: PASS (passWithNoTests; the import + `z.infer` type composition typecheck).

Run: `pnpm nx lint test-contracts`
Expected: PASS (cross-domain producer-schema imports are allowlisted via `@nestfolio/.+/contracts` + `-adpt/domain`).

- [ ] **Step 3: Commit**

```bash
git add libs/test-contracts/src/index.ts
git commit --no-verify -m "feat(test-contracts): compose EventSubjects registry (mandate + recommendation)"
```

---

## Task 4: Typed `putEvent` overload + runtime backstop (TDD)

The typed overload must coexist with the legacy untyped overload (≈280 unmigrated call sites use `detail:`). The discriminator is the presence of `subject`. The runtime `parse()` runs **before** the SSM/EB network calls so the backstop throws offline (and is unit-testable).

**Files:**
- Modify: `libs/test-support/src/fixtures/event-bridge-client.ts`
- Modify: `libs/test-support/src/index.ts`
- Create: `libs/test-support/test/types/put-event.type-test.ts`
- Create: `libs/test-support/test/fixtures/put-event-backstop.test.ts`
- Create: `libs/test-support/tsconfig.type-test.json`
- Modify: `libs/test-support/project.json` (add `typecheck` target)

- [ ] **Step 1: Write the failing runtime-backstop unit test** `libs/test-support/test/fixtures/put-event-backstop.test.ts`

```typescript
import { mockClient } from 'aws-sdk-client-mock';
import { EventBridgeClient as AwsEBClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { EventBridgeClient } from '../../src/fixtures/event-bridge-client';
import type { TestContext } from '../../src/context';

const ebMock = mockClient(AwsEBClient);

function fakeCtx(): TestContext {
  return {
    tenantId: 'integ-tenant',
    userId: 'integ-user',
    prefix: 'dev',
    region: 'us-east-1',
    // busArn must NOT be reached when the subject is invalid — the parse backstop
    // throws first. Make it explode if called so the test proves ordering.
    ssm: { busArn: async () => { throw new Error('ssm.busArn must not be called when subject is invalid'); } } as unknown as TestContext['ssm'],
    cleanup: { register: () => undefined } as unknown as TestContext['cleanup'],
    timings: { eventTimeout: 1, pollInterval: 1, canaryTimeout: 1, putEventRetries: 0, putEventBackoffMs: 0 },
  };
}

beforeEach(() => ebMock.reset());

it('runtime backstop: rejects an invalid typed subject before any network call', async () => {
  const client = new EventBridgeClient(fakeCtx());
  await expect(
    client.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'MANDATE_ISSUED',
      // missing required mandateId/level/status/... — cast past the type layer to
      // exercise the RUNTIME backstop (a dynamic/`as`-cast escape must still throw).
      subject: { operatingMode: 'BALANCED' } as never,
    }),
  ).rejects.toThrow();
  expect(ebMock.commandCalls(PutEventsCommand)).toHaveLength(0);
});

it('runtime backstop: accepts a valid typed subject and sends exactly one event', async () => {
  ebMock.onAnyCommand().resolves({ FailedEntryCount: 0, Entries: [{ EventId: 'evt-1' }] });
  const ctx = fakeCtx();
  // Valid path needs a resolvable busArn.
  (ctx.ssm as unknown as { busArn: (b: string) => Promise<string> }).busArn = async () => 'arn:aws:events:us-east-1:1:event-bus/advisory';
  const client = new EventBridgeClient(ctx);
  await client.putEvent({
    bus: 'advisory',
    targetService: 'compliance-ctrl',
    detailType: 'MANDATE_ISSUED',
    subject: { mandateId: 'm-1', level: 'DISCRETIONARY', status: 'ACTIVE', operatingMode: 'BALANCED', effectiveDate: '2026-01-15T00:00:00.000Z', __version: 1 },
    context: { userId: 'per-test-user' },
  });
  expect(ebMock.commandCalls(PutEventsCommand)).toHaveLength(1);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm nx run test-support:test --testPathPatterns put-event-backstop`
Expected: FAIL — the current `putEvent` has no `subject`/`context` params, so the typed call shapes don't exist (TS compile error in the test) / no runtime parse.

- [ ] **Step 3: Implement the typed overload + backstop** — replace the body of `libs/test-support/src/fixtures/event-bridge-client.ts`

```typescript
import { EventBridgeClient as AwsEBClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { randomUUID } from 'crypto';
import { EventSubjects, type RegisteredEventName, type SubjectOf } from '@nestfolio/test-contracts';
import type { TestContext } from '../context';

/**
 * Per-test identity override for the event CONTEXT (where handlers read identity).
 * Plain strings on purpose: the test layer does not brand TenantId/UserId, and the
 * constructed envelope is identical to the production BusEvent context.
 */
export interface TestEventContext {
  tenantId?: string;
  userId?: string;
  region?: string;
}

export class EventBridgeClient {
  private readonly client: AwsEBClient;
  private readonly ctx: TestContext;

  constructor(ctx: TestContext) {
    this.ctx = ctx;
    this.client = new AwsEBClient({ region: ctx.region });
    ctx.cleanup.register('EventBridgeClient', () => {
      this.client.destroy();
      return Promise.resolve();
    });
  }

  // Typed overload — `subject` is checked at compile time against the producer schema
  // for `detailType`, and `parse`d at runtime as a backstop. Per-test identity goes in
  // `context`, NOT the subject (DRY subjects: identity-in-subject is an excess-property error).
  async putEvent<K extends RegisteredEventName>(params: {
    bus: string;
    targetService: string | string[];
    detailType: K;
    subject: SubjectOf<K>;
    context?: TestEventContext;
    eventId?: string;
  }): Promise<void>;
  // Legacy untyped overload — retained for not-yet-migrated domains; removed per-domain
  // by the typed-fixtures retrofit (gate: tools/check-typed-fixtures.mjs).
  async putEvent(params: {
    bus: string;
    // Single target routes only to that service's Ingress. Array fans the same envelope
    // (shared `id`) to N services, each with its own `integration-test:<service>` source.
    targetService: string | string[];
    detailType: string;
    detail: Record<string, unknown>;
    eventId?: string;
  }): Promise<void>;
  async putEvent(params: {
    bus: string;
    targetService: string | string[];
    detailType: string;
    subject?: unknown;
    detail?: Record<string, unknown>;
    context?: TestEventContext;
    eventId?: string;
  }): Promise<void> {
    const targets = Array.isArray(params.targetService)
      ? params.targetService
      : [params.targetService];
    if (targets.length === 0) {
      throw new Error('putEvent: targetService must not be an empty array');
    }

    // Resolve the subject. Typed path = parse against the registry (runtime backstop,
    // BEFORE any network call so a bad subject throws offline). Legacy path = raw detail.
    let subject: unknown;
    if ('subject' in params && params.subject !== undefined) {
      const schema = EventSubjects[params.detailType as RegisteredEventName];
      if (!schema) {
        throw new Error(`putEvent: no registered subject schema for detailType "${params.detailType}"`);
      }
      subject = schema.parse(params.subject);
    } else {
      subject = params.detail;
    }

    const busArn = await this.ctx.ssm.busArn(params.bus);
    const maxRetries = this.ctx.timings.putEventRetries;
    const baseBackoff = this.ctx.timings.putEventBackoffMs;

    const detail = {
      id: params.eventId ?? `integ-${randomUUID()}`,
      type: params.detailType,
      timestamp: new Date().toISOString(),
      subject,
      context: {
        tenantId: params.context?.tenantId ?? this.ctx.tenantId,
        userId: params.context?.userId ?? this.ctx.userId,
        region: params.context?.region ?? this.ctx.region,
      },
    };

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.client.send(new PutEventsCommand({
          Entries: targets.map((target) => ({
            EventBusName: busArn,
            Source: `integration-test:${target}`,
            DetailType: params.detailType,
            Detail: JSON.stringify(detail),
          })),
        }));
        if (result.FailedEntryCount === 0) return;
        if (attempt === maxRetries) {
          throw new Error(`putEvent failed after ${maxRetries} retries: ${result.Entries?.[0]?.ErrorMessage}`);
        }
      } catch (err) {
        if (attempt === maxRetries) throw err;
      }
      await new Promise(r => setTimeout(r, baseBackoff * Math.pow(2, attempt)));
    }
  }
}
```

- [ ] **Step 4: Re-export `TestEventContext`** — in `libs/test-support/src/index.ts` change the EventBridgeClient export line to also export the type:

```typescript
export { EventBridgeClient, type TestEventContext } from './fixtures/event-bridge-client';
```

- [ ] **Step 5: Run the runtime-backstop test to verify it passes**

Run: `pnpm nx run test-support:test --testPathPatterns put-event-backstop`
Expected: PASS (both cases).

- [ ] **Step 6: Write the compile-error type-test** `libs/test-support/test/types/put-event.type-test.ts`

```typescript
/**
 * Type-level tests for the typed putEvent overload. Validated by
 * `pnpm nx run test-support:typecheck` (tsc --noEmit). No runtime assertions: a
 * `@ts-expect-error` that does NOT error is itself a compile failure — that is the
 * test failing. `use(...)` keeps noUnusedLocals/no-unused-expressions satisfied.
 */
import { EventBridgeClient } from '../../src/fixtures/event-bridge-client';

declare function use(...xs: unknown[]): void;
declare const eb: EventBridgeClient;

// --- happy path: a complete, correct mandate subject typechecks ---
use(eb.putEvent({
  bus: 'advisory',
  targetService: 'compliance-ctrl',
  detailType: 'MANDATE_ISSUED',
  subject: { mandateId: 'm', level: 'DISCRETIONARY', status: 'ACTIVE', operatingMode: 'BALANCED', effectiveDate: '2026-01-15T00:00:00.000Z', __version: 1 },
  context: { userId: 'u' },
}));

// --- Bug B class: missing required subject fields is a compile error ---
use(eb.putEvent({
  bus: 'advisory',
  targetService: 'compliance-ctrl',
  detailType: 'RECOMMENDATION_PROPOSED',
  // @ts-expect-error — missing isInitialBuild + riskCategory (required by RecommendationProposedSchema)
  subject: { decisionId: 'd', taskToken: 't', awaitingCompliance: true, proposedTrades: [], portfolioValueCents: 1, currentPositions: [] },
}));

// --- Bug A class: an identity field in the subject is an excess-property error ---
use(eb.putEvent({
  bus: 'advisory',
  targetService: 'compliance-ctrl',
  detailType: 'MANDATE_ISSUED',
  // @ts-expect-error — userId is identity; it belongs in `context`, not the DRY subject
  subject: { userId: 'u', mandateId: 'm', level: 'DISCRETIONARY', status: 'ACTIVE', operatingMode: 'BALANCED', effectiveDate: '2026-01-15T00:00:00.000Z' },
}));

// --- unknown event name is a compile error ---
use(eb.putEvent({
  bus: 'advisory',
  targetService: 'compliance-ctrl',
  // @ts-expect-error — NOT_A_REAL_EVENT is not a RegisteredEventName
  detailType: 'NOT_A_REAL_EVENT',
  subject: { anything: true },
}));
```

- [ ] **Step 7: Create `libs/test-support/tsconfig.type-test.json`**

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

- [ ] **Step 8: Add a `typecheck` target to `libs/test-support/project.json`**

Inside `targets`, add:

```json
"typecheck": {
  "executor": "nx:run-commands",
  "options": {
    "command": "tsc --noEmit -p libs/test-support/tsconfig.type-test.json"
  }
}
```

- [ ] **Step 9: Run the type-test to verify the negatives fire**

Run: `pnpm nx run test-support:typecheck`
Expected: PASS — every `@ts-expect-error` is matched by a real error (the happy path compiles). If any `@ts-expect-error` is "unused", tsc fails — that means a guard isn't actually catching its bug; fix the types, do not delete the assertion.

- [ ] **Step 10: Commit**

```bash
git add libs/test-support tsconfig.base.json
git commit --no-verify -m "feat(test-support): typed putEvent overload + runtime backstop + type-tests"
```

---

## Task 5: Generic `waitForItem<T>` read side (backward-compatible)

Bug A's root fix is the Task-4 `context` param; the typed read side is the complementary protection on the assertion side (spec §3.4). Make it a **non-breaking generic** — default `T` preserves every existing caller.

**Files:**
- Modify: `libs/integration-testing/src/fixtures/table-assertions.ts`

- [ ] **Step 1: Make `waitForItem` generic**

Change the method signature (and only the signature + return type — the body is unchanged because the match/predicate logic already operates structurally):

```typescript
  async waitForItem<T extends Record<string, unknown> = Record<string, unknown>>(params: {
    table: string;
    pk: string;
    sk?: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
    match?: Partial<T>;
    predicate?: (item: T) => boolean;
    description?: string;
  }): Promise<T> {
```

Inside the body, update the two internal `item` typings so it compiles under the generic:
- change `let lastObserved: Record<string, unknown> | undefined;` → `let lastObserved: T | undefined;`
- change `let item: Record<string, unknown> | undefined;` → `let item: T | undefined;`
- the two `item = unmarshall(...)` assignments become `item = unmarshall(...) as T;`
- the predicate/match access stays as-is; the final `return item;` now returns `T`.

(`queryItems`, `cleanup`, `cleanupAll` are unchanged.)

- [ ] **Step 2: Verify integration-testing still compiles**

Run: `pnpm nx lint integration-testing`
Expected: PASS — existing callers that don't pass `<T>` default to `Record<string, unknown>`, identical to before.

- [ ] **Step 3: Commit**

```bash
git add libs/integration-testing/src/fixtures/table-assertions.ts
git commit --no-verify -m "feat(integration-testing): generic waitForItem<T> (backward-compatible default)"
```

---

## Task 6: Migrate compliance-ctrl integration fixtures (Bug A)

**File:** `services/advisory/compliance-ctrl/test/integration/compliance-ctrl.integration.test.ts`

**The mechanical migration rule** for every `putEvent({ ... detail: {...} })` call:
1. Rename the `detail:` key to `subject:`.
2. **Remove** `tenantId: ctx.tenantId` from the subject (it defaults to `ctx.tenantId` in the envelope context).
3. **Move** the per-test `userId` out of the subject into a new sibling `context: { userId }`.
4. Leave every other field in the subject (it is exactly the producer schema's shape).
5. **Do not touch** the `waitForItem`/`pollForMandateSnapshot` assertions — they already poll `pk: GuardrailPolicy#${ctx.tenantId}#${userId}` with the per-test `userId`, which is now the key the handler actually writes (because `ctx.userId` = the per-call override).

The `MANDATE_*` calls (subject = `MandateSchema`) and the `RECOMMENDATION_PROPOSED` calls (subject = `RecommendationProposedSchema`) both follow the same rule.

- [ ] **Step 1: Migrate the MANDATE_ISSUED projection test (≈L82-114)**

Before:
```typescript
await eb.putEvent({
  bus: 'advisory',
  targetService: 'compliance-ctrl',
  detailType: 'MANDATE_ISSUED',
  detail: {
    tenantId: ctx.tenantId,
    userId,
    mandateId,
    level: 'DISCRETIONARY',
    status: 'ACTIVE',
    operatingMode: 'BALANCED',
    effectiveDate: '2026-01-15T00:00:00.000Z',
    __version: 1,
  },
});
```
After:
```typescript
await eb.putEvent({
  bus: 'advisory',
  targetService: 'compliance-ctrl',
  detailType: 'MANDATE_ISSUED',
  subject: {
    mandateId,
    level: 'DISCRETIONARY',
    status: 'ACTIVE',
    operatingMode: 'BALANCED',
    effectiveDate: '2026-01-15T00:00:00.000Z',
    __version: 1,
  },
  context: { userId },
});
```

- [ ] **Step 2: Apply the same rule to the remaining MANDATE_* calls in this file** — the OPERATING_MODE_CHANGED test (≈L126-187, two `putEvent`s: the MANDATE_ISSUED seed and the OPERATING_MODE_CHANGED with `__version: 2`), the MANDATE_REVOKED test (≈L190-257), and the REVOKED-blocks-cycle seed+revoke (≈L260-377). For MANDATE_REVOKED keep `revokedAt` in the subject (it is in `MandateSchema`). Each: drop `tenantId`, move `userId` to `context`, rename `detail`→`subject`.

- [ ] **Step 3: Migrate the RECOMMENDATION_PROPOSED calls (≈L41-59, L329-377 revoked-block, L420-471 L1, L506-548 L2)**

For the REVOKED-block / L1 / L2 cases the subject already carries `decisionId, taskToken, awaitingCompliance, proposedTrades, portfolioValueCents, riskCategory, isInitialBuild, currentPositions` plus `tenantId, userId`. Apply the rule — example (revoked-block, ≈L329):

Before (excerpt):
```typescript
detailType: 'RECOMMENDATION_PROPOSED',
detail: {
  decisionId,
  tenantId: ctx.tenantId,
  userId,
  taskToken: `integ-task-token-${decisionId}`,
  awaitingCompliance: true,
  proposedTrades: [ /* ... */ ],
  portfolioValueCents: 100000,
  riskCategory: 'MODERATE',
  isInitialBuild: false,
  currentPositions: [{ ticker: 'AAPL', weight: 5 }],
},
```
After:
```typescript
detailType: 'RECOMMENDATION_PROPOSED',
subject: {
  decisionId,
  taskToken: `integ-task-token-${decisionId}`,
  awaitingCompliance: true,
  proposedTrades: [ /* ... unchanged ... */ ],
  portfolioValueCents: 100000,
  riskCategory: 'MODERATE',
  isInitialBuild: false,
  currentPositions: [{ ticker: 'AAPL', weight: 5 }],
},
context: { userId },
```
The first RECOMMENDATION_PROPOSED (≈L41-59) has no per-test `userId`/`tenantId` in its detail → just rename `detail:`→`subject:` (no `context`).

- [ ] **Step 4: Typecheck the file**

Run: `pnpm nx lint compliance-ctrl`
Expected: PASS — every migrated subject now satisfies its producer schema at compile time. If the compiler flags a subject field, that is a genuine co-wrong fixture; fix it to match the schema (case (a)).

- [ ] **Step 5: Commit**

```bash
git add services/advisory/compliance-ctrl/test/integration/compliance-ctrl.integration.test.ts
git commit --no-verify -m "test(compliance-ctrl): migrate integration mandate/recommendation fixtures to typed putEvent (fixes Bug A)"
```

---

## Task 7: Migrate compliance-ctrl resilience fixtures (Bug A)

**File:** `services/advisory/compliance-ctrl/test/integration/compliance-ctrl.resilience.integration.test.ts`

This file uses a `baseMandateIssued(mandateId)` helper spread into each detail. Apply the same rule; the spread stays in the subject (verify `baseMandateIssued` returns only `MandateSchema` fields — `mandateId, level, operatingMode, effectiveDate` — and contains no `tenantId/userId`; if it does, remove them from the helper).

- [ ] **Step 1: Inspect `baseMandateIssued`** (top of file). Confirm it returns only DRY mandate fields. If it includes `tenantId`/`userId`, delete those from the helper (identity is never in the subject).

- [ ] **Step 2: Migrate the duplicate-MANDATE_ISSUED idempotency test (≈L57-113)**

Before:
```typescript
const detail = {
  tenantId: ctx.tenantId,
  userId,
  ...baseMandateIssued(mandateId),
  status: 'ACTIVE',
  __version: 1,
};
await eb.putEvent({ bus: 'advisory', targetService: 'compliance-ctrl', detailType: 'MANDATE_ISSUED', detail, eventId });
// ...
await eb.putEvent({ bus: 'advisory', targetService: 'compliance-ctrl', detailType: 'MANDATE_ISSUED', detail, eventId });
```
After:
```typescript
const subject = {
  ...baseMandateIssued(mandateId),
  status: 'ACTIVE',
  __version: 1,
};
await eb.putEvent({ bus: 'advisory', targetService: 'compliance-ctrl', detailType: 'MANDATE_ISSUED', subject, context: { userId }, eventId });
// ...
await eb.putEvent({ bus: 'advisory', targetService: 'compliance-ctrl', detailType: 'MANDATE_ISSUED', subject, context: { userId }, eventId });
```

- [ ] **Step 3: Apply the same rule to the duplicate-MANDATE_REVOKED test (≈L115-186) and the order-agnostic/SQS-redelivery test (≈L203-299)** — for each `revokeDetail`/`issueDetail` object, rename to `subject`, drop `tenantId`/`userId`, and pass `context: { userId }` in each `putEvent`. Keep `revokedAt` + `__version` in the subject.

- [ ] **Step 4: Typecheck**

Run: `pnpm nx lint compliance-ctrl`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/compliance-ctrl/test/integration/compliance-ctrl.resilience.integration.test.ts
git commit --no-verify -m "test(compliance-ctrl): migrate resilience fixtures to typed putEvent (Bug A)"
```

- [ ] **Step 6: Run the compliance-ctrl integration suites against deployed dev (Bug A validation)**

Run:
```bash
NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run compliance-ctrl:test-integration
```
Expected: GREEN. (Bug A previously left the mandate projection tests red because the per-test `userId` row never existed; now the handler writes the per-test-`userId` key.) If a test still fails, read the `TableAssertions` timeout message (`Last item: …`) — a real shape/keying mismatch is a fixture bug to correct, not a backstop to loosen.

---

## Task 8: Migrate `update-operating-mode` e2e RECOMMENDATION_PROPOSED (Bug B)

**File:** `apps/e2e-feature-tests/src/profile/update-operating-mode.e2e.test.ts` (≈L195-222)

- [ ] **Step 1: Migrate the single RECOMMENDATION_PROPOSED emission**

Before:
```typescript
await eb.putEvent({
  bus: 'advisory',
  targetService: 'compliance-ctrl',
  detailType: DecisionWorkflowEventTypes.RECOMMENDATION_PROPOSED,
  detail: {
    tenantId: tenant.tenantId,
    userId: tenant.userId,
    decisionId,
    taskToken: `e2e-fake-token-${decisionId}`,
    awaitingCompliance: true,
    proposedTrades: [
      { symbol: 'QQQ', assetClass: 'EQUITY', side: 'BUY', quantityOrAmountCents: TRADE_AMOUNT, targetWeightPercent: TRADE_PERCENT, rationale: 'E2E mode-switch test trade' },
    ],
    portfolioValueCents: CAPITAL_AMOUNT,
    riskScore: 5,
    currentPositions: [],
  },
});
```
After (add the two required fields `isInitialBuild` + `riskCategory`, drop the stray `riskScore`, move identity to `context`; the real producer emits both fields — `decision-state-machine.ts` L226-227 — so this is a fixture-only fix):
```typescript
await eb.putEvent({
  bus: 'advisory',
  targetService: 'compliance-ctrl',
  detailType: DecisionWorkflowEventTypes.RECOMMENDATION_PROPOSED,
  subject: {
    decisionId,
    taskToken: `e2e-fake-token-${decisionId}`,
    awaitingCompliance: true,
    proposedTrades: [
      { symbol: 'QQQ', assetClass: 'EQUITY', side: 'BUY', quantityOrAmountCents: TRADE_AMOUNT, targetWeightPercent: TRADE_PERCENT, rationale: 'E2E mode-switch test trade' },
    ],
    portfolioValueCents: CAPITAL_AMOUNT,
    isInitialBuild: false,
    riskCategory: 'BALANCED',
    currentPositions: [],
  },
  context: { tenantId: tenant.tenantId, userId: tenant.userId },
});
```

> Note: if `DecisionWorkflowEventTypes.RECOMMENDATION_PROPOSED` (a branded `EventName & 'RECOMMENDATION_PROPOSED'`) does not resolve cleanly as the generic key `K`, replace it with the string literal `'RECOMMENDATION_PROPOSED'` (the registry key). Verify by typechecking in Step 2.

- [ ] **Step 2: Typecheck the e2e project**

Run: `pnpm nx lint e2e-feature-tests`
Expected: PASS — the subject now satisfies `RecommendationProposedSchema`; the missing `isInitialBuild`/`riskCategory` that caused the runtime `ZodError` are present, and `riskScore` (excess) is gone.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e-feature-tests/src/profile/update-operating-mode.e2e.test.ts
git commit --no-verify -m "test(e2e): type update-operating-mode RECOMMENDATION_PROPOSED subject (fixes Bug B)"
```

- [ ] **Step 4: Run the update-operating-mode e2e against deployed dev (Bug B validation)**

Run:
```bash
NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPatterns update-operating-mode
```
Expected: GREEN end-to-end (the synthetic RECOMMENDATION_PROPOSED now passes `parseSubject`, a `ComplianceCheck` is produced, and the scenario completes). If it fails-then-passes on rerun, pull CloudWatch evidence from the failing window before continuing (flake = real failure).

---

## Task 9: Regression gate — forbid legacy `detail:` in migrated dirs

Model after `tools/check-typed-subjects.mjs` (standalone Node `.mjs` scanner, exit 1 on violation). Phase 0's migrated allowlist = the compliance-ctrl test dirs.

**Files:**
- Create: `tools/check-typed-fixtures.mjs`
- Create: `tools/typed-fixture-migrated.json`
- Modify: root `package.json` (add a script)

- [ ] **Step 1: Create `tools/typed-fixture-migrated.json`** (the per-domain migrated allowlist; later phases append)

```json
{
  "migratedDirs": [
    "services/advisory/compliance-ctrl/test"
  ]
}
```

- [ ] **Step 2: Create `tools/check-typed-fixtures.mjs`**

```javascript
#!/usr/bin/env node
// Regression gate: in dirs declared "migrated" (tools/typed-fixture-migrated.json), a
// putEvent fixture must use the typed `subject:` form — the legacy `detail:` payload and
// `.subject as` casts are forbidden. The test-layer analogue of check-typed-subjects.mjs.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const { migratedDirs } = JSON.parse(readFileSync(join(root, 'tools/typed-fixture-migrated.json'), 'utf8'));

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (/\.(test|spec|integration\.test|e2e\.test)\.ts$/.test(name) || name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

const violations = [];
// Heuristic: a putEvent(...) call object that carries a `detail:` key, or a `.subject as`
// cast, inside a migrated dir. Block scan keeps it simple and dependency-free.
const DETAIL_IN_PUTEVENT = /putEvent\s*\(\s*\{[\s\S]*?\bdetail\s*:/;
const SUBJECT_CAST = /\.subject\s+as\b/;

for (const rel of migratedDirs) {
  const abs = join(root, rel);
  let files;
  try { files = walk(abs); } catch { continue; }
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    if (DETAIL_IN_PUTEVENT.test(src)) {
      violations.push(`${file}: legacy untyped putEvent({ detail: ... }) — use the typed subject:/context: form`);
    }
    if (SUBJECT_CAST.test(src)) {
      violations.push(`${file}: '.subject as' cast — fixtures must satisfy the producer schema by type, not cast`);
    }
  }
}

if (violations.length) {
  console.error('check-typed-fixtures: violations found in migrated dirs:\n' + violations.map(v => `  - ${v}`).join('\n'));
  process.exit(1);
}
console.log(`check-typed-fixtures: OK (${migratedDirs.length} migrated dir(s) clean)`);
```

- [ ] **Step 3: Add a root `package.json` script** — in the `"scripts"` block add:

```json
"check:typed-fixtures": "node tools/check-typed-fixtures.mjs",
```

- [ ] **Step 4: Run the gate to verify it passes on the migrated code**

Run: `node tools/check-typed-fixtures.mjs`
Expected: `check-typed-fixtures: OK (1 migrated dir(s) clean)` — Tasks 6+7 removed every `detail:` from compliance-ctrl fixtures.

- [ ] **Step 5: Self-test the gate (prove it actually fails on a violation)**

Run:
```bash
node -e "const{execSync}=require('child_process');const f='services/advisory/compliance-ctrl/test/integration/__gate_probe.test.ts';require('fs').writeFileSync(f,'it(\"x\",async()=>{await eb.putEvent({bus:\"b\",targetService:\"s\",detailType:\"X\",detail:{a:1}});});');let failed=false;try{execSync('node tools/check-typed-fixtures.mjs',{stdio:'pipe'})}catch(e){failed=true}require('fs').unlinkSync(f);if(!failed){console.error('GATE DID NOT FAIL ON VIOLATION');process.exit(1)}console.log('gate correctly failed on injected violation')"
```
Expected: `gate correctly failed on injected violation` (the probe file is created, the gate exits 1, the probe is deleted).

- [ ] **Step 6: Commit**

```bash
git add tools/check-typed-fixtures.mjs tools/typed-fixture-migrated.json package.json
git commit --no-verify -m "feat(gate): check-typed-fixtures forbids legacy detail: in migrated fixture dirs"
```

---

## Task 10: Phase-0 verification sweep + bug-triage log

- [ ] **Step 1: Run the affected unit/lint/typecheck gate**

```bash
AFFECTED=$(node tools/affected-projects.mjs --base=origin/main | paste -sd, -)
pnpm nx run-many -t test,lint -p "$AFFECTED"
pnpm nx run test-support:typecheck
node tools/check-typed-fixtures.mjs
```
Expected: all PASS.

- [ ] **Step 2: Record the bug-triage split (spec §7, no silent truncation)** — in the backlog file body (`docs/backlog/typed-test-fixtures-phase0.md`) note the count + (a)/(b) split:
  - Bug A (compliance-ctrl integration + resilience mandate fixtures): **case (a) fixture-only** — identity moved to context; subject typed DRY.
  - Bug B (update-operating-mode e2e RECOMMENDATION_PROPOSED): **case (a) fixture-only** — real producer (`decision-state-machine.ts` L226-227) emits `isInitialBuild`+`riskCategory`; **no latent contract bug filed**.
  - Any additional co-wrong fixture surfaced by the compiler during Tasks 6-8: list it with its (a)/(b) classification; file (b) cases via `backlog-add` (do not fix production code under this program).

- [ ] **Step 3: Commit any triage-log edits**

```bash
git add docs/backlog/typed-test-fixtures-phase0.md
git commit --no-verify -m "docs(backlog): phase-0 bug-triage log (Bug A + Bug B both case-a)"
```

---

## Self-Review

**1. Spec coverage**
- §3.1 producer event→schema maps → Task 2. §3.2 composed registry → Task 3. §3.3 typed `putEvent` + `context` + runtime backstop → Task 4. §3.4 typed read side → Task 5. §4 Phase-0 scope (mechanism + compliance-ctrl) → Tasks 1-9. §6 regression lock-in → Task 9. §7 triage log → Task 10 Step 2. §8 testing (compile-error type-test + runtime backstop unit test) → Task 4 Steps 1-9. Bug A → Tasks 6-7; Bug B → Task 8.
- `done_when` items: mechanism shipped+unit-tested ✓ (Task 4); fixture-omitting-required-field fails to compile, pinned with `@ts-expect-error` ✓ (Task 4 Step 6); runtime parse throw-path unit-tested ✓ (Task 4 Step 1); compliance-ctrl integration GREEN ✓ (Task 7 Step 6); update-operating-mode e2e GREEN, real-producer fields confirmed ✓ (Task 8 Step 4 + Task 10 Step 2); regression gate forbids untyped putEvent in compliance-ctrl fixtures ✓ (Task 9).

**2. Placeholder scan** — no "TBD"/"handle errors"/"similar to". Migration rule is stated once and applied with at least one fully-worked before/after per file; the mechanical uniformity (rename `detail`→`subject`, drop `tenantId`, move `userId`→`context`) is explicit. The only "inspect at execution" steps (Task 7 Step 1 `baseMandateIssued`, Task 8 Step 1 branded-key fallback) are genuine repo-state confirmations with a stated default action, not deferred design.

**3. Type consistency** — `RegisteredEventName`/`SubjectOf<K>`/`EventSubjects` (Task 3) used identically in Task 4. `TestEventContext` defined in Task 4 and re-exported in the same task. `putEvent` typed overload uses `subject` + `context`; legacy uses `detail`; the gate (Task 9) forbids `detail` in migrated dirs — consistent. `waitForItem<T>` default keeps all callers compiling (Task 5).

## Out of scope (Phase 0)

- Retrofitting Investor/Advisory(remaining)/Execution/Ledger fixtures (Phases 1-4 — separate epic members, filed when Phase 0 ships).
- Any production contract / producer-emission / consumer (`parseSubject`) change. Bug A and Bug B are both fixture-only; if Tasks 6-8 surface a case-(b) latent contract bug, it is filed via `backlog-add`, not fixed here.
- Extending the cross-domain-import check to test fixtures (spec §6 "optional") — deferred.
