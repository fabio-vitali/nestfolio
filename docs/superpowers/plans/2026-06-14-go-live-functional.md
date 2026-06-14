# Go-Live Functional Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the simulation→live switch actually work, as a deterministic review-and-revise wizard on investor-bff, with mandate re-affirmation audited cross-domain.

**Architecture:** A new `confirmGoLive` AppSync JS resolver on investor-bff atomically flips `executionMode='live'` (emitting `EXECUTION_MODE_CHANGED` → broker-ctrl) and re-affirms the Mandate row (emitting a new `MANDATE_REAFFIRMED` → compliance-ctrl). The dead `GO_LIVE_CONFIRMED` event + onboarding-bff go-live code are removed. The settings wizard becomes an editable review-and-revise form (risk via a bundled-resolver `updateRiskProfile`, goals/mode via existing mutations) seeded from a new `getProfile`. Covered by a deterministic Jest e2e + an extended Playwright journey.

**Tech Stack:** TypeScript, AWS CDK (cdk-constructs Facade), AppSync APPSYNC_JS (`JS_1_0_0`) JS resolvers + esbuild, DynamoDB single-table + CDC, EventBridge, event-processor pipelines, Angular 21 + Apollo (`@nestfolio/shell/graphql`), Jest 30, Playwright, `@nestfolio/test-support`.

**Spec:** `docs/superpowers/specs/2026-06-14-go-live-functional-design.md`

**Phase map (each phase is independently shippable + verifiable):**
- **P1** — sim→live switch works (closes the filed bug). investor-bff `confirmGoLive` (executionMode only) + remove `GO_LIVE_CONFIRMED` + onboarding-bff dead-code removal + Jest e2e + deploy gate.
- **P2** — revise enablers. esbuild resolver-bundling in `discoverJsResolvers` + `updateRiskProfile` resolver (imports `computeRiskProfile`). (Existing `updateGoal`/`updateOperatingMode` reused as-is.)
- **P3** — mandate re-affirm. `MANDATE_REAFFIRMED` event; fold the Mandate re-affirm write into `confirmGoLive`; advisory-adpt forward; compliance-ctrl consume.
- **P4** — frontend + UI-truth + docs. `getProfile` query + Apollo service + editable wizard + `/settings/go-live` route; Playwright journey extension; flow spec + data-flows + service cards + C4 regen.

> **Frontend regrouping note:** the spec lists "editable goals/mode in the wizard" under P2; this plan consolidates ALL frontend into P4 (the wizard is one coherent unit) and keeps P2 backend-only. Same scope, cleaner phase boundaries — each phase stays independently testable.

**Worktree:** all work happens in `/Users/fabiovitali/WebstormProjects/nestfolio/.claude/worktrees/go-live-agent-wiring`. Commit with `--no-verify` (worktree pre-commit hook can't run nx-affected) and verify each commit landed ([[feedback-worktree-commit-no-verify]]). Run nx via `pnpm nx` ([[feedback-aws-profile-in-env]] — `.env` auto-loaded; no `AWS_PROFILE` prefix for `pnpm nx`, but prefix raw `aws`/`pnpm jest`).

---

## PHASE 1 — sim→live switch works (closes the bug)

### Task 1.1: `confirmGoLive` mutation + resolver (executionMode switch only)

**Files:**
- Modify: `services/investor/investor-bff/src/schema.graphql:9-17` (add the mutation)
- Create: `services/investor/investor-bff/src/graphql/js-function/confirm-go-live.fn.js`
- Modify: `services/investor/investor-bff/src/service.stack.ts` (add `confirmGoLive` readback to `extraSteps`)
- Test: `services/investor/investor-bff/test/unit/graphql/confirm-go-live.test.ts`

- [ ] **Step 1: Write the failing resolver unit test**

Create `services/investor/investor-bff/test/unit/graphql/confirm-go-live.test.ts`:

```typescript
import { request, response } from '../../../src/graphql/js-function/confirm-go-live.fn.js';

const baseCtx = {
  stash: { tenantId: 't1', userId: 'u1', tableName: 'investor-bff-table' },
  arguments: {},
  result: {},
};

describe('confirmGoLive resolver (sim→live switch)', () => {
  it('TransactWriteItems: puts ExecutionModeChange + flips InvestorProfile executionMode to live', () => {
    const req = request(baseCtx as any);
    expect(req.operation).toBe('TransactWriteItems');
    // P1: two items (ExecutionModeChange Put + InvestorProfile Update). P3 adds the Mandate item.
    expect(req.transactItems).toHaveLength(2);

    const put = req.transactItems.find((i: any) => i.operation === 'PutItem');
    expect(put.table).toBe('investor-bff-table');
    expect(put.attributeValues.__typename.S).toBe('ExecutionModeChange');
    expect(put.attributeValues.fromMode.S).toBe('simulation');
    expect(put.attributeValues.toMode.S).toBe('live');
    expect(put.key.pk.S).toBe('InvestorProfile#t1#u1');
    expect(put.key.sk.S).toMatch(/^ExecutionModeChange#/);

    const upd = req.transactItems.find((i: any) => i.operation === 'UpdateItem');
    expect(upd.key.pk.S).toBe('InvestorProfile#t1#u1');
    expect(upd.key.sk.S).toBe('InvestorProfile');
    expect(upd.update.expression).toContain('executionMode = :mode');
    expect(upd.update.expression).toContain('#v = if_not_exists(#v, :zero) + :one');
    expect(upd.update.expressionNames['#v']).toBe('__version');
    expect(upd.condition.expression).toContain('attribute_exists(pk)');
  });

  it('maps a cancelled transaction to a clean InvalidState error', () => {
    expect(() => response({
      ...baseCtx,
      error: { message: 'cancelled', type: 'DynamoDB:TransactionCanceledException' },
    } as any)).toThrow(/go.?live/i);
  });

  it('passes ctx.result through on success (readback step returns the profile)', () => {
    expect(response(baseCtx as any)).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm nx test investor-bff -- --testPathPatterns confirm-go-live`
Expected: FAIL — `Cannot find module '.../confirm-go-live.fn.js'`.

- [ ] **Step 3: Write the resolver**

Create `services/investor/investor-bff/src/graphql/js-function/confirm-go-live.fn.js` (mirrors `update-operating-mode.fn.js` + `investor-profile.repository.ts:setExecutionMode`):

```javascript
import { util } from '@aws-appsync/utils';

// Deterministic go-live commit. P1 scope: flip executionMode simulation→live atomically
// with a write-once ExecutionModeChange audit row (CDC → EXECUTION_MODE_CHANGED → broker-ctrl).
// P3 adds a third transactItem re-affirming the Mandate row.
export function request(ctx) {
  const { tenantId, userId, tableName } = ctx.stash;
  const now = util.time.nowISO8601();
  const pk = `InvestorProfile#${tenantId}#${userId}`;
  const changeId = `${tenantId}#${userId}#${now}`;

  return {
    operation: 'TransactWriteItems',
    transactItems: [
      {
        table: tableName,
        operation: 'PutItem',
        key: util.dynamodb.toMapValues({ pk, sk: `ExecutionModeChange#${changeId}` }),
        attributeValues: util.dynamodb.toMapValues({
          __typename: 'ExecutionModeChange',
          tenantId, userId,
          changeId, fromMode: 'simulation', toMode: 'live',
          changedAt: now, timestamp: now,
        }),
      },
      {
        table: tableName,
        operation: 'UpdateItem',
        key: util.dynamodb.toMapValues({ pk, sk: 'InvestorProfile' }),
        update: {
          expression:
            'SET executionMode = :mode, updatedAt = :now, #ts = :now, #v = if_not_exists(#v, :zero) + :one',
          expressionNames: { '#ts': 'timestamp', '#v': '__version' },
          expressionValues: util.dynamodb.toMapValues({ ':mode': 'live', ':now': now, ':zero': 0, ':one': 1 }),
        },
        condition: { expression: 'attribute_exists(pk)' },
      },
    ],
  };
}

export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:TransactionCanceledException') {
      util.error('Cannot confirm go-live (profile missing or already live)', 'InvalidState');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  // TransactWriteItems returns no attributes; get-profile.fn.js readback (extraSteps) returns the profile.
  return ctx.result;
}
```

Add to `services/investor/investor-bff/src/schema.graphql` Mutation block (after `updateOperatingMode`):

```graphql
  confirmGoLive: InvestorProfile!
```

- [ ] **Step 4: Wire the readback step in service.stack.ts**

In `services/investor/investor-bff/src/service.stack.ts`, extend the `extraSteps` map inside `discoverJsResolvers(...)`:

```typescript
    extraSteps: {
      getProfile: ['get-profile-mandate.fn.js'],
      updateOperatingMode: ['get-profile.fn.js'],
      confirmGoLive: ['get-profile.fn.js'],
    },
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `pnpm nx test investor-bff -- --testPathPatterns confirm-go-live`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add services/investor/investor-bff/src/graphql/js-function/confirm-go-live.fn.js \
        services/investor/investor-bff/src/schema.graphql \
        services/investor/investor-bff/src/service.stack.ts \
        services/investor/investor-bff/test/unit/graphql/confirm-go-live.test.ts
git commit --no-verify -m "feat(investor-bff): confirmGoLive mutation flips executionMode to live"
```

---

### Task 1.2: Remove `GO_LIVE_CONFIRMED` from investor-bff (now redundant)

**Files:**
- Modify: `services/investor/investor-bff/src/handlers/event-listener.ts` (remove the `GO_LIVE_CONFIRMED` handler branch + the `GoLiveConfirmedSchema` import)
- Modify: `services/investor/investor-bff/src/service.stack.ts` (remove `GO_LIVE_CONFIRMED` from Ingress `eventTypes`)
- Modify: `services/investor/investor-bff/src/domain/events.ts` (remove `GO_LIVE_CONFIRMED`)
- Test: `services/investor/investor-bff/test/unit/handlers/event-listener.test.ts`

- [ ] **Step 1: Update the handler test first (remove the GO_LIVE_CONFIRMED case)**

In `services/investor/investor-bff/test/unit/handlers/event-listener.test.ts`, delete any `describe`/`it` block exercising `GO_LIVE_CONFIRMED` (search the file for `GO_LIVE_CONFIRMED` and remove those tests + any `setExecutionMode` expectation tied to it). If a test asserts the handler map keys, remove `GO_LIVE_CONFIRMED` from the expected set.

- [ ] **Step 2: Run the (now-reduced) test, expect PASS against current code is wrong — first confirm the removed test no longer references it**

Run: `pnpm nx test investor-bff -- --testPathPatterns event-listener`
Expected: PASS (the file still compiles; the removed cases are gone). If it FAILS because the production handler still references a now-deleted test fixture, that's expected — proceed to Step 3.

- [ ] **Step 3: Remove the production code**

In `services/investor/investor-bff/src/handlers/event-listener.ts`:
- Delete the entire `[InvestorBffEventTypes.GO_LIVE_CONFIRMED]: async (payload, ctx) => { ... setExecutionMode('simulation','live') ... }` entry from `createHandlers`.
- Remove the now-unused `import { GoLiveConfirmedSchema } from '@nestfolio/onboarding-bff/contracts';` line (keep any other onboarding-bff contract imports still used, e.g. `OnboardingCompletedRecordSchema`).
- Keep `setExecutionMode` on the repository — it is now called by the resolver path only (well, the resolver writes inline; the repo method may become unused — see Step 5).

In `services/investor/investor-bff/src/service.stack.ts`: remove the line `InvestorBffEventTypes.GO_LIVE_CONFIRMED,` from the Ingress `eventTypes` array.

In `services/investor/investor-bff/src/domain/events.ts`: remove the `GO_LIVE_CONFIRMED: eventName('GO_LIVE_CONFIRMED'),` entry from `InvestorBffEventTypes`.

- [ ] **Step 4: Check for `setExecutionMode` repo usages**

Run: `grep -rn "setExecutionMode" services/investor/investor-bff/src services/investor/investor-bff/test`
- If the only remaining references are the repository definition + its own unit test, **leave them** (harmless, still covered) — the resolver duplicates the write inline by design (resolvers can't call the repo). Do NOT delete the repo method in P1; it documents the canonical write the resolver mirrors. (A later cleanup may remove it; out of scope here.)

- [ ] **Step 5: Run investor-bff unit tests**

Run: `pnpm nx test investor-bff`
Expected: PASS. Fix any compile error from the removed event constant (e.g. a test importing `GO_LIVE_CONFIRMED`).

- [ ] **Step 6: Commit**

```bash
git add services/investor/investor-bff/src/handlers/event-listener.ts \
        services/investor/investor-bff/src/service.stack.ts \
        services/investor/investor-bff/src/domain/events.ts \
        services/investor/investor-bff/test/unit/handlers/event-listener.test.ts
git commit --no-verify -m "refactor(investor-bff): drop redundant GO_LIVE_CONFIRMED consumer (trigger now in-domain)"
```

---

### Task 1.3: Remove onboarding-bff go-live dead code

**Files:**
- Modify: `services/investor/onboarding-bff/src/service.stack.ts:22-29` (Egress map)
- Modify: `services/investor/onboarding-bff/src/domain/events.ts` (remove `GO_LIVE_CONFIRMED`)
- Modify: `services/investor/onboarding-bff/src/repositories/onboarding.repository.ts:121-151` (remove `confirmGoLive`)
- Modify: `services/investor/onboarding-bff/src/domain/schemas.ts` (remove go-live phases, `flowType`, `GoLiveConfirmedRecordSchema`)
- Modify: `services/investor/onboarding-bff/src/handlers/publisher-schemas.ts` (remove `GoLiveConfirmed` registry entry)
- Modify tests: `test/unit/repositories/onboarding.repository.test.ts`, `test/unit/domain/schemas.test.ts`, `test/unit/publisher-schemas.test.ts`

- [ ] **Step 1: Remove the go-live tests first**

- In `test/unit/repositories/onboarding.repository.test.ts`: delete the `describe('confirmGoLive', ...)` block (around line 168).
- In `test/unit/domain/schemas.test.ts`: delete the `it('accepts flowType go-live with go-live phases', ...)` test (around line 37) and any test asserting `GoLiveConfirmedRecordSchema`.
- In `test/unit/publisher-schemas.test.ts`: remove any assertion that `GoLiveConfirmed`/`GO_LIVE_CONFIRMED` is in the publisher registry.

- [ ] **Step 2: Remove the production code**

`src/service.stack.ts` — Egress becomes:
```typescript
new Egress(this, 'Egress', {
  state,
  eventTypes: {
    'OnboardingCompleted': { insert: ONBOARDING_COMPLETED },
  },
});
```
Also remove `GO_LIVE_CONFIRMED` from the import on line 9: `import { ONBOARDING_COMPLETED } from './domain/events';`

`src/domain/events.ts` — delete `export const GO_LIVE_CONFIRMED = eventName('GO_LIVE_CONFIRMED');`

`src/repositories/onboarding.repository.ts` — delete the entire `readonly confirmGoLive = this.log('confirmGoLive', ... );` block (lines 121-151).

`src/domain/schemas.ts`:
- In `OnboardingPhaseSchema`, remove the third line: `'review_risk', 'review_goals', 'review_mandate', 'fund_account', 'go_live_confirmation',`
- In `PhasesSchema`, remove the `// Go-live phases` comment + the 5 optional go-live fields (`review_risk`/`review_goals`/`review_mandate`/`fund_account`/`go_live_confirmation`).
- In `OnboardingSessionSchema`, remove the `flowType: z.enum(['initial', 'go-live']).default('initial'),` line.
- Delete `GoLiveConfirmedRecordSchema` + its type + the doc comment (lines 46-51).

`src/handlers/publisher-schemas.ts` — remove the `GoLiveConfirmed` entry from `subjectSchemas` (and from `exemptTypenames` if listed). Search for `GoLiveConfirmed`/`GO_LIVE_CONFIRMED` and remove.

Check the `./contracts` re-export: `grep -n "GoLiveConfirmed" services/investor/onboarding-bff/src/domain/schemas.ts services/investor/onboarding-bff/package.json` — remove any `GoLiveConfirmedSchema`/`GoLiveConfirmed` alias re-export.

- [ ] **Step 3: Run onboarding-bff unit tests**

Run: `pnpm nx test onboarding-bff`
Expected: PASS. Fix any dangling references the compiler flags.

- [ ] **Step 4: Verify no dangling importers remain repo-wide**

Run:
```bash
grep -rn "GO_LIVE_CONFIRMED\|GoLiveConfirmedSchema\|GoLiveConfirmedRecord\|GoLiveConfirmed\b\|flowType" services apps libs | grep -v node_modules
```
Expected: only the `go-live-wizard` frontend (handled in P4) and the `go-live.flow.yaml` (handled in P4) should remain. Backend references must be ZERO. Fix any stragglers.

- [ ] **Step 5: Commit**

```bash
git add services/investor/onboarding-bff
git commit --no-verify -m "refactor(onboarding-bff): remove dead go-live phases + GO_LIVE_CONFIRMED emission"
```

---

### Task 1.4: Deterministic Jest e2e — sim→live switch

**Files:**
- Create: `apps/e2e-feature-tests/src/account/go-live-switch.e2e.test.ts`
- Modify: `apps/e2e-feature-tests/src/investor/investor-contract-emission.e2e.test.ts` (update the gap comment ~lines 17-19)
- Modify: `apps/e2e-feature-tests/src/execution/execution-contract-emission.e2e.test.ts` (update the gap comment ~line 378)

- [ ] **Step 1: Confirm the broker-ctrl ExecutionMode row key**

Run: `grep -rn "ExecutionMode" services/execution/broker-ctrl/src | grep -i "pk\|sk\|__typename"`
Expected: confirm the row key (flow spec says `pk='ExecutionMode#{tenantId}'`, `__typename='ExecutionMode'`, `mode` field). Use the exact key found in the test below (adjust if it differs).

- [ ] **Step 2: Write the e2e scenario**

Create `apps/e2e-feature-tests/src/account/go-live-switch.e2e.test.ts`:

```typescript
/**
 * Go-live e2e — the FIRST scenario that triggers a live execution-mode switch.
 * Deterministic (no LLM in the switch itself): drives confirmGoLive as an
 * authenticated user, asserts executionMode='live' on the investor-bff profile,
 * the EXECUTION_MODE_CHANGED emission, and broker-ctrl's ExecutionMode row = 'live'.
 */
import { createTestContext, type TestContext } from '@nestfolio/test-support';
import { freshTenant, applyFixtures, onboarded, bffClient, poll, type FreshTenant } from '..';
import { armEventSubjectTrap } from '../helpers/event-subject-trap';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/events';

jest.retryTimes(1);

describe('go-live — simulation→live switch', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;
  let ddb: DynamoDBDocumentClient;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    await applyFixtures(ctx, tenant, [onboarded()]);
    ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: ctx.region }));
  }, 600_000);

  afterEach(async () => {
    ddb?.destroy();
    await ctx.cleanup.runAll();
  }, 60_000);

  it('confirmGoLive flips executionMode to live end-to-end', async () => {
    const trap = await armEventSubjectTrap(ctx, {
      bus: 'investor',
      detailType: InvestorBffEventTypes.EXECUTION_MODE_CHANGED,
    });

    const bff = bffClient(ctx, tenant);
    const res = await bff.investor.mutate<{ confirmGoLive: { executionMode: string } }>(
      `mutation { confirmGoLive { executionMode } }`,
      {},
    );
    expect(res.confirmGoLive.executionMode).toBe('live');

    // EXECUTION_MODE_CHANGED emitted
    const subject = await trap.waitForSubject(180_000);
    expect(subject['toMode']).toBe('live');

    // investor-bff profile row reflects live
    const ibTable = await ctx.ssm.tableName('investor-bff');
    const profile = await poll(async () => {
      const r = await ddb.send(new GetCommand({
        TableName: ibTable,
        Key: { pk: `InvestorProfile#${tenant.tenantId}#${tenant.userId}`, sk: 'InvestorProfile' },
      }));
      return r.Item?.['executionMode'] === 'live' ? r.Item : undefined;
    }, 60_000);
    expect(profile['executionMode']).toBe('live');

    // broker-ctrl ExecutionMode row reflects live (key confirmed in Step 1)
    const brokerTable = await ctx.ssm.tableName('broker-ctrl');
    const mode = await poll(async () => {
      const r = await ddb.send(new GetCommand({
        TableName: brokerTable,
        Key: { pk: `ExecutionMode#${tenant.tenantId}`, sk: 'ExecutionMode' },
      }));
      return r.Item?.['mode'] === 'live' ? r.Item : undefined;
    }, 180_000);
    expect(mode['mode']).toBe('live');
  }, 600_000);
});
```

- [ ] **Step 3: Update the two gap-documenting comments**

In `apps/e2e-feature-tests/src/investor/investor-contract-emission.e2e.test.ts` (~lines 17-19) replace the "NOT covered here (documented boundary): ExecutionModeChanged — no e2e fixture triggers a live execution-mode switch…" comment with: `ExecutionModeChange IS now covered by src/account/go-live-switch.e2e.test.ts (drives confirmGoLive → live).`

In `apps/e2e-feature-tests/src/execution/execution-contract-emission.e2e.test.ts` (~line 378) update the comment noting the live mode switch is now exercised by `src/account/go-live-switch.e2e.test.ts`.

- [ ] **Step 4: (Deferred to Task 1.5 deploy gate)** — do not run against dev yet; e2e runs after deploy.

- [ ] **Step 5: Commit**

```bash
git add apps/e2e-feature-tests/src/account/go-live-switch.e2e.test.ts \
        apps/e2e-feature-tests/src/investor/investor-contract-emission.e2e.test.ts \
        apps/e2e-feature-tests/src/execution/execution-contract-emission.e2e.test.ts
git commit --no-verify -m "test(e2e): deterministic go-live sim→live switch scenario"
```

---

### Task 1.5: P1 deploy + scoped validation (the bug-closing gate)

- [ ] **Step 1: Verify affected projects build + lint + unit-test**

```bash
AFFECTED=$(node tools/affected-projects.mjs --base=origin/main | paste -sd, -)
pnpm nx run-many -t test,lint -p "$AFFECTED"
```
Expected: PASS. (Should include investor-bff, onboarding-bff, e2e-feature-tests.)

- [ ] **Step 2: Deploy the affected services to dev**

```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-bff,onboarding-bff | tee /tmp/golive-p1-deploy.log
```
Expected: green deploy (broker-ctrl unchanged — it already consumes EXECUTION_MODE_CHANGED).

- [ ] **Step 3: Run the go-live e2e scenario only**

```bash
NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev \
  pnpm nx run e2e-feature-tests:test-e2e-features -- --testPathPatterns go-live-switch
```
Expected: PASS. If it fails-then-passes on the `jest.retryTimes(1)` retry, pull CloudWatch evidence from the failing window before continuing and run a second confirmation pass ([[feedback-flake-means-broken]]).

- [ ] **Step 4: Commit nothing (validation only).** Record the deploy log line + e2e PASS output as the P1 evidence (used in the backlog `validation_gate` at ship).

> **P1 is the filed bug closed.** sim→live now works end-to-end. P2–P4 add the review-and-revise richness.

---

## PHASE 2 — revise enablers (esbuild bundling + updateRiskProfile)

### Task 2.1: esbuild resolver-bundling in `discoverJsResolvers`

**Files:**
- Modify: `libs/cdk-constructs/src/core/facade.ts` (the resolver `Code` creation around line 166 + `discoverJsResolvers` file resolution)
- Test: `libs/cdk-constructs/test/core/facade.test.ts`

- [ ] **Step 1: Write the failing construct test**

Add to `libs/cdk-constructs/test/core/facade.test.ts` a test that, given a service dir containing a `<name>.fn.ts` resolver that imports a sibling module, `discoverJsResolvers` returns a resolver whose code is the **bundled** output (the import inlined, `@aws-appsync/utils` left as an external import). Use a temp fixture dir:

```typescript
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { discoverJsResolvers } from '../../src/core/facade';

it('bundles a .fn.ts resolver, inlining local imports (external @aws-appsync/utils)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'facade-bundle-'));
  mkdirSync(join(dir, 'graphql', 'js-function'), { recursive: true });
  mkdirSync(join(dir, 'domain'), { recursive: true });
  writeFileSync(join(dir, 'schema.graphql'), 'type Query { ping: String } type Mutation { doThing: String }');
  writeFileSync(join(dir, 'domain', 'calc.ts'), 'export const answer = () => 42;');
  writeFileSync(
    join(dir, 'graphql', 'js-function', 'do-thing.fn.ts'),
    `import { util } from '@aws-appsync/utils';\n` +
    `import { answer } from '../../domain/calc';\n` +
    `export function request(ctx){ return { payload: answer() }; }\n` +
    `export function response(ctx){ util.error; return ctx.result; }\n`,
  );
  const resolvers = discoverJsResolvers(dir);
  const doThing = resolvers.find(r => r.fieldName === 'doThing');
  expect(doThing).toBeDefined();
  expect(doThing!.code).toContain('42');                       // local import inlined
  expect(doThing!.code).toMatch(/@aws-appsync\/utils/);        // runtime import preserved (external)
  expect(doThing!.code).not.toMatch(/from '\.\.\/\.\.\/domain/); // local import resolved away
});
```

(Confirm the `JsResolverConfig` shape exposes `code: string` and `fieldName: string`; if it currently exposes a `Code` asset path instead, adapt this test + Step 2 to return inline code for bundled `.fn.ts`.)

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm nx test cdk-constructs -- --testPathPatterns facade`
Expected: FAIL (`.fn.ts` not discovered / not bundled).

- [ ] **Step 3: Implement bundling in `discoverJsResolvers`/`Facade`**

In `libs/cdk-constructs/src/core/facade.ts`:
- When resolving a resolver entry, prefer `<name>.fn.ts` over `<name>.fn.js`. If a `.fn.ts` exists, bundle it synchronously with esbuild; else read the raw `.fn.js` as today.

```typescript
import { buildSync } from 'esbuild';
import { existsSync, readFileSync } from 'fs';

function loadResolverCode(jsFnPath: string, fnFileName: string): string {
  const tsPath = join(jsFnPath, fnFileName.replace(/\.fn\.js$/, '.fn.ts'));
  if (existsSync(tsPath)) {
    const out = buildSync({
      entryPoints: [tsPath],
      bundle: true,
      write: false,
      format: 'esm',
      target: 'es2020',
      platform: 'neutral',
      // @aws-appsync/utils is provided by the APPSYNC_JS runtime — never bundle it.
      external: ['@aws-appsync/utils'],
      legalComments: 'none',
    });
    return out.outputFiles[0].text;
  }
  return readFileSync(join(jsFnPath, fnFileName), 'utf-8');
}
```

- Use `loadResolverCode(...)` everywhere the construct currently does `readFileSync(...fn.js)` / `Code.fromAsset(fnPath)`, and create the AppSync function with `Code.fromInline(code)` (APPSYNC_JS accepts inline code). Existing `.fn.js` resolvers go through the same helper and are byte-for-byte unchanged (no `.fn.ts` sibling ⇒ raw read).
- Ensure `esbuild` is in `libs/cdk-constructs` deps (it is a workspace dep used by the AgentRuntime pipeline; add to the lib's `package.json` if its dependency graph requires it).

- [ ] **Step 4: Run, verify it passes + existing facade tests still pass**

Run: `pnpm nx test cdk-constructs -- --testPathPatterns facade`
Expected: PASS (new test + all existing facade tests — proves raw `.fn.js` path unchanged).

- [ ] **Step 5: Commit**

```bash
git add libs/cdk-constructs/src/core/facade.ts libs/cdk-constructs/test/core/facade.test.ts libs/cdk-constructs/package.json
git commit --no-verify -m "feat(cdk-constructs): esbuild-bundle .fn.ts resolvers (shared-code imports, external @aws-appsync/utils)"
```

---

### Task 2.2: `updateRiskProfile` resolver (imports `computeRiskProfile`)

**Files:**
- Modify: `services/investor/investor-bff/src/schema.graphql` (mutation)
- Create: `services/investor/investor-bff/src/graphql/js-function/update-risk-profile.fn.ts`
- Modify: `services/investor/investor-bff/src/service.stack.ts` (`extraSteps` readback)
- Test: `services/investor/investor-bff/test/unit/graphql/update-risk-profile.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/investor/investor-bff/test/unit/graphql/update-risk-profile.test.ts`:

```typescript
import { request, response } from '../../../src/graphql/js-function/update-risk-profile.fn.ts';
import { computeRiskProfile } from '../../../src/domain/risk-profile.service';

const baseCtx = {
  stash: { tenantId: 't1', userId: 'u1', tableName: 'investor-bff-table' },
  arguments: { toleranceIdx: 3, experienceIdx: 1 },
  result: {},
};

describe('updateRiskProfile resolver', () => {
  it('recomputes riskProfile via the canonical computeRiskProfile and writes it', () => {
    const req = request(baseCtx as any);
    const expected = computeRiskProfile(3, 1);
    expect(req.operation).toBe('UpdateItem');
    expect(req.key.pk.S).toBe('InvestorProfile#t1#u1');
    expect(req.key.sk.S).toBe('InvestorProfile');
    expect(req.update.expression).toContain('riskProfile = :rp');
    expect(req.update.expression).toContain('#v = if_not_exists(#v, :zero) + :one');
    // the written riskProfile matches computeRiskProfile output (single source of truth)
    const rp = req.update.expressionValues[':rp'].M;
    expect(Number(rp.score.N)).toBe(expected.score);
    expect(rp.band.M.minEquity.N).toBe(String(expected.band.minEquity));
  });

  it('passes ctx.result through on success', () => {
    expect(response(baseCtx as any)).toEqual({});
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm nx test investor-bff -- --testPathPatterns update-risk-profile`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the resolver (`.fn.ts`, importing the owned algorithm)**

Create `services/investor/investor-bff/src/graphql/js-function/update-risk-profile.fn.ts`:

```typescript
import { util } from '@aws-appsync/utils';
import { computeRiskProfile } from '../../domain/risk-profile.service';

export function request(ctx: any) {
  const { tenantId, userId } = ctx.stash;
  const { toleranceIdx, experienceIdx } = ctx.arguments;
  const now = util.time.nowISO8601();
  const r = computeRiskProfile(toleranceIdx, experienceIdx);
  const riskProfile = {
    score: r.score,
    band: r.band,
    toleranceResponse: r.tolerance,
    experienceLevel: r.experienceLevel,
  };
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ pk: `InvestorProfile#${tenantId}#${userId}`, sk: 'InvestorProfile' }),
    update: {
      expression: 'SET riskProfile = :rp, updatedAt = :now, #ts = :now, #v = if_not_exists(#v, :zero) + :one',
      expressionNames: { '#ts': 'timestamp', '#v': '__version' },
      expressionValues: util.dynamodb.toMapValues({ ':rp': riskProfile, ':now': now, ':zero': 0, ':one': 1 }),
    },
    condition: { expression: 'attribute_exists(pk)' },
  };
}

export function response(ctx: any) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result;
}
```

Add to `schema.graphql` Mutation block:
```graphql
  updateRiskProfile(toleranceIdx: Int!, experienceIdx: Int!): InvestorProfile!
```
Add the readback to `service.stack.ts` `extraSteps`:
```typescript
      updateRiskProfile: ['get-profile.fn.js'],
```

- [ ] **Step 4: Run, verify it passes**

Run: `pnpm nx test investor-bff -- --testPathPatterns update-risk-profile`
Expected: PASS.

- [ ] **Step 5: Synth-check the bundling actually works for this resolver**

Run: `pnpm nx synth investor-bff` (or the repo's synth target — `grep -n synth services/investor/investor-bff/project.json`).
Expected: synth succeeds and the `updateRiskProfile` AppSync function code contains the inlined `computeRiskProfile` body (no unresolved `../../domain` import). If synth complains about APPSYNC_JS-unsupported syntax, the algorithm is pure arithmetic so it should pass; otherwise simplify the import surface.

- [ ] **Step 6: Commit**

```bash
git add services/investor/investor-bff/src/graphql/js-function/update-risk-profile.fn.ts \
        services/investor/investor-bff/src/schema.graphql \
        services/investor/investor-bff/src/service.stack.ts \
        services/investor/investor-bff/test/unit/graphql/update-risk-profile.test.ts
git commit --no-verify -m "feat(investor-bff): updateRiskProfile resolver reusing computeRiskProfile via bundling"
```

---

## PHASE 3 — mandate re-affirm (cross-domain to compliance-ctrl)

### Task 3.1: Declare `MANDATE_REAFFIRMED` across the event registries

**Files (confirm exact paths via grep first):**
- Modify: `services/investor/investor-bff/src/domain/events.ts` (producer/Egress side: `InvestorBffEventTypes`)
- Modify: investor-adpt cross-domain registry (`InvestorCrossDomainEventTypes`) — `grep -rln "InvestorCrossDomainEventTypes" services/advisory/compliance-ctrl/src` then open the imported module
- Modify: advisory-adpt ingest registry (`AdvisoryIngestEventTypes`) — `grep -rln "AdvisoryIngestEventTypes =" services`

- [ ] **Step 1: Locate the registries**

Run:
```bash
grep -rn "MANDATE_ISSUED" services/investor/investor-bff/src/domain/events.ts \
  $(grep -rln "InvestorCrossDomainEventTypes =" services) \
  $(grep -rln "AdvisoryIngestEventTypes =" services)
```
Note each file + the exact object the `MANDATE_ISSUED` entry sits in.

- [ ] **Step 2: Add `MANDATE_REAFFIRMED: eventName('MANDATE_REAFFIRMED'),`** next to `MANDATE_ISSUED` in each of the three registries found.

- [ ] **Step 3: Build the touched projects**

Run: `pnpm nx run-many -t test,lint -p investor-bff,investor-adpt,advisory-adpt,compliance-ctrl`
Expected: PASS (no behavior yet; just the constant exists).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit --no-verify -m "feat(events): declare MANDATE_REAFFIRMED across producer + cross-domain registries"
```

---

### Task 3.2: Emit `MANDATE_REAFFIRMED` + fold the re-affirm write into `confirmGoLive`

**Files:**
- Modify: `services/investor/investor-bff/src/service.stack.ts` (Mandate Egress `onFieldChange`)
- Modify: `services/investor/investor-bff/src/graphql/js-function/confirm-go-live.fn.js` (add the 3rd transactItem)
- Test: `services/investor/investor-bff/test/unit/graphql/confirm-go-live.test.ts`

- [ ] **Step 1: Extend the confirm-go-live test (TDD)**

In `confirm-go-live.test.ts`, change the transactItems length assertion to 3 and add:

```typescript
  it('re-affirms the Mandate row (effectiveDate + __version bump, status/level/operatingMode untouched)', () => {
    const req = request(baseCtx as any);
    expect(req.transactItems).toHaveLength(3);
    const mandate = req.transactItems.find(
      (i: any) => i.operation === 'UpdateItem' && i.key.sk.S === 'Mandate',
    );
    expect(mandate).toBeDefined();
    expect(mandate.update.expression).toContain('effectiveDate = :now');
    expect(mandate.update.expression).toContain('#v = if_not_exists(#v, :zero) + :one');
    // must NOT touch status / operatingMode (those fire other events)
    expect(mandate.update.expression).not.toContain('#status');
    expect(mandate.update.expression).not.toContain('operatingMode');
    expect(mandate.condition.expression).toContain('#status = :active'); // only re-affirm an ACTIVE mandate
  });
```

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm nx test investor-bff -- --testPathPatterns confirm-go-live`
Expected: FAIL (length 2 ≠ 3).

- [ ] **Step 3: Add the Mandate re-affirm transactItem to `confirm-go-live.fn.js`**

Append a third item to the `transactItems` array in `request(ctx)`:

```javascript
      {
        table: tableName,
        operation: 'UpdateItem',
        key: util.dynamodb.toMapValues({ pk, sk: 'Mandate' }),
        update: {
          expression: 'SET effectiveDate = :now, updatedAt = :now, #ts = :now, #v = if_not_exists(#v, :zero) + :one',
          expressionNames: { '#ts': 'timestamp', '#v': '__version' },
          expressionValues: util.dynamodb.toMapValues({ ':now': now, ':zero': 0, ':one': 1 }),
        },
        condition: {
          expression: 'attribute_exists(pk) AND #status = :active',
          expressionNames: { '#status': 'status' },
          expressionValues: util.dynamodb.toMapValues({ ':active': 'ACTIVE' }),
        },
      },
```

- [ ] **Step 4: Add the Egress mapping**

In `service.stack.ts`, extend the `Mandate` Egress entry's `onFieldChange`:

```typescript
    'Mandate': {
      insert: InvestorBffEventTypes.MANDATE_ISSUED,
      modify: {
        onFieldChange: {
          status: InvestorBffEventTypes.MANDATE_REVOKED,
          operatingMode: InvestorBffEventTypes.OPERATING_MODE_CHANGED,
          effectiveDate: InvestorBffEventTypes.MANDATE_REAFFIRMED,
        },
      },
    },
```

- [ ] **Step 5: Register the producer subject schema for the new event**

The Mandate row CDC subject already validates via `MandateSchema` (`@nestfolio/investor-adpt/domain`). Open `services/investor/investor-bff/src/handlers/publisher-schemas.ts` and ensure the publisher's typed-subject registry maps `MANDATE_REAFFIRMED` to the same Mandate schema used by `MANDATE_ISSUED`/`MANDATE_REVOKED` (copy that entry). Run `grep -n "MANDATE_ISSUED\|MandateSchema" services/investor/investor-bff/src/handlers/publisher-schemas.ts` to find the pattern.

- [ ] **Step 6: Run investor-bff tests**

Run: `pnpm nx test investor-bff`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/investor/investor-bff
git commit --no-verify -m "feat(investor-bff): confirmGoLive re-affirms Mandate → MANDATE_REAFFIRMED"
```

---

### Task 3.3: Forward `MANDATE_REAFFIRMED` investor→advisory (advisory-adpt)

**Files:**
- Modify: `services/advisory/advisory-adpt/src/service.stack.ts:40-56`
- Test: the advisory-adpt service.stack test (`grep -rln "AdvisoryIngress-FromInvestor\|fromInvestorEvents" services/advisory/advisory-adpt/test`)

- [ ] **Step 1: Update the rule test first**

In the advisory-adpt service.stack test, add `MANDATE_REAFFIRMED` to the expected `detailType` set for the `AdvisoryIngress-FromInvestor` rule (mirror the existing `MANDATE_ISSUED` assertion).

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm nx test advisory-adpt`
Expected: FAIL (constant not in the rule).

- [ ] **Step 3: Add the event to `fromInvestorEvents`**

In `services/advisory/advisory-adpt/src/service.stack.ts`:
```typescript
const fromInvestorEvents = [
  AdvisoryIngestEventTypes.INVESTOR_PROFILE_UPDATED,
  AdvisoryIngestEventTypes.MANDATE_ISSUED,
  AdvisoryIngestEventTypes.MANDATE_REVOKED,
  AdvisoryIngestEventTypes.MANDATE_REAFFIRMED,
  AdvisoryIngestEventTypes.OPERATING_MODE_CHANGED,
];
```

- [ ] **Step 4: Run, verify it passes**

Run: `pnpm nx test advisory-adpt`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/advisory-adpt
git commit --no-verify -m "feat(advisory-adpt): forward MANDATE_REAFFIRMED investor→advisory"
```

---

### Task 3.4: Consume `MANDATE_REAFFIRMED` in compliance-ctrl

**Files:**
- Modify: `services/advisory/compliance-ctrl/src/service.stack.ts:13-21` (Ingress)
- Modify: `services/advisory/compliance-ctrl/src/handlers/event-listener.ts:187-208` (handler map)
- Test: `services/advisory/compliance-ctrl/test/unit/event-listener.test.ts`

- [ ] **Step 1: Write the failing handler test**

In `compliance-ctrl/test/unit/event-listener.test.ts`, add a test that a `MANDATE_REAFFIRMED` event projects a `MandateSnapshot` (same shape as `MANDATE_ISSUED`), mirroring the existing mandate-event test. Use the same `projectMandateSnapshot` expectations (a `projectVersioned('MandateSnapshot', …)` intent with `status: 'ACTIVE'`, the bumped `__version`).

```typescript
it('projects MandateSnapshot on MANDATE_REAFFIRMED', async () => {
  const harness = makeHarness();
  const result = await harness.process([
    fakeSqsRecord('MANDATE_REAFFIRMED', {
      mandateId: 'm-1', level: 'DISCRETIONARY', status: 'ACTIVE',
      operatingMode: 'BALANCED', effectiveDate: '2026-06-14T00:00:00Z', __version: 2,
    }, { tenantId: 't-1' }),
  ]);
  expect(result.batchItemFailures).toHaveLength(0);
  expect(result.intents[0]).toMatchObject({
    _tag: 'project', typename: 'MandateSnapshot',
    fields: expect.objectContaining({ status: 'ACTIVE', operatingMode: 'BALANCED' }),
  });
});
```
(Match the exact assertion style used by the existing mandate test in this file.)

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm nx test compliance-ctrl -- --testPathPatterns event-listener`
Expected: FAIL (no handler for `MANDATE_REAFFIRMED`).

- [ ] **Step 3: Register the handler + Ingress**

In `services/advisory/compliance-ctrl/src/handlers/event-listener.ts` `createHandlers`, add:
```typescript
  handlers[InvestorCrossDomainEventTypes.MANDATE_REAFFIRMED] = (payload, ctx) =>
    projectMandateSnapshot(payload, ctx);
```
In `services/advisory/compliance-ctrl/src/service.stack.ts` Ingress `eventTypes`, add:
```typescript
    InvestorCrossDomainEventTypes.MANDATE_REAFFIRMED,
```

- [ ] **Step 4: Run, verify it passes**

Run: `pnpm nx test compliance-ctrl`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/compliance-ctrl
git commit --no-verify -m "feat(compliance-ctrl): project MandateSnapshot on MANDATE_REAFFIRMED"
```

---

### Task 3.5: P3 deploy + e2e assertion extension

- [ ] **Step 1: Extend the go-live e2e to assert the re-affirm**

In `apps/e2e-feature-tests/src/account/go-live-switch.e2e.test.ts`, add to the test: arm a second trap on `InvestorBffEventTypes.MANDATE_REAFFIRMED` before the mutation, and after `confirmGoLive` assert `await reaffirmTrap.waitForSubject(180_000)` resolves with `status: 'ACTIVE'`. Optionally poll the compliance-ctrl `MandateSnapshot` row for a bumped `__version`.

- [ ] **Step 2: Verify, deploy, run**

```bash
AFFECTED=$(node tools/affected-projects.mjs --base=origin/main | paste -sd, -)
pnpm nx run-many -t test,lint -p "$AFFECTED"
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-bff,advisory-adpt,compliance-ctrl | tee /tmp/golive-p3-deploy.log
NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev \
  pnpm nx run e2e-feature-tests:test-e2e-features -- --testPathPatterns go-live-switch
```
Expected: PASS (switch + mandate re-affirm).

- [ ] **Step 3: Commit the e2e extension**

```bash
git add apps/e2e-feature-tests/src/account/go-live-switch.e2e.test.ts
git commit --no-verify -m "test(e2e): assert MANDATE_REAFFIRMED on go-live"
```

---

## PHASE 4 — frontend + UI-truth + docs

### Task 4.1: `getProfile` query + Apollo go-live service + mutations

**Files:**
- Modify: `apps/investor-mfe/src/app/graphql/investor-bff.queries.ts` (add `GET_PROFILE`)
- Modify: `apps/investor-mfe/src/app/graphql/investor-bff.mutations.ts` (add `CONFIRM_GO_LIVE`, `UPDATE_RISK_PROFILE`, `UPDATE_GOAL`, `UPDATE_OPERATING_MODE`)
- Create: `apps/investor-mfe/src/app/services/go-live.service.ts`
- Test: `apps/investor-mfe/test/app/services/go-live.service.spec.ts`

- [ ] **Step 1: Write the failing service test**

Create `apps/investor-mfe/test/app/services/go-live.service.spec.ts` mirroring the deposit.service test style — inject a mock `GraphqlService` (`{ query: jest.fn(), mutate: jest.fn() }`), assert `getProfile()` calls `graphql.query(GET_PROFILE)` and `confirmGoLive()` calls `graphql.mutate(CONFIRM_GO_LIVE)` returning the profile.

```typescript
import { TestBed } from '@angular/core/testing';
import { GoLiveService } from '../../../src/app/services/go-live.service';
import { GraphqlService } from '@nestfolio/shell/graphql';

describe('GoLiveService', () => {
  let svc: GoLiveService;
  let graphql: { query: jest.Mock; mutate: jest.Mock };
  beforeEach(() => {
    graphql = { query: jest.fn(), mutate: jest.fn() };
    TestBed.configureTestingModule({ providers: [GoLiveService, { provide: GraphqlService, useValue: graphql }] });
    svc = TestBed.inject(GoLiveService);
  });
  it('getProfile queries getProfile', async () => {
    graphql.query.mockResolvedValue({ getProfile: { executionMode: 'simulation' } });
    const p = await svc.getProfile();
    expect(graphql.query).toHaveBeenCalled();
    expect(p.executionMode).toBe('simulation');
  });
  it('confirmGoLive mutates and returns the updated profile', async () => {
    graphql.mutate.mockResolvedValue({ confirmGoLive: { executionMode: 'live' } });
    const p = await svc.confirmGoLive();
    expect(graphql.mutate).toHaveBeenCalled();
    expect(p.executionMode).toBe('live');
  });
});
```

- [ ] **Step 2: Run, verify it fails** — `pnpm nx test investor-mfe -- --testPathPatterns go-live.service`. Expected FAIL.

- [ ] **Step 3: Add the GraphQL ops + service**

Append to `apps/investor-mfe/src/app/graphql/investor-bff.queries.ts`:
```typescript
export const GET_PROFILE = `
  query GetProfile {
    getProfile {
      operatingMode
      executionMode
      goal { objective targetAmountCents currency timeHorizonMonths targetReturn }
      riskProfile { score band { minEquity maxEquity } toleranceResponse experienceLevel }
      mandate { mandateId level status effectiveDate }
    }
  }`;
```
Append to `apps/investor-mfe/src/app/graphql/investor-bff.mutations.ts`:
```typescript
export const CONFIRM_GO_LIVE = `mutation ConfirmGoLive { confirmGoLive { executionMode } }`;
export const UPDATE_RISK_PROFILE = `
  mutation UpdateRiskProfile($toleranceIdx: Int!, $experienceIdx: Int!) {
    updateRiskProfile(toleranceIdx: $toleranceIdx, experienceIdx: $experienceIdx) {
      riskProfile { score band { minEquity maxEquity } }
    }
  }`;
export const UPDATE_GOAL = `mutation UpdateGoal($input: GoalInput!) { updateGoal(input: $input) { objective timeHorizonMonths targetAmountCents currency } }`;
export const UPDATE_OPERATING_MODE = `mutation UpdateOperatingMode($mode: OperatingMode!) { updateOperatingMode(mode: $mode) { operatingMode } }`;
```
Create `apps/investor-mfe/src/app/services/go-live.service.ts` (mirror `deposit.service.ts`'s `GraphqlService` injection):
```typescript
import { Injectable, inject } from '@angular/core';
import { GraphqlService } from '@nestfolio/shell/graphql';
import { GET_PROFILE } from '../graphql/investor-bff.queries';
import { CONFIRM_GO_LIVE, UPDATE_RISK_PROFILE, UPDATE_GOAL, UPDATE_OPERATING_MODE } from '../graphql/investor-bff.mutations';

@Injectable()
export class GoLiveService {
  private readonly graphql = inject(GraphqlService);

  async getProfile(): Promise<any> {
    const d = await this.graphql.query<{ getProfile: any }>(GET_PROFILE, {});
    return d.getProfile;
  }
  async updateRiskProfile(toleranceIdx: number, experienceIdx: number): Promise<any> {
    const d = await this.graphql.mutate<{ updateRiskProfile: any }>(UPDATE_RISK_PROFILE, { toleranceIdx, experienceIdx });
    return d.updateRiskProfile;
  }
  async updateGoal(input: Record<string, unknown>): Promise<any> {
    const d = await this.graphql.mutate<{ updateGoal: any }>(UPDATE_GOAL, { input });
    return d.updateGoal;
  }
  async updateOperatingMode(mode: string): Promise<any> {
    const d = await this.graphql.mutate<{ updateOperatingMode: any }>(UPDATE_OPERATING_MODE, { mode });
    return d.updateOperatingMode;
  }
  async confirmGoLive(): Promise<any> {
    const d = await this.graphql.mutate<{ confirmGoLive: any }>(CONFIRM_GO_LIVE, {});
    return d.confirmGoLive;
  }
}
```

- [ ] **Step 4: Run, verify it passes** — `pnpm nx test investor-mfe -- --testPathPatterns go-live.service`. Expected PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/investor-mfe/src/app/graphql apps/investor-mfe/src/app/services/go-live.service.ts apps/investor-mfe/test/app/services/go-live.service.spec.ts
git commit --no-verify -m "feat(investor-mfe): go-live Apollo service + getProfile/confirmGoLive/updateRiskProfile ops"
```

---

### Task 4.2: Wire the `/settings/go-live` route + provide GoLiveService

**Files:**
- Modify: `apps/investor-mfe/src/app/app.routes.ts` (add `settings/go-live` route, provide `GoLiveService` + `provideMfeGraphql('investor', …)` if not already at this route level)

- [ ] **Step 1: Inspect the current routes** — `cat apps/investor-mfe/src/app/app.routes.ts`. Note how `/deposit` provides graphql (`provideMfeGraphql('investor', appsyncGraphqlUrl('investor'))`).

- [ ] **Step 2: Add the route**

Add (mirroring the deposit route's providers):
```typescript
  {
    path: 'settings/go-live',
    loadComponent: () => import('./settings/go-live/go-live-wizard.component').then(m => m.GoLiveWizardComponent),
    providers: [
      ...provideMfeGraphql('investor', appsyncGraphqlUrl('investor')),
      GoLiveService,
    ],
  },
```
(Import `provideMfeGraphql`, `appsyncGraphqlUrl`, and `GoLiveService` at the top, matching the deposit route's imports.)

- [ ] **Step 3: Build** — `pnpm nx build investor-mfe`. Expected: PASS.

- [ ] **Step 4: Commit**
```bash
git add apps/investor-mfe/src/app/app.routes.ts
git commit --no-verify -m "feat(investor-mfe): route /settings/go-live with investor graphql provider"
```

---

### Task 4.3: Rebuild the go-live wizard to editable review-and-revise

**Files:**
- Modify: `apps/investor-mfe/src/app/settings/go-live/go-live-wizard.component.ts`
- Modify: `apps/investor-mfe/test/app/settings/go-live/go-live-wizard.component.spec.ts`

- [ ] **Step 1: Update the spec test first (assert mutation, not navigation)**

Replace the navigation test with one that injects a mock `GoLiveService`, seeds `getProfile` on init, and asserts `confirmGoLive()` calls `goLiveService.confirmGoLive()` (and on success navigates to `/dashboard` or shows success). Mirror the existing TestBed override pattern in the file.

```typescript
it('confirmGoLive calls the mutation and navigates to dashboard', async () => {
  goLive.confirmGoLive.mockResolvedValue({ executionMode: 'live' });
  await component.confirmGoLive();
  expect(goLive.confirmGoLive).toHaveBeenCalled();
  expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
});
```

- [ ] **Step 2: Run, verify it fails** — `pnpm nx test investor-mfe -- --testPathPatterns go-live-wizard`. Expected FAIL.

- [ ] **Step 3: Rewrite the component class**

In `go-live-wizard.component.ts`:
- Inject `GoLiveService` (replace direct go-live navigation).
- On init (`constructor`/`ngOnInit` via a signal), call `goLive.getProfile()` and store into a `profile` signal to seed the steps (risk sliders default to current tolerance/experience, goal form to current goal, mode select to current operatingMode).
- Add a `mandateAccepted` signal (the required live-mandate checkbox) gating the Confirm button.
- Per-step "save" handlers call `goLive.updateRiskProfile(...)`, `goLive.updateGoal(...)`, `goLive.updateOperatingMode(...)`.
- Rewrite `confirmGoLive()`:
```typescript
  async confirmGoLive(): Promise<void> {
    if (!this.mandateAccepted()) return;
    this.confirming.set(true);
    try {
      await this.goLive.confirmGoLive();
      await this.router.navigate(['/dashboard']);
    } finally {
      this.confirming.set(false);
    }
  }
```
- Update the template: make the review steps editable inputs (sliders/forms bound to the signals), wire the mandate checkbox to `mandateAccepted`, bind the confirm button `[disabled]="confirming() || !mandateAccepted()"`. Keep the existing `data-testid`s (`confirm-go-live-btn`, `step-next-btn`, `step-back-btn`) and add `data-testid`s for the new inputs (`risk-tolerance-input`, `goal-objective-input`, `operating-mode-select`, `mandate-accept-checkbox`).

- [ ] **Step 4: Run, verify it passes** — `pnpm nx test investor-mfe -- --testPathPatterns go-live-wizard`. Expected PASS. Then `pnpm nx test investor-mfe` (whole project).

- [ ] **Step 5: Commit**
```bash
git add apps/investor-mfe/src/app/settings/go-live apps/investor-mfe/test/app/settings/go-live
git commit --no-verify -m "feat(investor-mfe): editable review-and-revise go-live wizard calling confirmGoLive"
```

---

### Task 4.4: Playwright POM + extend the happy-path journey

**Files:**
- Create: `apps/nestfolio-e2e/src/pages/go-live.page.ts`
- Modify: `apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts`

- [ ] **Step 1: Create the POM**

Create `apps/nestfolio-e2e/src/pages/go-live.page.ts` (mirror `investor.page.ts` style — `data-testid` locators):

```typescript
import { Page, expect } from '@playwright/test';

export class GoLivePage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/investor/settings/go-live');
  }
  async acceptMandate(): Promise<void> {
    await this.page.locator('[data-testid="mandate-accept-checkbox"]').check();
  }
  async confirm(): Promise<void> {
    await this.page.locator('[data-testid="confirm-go-live-btn"]').click();
  }
  async stepThrough(): Promise<void> {
    // advance the 5 review steps to the confirm step
    for (let i = 0; i < 4; i++) {
      await this.page.locator('[data-testid="step-next-btn"]').click();
    }
  }
}
```
(Adjust the `goto` path to the host's investor mount — confirm via `grep -rn "investor" apps/nestfolio-e2e/src/pages/investor.page.ts` which uses `/investor/deposit`.)

- [ ] **Step 2: Extend the journey**

In `apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts`, after the existing advisory-confirmation step and BEFORE logout, add:

```typescript
  await test.step('investor goes live from simulation', async () => {
    const goLive = new GoLivePage(page);
    await goLive.goto();
    await goLive.stepThrough();
    await goLive.acceptMandate();
    await goLive.confirm();
    // UI-truth: dashboard reflects live mode (assert the user-visible live indicator)
    await expect(page.locator('[data-testid="execution-mode-live"]')).toBeVisible({ timeout: 30_000 });
  });
```
Import `GoLivePage` at the top. The `execution-mode-live` indicator must exist in the dashboard/host UI — if it does not, add a minimal live-mode badge to the dashboard surface that reads `executionMode` (small UI addition; assert UI truth, do not poll backend [[feedback-e2e-ui-assertions-only]]). Confirm via `grep -rn "executionMode" apps/dashboard-mfe/src apps/investor-mfe/src`.

- [ ] **Step 3: Commit (run happens in Task 4.6 after deploy)**
```bash
git add apps/nestfolio-e2e/src/pages/go-live.page.ts apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts
git commit --no-verify -m "test(e2e): extend happy-path journey through go-live (UI-truth)"
```

---

### Task 4.5: Rewrite the flow spec + regenerate derived docs

**Files:**
- Modify: `flows/go-live.flow.yaml`
- Regenerate: `docs/data-flows/`, service cards (investor-bff, onboarding-bff, compliance-ctrl), C4

- [ ] **Step 1: Rewrite `flows/go-live.flow.yaml`**

Replace the file so it reflects the new trigger + mandate hop, dropping the onboarding step + the "NOT wired" caveats. New shape:
- `trigger: investor-bff confirmGoLive mutation (AppSync) → writes executionMode='live' + ExecutionModeChange + re-affirms Mandate`
- Step 1 (investor-bff): `confirmGoLive` resolver TransactWrite → emits `EXECUTION_MODE_CHANGED` (from ExecutionModeChange:INSERT) + `MANDATE_REAFFIRMED` (from Mandate effectiveDate change) + `INVESTOR_PROFILE_UPDATED`.
- Step 2 cross_domain `EXECUTION_MODE_CHANGED`: InvestorBus→ExecutionBus via execution-adpt → broker-ctrl `ExecutionMode='live'` (unchanged from current steps 3-4).
- Step 3 cross_domain `MANDATE_REAFFIRMED`: InvestorBus→AdvisoryBus via advisory-adpt → compliance-ctrl projects `MandateSnapshot`.
- `success_criteria`: ExecutionMode row mode='live'; MandateSnapshot re-affirmed; future orders route to broker-alpaca-adpt.

- [ ] **Step 2: Validate the flow against code**

Run the `validate-flow` skill for `go-live` (it traces subscriptions/CDC/adapter rules). Resolve any mismatch it reports.

- [ ] **Step 3: Regenerate derived docs**

Run: `node .claude/skills/backlog-next/detect-doc-derivation.mjs` and run the skills it lists. At minimum:
- `audit-service investor-bff`, `audit-service onboarding-bff`, `audit-service compliance-ctrl` (regen the cards: new `confirmGoLive`/`updateRiskProfile` resolvers, removed `GO_LIVE_CONFIRMED`, new `MANDATE_REAFFIRMED`).
- `generate-c4-diagrams` (new investor→advisory mandate-reaffirm edge; removed onboarding-bff GO_LIVE_CONFIRMED edge) — then visually verify the SVGs ([[feedback-verify-diagrams]]).
- Regenerate `docs/data-flows/` from the flow specs.

- [ ] **Step 4: Commit (source + derived together)**
```bash
git add flows/go-live.flow.yaml docs/data-flows docs/architecture services/**/CLAUDE.md docs/diagrams 2>/dev/null
git commit --no-verify -m "docs(go-live): refresh flow spec + data-flows + service cards + C4"
```

---

### Task 4.6: P4 deploy + Playwright journey + final validation

- [ ] **Step 1: Verify affected**
```bash
AFFECTED=$(node tools/affected-projects.mjs --base=origin/main | paste -sd, -)
pnpm nx run-many -t test,lint -p "$AFFECTED"
```
Expected: PASS (incl. investor-mfe, nestfolio-e2e, cdk-constructs).

- [ ] **Step 2: Deploy frontend + any infra touched**
```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-bff,investor-mfe | tee /tmp/golive-p4-deploy.log
```
(investor-bff redeploy picks up the bundled `updateRiskProfile` + `confirmGoLive` mandate change if not already deployed in P2/P3.)

- [ ] **Step 3: Run the extended Playwright journey**
```bash
NESTFOLIO_INTEG_PREFIX=dev pnpm nx run nestfolio-e2e:e2e -- --grep "new-investor-happy-path"
```
Expected: PASS through go-live. If the go-live step fails-then-passes, pull CloudWatch + page snapshot evidence from the failing window ([[feedback-check-screenshot-first]], [[feedback-flake-means-broken]]) and re-run a confirmation pass. The go-live portion is deterministic — a flake there is a real UI/wiring bug, fix it (do not extend POM timeouts as a band-aid [[feedback-e2e-ui-assertions-only]]).

- [ ] **Step 4: Re-run the Jest go-live scenario** (full sim→live + mandate re-affirm) as the final backend gate:
```bash
NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev \
  pnpm nx run e2e-feature-tests:test-e2e-features -- --testPathPatterns go-live-switch
```
Expected: PASS.

- [ ] **Step 5: Record evidence** (deploy log lines + both e2e PASS outputs) for the backlog `validation_gate` at ship.

---

## Self-Review (completed during authoring)

- **Spec coverage:** D1 review-and-revise → P4 wizard; D2 deterministic/investor-bff → all backend tasks; D3 confirmGoLive + remove GO_LIVE_CONFIRMED → 1.1/1.2/1.3; D4 mandate re-affirm → P3; D5 editable risk → 2.2 + 4.3; D6 funding optional → wizard fund step links existing flow (no new backend; surfaced in 4.3 template); D7 bundling → 2.1; Jest e2e → 1.4; Playwright → 4.4; flow/docs → 4.5. All covered.
- **Placeholder scan:** every code step contains real code; mechanical removals give exact file:line + the resulting code. Registry-path lookups in 3.1 use `grep` to resolve exact files (the registries are module-located, not guessable) — these are discovery steps, not placeholders.
- **Type consistency:** resolver `request`/`response` signatures match the existing `.fn.js` pattern; `confirmGoLive` returns `InvestorProfile!` with a `get-profile.fn.js` readback (same as `updateOperatingMode`); `MANDATE_REAFFIRMED` reuses `MandateSchema` + `projectMandateSnapshot`; transactItems count evolves 2 (P1) → 3 (P3) consistently across 1.1 and 3.2 tests.

## Out of scope (from spec §7)

Broker live-trading/Alpaca routing behavior; conversational go-live; mandate level changes; mandatory funding; removing the `setExecutionMode` repo method (left as documentary).
